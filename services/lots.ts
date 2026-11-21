import { supabase } from '@/services/supabaseClient';
import type { CoffeeBatch, GradingResult, PricingAssessment, SampleType } from '@/types';

/** State of the warehouse readings that apply to one lot. */
export type LotEnvironmentState = 'no_zone' | 'no_reading' | 'fresh' | 'stale' | 'storage_ended';

export interface LotEnvironment {
  batch_id: string;
  state: LotEnvironmentState;
  stale_after_minutes: number;
  zone?: { id: string; name: string };
  storage?: { assigned_at: string; released_at: string | null };
  device?: { device_uid: string; label: string | null; is_simulated: boolean; last_seen_at: string | null } | null;
  reading?: {
    recorded_at: string;
    received_at: string;
    temperature_c: number;
    temperature_unit: 'C';
    humidity_pct: number;
    humidity_unit: '%RH';
    source: 'live' | 'simulated';
    age_minutes: number;
  } | null;
  reading_count: number;
  checked_at: string;
  note: string;
}

export interface WarehouseZone { id: string; name: string }

const UNASSESSED_RESULT: GradingResult = {
  is_coffee_sample: true,
  ecx_grade: 'Unclassified',
  quality_score: 0,
  confidence_score: 0,
  breakdown: { sound_or_ripe_pct: 0, unripe_green_pct: 0, black_overfermented_pct: 0, insect_broken_pct: 0, foreign_matter_pct: 0 },
  estimated_price_per_feresula_etb: 0,
  potential_gain_if_sorted_etb: 0,
  export_readiness: 'Insufficient Evidence',
  sorting_action_advice: 'No sample photo has been assessed for this lot yet.',
  assessment_limitations: ['No photo assessment exists for this lot. The figures above are placeholders, not results.'],
  assessment_method: 'ai_visual_estimate',
};

/** Loads a lot the signed-in account may read (owner, reviewer or admin). */
export async function fetchCloudLot(id: string): Promise<CoffeeBatch | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('coffee_batches')
    .select('id,batch_code,sample_type,woreda,created_at,lot_weight_kg,station_id,verification_id,grading_status,grading_result,pricing_result')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data.grading_result ?? {}) as Partial<GradingResult>;
  const assessed = typeof raw.quality_score === 'number' && Boolean(raw.breakdown);
  return {
    id: data.id,
    batch_code: data.batch_code,
    sample_type: data.sample_type as SampleType,
    woreda: data.woreda,
    created_at: data.created_at,
    lot_weight_kg: Number(data.lot_weight_kg),
    station_id: data.station_id,
    verification_id: data.verification_id,
    status: assessed ? 'synced' : 'queued',
    result: assessed ? ({ ...UNASSESSED_RESULT, ...raw } as GradingResult) : UNASSESSED_RESULT,
    pricing: (data.pricing_result as PricingAssessment | null) ?? undefined,
  };
}

export async function fetchLotEnvironment(batchId: string): Promise<LotEnvironment> {
  if (!supabase) throw new Error('Connect a station account to see warehouse readings.');
  const { data, error } = await supabase.rpc('bunalens_lot_environment', { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data as LotEnvironment;
}

export async function fetchWarehouseZones(): Promise<WarehouseZone[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('warehouse_zones').select('id,name').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseZone[];
}

export async function assignLotZone(batchId: string, zoneId: string | null): Promise<void> {
  if (!supabase) throw new Error('Connect a station account to store a lot.');
  const { error } = await supabase.rpc('bunalens_assign_lot_zone', { p_batch_id: batchId, p_zone_id: zoneId });
  if (error) throw new Error(error.message);
}
