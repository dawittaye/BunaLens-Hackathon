import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { CoffeeBatch, SampleType } from '@/types';
import { getSupabaseAccessToken } from '@/services/supabaseClient';
import { validateGradingResult } from '@/services/geminiVision';

const KEY = 'bunalens.offline.queue';
const QUEUE_DIR = (FileSystem.documentDirectory || '') + 'bunalens-queue/';
const endpoint = process.env.EXPO_PUBLIC_BUNALENS_SYNC_URL;
let syncInProgress = false;

export interface QueuedCapture {
  id: string;
  batch_code?: string;
  /** Existing registered lot this capture belongs to; kept so a later sync stays attached to it. */
  batch_id?: string;
  image_uri: string;
  sample_type: SampleType;
  woreda: string;
  lot_weight_kg: number;
  created_at: string;
  station_id?: string;
  mime_type?: string;
}

export async function getQueue(stationId?: string): Promise<QueuedCapture[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.image_uri === 'string' && (stationId === undefined || (item.station_id ?? 'station-demo') === stationId)) as QueuedCapture[] : [];
  } catch { return []; }
}

async function saveQueue(items: QueuedCapture[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function persistLocalImage(uri: string, id: string, mimeType = 'image/jpeg'): Promise<string> {
  // Browsers expose no document directory; the picked/captured URI is already
  // displayable, so keep it instead of failing the capture.
  if (!FileSystem.documentDirectory) {
    if (Platform.OS === 'web') return uri;
    throw new Error('Local document storage is unavailable.');
  }
  const dir = FileSystem.documentDirectory + 'bunalens-batches/';
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const target = dir + id + '.' + ext;
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) return target;
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

export async function enqueueCapture(item: QueuedCapture) {
  const current = await getQueue();
  if (current.some((queued) => queued.id === item.id)) return;
  if (!FileSystem.documentDirectory) throw new Error('Local document storage is unavailable on this device.');
  if (!Number.isFinite(item.lot_weight_kg) || item.lot_weight_kg <= 0) throw new Error('The queued lot weight is invalid.');
  await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
  const extension = item.mime_type === 'image/png' ? 'png' : item.mime_type === 'image/webp' ? 'webp' : 'jpg';
  const destination = QUEUE_DIR + item.id + '.' + extension;
  const existing = await FileSystem.getInfoAsync(destination);
  if (!existing.exists) await FileSystem.copyAsync({ from: item.image_uri, to: destination });
  await saveQueue([{ ...item, image_uri: destination }, ...current]);
}

export async function assignQueuedStation(stationId: string) {
  const queue = await getQueue();
  await saveQueue(queue.map((item) => !item.station_id || item.station_id === 'station-demo' ? { ...item, station_id: stationId } : item));
}

export async function isOnline() {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export async function syncQueuedCaptures(stationId: string): Promise<{ synced: CoffeeBatch[]; remaining: number }> {
  if (syncInProgress) return { synced: [], remaining: (await getQueue(stationId)).length };
  syncInProgress = true;
  try {
    if (stationId === 'station-demo') throw new Error('Sign in to a registered station before synchronizing queued captures.');
    if (!endpoint) throw new Error('Offline sync is not configured. Set EXPO_PUBLIC_BUNALENS_SYNC_URL to the coffee-sync Edge Function URL.');
    const token = await getSupabaseAccessToken();
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !anonKey) throw new Error('Sign in to a registered station before synchronizing queued captures.');
    if (!(await isOnline())) throw new Error('No internet connection.');
    const queue = await getQueue(stationId);
    const synced: CoffeeBatch[] = [];
    for (const item of queue) {
      try {
        if (!item.station_id || item.station_id === 'station-demo') break;
        const info = await FileSystem.getInfoAsync(item.image_uri);
        if (!info.exists) break;
        const imageBase64 = await FileSystem.readAsStringAsync(item.image_uri, { encoding: FileSystem.EncodingType.Base64 });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45_000);
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: 'Bearer ' + token },
            body: JSON.stringify({
              idempotency_key: item.id, batch_code: item.batch_code, batch_id: item.batch_id, station_id: item.station_id, sample_type: item.sample_type,
              woreda: item.woreda, lot_weight_kg: item.lot_weight_kg, captured_at: item.created_at,
              image_mime_type: item.mime_type || 'image/jpeg', image_base64: imageBase64,
            }),
          });
        } finally { clearTimeout(timeout); }
        if (!response.ok) break;
        let payload: { batch?: CoffeeBatch };
        try { payload = await response.json() as { batch?: CoffeeBatch }; } catch { break; }
        const batch = payload.batch;
        if (!batch?.id || !batch.batch_code || !batch.result || !batch.station_id) break;
        const result = validateGradingResult(batch.result);
        if (!result.is_coffee_sample) break;
        const permanentImage = await persistLocalImage(item.image_uri, item.id, item.mime_type || 'image/jpeg').catch(() => null);
        const completedBatch: CoffeeBatch = { ...batch, result, image_uri: permanentImage || item.image_uri, status: 'synced' };
        // The authenticated station reloads the authoritative record after a restart.
        synced.push(completedBatch);
        const latest = await getQueue();
        await saveQueue(latest.filter((queued) => queued.id !== item.id));
        if (permanentImage && permanentImage !== item.image_uri) await FileSystem.deleteAsync(item.image_uri, { idempotent: true }).catch(() => undefined);
      } catch {
        break;
      }
    }
    return { synced, remaining: (await getQueue()).length };
  } finally {
    syncInProgress = false;
  }
}
