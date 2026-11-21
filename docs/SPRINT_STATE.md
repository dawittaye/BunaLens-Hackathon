# BunaLens Sprint State

Last updated: 2026-11-21T13:54+03:00, end of Phase 2.

Read `docs/SPRINT_RULES.md` before continuing. Details of the audit and the
schema are in `docs/FOUNDATION.md`. No secret values belong in this file.

## Time

| Item | Value |
|---|---|
| Sprint start | 2026-11-21T13:32:51+03:00 |
| Budget | 60 minutes of active work, cumulative across phases and restarts |
| Phase 1 active work | 13:32:51 to 13:38:12, about 5.5 minutes |
| Phase 2 active work | 13:42:25 to about 13:54:30, about 12 minutes |
| Elapsed active time | about 17.5 minutes |
| Remaining budget | about 42.5 minutes |
| Interruptions (not counted) | 13:38:12 to 13:42:25, waiting for the Phase 2 instruction |

## Repository

| Item | Value |
|---|---|
| Source repository | https://github.com/Newaznezif/BunaLens (read only, never push here) |
| Source branch and SHA | `main` at `3168b3009b02d1bc9ee745954a3d443d77f7bda2` |
| Baseline commit | `91cae6734c2f40516756b512dd14c5f83712269a` |
| New checkout | `C:\Users\dave\Documents\BunaLens-Hackathon` |
| New remote | https://github.com/dawittaye/BunaLens-Hackathon (private), remote name `origin` |
| Sprint branch | `feat/hackathon-lot-to-order` |
| Remote `main` | Moved to `7412d5e` at 13:41 when pull request #1 (the Phase 1 docs commit) was merged on GitHub by the repository owner. The sprint itself does not merge. The sprint branch was not rebased and does not need to be |
| Commit identity | `Dave <davboss.t07@gmail.com>`, local Git config |

## Phases

| Phase | Status |
|---|---|
| 1. Repository and persistent context | Complete |
| 2. Configuration, architecture, and data foundations | Complete |
| 3. Warehouse device ingestion and lot traceability | Not started |
| 4. Photo screening and dataset experiment | Not started |
| 5. Publication policy and reviewer workflow | Not started |
| 6. Marketplace and orders | Not started |
| 7. Chapa test payments | Not started |
| 8. End-to-end verification and handoff | Not started |

## Implemented changes

Everything not listed here is imported and unchanged. No application screen,
service or Edge Function has been changed yet.

| Change | Path | Phase |
|---|---|---|
| Baseline record | `docs/BASELINE.md` | 1 |
| Sprint rules | `docs/SPRINT_RULES.md` | 1 |
| Sprint state | `docs/SPRINT_STATE.md` | 1, 2 |
| Audit, schema and configuration record | `docs/FOUNDATION.md` | 2 |
| Additive schema for zones, devices, readings, reviews, listings, orders and order payments | `supabase/migrations/20261121134500_hackathon_lot_to_order_foundation.sql` | 2 |
| Repeatable database checks that roll back | `supabase/tests/hackathon_foundation_check.sql` | 2 |

## Checks actually run

| Check | Where | Result |
|---|---|---|
| Tree hash of new checkout equals source commit tree | local files | Passed (Phase 1) |
| `npm ci`, `npm run typecheck`, `npx expo export --platform web` | local files | Passed (Phase 1). Not re-run in Phase 2 because no application code changed |
| Three later repository migrations applied (`20261118145504`, `20261119120000`, `20261119140000`) | local test database | Applied without error |
| Sprint migration applied | local test database | Applied without error |
| Sprint migration applied a second time | local test database | No error, so it is safe to re-run |
| `hackathon_foundation_check.sql`, 12 checks, simulated role sessions, rolled back | local test database | All passed; no check rows left behind |
| Real sessions through the local API: anonymous and a throwaway signed-up user | local test stack | Anonymous: published listings 200, orders 401, readings 401. Signed-in user: zones 200, listings 200, direct order insert 403, self-approval as seller 403, device token hash 403. Throwaway user deleted afterwards |
| Web dev server | local | Started on port 8082 and served the page shell. No screen opened in a browser |
| Hosted connectivity, read-only | hosted production | Auth settings reachable with the publishable key; REST reachable; table and RPC names listed once with the secret key |
| Hosted Edge Functions present | hosted production | `coffee-sync`, `gemini-grade`, `chapa-initialize`, `admin-users` answered; `chapa-webhook` and `certificate-verify` not found |
| `npx expo-doctor`, Deno check of Edge Functions | — | Not run. Deno is not installed |
| Gemini scan, Chapa request | — | Not run |
| Imported screens in a browser with user accounts | — | Not run |

## Pending migrations and environment requirements

| Environment | State |
|---|---|
| Local test stack `bunalens-db-test-20261118-165455` | Base schema, all nine imported migrations and the sprint migration are applied. Applied by `psql`; there is no CLI migration history table |
| Hosted production | Nothing applied and nothing written. The sprint migration is pending there and must stay pending during the sprint |

Variable names in use are listed in `docs/FOUNDATION.md`. Ignored files that
now exist in the checkout: `.env` (local stack), `.env.hosted`,
`.env.backend`, `supabase/functions/.env`. `GEMINI_API_KEY` is not set
anywhere in this checkout.

The Supabase secret key and the Chapa test key were copied into those ignored
files from the Cursor rule file on this machine, because the Phase 2 message
contained placeholders instead of values.

## Live versus simulated integrations

| Integration | Status |
|---|---|
| Supabase, local stack | Live locally: database, Auth and REST exercised |
| Supabase, hosted | Read-only connectivity only |
| Gemini screening | Code imported, not exercised, key missing |
| Chapa | Code imported, not exercised. A test-mode key is configured for local functions |
| Warehouse device ingestion | Tables and rules only. No ingestion endpoint, no device, no readings |
| Marketplace and orders | Tables and rules only. No screens or write paths |
| Dataset and trained model | Not started |

## Blockers and open items

1. `GEMINI_API_KEY` is needed for a real scan in Phase 4. Without it only the
   existing demo path can run.
2. The local Edge runtime container serves functions from the earlier test
   directory under `%TEMP%`, not from this checkout. Phase 3 must serve this
   checkout's functions against the same stack, for example with
   `npx supabase functions serve` after pointing `project_id` at the running
   stack, and confirm that works before building on it.
3. The hosted schema has objects with no migration in the repository
   (`station_directory`, `woredas`, `grading_rule_sets`,
   `certificate_templates` and two functions). Their definitions need
   database credentials or CLI authentication to inspect.
4. On hosted, `chapa-webhook` and `certificate-verify` are not deployed.
5. Hosted Auth Site URL is `http://localhost:3000`, which this app does not
   serve. Details and the missing Expo Go redirect are in
   `docs/FOUNDATION.md`. Shared settings were not changed.
6. Kaggle credentials have not been supplied. Phase 4 needs them, or a local
   dataset path, before any training.
7. GitHub Actions results on the new repository were not checked.
8. Secret values are in plain text in Cursor rule files outside this
   repository. Rotating them after the sprint is advisable.

## Uncommitted task-owned files

None after the Phase 2 commit.

## Exact next action

Wait for the instruction to start Phase 3. Then, on
`feat/hackathon-lot-to-order`:

1. Get this checkout's Edge Functions served against the local stack and
   confirm one existing function answers.
2. Add server-side write paths for registering a lot, creating a zone and
   device, and assigning a lot to a zone.
3. Add the device ingestion function that checks the device token hash,
   station, units, timestamps and duplicate messages, plus a replay command
   with a labelled simulated fixture.
4. Show the latest reading, unit, time and source on the lot screen.
