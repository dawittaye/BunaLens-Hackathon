# BunaLens Sprint State

Last updated: 2026-11-21T15:11+03:00, end of Phase 7.

Read `docs/SPRINT_RULES.md` before continuing. Supporting records:
`docs/FOUNDATION.md` (audit, schema, configuration),
`docs/DEVICE_INGESTION.md` (payload, replay, checks, limitations) and
`docs/PHOTO_SCREENING.md` (screening record, dataset inspection, what ran)
`docs/ELIGIBILITY.md` (demo policy, exact rules, demo cases, checks),
`docs/MARKETPLACE.md` (routes, functions, order states, stock, checks) and
`docs/ORDER_PAYMENTS.md` (Chapa test payment, rules, what ran). No secret
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
| Phase 5 active work | 14:43 to about 14:50, about 8 minutes |
| Phase 6 active work | 14:52 to about 15:01, about 10 minutes |
| Phase 7 active work | 15:02 to about 15:11, about 10 minutes |
| Elapsed active time | about 73 minutes. The 60-minute budget was passed during Phase 6, at about 14:59 |
| Remaining budget | None. Phase 8 is over budget |
| Interruptions (not counted) | 13:38:12 to 13:42:25, 13:53:11 to 13:55:35, 14:05:17 to 14:22:48, 14:41 to 14:43 and 14:51 to 14:52, waiting for phase instructions |

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
| 5. Publication policy and reviewer workflow | Complete on the server with a DEMO policy and simulated readings. Lot-screen card not seen in a browser; no screens for readings or reviewer decisions |
| 6. Marketplace and orders | Complete on the server and verified through the HTTP API, including concurrent acceptance. Screens written, type-checked and bundled, not opened in a browser |
| 7. Chapa test payments | Complete. One order paid in Chapa TEST mode and verified by the server. Failure, mismatch, expiry and late success checked with simulated provider answers only. App buttons not opened in a browser |
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
| Demo policy, evidence table, rule evaluation, reviewer and override decisions, seller approval, publication re-check | `supabase/migrations/20261121144500_hackathon_publication_eligibility.sql` | 5 |
| Eligibility card and data access; card added to the lot screen | `components/LotEligibilityCard.tsx`, `services/lots.ts`, `app/batch/[id].tsx` | 5 |
| Phase 5 checks and demo cases | `scripts/hackathon/verify-eligibility.mjs` | 5 |
| Rules, demo cases and check record | `docs/ELIGIBILITY.md` | 5 |
| Listing and order functions; listing provenance and order snapshot columns | `supabase/migrations/20261121145500_hackathon_marketplace_orders.sql` | 6 |
| Marketplace data access | `services/marketplace.ts` | 6 |
| Browse tab, listing details and order, orders screen | `app/(tabs)/marketplace.tsx`, `app/market/[id].tsx`, `app/market/orders.tsx` | 6 |
| "Market" tab added (imported file, modified); seller listing card on the lot screen | `app/(tabs)/_layout.tsx`, `components/LotListingCard.tsx`, `app/batch/[id].tsx` | 6 |
| Phase 6 checks and demo listings | `scripts/hackathon/verify-marketplace.mjs` | 6 |
| Routes, states, stock and check record | `docs/MARKETPLACE.md` | 6 |
| Order payment functions and columns | `supabase/migrations/20261121150500_hackathon_order_payments.sql` | 7 |
| Order payment Edge Function (new, separate from the credit functions); function config entry | `supabase/functions/chapa-order-payment/index.ts`, `supabase/config.toml` | 7 |
| Pay, check payment and verified-payment list; payment data access | `app/market/orders.tsx`, `services/marketplace.ts` | 7 |
| Phase 7 checks | `scripts/hackathon/verify-order-payment.mjs`, `supabase/tests/hackathon_order_payment_check.sql` | 7 |
| Payment record | `docs/ORDER_PAYMENTS.md` | 7 |

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
| `node scripts/hackathon/verify-eligibility.mjs`, 49 checks with seller, reviewer and administrator sessions | local test stack, HTTP API | All passed, run twice. Role setup and listing writes use the local service role and are marked in the script |
| `npm run typecheck` after the Phase 5 client changes | local | Passed |
| `node scripts/hackathon/verify-marketplace.mjs`, 59 checks with two sellers and two buyers, normal sessions only | local test stack, HTTP API | All passed: 58 of 58 on the first run; 59 of 59 on three further runs, after one check was added and the order checks were moved to a lot created per run. Includes six parallel acceptances against 300 kg: three accepted, never above stock |
| `npm run typecheck` and `npx expo export --platform web` after the Phase 6 client changes | local | Both passed |
| `node scripts/hackathon/verify-order-payment.mjs`, function served from this checkout with Deno, real Chapa TEST API | local test stack + Chapa test mode | 18 of 18 passed: checkout opened for 900 ETB, retry, authorization, forged callbacks ignored |
| Chapa hosted checkout paid in a browser with Chapa's test phone number | Chapa test mode | Receipt "Paid", 900.00 ETB, "Test Mode: Not a real payment." |
| `node scripts/hackathon/verify-order-payment.mjs --confirm` | local test stack + Chapa test mode | 6 of 6 passed: Chapa verify reports success, order `paid_test`, duplicates change nothing |
| `supabase/tests/hackathon_order_payment_check.sql`, rolled back, SIMULATED provider answers | local test database | 19 of 19 passed: mismatch, failure, expiry, stock release, late success |
| `npx -y deno check` of `chapa-order-payment`; `npm run typecheck`; `npx expo export --platform web` | local | All passed |
| Credit checkout files and `station_payments` rows | Git and local database | Unchanged. The credit checkout itself was not exercised |
| Any Phase 4, 5, 6 or 7 screen of the app in a browser | — | Not run |
| `python ml/inspect_datasets.py` | Kaggle public API | Ran; output in `ml/dataset_inspection.json` |
| Model training | — | Not run. PyTorch is not installed |
| `npx expo-doctor` | — | Not run |
| Gemini scan, Chapa request, real device message | — | Not run |

## Pending migrations and environment requirements

| Environment | State |
|---|---|
| Local test stack `bunalens-db-test-20261118-165455` | Base schema, nine imported migrations and all six sprint migrations applied with `psql`. No CLI migration history table |
| Hosted production | Nothing applied, nothing written. All six sprint migrations, the two modified functions and the new `chapa-order-payment` function are pending there and must stay pending during the sprint |

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
red-cherry check lots with demo-fixture assessments. Phase 5 added accounts
`demo-reviewer@bunalens.test` and `demo-admin@bunalens.test`, the three demo
case lots (pass BNL-JMA-0688, fail BNL-JMA-A8E5, manual review BNL-JMA-7687)
with SIMULATED readings, one published DEMO listing for the pass lot, the
demo seller approved by the demo administrator, and check lots from two runs.
New names in `.env.backend`: `BUNALENS_DEMO_REVIEWER_PASSWORD`,
`BUNALENS_DEMO_ADMIN_PASSWORD`. Phase 6 added accounts
`demo-buyer@bunalens.test` and `demo-buyer-b@bunalens.test`
(`BUNALENS_DEMO_BUYER_PASSWORD`, `BUNALENS_DEMO_BUYER_B_PASSWORD`), both demo
sellers approved, three published DEMO listings (BNL-JMA-0688 500 kg at 450,
BNL-JMA-B7E4 400 kg at 520, BNL-JMA-6D1D 800 kg at 38 ETB per kg), and demo
orders from the verification runs. Phase 7 added one accepted 2 kg order on
BNL-JMA-0688 paid in Chapa TEST mode (900 ETB, `paid_test`), so that listing
now has 498 kg. Every other order is unpaid. New optional names: backend
`CHAPA_ORDER_CALLBACK_URL`, `CHAPA_ORDER_RETURN_URL`; client
`EXPO_PUBLIC_CHAPA_ORDER_PAYMENT_URL`. The ignored file
`.order-payment-check.json` holds the last checked order id and reference.

## Live versus simulated integrations

| Integration | Status |
|---|---|
| Supabase, local stack | Live locally: database, Auth and REST exercised |
| Supabase, hosted | Read-only connectivity only |
| Warehouse device ingestion | Endpoint live on the local stack. All readings are SIMULATED. No physical device, no `live` reading |
| Gemini screening | Not exercised, key missing. Saving on an existing lot is written and type-checked only |
| Photo assessment on a lot | DEMO FIXTURE only, saved through the local stack. No photo has been analysed by a model |
| Chapa, coffee orders | Live against the Chapa TEST API from a locally served function: initialize and verify exercised, one test payment verified. No live-mode call, no payout |
| Chapa, station credits | Imported code, unchanged, not exercised |
| Publication eligibility | Live on the local stack under a DEMO policy. Every reading is SIMULATED; no instrument was used |
| Marketplace and orders | Live on the local stack through the HTTP API. All listings are DEMO with simulated evidence. One order has a verified TEST payment |
| Dataset and trained model | Six datasets inspected from listings. No model trained, none integrated |

## Blockers and open items

1. No hardware was available, so no real device message has been verified.
2. `GEMINI_API_KEY` is not set, so no live scan has run. The `batch_id`
   path in `coffee-sync` has never been executed.
3. Kaggle access works through `kagglehub`. Training is blocked by missing
   PyTorch; see `docs/PHOTO_SCREENING.md`.
4. The local Edge runtime container serves functions from the earlier test
   directory under `%TEMP%`, not from this checkout. Still unsolved for the container. Phase 7 worked around it by serving
   `chapa-order-payment` directly with Deno. `coffee-sync` was not served that
   way because `GEMINI_API_KEY` is missing.
5. Hosted schema drift, the two undeployed hosted functions and the Auth URL
   gaps are unchanged; see `docs/FOUNDATION.md`.
6. There is no screen for registering a lot or creating a zone and device,
   and station-registered lots do not appear in the batches list.
7. GitHub Actions results on the new repository were not checked.
8. Secret values are in plain text in Cursor rule files outside this
   repository. Rotating them after the sprint is advisable.

## Uncommitted task-owned files

None after the Phase 7 commit.

## Exact next action

Wait for the instruction to start Phase 8. The budget is used up, so keep
it to verification and the handoff document. On `feat/hackathon-lot-to-order`:

1. Open the app in a browser once with the demo seller and the demo buyer:
   lot screen (warehouse, screening, eligibility, listing cards), Market tab,
   listing details, orders. None of these screens has been seen rendered.
2. Write `docs/BUNALENS_SPRINT.md` from the phase records, with the
   verification table and the three-minute walkthrough.
3. Final commit and push. No merge, no deployment.

Run order for the demo data: `verify-device-ingestion.mjs`,
`verify-photo-screening.mjs`, `verify-eligibility.mjs`,
`verify-marketplace.mjs`. `verify-order-payment.mjs` needs the function
served locally; see `docs/ORDER_PAYMENTS.md`.
