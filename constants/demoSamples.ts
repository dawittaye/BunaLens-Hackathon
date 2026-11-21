import type { GradingResult, SampleType } from '@/types';

export function getDemoAssessment(defective: boolean, sampleType: SampleType): GradingResult {
  const cherry = sampleType === 'red_cherry';
  const clean: GradingResult = {
    is_coffee_sample: true,
    ecx_grade: 'Grade 1',
    quality_score: 96,
    confidence_score: 98,
    breakdown: {
      sound_or_ripe_pct: 96,
      unripe_green_pct: 1,
      black_overfermented_pct: 1,
      insect_broken_pct: 1,
      foreign_matter_pct: 1,
    },
    estimated_price_per_feresula_etb: 0,
    potential_gain_if_sorted_etb: 0,
    export_readiness: 'Specialty Export',
    sorting_action_advice: cherry
      ? 'Demonstration only: retain uniformly ripe red cherries, remove the few visibly immature or damaged fruits, and keep foreign material out before pulping.'
      : 'Demonstration only: retain sound intact beans, hand-sort visible damaged pieces, and remove foreign matter before storage or hulling.',
    assessment_limitations: [
      'Simulated demonstration data; no photograph was analyzed.',
      'Does not measure moisture, cup quality, screen size, density or laboratory properties.',
      'Grade label is illustrative demonstration content, not an official ECX grade.',
    ],
    assessment_method: 'ai_visual_estimate',
  };
  if (!defective) return clean;
  return {
    ...clean,
    ecx_grade: 'Grade 3',
    quality_score: 72,
    confidence_score: 94,
    breakdown: cherry
      ? { sound_or_ripe_pct: 72, unripe_green_pct: 8, black_overfermented_pct: 7, insect_broken_pct: 8, foreign_matter_pct: 5 }
      : { sound_or_ripe_pct: 72, unripe_green_pct: 5, black_overfermented_pct: 8, insect_broken_pct: 10, foreign_matter_pct: 5 },
    export_readiness: 'Commercial Export',
    sorting_action_advice: cherry
      ? 'Demonstration only: separate green and immature cherries, remove blackened or overripe fruit, discard visibly insect-damaged or broken cherries, and clean out leaves and twigs before processing.'
      : 'Demonstration only: re-sort blackened or discoloured beans, remove insect-damaged and broken pieces, separate immature-looking beans, and screen out parchment, stones and other foreign matter.',
    assessment_limitations: [
      'Simulated demonstration data; no photograph was analyzed.',
      'Defect percentages are illustrative and do not represent a measured lot sample.',
      'Does not measure moisture, cup quality, screen size, density or laboratory properties.',
      'Grade label is illustrative demonstration content, not an official ECX grade.',
    ],
  };
}

export const DEMO_CLEAN = getDemoAssessment(false, 'green_bean');
export const DEMO_DEFECTIVE = getDemoAssessment(true, 'green_bean');
