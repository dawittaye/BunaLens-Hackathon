# BunaLens Sprint State

Last updated: 2026-11-21T13:38+03:00, end of Phase 1.

Read `docs/SPRINT_RULES.md` before continuing. No secret values belong in this
file.

## Time

| Item | Value |
|---|---|
| Sprint start | 2026-11-21T13:32:51+03:00 |
| Budget | 60 minutes of active work, cumulative across phases and restarts |
| Phase 1 active work | 13:32:51 to about 13:39, roughly 6 minutes |
| Elapsed active time | about 6 minutes |
| Remaining budget | about 54 minutes |
| Interruptions | None so far. Time spent waiting between phases is not active work; record each pause here with start and end times. |

## Repository

| Item | Value |
|---|---|
| Source repository | https://github.com/Newaznezif/BunaLens (read only, never push here) |
| Source branch and SHA | `main` at `3168b3009b02d1bc9ee745954a3d443d77f7bda2` |
| Baseline commit | `91cae6734c2f40516756b512dd14c5f83712269a` on `main` |
| New checkout | `C:\Users\dave\Documents\BunaLens-Hackathon` |
| New remote | https://github.com/dawittaye/BunaLens-Hackathon (private), remote name `origin` |
| Sprint branch | `feat/hackathon-lot-to-order`, created from the baseline commit |
| Commit identity | `Dave <davboss.t07@gmail.com>`, set in this repository's local Git config to match the source checkout |

## Phases

| Phase | Status |
|---|---|
| 1. Repository and persistent context | Complete |
| 2. Configuration, architecture, and data foundations | Not started |
| 3. Warehouse device ingestion and lot traceability | Not started |
| 4. Photo screening and dataset experiment | Not started |
| 5. Publication policy and reviewer workflow | Not started |
| 6. Marketplace and orders | Not started |
| 7. Chapa test payments | Not started |
| 8. End-to-end verification and handoff | Not started |

## Implemented changes

Sprint additions so far are documentation only. No application code,
migration, or Edge Function has been changed.

| Change | Path | Type |
|---|---|---|
| Baseline record | `docs/BASELINE.md` | Sprint addition |
| Sprint rules | `docs/SPRINT_RULES.md` | Sprint addition |
| Sprint state | `docs/SPRINT_STATE.md` | Sprint addition |
| Everything else | 81 files from the source commit | Imported, unchanged |

## Checks actually run

| Check | Result |
|---|---|
| Tree hash of new checkout equals source commit tree | Passed |
| Secret pattern scan of imported snapshot | No matches |
| `npm ci --no-audit --no-fund` | Passed |
| `npm run typecheck` | Passed |
| `npx expo export --platform web` | Passed |
| `npx expo-doctor` | Not run |
| Deno check of Edge Functions | Not run, Deno is not installed |
| Any live Supabase, Gemini, or Chapa request | Not run |
| GitHub Actions on the new repository | Not checked |

## Pending migrations and environment requirements

No sprint migrations exist yet. The imported schema and nine migrations have
not been applied anywhere during this sprint.

Client variables, names only: `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_DEMO_MODE`,
`EXPO_PUBLIC_ENABLE_REAL_PAYMENTS`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_BUNALENS_SYNC_URL`,
`EXPO_PUBLIC_CHAPA_INITIALIZE_URL`, `EXPO_PUBLIC_CERTIFICATE_VERIFY_BASE_URL`,
`EXPO_PUBLIC_CHAPA_DEMO_MODE`.

Backend-only variables, names only: `GEMINI_API_KEY`, `CHAPA_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `BUNALENS_INTERNAL_FUNCTION_KEY`,
`CHAPA_CALLBACK_URL`, `CHAPA_RETURN_URL`.

No `.env` file exists in the new checkout. The web build above ran with blank
client configuration.

## Live versus simulated integrations

| Integration | Status |
|---|---|
| Supabase | Code imported, not exercised |
| Gemini screening | Code imported, not exercised |
| Chapa | Code imported, not exercised |
| Warehouse device ingestion | Not implemented |
| Marketplace and orders | Not implemented |
| Dataset and trained model | Not started |

## Blockers and open items

1. Write-based verification needs a local Supabase stack or a designated test
   project. The Supabase CLI and Deno are not on PATH. Docker is installed but
   was not confirmed running. Phase 2 must settle which environment is safe
   for writes before any migration is applied.
2. The GitHub CLI is not installed. The new repository was created through the
   GitHub REST API with the `dawittaye` login stored in the Git credential
   manager on this machine.
3. Pushing `main` to the new repository triggers the two imported workflows.
   The Android release workflow is expected to stop at its missing
   `EXPO_TOKEN` check because the new repository has no secrets. Its result
   was not checked.
4. Secret values are present in plain text in local Cursor rule files outside
   this repository. They were not copied here. Consider rotating them and
   moving them to an ignored environment file.

## In progress (Phase 2, 13:49)

About to apply repo migrations `20261118145504`, `20261119120000`,
`20261119140000` and the new sprint migration
`20261121134500_hackathon_lot_to_order_foundation.sql` to the LOCAL Docker
Supabase stack `bunalens-db-test-20261118-165455` (ports 54321 / 54322). A
`pg_dump` backup is taken first and kept outside Git. The hosted project is
not written to.

## Uncommitted task-owned files

None after the Phase 1 commit.

## Exact next action

Wait for the instruction to start Phase 2. Then, on
`feat/hackathon-lot-to-order`, trace configuration, architecture, and data
foundations: scan flow from photo to saved result, station ownership, scan
credits, Chapa, demo mode, web entry point, and the existing batch tables, and
decide the write-safe environment for verification.
