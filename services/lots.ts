import { supabase } from '@/services/supabaseClient';
import type { CoffeeBatch, GradingResult, PricingAssessment, SampleType } from '@/types';
import { buildScreening } from '@/supabase/functions/_shared/screening';
import { getDemoAssessment } from '@/constants/demoSamples';

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
    .select('id,batch_code,sample_type,woreda,created_at,lot_weight_kg,station_id,verification_id,grading_status,grading_result,pricing_result,image_path,is_demo')
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
    status: !assessed ? 'queued' : data.is_demo || data.grading_status === 'demo' ? 'demo' : 'synced',
    image_path: data.image_path ?? undefined,
    result: assessed ? ({ ...UNASSESSED_RESULT, ...raw } as GradingResult) : UNASSESSED_RESULT,
    pricing: (data.pricing_result as PricingAssessment | null) ?? undefined,
  };
}

/** Short-lived link to a privately stored sample photo. Null when it cannot be read. */
export async function fetchLotPhotoUrl(imagePath: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from('coffee-samples').createSignedUrl(imagePath, 600);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/**
 * Saves a DEMO-FIXTURE assessment on a registered lot. The values are presets and the
 * photo is not analysed; the server forces the demo labels. The photo, when given,
 * is stored privately so the lot keeps its photo reference.
 */
export async function attachDemoAssessment(
  lot: { id: string; station_id?: string; sample_type: SampleType },
  defective: boolean,
  photo?: { base64: string; mimeType: string },
): Promise<void> {
  if (!supabase) throw new Error('Connect a station account to save an assessment on a lot.');
  const captureKey = 'demo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let imagePath: string | null = null;
  if (photo && lot.station_id) {
    const ext = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const clean = photo.base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, '');
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    imagePath = lot.station_id + '/' + lot.id + '-' + captureKey + '.' + ext;
    const { error: uploadError } = await supabase.storage.from('coffee-samples').upload(imagePath, bytes.buffer as ArrayBuffer, { contentType: photo.mimeType });
    if (uploadError) throw new Error('The photo could not be stored: ' + uploadError.message);
  }
  const preset = { ...getDemoAssessment(defective, lot.sample_type), ecx_grade: 'Unclassified' as const };
  const screening = buildScreening(preset, lot.sample_type, {
    source: 'demo_fixture', provider: 'bunalens-demo-fixture', model: 'none', assessedAt: new Date().toISOString(), captureKey,
  });
  const { error } = await supabase.rpc('bunalens_attach_demo_assessment', {
    p_batch_id: lot.id, p_capture_key: captureKey, p_assessment: { ...preset, screening }, p_image_path: imagePath,
  });
  if (error) throw new Error(error.message);
}

/** One input of the listing rules, with the evidence it was judged on. */
export interface EligibilityCheck {
  input: 'defect_pct' | 'bean_moisture_pct' | 'screen_size' | 'visible_damage_pct';
  label: string;
  status: 'pass' | 'fail' | 'manual_review' | 'not_applicable';
  reason: string;
  value?: number;
  unit?: string;
  method?: string;
  source?: 'measured' | 'visually_estimated' | 'reviewer_entered' | 'simulated' | 'missing';
  recorded_at?: string;
  verification_status?: 'unverified' | 'verified' | 'rejected';
}

export interface LotEligibility {
  eligibility_status: 'unreviewed' | 'eligible' | 'rejected' | 'needs_review';
  current_rule_result: {
    outcome: 'pass' | 'fail' | 'manual_review';
    reasons: string[];
    checks: EligibilityCheck[];
    policy: { id: string; label: string; is_demo: boolean };
    uses_simulated_evidence: boolean;
    official_grade: 'Unclassified';
  };
  last_decision: {
    decision: 'eligible' | 'rejected' | 'needs_review';
    decided_by: 'rule' | 'reviewer';
    reason: string;
    policy_id: string | null;
    is_override: boolean;
    decided_at: string;
    matches_current_evidence: boolean;
  } | null;
}

export async function fetchLotEligibility(batchId: string): Promise<LotEligibility> {
  if (!supabase) throw new Error('Connect a station account to see listing eligibility.');
  const { data, error } = await supabase.rpc('bunalens_lot_eligibility', { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return data as LotEligibility;
}

/** Applies the server-side listing rules to the lot and records the decision. */
export async function evaluateLotEligibility(batchId: string): Promise<void> {
  if (!supabase) throw new Error('Connect a station account to evaluate a lot.');
  const { error } = await supabase.rpc('bunalens_evaluate_lot_eligibility', { p_batch_id: batchId });
  if (error) throw new Error(error.message);
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
