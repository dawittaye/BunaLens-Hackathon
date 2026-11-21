import type { CoffeeBatch, GradingResult, GradingBreakdown, SampleType } from '@/types';
import { getSupabaseAccessToken } from '@/services/supabaseClient';

const SYNC_URL = process.env.EXPO_PUBLIC_BUNALENS_SYNC_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PERCENT_KEYS: (keyof GradingBreakdown)[] = [
  'sound_or_ripe_pct', 'unripe_green_pct', 'black_overfermented_pct',
  'insect_broken_pct', 'foreign_matter_pct',
];
const GRADES = ['Unclassified'] as const;
const READINESS = ['Specialty Export', 'Commercial Export', 'Local Market Only', 'Reject / Re-sort', 'Insufficient Evidence'] as const;

export class GradingServiceError extends Error {
  constructor(message: string, readonly code: 'configuration' | 'auth' | 'timeout' | 'network' | 'invalid_response' | 'rejected' | 'server') {
    super(message);
    this.name = 'GradingServiceError';
  }
}

/** Strictly validates the model contract. Small rounding drift (<=2 points) is normalized;
 * invalid or materially incomplete percentages are rejected, never silently repaired. */
export function validateGradingResult(value: unknown): GradingResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GradingServiceError('The assessment response was not a valid object. Retake the sample photograph.', 'invalid_response');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.is_coffee_sample !== 'boolean') throw new GradingServiceError('The assessment is missing its coffee-sample classification.', 'invalid_response');
  if (v.rejection_reason !== undefined && typeof v.rejection_reason !== 'string') throw new GradingServiceError('The assessment contains an invalid rejection reason.', 'invalid_response');
  if (typeof v.quality_score !== 'number' || !Number.isFinite(v.quality_score) || v.quality_score < 0 || v.quality_score > 100) {
    throw new GradingServiceError('The assessment returned an invalid quality score.', 'invalid_response');
  }
  if (typeof v.confidence_score !== 'number' || !Number.isFinite(v.confidence_score) || v.confidence_score < 0 || v.confidence_score > 100) {
    throw new GradingServiceError('The assessment returned an invalid confidence score.', 'invalid_response');
  }
  if (!GRADES.includes(v.ecx_grade as typeof GRADES[number])) throw new GradingServiceError('The assessment returned an unsupported grade label.', 'invalid_response');
  if (!READINESS.includes(v.export_readiness as typeof READINESS[number])) throw new GradingServiceError('The assessment returned an unsupported readiness label.', 'invalid_response');
  if (!v.breakdown || typeof v.breakdown !== 'object' || Array.isArray(v.breakdown)) throw new GradingServiceError('The assessment is missing its defect breakdown.', 'invalid_response');
  const raw = v.breakdown as Record<string, unknown>;
  const percentages = PERCENT_KEYS.map((key) => raw[key]);
  if (percentages.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100)) {
    throw new GradingServiceError('One or more defect percentages are invalid. Retake the photograph.', 'invalid_response');
  }
  const total = (percentages as number[]).reduce((sum, n) => sum + n, 0);
  if (Math.abs(total - 100) > 2) throw new GradingServiceError('The defect percentages do not total approximately 100%. The assessment was rejected.', 'invalid_response');
  const normalized = percentages as number[];
  const breakdown = Object.fromEntries(PERCENT_KEYS.map((key, index) => [key, Number(((normalized[index] ?? 0) * 100 / total).toFixed(1))])) as unknown as GradingBreakdown;
  const price = v.estimated_price_per_feresula_etb;
  const gain = v.potential_gain_if_sorted_etb;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
      typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0) {
    throw new GradingServiceError('The assessment contains invalid financial fields. No financial estimate was accepted.', 'invalid_response');
  }
  if (typeof v.sorting_action_advice !== 'string' || !v.sorting_action_advice.trim()) {
    throw new GradingServiceError('The assessment is missing practical sorting advice.', 'invalid_response');
  }
  if (!Array.isArray(v.assessment_limitations) || v.assessment_limitations.some((item) => typeof item !== 'string')) {
    throw new GradingServiceError('The assessment is missing its limitations statement.', 'invalid_response');
  }
  if (v.assessment_method !== 'ai_visual_estimate') throw new GradingServiceError('The assessment method is not recognized.', 'invalid_response');
  return {
    is_coffee_sample: v.is_coffee_sample,
    ...(typeof v.rejection_reason === 'string' ? { rejection_reason: v.rejection_reason.slice(0, 300) } : {}),
    ecx_grade: v.ecx_grade as GradingResult['ecx_grade'],
    quality_score: v.quality_score,
    confidence_score: v.confidence_score,
    breakdown,
    estimated_price_per_feresula_etb: price,
    potential_gain_if_sorted_etb: gain,
    export_readiness: v.export_readiness as GradingResult['export_readiness'],
    sorting_action_advice: v.sorting_action_advice.slice(0, 1000),
    assessment_limitations: (v.assessment_limitations as string[]).slice(0, 12).map((s) => s.slice(0, 300)),
    assessment_method: 'ai_visual_estimate',
    ...(isScreening(v.screening) ? { screening: v.screening } : {}),
  };
}

/** Shape check for the server-built screening summary; anything else is dropped. */
function isScreening(value: unknown): value is NonNullable<GradingResult['screening']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  const photo = s.photo as Record<string, unknown> | undefined;
  return s.schema_version === 1 && (s.source === 'live_inference' || s.source === 'demo_fixture') &&
    (s.sample_stage === 'red_cherry' || s.sample_stage === 'green_bean') && s.official_grade === 'Unclassified' &&
    typeof s.provider === 'string' && typeof s.model === 'string' && typeof s.assessed_at === 'string' &&
    typeof s.next_action === 'string' && typeof s.needs_review === 'boolean' &&
    [s.observations, s.suspected_defects, s.not_assessed, s.limitations, s.review_reasons].every(Array.isArray) &&
    Boolean(photo) && typeof photo === 'object' && Array.isArray(photo?.issues);
}

export async function submitCoffeeSample(
  base64: string, sampleType: SampleType, woreda: string, stationId: string,
  idempotencyKey: string, lotWeightKg: number, mimeType = 'image/jpeg',
  coordinates?: { latitude: number; longitude: number }, batchCode?: string,
  /** Existing registered lot this photo belongs to. Omit to create a new record. */
  batchId?: string,
): Promise<CoffeeBatch> {
  if (process.env.EXPO_PUBLIC_DEMO_MODE === 'true') {
    throw new GradingServiceError('Demo mode is enabled. Use a clearly labelled demo sample or set EXPO_PUBLIC_DEMO_MODE=false to enable authenticated cloud grading.', 'configuration');
  }
  if (!SYNC_URL) throw new GradingServiceError('Cloud grading is not configured. Use a clearly labelled offline demonstration or configure the secure sync service.', 'configuration');
  if (!SUPABASE_ANON_KEY) throw new GradingServiceError('Cloud authentication is not configured for this build.', 'configuration');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ||
      typeof base64 !== 'string' || base64.length < 32 || base64.length > 14_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, ''))) {
    throw new GradingServiceError('The selected image is invalid or exceeds the 10 MB limit.', 'invalid_response');
  }
  if (!Number.isFinite(lotWeightKg) || lotWeightKg <= 0 || lotWeightKg > 100000) throw new GradingServiceError('Enter a valid positive lot weight before grading.', 'invalid_response');
  const token = await getSupabaseAccessToken();
  if (!token) throw new GradingServiceError('Sign in to a registered washing station before grading a real sample.', 'auth');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  try {
    response = await fetch(SYNC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        station_id: stationId, idempotency_key: idempotencyKey, sample_type: sampleType,
        woreda, lot_weight_kg: lotWeightKg, captured_at: new Date().toISOString(),
        image_mime_type: mimeType,
        image_base64: base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, ''),
        gps_latitude: coordinates?.latitude, gps_longitude: coordinates?.longitude, batch_code: batchCode,
        batch_id: batchId,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new GradingServiceError('The assessment took too long. Check your connection and try again.', 'timeout');
    throw new GradingServiceError('Could not reach the grading service. Your photograph can be saved and retried when connected.', 'network');
  } finally {
    clearTimeout(timeout);
  }
  let payload: { batch?: CoffeeBatch; error?: string };
  try { payload = await response.json() as { batch?: CoffeeBatch; error?: string }; }
  catch { throw new GradingServiceError('The grading service returned malformed data. No result was saved.', 'invalid_response'); }
  if (!response.ok) {
    if (response.status === 422) throw new GradingServiceError(payload.error || 'This image could not be confirmed as the selected coffee sample.', 'rejected');
    throw new GradingServiceError(payload.error || 'Cloud grading is temporarily unavailable (HTTP ' + response.status + ').', response.status >= 500 ? 'server' : 'auth');
  }
  const batch = payload.batch;
  if (!batch?.id || !batch.batch_code || !batch.sample_type || !batch.woreda || !batch.created_at ||
      !Number.isFinite(batch.lot_weight_kg) || !batch.station_id) {
    throw new GradingServiceError('The cloud service returned an incomplete batch record.', 'invalid_response');
  }
  const result = validateGradingResult(batch.result);
  if (!result.is_coffee_sample) throw new GradingServiceError(result.rejection_reason || 'The image does not appear to contain the selected coffee sample.', 'rejected');
  return { ...batch, result };
}
