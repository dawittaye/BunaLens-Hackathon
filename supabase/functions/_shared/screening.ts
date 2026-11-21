// Lot screening summary shared by the coffee-sync Edge Function (Deno) and the
// app (React Native). Pure TypeScript with no imports so both can load it.
//
// It turns one model's visual composition estimate into plain feedback for a
// station operator. It deliberately does not:
//   * infer bean moisture, physical size, density or cup quality from a photo,
//   * turn a confidence score into a defect percentage,
//   * turn image classification into bean counts,
//   * assign an official grade (always "Unclassified"),
//   * combine or average the outputs of different models.

export type ScreeningStage = "red_cherry" | "green_bean";
export type ScreeningSource = "live_inference" | "demo_fixture";
export type PhotoIssue = "blurry" | "too_dark" | "glare" | "too_few_visible" | "overlapping" | "partial_view";
export type SizeVariation = "appears_uniform" | "appears_mixed" | "not_assessable";

export interface ScreeningBreakdown {
  sound_or_ripe_pct: number;
  unripe_green_pct: number;
  black_overfermented_pct: number;
  insect_broken_pct: number;
  foreign_matter_pct: number;
}

/** The parts of a model assessment this module reads. */
export interface ScreeningInput {
  breakdown: ScreeningBreakdown;
  confidence_score: number;
  export_readiness?: string;
  assessment_limitations?: string[];
  /** Optional fields a model may return. Absent means "not reported". */
  photo_issues?: PhotoIssue[];
  apparent_size_variation?: SizeVariation;
  visible_observations?: string[];
}

export interface SuspectedDefect {
  key: keyof ScreeningBreakdown;
  label: string;
  /** The model's estimate of the share of the visible sample. Not a count and not a lab result. */
  visible_share_pct: number;
  level: "low" | "moderate" | "high";
}

export interface LotScreening {
  schema_version: 1;
  source: ScreeningSource;
  provider: string;
  model: string;
  assessed_at: string;
  sample_stage: ScreeningStage;
  official_grade: "Unclassified";
  observations: string[];
  suspected_defects: SuspectedDefect[];
  apparent_size_variation: SizeVariation;
  not_assessed: string[];
  limitations: string[];
  next_action: string;
  photo: { usable: boolean; issues: PhotoIssue[]; retake_guidance: string | null };
  needs_review: boolean;
  review_reasons: string[];
  /** Capture key of the request that produced this assessment, for safe retries. */
  capture_key?: string;
}

export const LOW_CONFIDENCE_THRESHOLD = 60;
const DEFECT_REPORT_FROM_PCT = 3;

const LABELS: Record<ScreeningStage, Record<keyof ScreeningBreakdown, string>> = {
  red_cherry: {
    sound_or_ripe_pct: "Ripe red cherries",
    unripe_green_pct: "Unripe or green cherries",
    black_overfermented_pct: "Blackened, shrivelled or over-ripe cherries",
    insect_broken_pct: "Insect-damaged or broken cherries",
    foreign_matter_pct: "Leaves, twigs, stones or other foreign matter",
  },
  green_bean: {
    sound_or_ripe_pct: "Intact, normal-looking beans",
    unripe_green_pct: "Pale or immature-looking beans",
    black_overfermented_pct: "Black or discoloured beans",
    insect_broken_pct: "Insect-damaged, chipped or broken beans",
    foreign_matter_pct: "Husk, parchment, stones or other foreign matter",
  },
};

const ACTIONS: Record<ScreeningStage, Record<keyof ScreeningBreakdown, string>> = {
  red_cherry: {
    sound_or_ripe_pct: "Keep this lot separate and pulp it promptly; no extra sorting is suggested by this photo.",
    unripe_green_pct: "Hand-sort or float the cherries to remove unripe green fruit before pulping, and ask pickers to harvest only fully red cherries.",
    black_overfermented_pct: "Remove blackened and over-ripe cherries before pulping, and shorten the time between picking and delivery.",
    insect_broken_pct: "Pick out insect-damaged and broken cherries before pulping, and check the plot for berry borer.",
    foreign_matter_pct: "Clean leaves, twigs and stones out of the cherries before weighing and pulping.",
  },
  green_bean: {
    sound_or_ripe_pct: "Keep this lot separate, dry and off the floor; no extra sorting is suggested by this photo.",
    unripe_green_pct: "Hand-sort pale and immature-looking beans out of the lot before storage.",
    black_overfermented_pct: "Hand-sort black and discoloured beans out of the lot, and review fermentation and drying times for the next batch.",
    insect_broken_pct: "Hand-sort insect-damaged and broken beans out of the lot, and check hulling settings and storage for pests.",
    foreign_matter_pct: "Screen or winnow the lot to remove husk, parchment and stones before storage.",
  },
};

const RETAKE: Record<PhotoIssue, string> = {
  blurry: "hold the phone steady and tap to focus",
  too_dark: "move to open shade or brighter even light",
  glare: "avoid direct sun and flash reflections",
  too_few_visible: "spread at least a handful of the sample so more of it is visible",
  overlapping: "spread the sample in a single layer so pieces do not cover each other",
  partial_view: "fit the whole sample inside the frame",
};

const NOT_ASSESSED: string[] = [
  "Bean moisture: a photo cannot measure it. Use a moisture meter.",
  "Physical bean size or screen size: the photo has no size reference.",
  "Cup quality, aroma, density and hidden defects.",
  "Official grade: no validated grading process is configured, so the grade stays Unclassified.",
];

const DEFECT_KEYS: (keyof ScreeningBreakdown)[] = [
  "unripe_green_pct", "black_overfermented_pct", "insect_broken_pct", "foreign_matter_pct",
];

const level = (pct: number): SuspectedDefect["level"] => (pct >= 10 ? "high" : pct >= 5 ? "moderate" : "low");

export function buildScreening(
  input: ScreeningInput,
  stage: ScreeningStage,
  meta: { source: ScreeningSource; provider: string; model: string; assessedAt: string; captureKey?: string },
): LotScreening {
  const labels = LABELS[stage];
  const share = (key: keyof ScreeningBreakdown) => Number(Number(input.breakdown[key] ?? 0).toFixed(1));
  const issues = (input.photo_issues ?? []).filter((issue): issue is PhotoIssue => issue in RETAKE);
  const lowConfidence = input.confidence_score < LOW_CONFIDENCE_THRESHOLD;
  const insufficient = input.export_readiness === "Insufficient Evidence";

  const suspected = DEFECT_KEYS
    .map((key) => ({ key, label: labels[key], visible_share_pct: share(key), level: level(share(key)) }))
    .filter((item) => item.visible_share_pct >= DEFECT_REPORT_FROM_PCT)
    .sort((a, b) => b.visible_share_pct - a.visible_share_pct);

  const sizeVariation: SizeVariation = input.apparent_size_variation ?? "not_assessable";
  const observations: string[] = [
    `${labels.sound_or_ripe_pct}: about ${share("sound_or_ripe_pct")}% of what is visible in the photo.`,
  ];
  if (stage === "red_cherry") {
    observations.push(`Ripeness: about ${share("unripe_green_pct")}% of the visible cherries look unripe.`);
  } else {
    const discoloured = Number((share("black_overfermented_pct") + share("unripe_green_pct")).toFixed(1));
    observations.push(`Discolouration: about ${discoloured}% of the visible beans look black, discoloured or pale.`);
  }
  observations.push(`Visible damage: about ${share("insect_broken_pct")}% look insect-damaged or broken.`);
  observations.push(
    sizeVariation === "appears_uniform" ? "Apparent size: pieces look similar in size in this photo. This is not a measured size."
      : sizeVariation === "appears_mixed" ? "Apparent size: pieces look mixed in size in this photo. This is not a measured size; screen the lot to confirm."
        : "Apparent size variation was not assessed from this photo.",
  );
  for (const note of (input.visible_observations ?? []).slice(0, 4)) observations.push(String(note).slice(0, 240));

  const reviewReasons: string[] = [];
  if (meta.source === "demo_fixture") reviewReasons.push("This is a demonstration fixture. The photo was not analysed.");
  if (lowConfidence) reviewReasons.push(`The model reported low confidence (${Math.round(input.confidence_score)} out of 100).`);
  if (insufficient) reviewReasons.push("The model reported insufficient visual evidence.");
  if (issues.length) reviewReasons.push("The photo has quality problems: " + issues.join(", ").replace(/_/g, " ") + ".");

  const photoUsable = issues.length === 0 && !insufficient && !lowConfidence;
  const retakeSteps = issues.length ? issues.map((issue) => RETAKE[issue]) : [RETAKE.too_dark, RETAKE.overlapping, RETAKE.blurry];
  const retakeGuidance = photoUsable ? null : "Retake the photo: " + retakeSteps.join("; ") + ".";

  const top = suspected[0];
  const nextAction = !photoUsable && meta.source === "live_inference"
    ? retakeGuidance ?? ""
    : top ? ACTIONS[stage][top.key] : ACTIONS[stage].sound_or_ripe_pct;

  return {
    schema_version: 1,
    source: meta.source,
    provider: meta.provider,
    model: meta.model,
    assessed_at: meta.assessedAt,
    sample_stage: stage,
    official_grade: "Unclassified",
    observations,
    suspected_defects: suspected,
    apparent_size_variation: sizeVariation,
    not_assessed: NOT_ASSESSED,
    limitations: [
      "Shares are one model's visual estimate of what is visible in a single photo. They are not counts and not a laboratory result.",
      ...(input.assessment_limitations ?? []).slice(0, 8),
    ],
    next_action: nextAction,
    photo: { usable: photoUsable, issues, retake_guidance: retakeGuidance },
    needs_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    ...(meta.captureKey ? { capture_key: meta.captureKey } : {}),
  };
}
