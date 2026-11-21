import type { GradingResult, SampleType } from '@/types';
import { MARKET_BENCHMARKS } from '@/constants/marketBenchmarks';

export const KG_PER_FERESULA = 17;

export function priceAssessment(sampleType: SampleType, grade: GradingResult['ecx_grade'], lotWeightKg: number) {
  const benchmark = MARKET_BENCHMARKS.find(x => x.sample_type === sampleType && x.grade === grade);
  if (!benchmark) throw new Error('No market benchmark is configured for this sample and grade.');
  const midpoint = Math.round((benchmark.min_etb_per_feresula + benchmark.max_etb_per_feresula) / 2);
  const lowPerKg = benchmark.min_etb_per_feresula / KG_PER_FERESULA;
  const highPerKg = benchmark.max_etb_per_feresula / KG_PER_FERESULA;
  return {
    benchmark_id: benchmark.id,
    source_label: benchmark.source_label,
    effective_date: benchmark.effective_date,
    is_demo: benchmark.is_demo,
    min_etb_per_feresula: benchmark.min_etb_per_feresula,
    max_etb_per_feresula: benchmark.max_etb_per_feresula,
    estimated_price_per_feresula_etb: midpoint,
    estimated_price_per_kg_etb: Number((midpoint / KG_PER_FERESULA).toFixed(2)),
    min_lot_value_etb: Math.round(lowPerKg * lotWeightKg),
    max_lot_value_etb: Math.round(highPerKg * lotWeightKg),
    estimated_lot_value_etb: Math.round((midpoint / KG_PER_FERESULA) * lotWeightKg),
    potential_sorting_gain_etb: Math.round((benchmark.max_etb_per_feresula - midpoint) * lotWeightKg / KG_PER_FERESULA)
  };
}
