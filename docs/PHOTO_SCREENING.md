# Photo screening and dataset experiment (Phase 4)

Recorded 2026-11-21. Sprint additions unless marked imported.

## What ran, what was simulated, what is blocked

| Path | Status | Evidence |
|---|---|---|
| Screening rules (stage wording, review and retake triggers, things not assessed) | Locally tested | 12 checks in `scripts/hackathon/verify-photo-screening.mjs` |
| Photo upload to private Storage, then assessment saved on an existing lot | Locally tested with a DEMO FIXTURE assessment and a generated 1x1 placeholder image | 22 checks, normal seller sessions, local stack HTTP API |
| Live Gemini inference on a real photo | Blocked, not run | `GEMINI_API_KEY` is not set anywhere |
| `coffee-sync` saving a live assessment on an existing lot (`batch_id`) | Written and type-checked only | `deno check` passed. Never executed: needs the key, and the local function runtime serves an older directory, not this checkout |
| Lot screen card and "Photograph a sample for this lot" button | Type-checked and bundled only | `npm run typecheck` and `npx expo export --platform web` passed. Not opened in a browser in this phase |
| Offline queue keeps the lot link | Type-checked only | `batch_id` is stored with the queued capture and sent on sync. Not exercised |
| Trained model | Not trained | PyTorch is not installed. No results exist |

No real coffee photo was analysed by any model in this phase.

## How a photo reaches a lot

1. Lot screen (`app/batch/[id].tsx`) → "Photograph a sample for this lot" opens
   the existing scan screen (`app/(tabs)/scan.tsx`) with the lot id. Stage,
   origin and weight come from the lot record and the stage cannot be changed.
2. Live path: the existing `submitCoffeeSample` posts to `coffee-sync` with
   `batch_id`. The function checks station ownership, checks that the photo
   stage matches the lot stage, calls `gemini-grade` (imported, server side),
   stores the photo, and updates the lot instead of inserting a new record.
   Without `batch_id` it behaves as before.
3. Demo path: "Demo sample" on the scan screen, when opened from a lot, stores
   the photo privately and calls `bunalens_attach_demo_assessment`. The server
   forces `source = demo_fixture`, the fixture provider and model text,
   `needs_review = true`, grade `Unclassified`, and `is_demo = true`. A
   payload that claims live inference or a grade is stored as a demo fixture
   (checked). It cannot replace a live assessment.
4. Any new assessment resets the lot to `eligibility_status = unreviewed`.

## What is saved on the lot

`coffee_batches.image_path` holds the photo reference (private bucket
`coffee-samples`, path starts with the station id). `coffee_batches.grading_result`
keeps the imported model fields and adds `screening`:

| Field | Meaning |
|---|---|
| `source` | `live_inference` or `demo_fixture` |
| `provider`, `model` | Live: `google` and the model id returned by `gemini-grade` (`gemini-3.1-flash-lite` in code). Demo: fixture text |
| `assessed_at` | Assessment time |
| `sample_stage` | `red_cherry` or `green_bean`, always equal to the lot stage |
| `observations` | Share that looks sound or ripe, ripeness (cherries) or discolouration (beans), visible damage, apparent size variation |
| `suspected_defects` | Categories at 3% or more of the visible sample, with the model's estimated share. Not counts |
| `not_assessed` | Moisture, physical size, cup quality, official grade |
| `limitations` | Fixed statement plus the model's own limitations |
| `next_action` | One action for the largest suspected defect, or retake steps |
| `photo` | Usable or not, reported problems, retake guidance |
| `needs_review`, `review_reasons` | Set for a demo fixture, confidence below 60, "Insufficient Evidence", or reported photo problems |
| `official_grade` | Always `Unclassified` |
| `capture_key` | Makes a retry of the same capture a no-op |

Rules are in `supabase/functions/_shared/screening.ts`, used by the function
and the app. Only one model contributes to a screening; nothing is averaged.
Warehouse readings stay in their own tables and card.

Apparent size variation and photo problems are new optional fields in the
`gemini-grade` prompt and schema. They have never been returned by a live
call, so today every screening says size variation was not assessed.

## Run the checks

```
node scripts/hackathon/verify-photo-screening.mjs
```

Local test stack only. Result on 2026-11-21: 34 of 34 passed. The demo lot
`BNL-JMA-FDEF` now carries a demo-fixture assessment and a placeholder photo.

Migration: `supabase/migrations/20261121143000_hackathon_photo_screening.sql`,
applied to the local test database only. Pending on hosted.

## Dataset inspection

Method: Kaggle public API metadata and file listings
(`python ml/inspect_datasets.py`, output in `ml/dataset_inspection.json`),
plus two small text files downloaded with `kagglehub`. No image was
downloaded or opened, so label quality and representative images were not
checked. Class counts are folder counts from the listings.

| Dataset | License | Stage | Labels found | Use |
|---|---|---|---|---|
| `patopucho/lojano-arabica-coffee` v1, 726 MB | CC BY-NC 4.0 | Green beans | Folders `bueno` / `defectuoso`: 500 + 500 crops, 200 + 200 crops in a separate generalisation folder, 20 + 16 full photos | Suitable for a good/defective bean classifier. Non-commercial license |
| `j4ckdev/green-coffee-beans-dataset` v4, 4.7 MB | CC BY-NC-SA 4.0 | Green beans | 11 photos, one per defect type, each showing many beans (README: 9 to 255 beans per photo) | Too few images to train on. Useful as reference photos of defect types |
| `sot2542/coffee-bean-dataset-v2` v1, 86.7 GB | CC BY-SA 4.0 | Roasted beans by roast level | `Dark`, `Green`, `Light`, `Medium` | Not used. Roast-level labels, not defects. Listing truncated at 2,400 files |
| `gpiosenka/coffee-bean-dataset-resized-224-x-224` v1, 155 MB | CC BY-SA 4.0 | Roasted beans by roast level | `Dark`, `Green`, `Light`, `Medium`: 300 train + 100 test each | Not used. Roast-level labels, not defects |
| `harisyunanda/dataset-coffee-cherry` v1, 1.9 GB | ODbL | Cherries | 432 images with one label file each; classes `Matang`, `Setengah Matang`, `Tidak Matang` (ripe, half ripe, unripe) | Candidate for a YOLO11n ripeness detector. Box format and counts per class not inspected |
| `asimmahmudov/top-rated-coffee` v1, 0.6 MB | CC0 | Retail product reviews | Two CSV files | Not used. Ratings are not defect labels |

## Training experiment

Not run. `torch`, `torchvision` and `ultralytics` are not installed
(Python 3.14.0), and installing them plus downloading 726 MB would have taken
the time needed for the product. There is no trained model, no accuracy and
no prediction. Nothing from a trained model appears in the app.

Saved for a later run: `ml/experiment_lojano_mobilenetv3.json` (dataset
version, license, class mapping, splits, settings) and
`ml/train_mobilenetv3_small.py` (never executed). Kaggle access works on
this machine through `kagglehub`.

## Limits to state in a demo

- Shares are one model's estimate from one photo. They are not counts, not a
  defect percentage of the lot, and not a grade.
- A photo does not measure moisture or size.
- All screening text added in this phase is English only.
