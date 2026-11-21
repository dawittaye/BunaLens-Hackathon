import type { SampleType } from '@/types';

export interface MarketBenchmark {
  id: string;
  sample_type: SampleType;
  grade: 'Grade 1' | 'Grade 2' | 'Grade 3' | 'Grade 4' | 'Undergrade';
  min_etb_per_feresula: number;
  max_etb_per_feresula: number;
  source_label: string;
  effective_date: string;
  is_demo: boolean;
}

// Illustrative demonstration ranges only. Replace with dated, documented local
// buyer quotes or an approved market-data feed before commercial decisions.
export const MARKET_BENCHMARKS: MarketBenchmark[] = [
  { id:'demo-green-g1',sample_type:'green_bean',grade:'Grade 1',min_etb_per_feresula:6200,max_etb_per_feresula:6900,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-green-g2',sample_type:'green_bean',grade:'Grade 2',min_etb_per_feresula:5700,max_etb_per_feresula:6199,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-green-g3',sample_type:'green_bean',grade:'Grade 3',min_etb_per_feresula:4850,max_etb_per_feresula:5699,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-green-g4',sample_type:'green_bean',grade:'Grade 4',min_etb_per_feresula:4200,max_etb_per_feresula:4849,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-green-u',sample_type:'green_bean',grade:'Undergrade',min_etb_per_feresula:2500,max_etb_per_feresula:4199,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-cherry-g1',sample_type:'red_cherry',grade:'Grade 1',min_etb_per_feresula:4200,max_etb_per_feresula:5600,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-cherry-g2',sample_type:'red_cherry',grade:'Grade 2',min_etb_per_feresula:3600,max_etb_per_feresula:4199,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-cherry-g3',sample_type:'red_cherry',grade:'Grade 3',min_etb_per_feresula:3000,max_etb_per_feresula:3599,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-cherry-g4',sample_type:'red_cherry',grade:'Grade 4',min_etb_per_feresula:2400,max_etb_per_feresula:2999,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true },
  { id:'demo-cherry-u',sample_type:'red_cherry',grade:'Undergrade',min_etb_per_feresula:1500,max_etb_per_feresula:2399,source_label:'BunaLens demonstration benchmark',effective_date:'2026-11-15',is_demo:true }
];
