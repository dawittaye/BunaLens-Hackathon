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

/** Published listings only. The filters run on the server. */
export async function fetchListings(filters: ListingFilters = {}): Promise<Listing[]> {
  let query = client().from('marketplace_listings').select('*').eq('status', 'published');
  if (filters.origin) query = query.eq('origin_woreda', filters.origin);
  if (filters.stage) query = query.eq('coffee_stage', filters.stage);
  if (filters.minPrice !== undefined) query = query.gte('price_per_kg_etb', filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.lte('price_per_kg_etb', filters.maxPrice);
  const { data, error } = await query.order('price_per_kg_etb', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row, available_kg: Number(row.available_kg), price_per_kg_etb: Number(row.price_per_kg_etb) })) as Listing[];
}

/** One listing the caller may read: published for everyone, any state for its own station. */
export async function fetchListing(id: string): Promise<Listing | null> {
  const { data, error } = await client().from('marketplace_listings').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...data, available_kg: Number(data.available_kg), price_per_kg_etb: Number(data.price_per_kg_etb) } as Listing) : null;
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

/** One accurate label per order. Acceptance is not payment. */
export function orderStateLabel(order: Pick<CoffeeOrder, 'status' | 'payment_status'>): string {
  if (order.status === 'submitted') return 'Order submitted';
  if (order.status === 'declined') return 'Rejected by seller';
  if (order.status === 'cancelled') return 'Cancelled';
  const payment = order.payment_status === 'paid' ? 'paid' : order.payment_status === 'paid_test' ? 'paid (TEST payment)'
    : order.payment_status === 'pending' ? 'payment pending' : order.payment_status === 'failed' ? 'payment failed' : 'not paid';
  return (order.status === 'fulfilled' ? 'Fulfilled' : 'Order accepted') + ', ' + payment;
}
