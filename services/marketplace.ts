// Marketplace and order data access (hackathon sprint addition).
// Reads go through row-level security. Every write is a server function that
// checks ownership, listing state, quantity and stock.
import { supabase } from '@/services/supabaseClient';
import type { SampleType } from '@/types';

export interface ListingEvidenceInput {
  input: string;
  label: string;
  status: 'pass' | 'fail' | 'manual_review' | 'not_applicable';
  value?: number | null;
  unit?: string | null;
  method?: string | null;
  source?: 'measured' | 'visually_estimated' | 'reviewer_entered' | 'simulated' | 'missing' | null;
  recorded_at?: string | null;
  verification_status?: string | null;
}

export interface Listing {
  id: string;
  batch_id: string;
  batch_code: string | null;
  image_url?: string | null;
  station_id: string;
  seller_display_name: string;
  origin_woreda: string;
  coffee_stage: SampleType;
  available_kg: number;
  price_per_kg_etb: number;
  screening_summary: string;
  assessed_at: string | null;
  is_demo: boolean;
  status: 'draft' | 'published' | 'paused' | 'sold_out' | 'withdrawn';
  evidence_summary: {
    policy_id?: string;
    policy_is_demo?: boolean;
    eligibility_status?: string;
    decided_by?: 'rule' | 'reviewer' | null;
    decided_at?: string | null;
    is_override?: boolean;
    uses_simulated_evidence?: boolean;
    official_grade?: string;
    inputs?: ListingEvidenceInput[];
    screening?: { source: string; provider: string; model: string; assessed_at: string } | null;
  };
}

export interface CoffeeOrder {
  id: string;
  listing_id: string;
  batch_id: string;
  station_id: string;
  buyer_id: string;
  buyer_name: string;
  buyer_phone: string | null;
  quantity_kg: number;
  price_per_kg_etb: number;
  total_etb: number;
  status: 'submitted' | 'accepted' | 'declined' | 'cancelled' | 'fulfilled';
  payment_status: 'unpaid' | 'pending' | 'paid_test' | 'paid' | 'failed';
  created_at: string;
  decided_at: string | null;
  fulfilled_at: string | null;
  listing_snapshot: { seller_display_name?: string; origin_woreda?: string; coffee_stage?: SampleType; batch_code?: string; is_demo?: boolean };
}

export interface ListingFilters { origin?: string; stage?: SampleType; minPrice?: number; maxPrice?: number }

const client = () => {
  if (!supabase) throw new Error('The marketplace needs a configured Supabase connection.');
  return supabase;
};

type ListingWithPhoto = Listing & { coffee_batches?: { image_path: string | null } | { image_path: string | null }[] | null };

async function attachListingPhoto(row: ListingWithPhoto): Promise<Listing> {
  const batch = Array.isArray(row.coffee_batches) ? row.coffee_batches[0] : row.coffee_batches;
  const path = batch?.image_path;
  if (!path) return { ...row, image_url: null };
  const { data, error } = await client().storage.from('coffee-samples').createSignedUrl(path, 60 * 60);
  return { ...row, image_url: error ? null : (data?.signedUrl ?? null) };
}

/** Published listings only. The filters run on the server. */
export async function fetchListings(filters: ListingFilters = {}): Promise<Listing[]> {
  let query = client().from('marketplace_listings').select('*,coffee_batches!marketplace_listings_batch_id_fkey(image_path)').eq('status', 'published');
  if (filters.origin) query = query.eq('origin_woreda', filters.origin);
  if (filters.stage) query = query.eq('coffee_stage', filters.stage);
  if (filters.minPrice !== undefined) query = query.gte('price_per_kg_etb', filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.lte('price_per_kg_etb', filters.maxPrice);
  const { data, error } = await query.order('price_per_kg_etb', { ascending: true });
  if (error) throw new Error(error.message);
  return await Promise.all((data ?? []).map((row) => attachListingPhoto({ ...row, available_kg: Number(row.available_kg), price_per_kg_etb: Number(row.price_per_kg_etb) } as ListingWithPhoto)));
}

/** One listing the caller may read: published for everyone, any state for its own station. */
export async function fetchListing(id: string): Promise<Listing | null> {
  const { data, error } = await client().from('marketplace_listings').select('*,coffee_batches!marketplace_listings_batch_id_fkey(image_path)').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? await attachListingPhoto({ ...data, available_kg: Number(data.available_kg), price_per_kg_etb: Number(data.price_per_kg_etb) } as ListingWithPhoto) : null;
}

export async function fetchListingForLot(batchId: string): Promise<Listing | null> {
  const { data, error } = await client().from('marketplace_listings').select('*').eq('batch_id', batchId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...data, available_kg: Number(data.available_kg), price_per_kg_etb: Number(data.price_per_kg_etb) } as Listing) : null;
}

/** Seller: save the listing of an own lot. Publishing is an explicit status. */
export async function saveListing(batchId: string, availableKg: number, pricePerKgEtb: number, status: 'draft' | 'published' | 'paused' | 'withdrawn'): Promise<Listing> {
  const { data, error } = await client().rpc('bunalens_save_listing', { p_batch_id: batchId, p_available_kg: availableKg, p_price_per_kg_etb: pricePerKgEtb, p_status: status });
  if (error) throw new Error(error.message);
  return data as Listing;
}

/** Buyer: submit an order. The same key on a retry returns the same order. The total comes back from the server. */
export async function submitOrder(listingId: string, quantityKg: number, idempotencyKey: string, buyerName: string, buyerPhone?: string): Promise<{ already_submitted: boolean; order: CoffeeOrder }> {
  const { data, error } = await client().rpc('bunalens_submit_order', { p_listing_id: listingId, p_quantity_kg: quantityKg, p_idempotency_key: idempotencyKey, p_buyer_name: buyerName, p_buyer_phone: buyerPhone || null });
  if (error) throw new Error(error.message);
  return data as { already_submitted: boolean; order: CoffeeOrder };
}

/** Orders the caller may read, split into the ones they placed and the ones for their station. */
export async function fetchOrders(): Promise<{ placed: CoffeeOrder[]; incoming: CoffeeOrder[] }> {
  const { data: session } = await client().auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return { placed: [], incoming: [] };
  const { data, error } = await client().from('coffee_orders').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => ({ ...row, quantity_kg: Number(row.quantity_kg), price_per_kg_etb: Number(row.price_per_kg_etb), total_etb: Number(row.total_etb) })) as CoffeeOrder[];
  return { placed: rows.filter((row) => row.buyer_id === userId), incoming: rows.filter((row) => row.buyer_id !== userId) };
}

const orderAction = (name: string) => async (orderId: string, extra: Record<string, unknown> = {}): Promise<void> => {
  const { error } = await client().rpc(name, { p_order_id: orderId, ...extra });
  if (error) throw new Error(error.message);
};
export const acceptOrder = (orderId: string) => orderAction('bunalens_decide_order')(orderId, { p_action: 'accept' });
export const rejectOrder = (orderId: string) => orderAction('bunalens_decide_order')(orderId, { p_action: 'reject' });
export const cancelOrder = orderAction('bunalens_cancel_order');
export const fulfillOrder = orderAction('bunalens_fulfill_order');

/** A Chapa payment row of an order the caller is a party to. Amounts are records of verified checkouts, not payouts. */
export interface OrderPayment {
  order_id: string;
  chapa_tx_ref: string;
  amount_etb: number;
  currency: string;
  status: 'pending' | 'verified' | 'failed' | 'expired';
  is_test: boolean;
  verified_at: string | null;
  late_success: boolean;
}

const ORDER_PAYMENT_URL = process.env.EXPO_PUBLIC_CHAPA_ORDER_PAYMENT_URL;

// Calls the chapa-order-payment Edge Function with the user's session. The function,
// not the app, talks to Chapa and decides whether a payment is verified.
async function orderPayment<T>(body: Record<string, unknown>): Promise<T> {
  if (!ORDER_PAYMENT_URL) {
    const { data, error } = await client().functions.invoke('chapa-order-payment', { body });
    if (error) throw new Error('The payment service could not process this request.');
    return data as T;
  }
  const { data: session } = await client().auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sign in to pay for an order.');
  const response = await fetch(ORDER_PAYMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'The payment service could not process this request.');
  return json as T;
}

/** Buyer: open (or reopen) the Chapa TEST checkout of an accepted order. The amount is the stored order total. */
export const startOrderPayment = (orderId: string, idempotencyKey: string) =>
  orderPayment<{ checkout_url: string; tx_ref: string; amount_etb: number; currency: 'ETB'; test_mode: boolean; reused: boolean }>({ action: 'initialize', orderId, idempotencyKey });

/** Buyer or seller: ask the server to verify the payment with Chapa. A browser redirect alone proves nothing. */
export const verifyOrderPayment = (orderId: string) =>
  orderPayment<{ result: 'verified' | 'already_verified' | 'pending' | 'failed' | 'expired' | 'rejected' | 'late_success'; order_payment_status: string; provider_status: string }>({ action: 'verify', orderId });

/** Verified payments of orders the caller is a party to. */
export async function fetchVerifiedPayments(): Promise<OrderPayment[]> {
  const { data, error } = await client().from('coffee_order_payments')
    .select('order_id,chapa_tx_ref,amount_etb,currency,status,is_test,verified_at,late_success').eq('status', 'verified');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, amount_etb: Number(row.amount_etb) })) as OrderPayment[];
}

/** One accurate label per order. Acceptance is not payment. */
export function orderStateLabel(order: Pick<CoffeeOrder, 'status' | 'payment_status'>): string {
  if (order.status === 'submitted') return 'Order submitted';
  if (order.status === 'declined') return 'Rejected by seller';
  if (order.status === 'cancelled') return 'Cancelled';
  const payment = order.payment_status === 'paid' ? 'paid' : order.payment_status === 'paid_test' ? 'paid (TEST payment)'
    : order.payment_status === 'pending' ? 'payment pending' : order.payment_status === 'failed' ? 'payment failed' : 'not paid';
  return (order.status === 'fulfilled' ? 'Fulfilled' : 'Order accepted') + ', ' + payment;
}
