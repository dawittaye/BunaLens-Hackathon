import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { getSupabaseAccessToken } from '@/services/supabaseClient';

export type ChapaPackage = 'starter_50' | 'station_pro_monthly';
export const CHAPA_PACKAGES = {
  starter_50: { id: 'starter_50', name: 'Starter Pack', amount_etb: 500, credits: 50 },
  station_pro_monthly: { id: 'station_pro_monthly', name: 'Washing Station Pro', amount_etb: 2500, period_days: 30 },
} as const;

export type CheckoutResult =
  | { mode: 'demo'; transactionId: string; packageId: ChapaPackage; amountEtb: number; credits: number; proDays: number; alreadyGranted: boolean }
  | { mode: 'external'; transactionId: string };

const DEMO_TRANSACTIONS_KEY = 'bunalens.demo.transactions';
const PENDING_KEYS_KEY = 'bunalens.chapa.pending.keys';

async function readObject<T>(key: string, fallback: T): Promise<T> {
  try { return (JSON.parse((await AsyncStorage.getItem(key)) || 'null') as T) ?? fallback; } catch { return fallback; }
}

export async function getDemoPaymentHistory(): Promise<Array<Record<string, unknown>>> {
  return readObject(DEMO_TRANSACTIONS_KEY, []);
}

async function runDemoTransaction(packageId: ChapaPackage, stationId: string): Promise<CheckoutResult> {
  const selected = CHAPA_PACKAGES[packageId];
  const transactionId = 'BNL-DEMO-' + stationId + '-' + packageId + '-' + Math.floor(Date.now() / 60_000);
  const history = await getDemoPaymentHistory();
  const alreadyGranted = history.some((item) => item.transactionId === transactionId);
  if (!alreadyGranted) {
    history.unshift({
      transactionId, stationId, packageId, amountEtb: selected.amount_etb,
      status: 'demo_succeeded', createdAt: new Date().toISOString(),
      note: 'Simulated local demonstration. No Chapa request was made and no money was charged.',
    });
    await AsyncStorage.setItem(DEMO_TRANSACTIONS_KEY, JSON.stringify(history.slice(0, 100)));
  }
  return {
    mode: 'demo', transactionId, packageId, amountEtb: selected.amount_etb,
    credits: 'credits' in selected ? selected.credits : 0,
    proDays: 'period_days' in selected ? selected.period_days : 0,
    alreadyGranted,
  };
}

export async function startChapaCheckout(packageId: ChapaPackage, stationId: string): Promise<CheckoutResult> {
  const selected = CHAPA_PACKAGES[packageId];
  if (!selected || !stationId) throw new Error('Select a valid package and station.');
  const endpoint = process.env.EXPO_PUBLIC_CHAPA_INITIALIZE_URL;
  const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE !== 'false' ||
    process.env.EXPO_PUBLIC_CHAPA_DEMO_MODE === 'true' ||
    process.env.EXPO_PUBLIC_ENABLE_REAL_PAYMENTS !== 'true' || !endpoint;
  if (demoMode) return runDemoTransaction(packageId, stationId);

  const token = await getSupabaseAccessToken();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !anonKey) throw new Error('Sign in to a registered station before starting a real Chapa payment.');

  const pendingKeys = await readObject<Record<string, string>>(PENDING_KEYS_KEY, {});
  const idempotencyKey = pendingKeys[packageId] || 'bunalens-' + stationId + '-' + packageId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  pendingKeys[packageId] = idempotencyKey;
  await AsyncStorage.setItem(PENDING_KEYS_KEY, JSON.stringify(pendingKeys));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: 'Bearer ' + token },
      body: JSON.stringify({ packageId, stationId, idempotencyKey }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Payment initialization timed out. No payment was confirmed; retry using the same checkout.');
    throw new Error('Could not reach the payment service. No payment was confirmed.');
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({})) as { checkout_url?: string; tx_ref?: string; error?: string };
  if (!response.ok) {
    if (response.status === 503 && (data.error || '').toLowerCase().includes('not configured')) {
      return runDemoTransaction(packageId, stationId);
    }
    throw new Error(data.error || 'Checkout initialization failed. No credits were added.');
  }
  if (!data.checkout_url || !data.tx_ref) throw new Error('The payment service did not return a valid checkout reference.');
  let checkout: URL;
  try { checkout = new URL(data.checkout_url); } catch { throw new Error('The payment service returned an invalid checkout URL.'); }
  if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.chapa.co') {
    throw new Error('The payment service returned an untrusted checkout destination.');
  }
  const browser = await WebBrowser.openBrowserAsync(checkout.toString());
  if (browser.type !== 'cancel') {
    delete pendingKeys[packageId];
    await AsyncStorage.setItem(PENDING_KEYS_KEY, JSON.stringify(pendingKeys));
  }
  return { mode: 'external', transactionId: data.tx_ref };
}
