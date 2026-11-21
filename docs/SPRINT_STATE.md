# BunaLens Sprint State

Last updated: 2026-11-21T14:07+03:00, end of Phase 3.

Read `docs/SPRINT_RULES.md` before continuing. Supporting records:
`docs/FOUNDATION.md` (audit, schema, configuration) and
`docs/DEVICE_INGESTION.md` (payload, replay, checks, limitations). No secret
values belong in this file.

## Time

| Item | Value |
|---|---|
| Sprint start | 2026-11-21T13:32:51+03:00 |
| Budget | 60 minutes of active work, cumulative across phases and restarts |
| Phase 1 active work | 13:32:51 to 13:38:12, about 5.5 minutes |
| Phase 2 active work | 13:42:25 to 13:53:11, about 11 minutes (recorded as 12 before; corrected to the last commit time) |
| Phase 3 active work | 13:55:35 to about 14:07, about 11.5 minutes |
| Elapsed active time | about 28 minutes |
| Remaining budget | about 32 minutes for Phases 4 to 8 |
| Interruptions (not counted) | 13:38:12 to 13:42:25 and 13:53:11 to 13:55:35, waiting for phase instructions |

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
| 4. Photo screening and dataset experiment | Not started |
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
| `npx expo-doctor`, Deno check of Edge Functions | — | Not run. Deno is not installed |
| Gemini scan, Chapa request, real device message | — | Not run |

## Pending migrations and environment requirements

| Environment | State |
|---|---|
| Local test stack `bunalens-db-test-20261118-165455` | Base schema, nine imported migrations and both sprint migrations applied with `psql`. No CLI migration history table |
| Hosted production | Nothing applied, nothing written. Both sprint migrations are pending there and must stay pending during the sprint |

Ignored files in the checkout: `.env` (local stack), `.env.hosted`,
`.env.backend`, `supabase/functions/.env`. Phase 3 added these names to
`.env.backend`: `BUNALENS_DEMO_SELLER_PASSWORD`,
`BUNALENS_DEMO_SELLER_B_PASSWORD`, `BUNALENS_DEMO_DEVICE_TOKEN`,
`BUNALENS_DEMO_LOT_ID`. `GEMINI_API_KEY` is still not set anywhere.

Demo data now in the local test database, all labelled DEMO or SIMULATED:
accounts `demo-seller@bunalens.test` and `demo-seller-b@bunalens.test` with
one station each, zone "Zone A" with simulated device `esp32-sim-zone-a`, the
demo lot stored in Zone A with one simulated reading, and three lots plus one
zone and device left by the verification run.

## Live versus simulated integrations

| Integration | Status |
|---|---|
| Supabase, local stack | Live locally: database, Auth and REST exercised |
| Supabase, hosted | Read-only connectivity only |
| Warehouse device ingestion | Endpoint live on the local stack. All readings are SIMULATED. No physical device, no `live` reading |
| Gemini screening | Code imported, not exercised, key missing |
| Chapa | Code imported, not exercised. A test-mode key is configured for local functions |
| Marketplace and orders | Tables and rules only. No screens or write paths |
| Dataset and trained model | Not started |

## Blockers and open items

1. No hardware was available, so no real device message has been verified.
2. `GEMINI_API_KEY` is needed for a real scan in Phase 4.
3. Kaggle credentials or a local dataset path are needed before any training
   in Phase 4.
4. The local Edge runtime container serves functions from the earlier test
   directory under `%TEMP%`, not from this checkout. Phase 3 avoided the
   problem by implementing ingestion as database functions behind the
   existing REST API. Phase 4 needs `coffee-sync` and `gemini-grade` from
   this checkout, so it has to solve this first.
5. Hosted schema drift, the two undeployed hosted functions and the Auth URL
   gaps are unchanged; see `docs/FOUNDATION.md`.
6. There is no screen for registering a lot or creating a zone and device,
   and station-registered lots do not appear in the batches list.
7. GitHub Actions results on the new repository were not checked.
8. Secret values are in plain text in Cursor rule files outside this
   repository. Rotating them after the sprint is advisable.

## Uncommitted task-owned files

None after the Phase 3 commit.

## Exact next action

Wait for the instruction to start Phase 4. Then, on
`feat/hackathon-lot-to-order`:

1. Decide how this checkout's Edge Functions are served against the local
   stack and confirm `coffee-sync` answers.
2. Make the scan attach its assessment to an existing registered lot instead
   of always creating a new batch.
3. Show sample stage, observations, suspected defects, limitations and one
   next action on the lot screen.
4. Inspect the Kaggle datasets and run a short baseline only if credentials
   and suitable labels exist; otherwise record the exact blocker.
