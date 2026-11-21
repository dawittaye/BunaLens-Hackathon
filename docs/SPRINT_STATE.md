# BunaLens Sprint State

Last updated: 2026-11-21T14:41+03:00, end of Phase 4.

Read `docs/SPRINT_RULES.md` before continuing. Supporting records:
`docs/FOUNDATION.md` (audit, schema, configuration),
`docs/DEVICE_INGESTION.md` (payload, replay, checks, limitations) and
`docs/PHOTO_SCREENING.md` (screening record, dataset inspection, what ran). No secret
values belong in this file.

## Time

| Item | Value |
|---|---|
| Sprint start | 2026-11-21T13:32:51+03:00 |
| Budget | 60 minutes of active work, cumulative across phases and restarts |
| Phase 1 active work | 13:32:51 to 13:38:12, about 5.5 minutes |
| Phase 2 active work | 13:42:25 to 13:53:11, about 11 minutes (recorded as 12 before; corrected to the last commit time) |
| Phase 3 active work | 13:55:35 to about 14:05, about 10 minutes (recorded as 11.5 before) |
| Phase 4 active work | 14:22:48 to about 14:41, about 18 minutes. Over its share of the budget |
| Elapsed active time | about 45 minutes |
| Remaining budget | about 15 minutes for Phases 5 to 8. Not enough for all four as specified |
| Interruptions (not counted) | 13:38:12 to 13:42:25, 13:53:11 to 13:55:35 and 14:05:17 to 14:22:48, waiting for phase instructions |

## Repository

| Item | Value |
|---|---|
| Source repository | https://github.com/Newaznezif/BunaLens (read only, never push here) |
| Source branch and SHA | `main` at `3168b3009b02d1bc9ee745954a3d443d77f7bda2` |
| Baseline commit | `91cae6734c2f40516756b512dd14c5f83712269a` |
| New checkout | `C:\Users\dave\Documents\BunaLens-Hackathon` |
| New remote | https://github.com/dawittaye/BunaLens-Hackathon (private), remote name `origin` |
| Sprint branch | `feat/hackathon-lot-to-order` |
| Remote `main` | At `7412d5e` since pull request #1 was merged on GitHub by the repository owner. The sprint does not merge |
| Commit identity | `Dave <davboss.t07@gmail.com>`, local Git config |

## Phases

| Phase | Status |
|---|---|
| 1. Repository and persistent context | Complete |
| 2. Configuration, architecture, and data foundations | Complete |
| 3. Warehouse device ingestion and lot traceability | Complete, with simulated readings only |
| 4. Photo screening and dataset experiment | Complete for the demo-fixture path. Live Gemini path written but not run. No model trained |
| 5. Publication policy and reviewer workflow | Not started |
| 6. Marketplace and orders | Not started |
| 7. Chapa test payments | Not started |
| 8. End-to-end verification and handoff | Not started |

## Implemented changes

Everything not listed here is imported and unchanged.

| Change | Path | Phase |
|---|---|---|
| Baseline record, sprint rules, sprint state | `docs/BASELINE.md`, `docs/SPRINT_RULES.md`, `docs/SPRINT_STATE.md` | 1 |
| Audit, schema and configuration record | `docs/FOUNDATION.md` | 2 |
| Additive schema for zones, devices, readings, reviews, listings, orders, order payments | `supabase/migrations/20261121134500_hackathon_lot_to_order_foundation.sql` | 2 |
| Database checks that roll back | `supabase/tests/hackathon_foundation_check.sql` | 2 |
| Lot registration, zone and device creation, lot storage, device ingestion, lot environment functions | `supabase/migrations/20261121140000_hackathon_device_ingestion.sql` | 3 |
| Simulated device fixture | `supabase/fixtures/device/simulated_reading.json` | 3 |
| Replay, verification and screen-check scripts | `scripts/hackathon/` | 3 |
| Lot data access for the client | `services/lots.ts` | 3 |
| Warehouse conditions card | `components/LotEnvironmentCard.tsx` | 3 |
| Lot screen: lot ID, cloud fallback, unassessed notice, warehouse card (imported file, modified) | `app/batch/[id].tsx` | 3 |
| ESP32 sketch, not compiled or run | `hardware/esp32_zone_sensor/esp32_zone_sensor.ino` | 3 |
| Payload, replay and check record | `docs/DEVICE_INGESTION.md` | 3 |
| Screening rules shared by the function and the app | `supabase/functions/_shared/screening.ts` | 4 |
| `coffee-sync`: optional `batch_id` saves the assessment on an existing lot; screening stored with every result (imported file, modified) | `supabase/functions/coffee-sync/index.ts` | 4 |
| `gemini-grade`: optional photo-problem, size-variation and observation fields (imported file, modified) | `supabase/functions/gemini-grade/index.ts` | 4 |
| Demo-fixture assessment function | `supabase/migrations/20261121143000_hackathon_photo_screening.sql` | 4 |
| Screening card; photo and demo-attach helpers | `components/LotScreeningCard.tsx`, `services/lots.ts` | 4 |
| Scan from a lot, lot link kept in the offline queue (imported files, modified) | `app/(tabs)/scan.tsx`, `services/geminiVision.ts`, `services/offlineQueue.ts`, `types/index.ts`, `app/batch/[id].tsx` | 4 |
| Phase 4 checks | `scripts/hackathon/verify-photo-screening.mjs` | 4 |
| Dataset inspection and unrun training configuration | `ml/` | 4 |
| Screening and dataset record | `docs/PHOTO_SCREENING.md` | 4 |

## Checks actually run

| Check | Where | Result |
|---|---|---|
| Phase 1 and Phase 2 checks | see `docs/BASELINE.md` and `docs/FOUNDATION.md` | Passed as recorded there |
| Ingestion migration applied, then applied again | local test database | No error |
| `node scripts/hackathon/verify-device-ingestion.mjs`, 31 checks with normal user sessions and device tokens | local test stack, HTTP API | All passed |
| Fixture replay twice with the same message id | local test stack, HTTP API | First `stored`, second `duplicate` with the same reading id |
| Lot screen in a browser, three lots, throwaway account signed in through the app | local web dev server on port 8082 | Fresh, stale and no-zone states displayed correctly, with the simulated banner. Account deleted afterwards |
| `npm run typecheck` | local | Passed after the client changes |
| `npx expo export --platform web` | local | Not re-run in Phase 3; the dev server bundled and served the changed screen |
| `node scripts/hackathon/verify-photo-screening.mjs`, 34 checks with normal seller sessions | local test stack, HTTP API | All passed after one fix (a path pattern Postgres rejected) |
| `npx -y deno check` of `coffee-sync`, `gemini-grade`, `_shared/screening.ts` | local, Deno 2.9.6 through npx | Passed |
| `npm run typecheck`, `npx expo export --platform web` | local | Both passed after the Phase 4 client changes |
| Screening card and scan-from-lot in a browser | — | Not run in Phase 4 |
| `python ml/inspect_datasets.py` | Kaggle public API | Ran; output in `ml/dataset_inspection.json` |
| Model training | — | Not run. PyTorch is not installed |
| `npx expo-doctor` | — | Not run |
| Gemini scan, Chapa request, real device message | — | Not run |

## Pending migrations and environment requirements

| Environment | State |
|---|---|
| Local test stack `bunalens-db-test-20261118-165455` | Base schema, nine imported migrations and all three sprint migrations applied with `psql`. No CLI migration history table |
| Hosted production | Nothing applied, nothing written. All three sprint migrations and the two modified functions are pending there and must stay pending during the sprint |

Ignored files in the checkout: `.env` (local stack), `.env.hosted`,
`.env.backend`, `supabase/functions/.env`. Phase 3 added these names to
`.env.backend`: `BUNALENS_DEMO_SELLER_PASSWORD`,
`BUNALENS_DEMO_SELLER_B_PASSWORD`, `BUNALENS_DEMO_DEVICE_TOKEN`,
`BUNALENS_DEMO_LOT_ID`. `GEMINI_API_KEY` is still not set anywhere.

Demo data now in the local test database, all labelled DEMO or SIMULATED:
accounts `demo-seller@bunalens.test` and `demo-seller-b@bunalens.test` with
one station each, zone "Zone A" with simulated device `esp32-sim-zone-a`, the
demo lot stored in Zone A with one simulated reading, and three lots plus one
zone and device left by the verification run. Phase 4 added a demo-fixture
assessment and a 1x1 placeholder photo on the demo lot `BNL-JMA-FDEF`, and two
red-cherry check lots with demo-fixture assessments.

## Live versus simulated integrations

| Integration | Status |
|---|---|
| Supabase, local stack | Live locally: database, Auth and REST exercised |
| Supabase, hosted | Read-only connectivity only |
| Warehouse device ingestion | Endpoint live on the local stack. All readings are SIMULATED. No physical device, no `live` reading |
| Gemini screening | Not exercised, key missing. Saving on an existing lot is written and type-checked only |
| Photo assessment on a lot | DEMO FIXTURE only, saved through the local stack. No photo has been analysed by a model |
| Chapa | Code imported, not exercised. A test-mode key is configured for local functions |
| Marketplace and orders | Tables and rules only. No screens or write paths |
| Dataset and trained model | Six datasets inspected from listings. No model trained, none integrated |

## Blockers and open items

1. No hardware was available, so no real device message has been verified.
2. `GEMINI_API_KEY` is not set, so no live scan has run. The `batch_id`
   path in `coffee-sync` has never been executed.
3. Kaggle access works through `kagglehub`. Training is blocked by missing
   PyTorch; see `docs/PHOTO_SCREENING.md`.
4. The local Edge runtime container serves functions from the earlier test
   directory under `%TEMP%`, not from this checkout. Still unsolved. It
   blocks local runs of `coffee-sync` and, in Phase 7, the Chapa functions.
5. Hosted schema drift, the two undeployed hosted functions and the Auth URL
   gaps are unchanged; see `docs/FOUNDATION.md`.
6. There is no screen for registering a lot or creating a zone and device,
   and station-registered lots do not appear in the batches list.
7. GitHub Actions results on the new repository were not checked.
8. Secret values are in plain text in Cursor rule files outside this
   repository. Rotating them after the sprint is advisable.

## Uncommitted task-owned files

None after the Phase 4 commit.

## Exact next action

Wait for the instruction to start Phase 5. About 15 minutes of budget
remain, so agree the cut first. Then, on `feat/hackathon-lot-to-order`:

1. Add the server-side eligibility decision for a lot: rule result from
   recorded moisture, screen size and the saved screening, with a reviewer
   decision recorded in `lot_reviews`. A demo-fixture screening must never
   pass by rule alone.
2. Verify with a seller session and a reviewer session on the local stack.
3. Open the lot screen in a browser once to confirm the Phase 4 screening
   card, which has not been seen rendered.
