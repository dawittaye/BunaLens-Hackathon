# BunaLens Sprint Foundation (Phase 2)

Written 2026-11-21. This records what the imported application actually does,
what the hosted project actually contains, and the schema added for the
lot-to-order journey. "Code inspected" and "exercised" are kept apart on
purpose.

## Stack

| Layer | Actual technology |
|---|---|
| Client | Expo SDK 54, React Native 0.81.5, React 19.1, Expo Router 6, NativeWind 4, TypeScript 5.9. One codebase for Android, iOS and web. There is no Next.js. |
| Web | Metro web bundler. `npx expo start --web` for development, `npx expo export --platform web` for the static build that `vercel.json` serves as a single-page app. |
| Backend | Supabase: Postgres, Auth (email and password), private Storage bucket `coffee-samples`, Deno Edge Functions. |
| Vision model | `gemini-3.1-flash-lite`, called from `supabase/functions/gemini-grade`. The README still says Gemini 2.5 Flash. |
| Payments | Chapa hosted checkout, initialised and verified from Edge Functions. |

## Capability audit

Verification status uses these labels: **code** = read in the repository only;
**local** = exercised on the local Docker test stack; **hosted read** =
confirmed with a read-only request to the hosted project; **not exercised**.

| Capability | Implementation | Configuration needed | Verification status |
|---|---|---|---|
| Authentication | Supabase Auth email and password in `app/auth.tsx`, session in AsyncStorage (`services/supabaseClient.ts`), route guard in `app/_layout.tsx` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | local: sign-up returned a session. hosted read: auth settings reachable, email sign-up enabled, email confirmation required |
| Roles | Only one privileged role exists: `app_metadata.role = 'admin'`, checked in `app/_layout.tsx`, `app/admin-login.tsx`, `supabase/functions/admin-users` and admin RLS policies | Role set by a project owner through Auth Admin | code. Sprint adds `reviewer` on the same claim; local check passed |
| Station ownership | `stations.owner_id = auth.uid()` RLS; a station is created from sign-up metadata on first sign-in (`app/auth.tsx`); Edge Functions re-check ownership with the caller's token | none | local: RLS check passed for sprint tables; imported screens not exercised |
| Farmer approval | Does not exist in the imported code. The admin console can only suspend or reactivate accounts | — | Sprint adds `stations.marketplace_seller_status`; local check passed |
| Lots / batches | `coffee_batches` (text id, `batch_code`, station, sample type, woreda, weight, image path, grading JSON). Rows are created only by `coffee-sync` after a successful scan | — | code |
| Assessments | `coffee_batches.grading_result` JSON, projected by `project_batch_assessment` (before trigger) and copied to `grading_results` by `upsert_normalized_grading_result` (after trigger). Grade stays `Unclassified` | — | code |
| Photo upload and Gemini | `components/CameraScanner.tsx` and `app/(tabs)/scan.tsx` → `services/geminiVision.ts` → `coffee-sync` → `gemini-grade` → Gemini → Storage upload → batch insert | `EXPO_PUBLIC_BUNALENS_SYNC_URL`, `GEMINI_API_KEY`, `BUNALENS_INTERNAL_FUNCTION_KEY` | not exercised. `GEMINI_API_KEY` has not been supplied for local functions |
| Scan credits | `gemini-grade` calls `consume_station_scan_credit(uuid, text)` with the user's token after a valid assessment; debit is recorded in `station_credit_ledger` | — | local: debit and repeat-call idempotency passed in the check script |
| Chapa credit checkout | `components/ChapaTopUpModal.tsx` → `services/chapaService.ts` → `chapa-initialize` → Chapa → `chapa-webhook` → `apply_verified_chapa_payment` | `EXPO_PUBLIC_CHAPA_INITIALIZE_URL`, `EXPO_PUBLIC_ENABLE_REAL_PAYMENTS`, `CHAPA_SECRET_KEY`, optional `CHAPA_CALLBACK_URL`, `CHAPA_RETURN_URL` | local: `apply_verified_chapa_payment` applied once and stayed idempotent. No request to Chapa was made |
| Listings / orders | Do not exist in the imported code | — | Sprint tables added; local checks passed. No screens or write paths yet |
| Admin | `app/admin/index.tsx`, `components/admin/`, read-only RLS policies, `admin-users` Edge Function | admin claim | code |
| Offline queue | `services/offlineQueue.ts`, `contexts/OfflineQueueContext.tsx` queue captures and replay them to `coffee-sync` | `EXPO_PUBLIC_BUNALENS_SYNC_URL` | code |
| Demo mode | `EXPO_PUBLIC_DEMO_MODE=true` returns fixed sample assessments without calling Gemini | `EXPO_PUBLIC_DEMO_MODE` | code |
| Web build | `npx expo export --platform web` | none | local: passed in Phase 1 |
| Web startup | `npx expo start --web` | none | local: with `.env` loaded, the dev server started on port 8082 and served the BunaLens page shell. Port 8081, the Expo default, was already held by another Node process on this machine, which was left running. No screen was opened in a browser |

## Hosted project versus repository

Read-only requests were made to the hosted project (`hfczkwppiqxoraiajreg`,
main / PRODUCTION, eu-central-1). Nothing was written.

| Finding | Detail |
|---|---|
| Objects on hosted with no migration in the repository | Tables `station_directory`, `woredas`, `grading_rule_sets`, `certificate_templates`; column `stations.station_directory_id`; functions `activate_grading_rule_set(p_rule_set_id)` and `activate_certificate_template(p_template_id)` |
| Consequence | The repository cannot rebuild the hosted schema. `components/admin/DirectoryManager.tsx` reads and writes `woredas` and `station_directory`, so that screen cannot work on a database built from the repository. Definitions, grants, RLS and triggers of these objects could not be inspected: that needs database credentials or Supabase CLI authentication, and an API key does not provide either |
| `grading_rule_sets` columns seen | `id`, `version`, `name`, `description`, `rules` (jsonb), `status`, `created_by`, `created_at`, `activated_at` |
| `consume_station_scan_credit` | The hosted API exposes it with `p_station_id` and `p_idempotency_key`. Whether the older one-argument overload also exists on hosted cannot be told from the API |
| Edge Functions on hosted | `coffee-sync`, `gemini-grade`, `chapa-initialize`, `admin-users` answered. `chapa-webhook` and `certificate-verify` returned "Requested function was not found" |
| Consequence | `chapa-initialize` sends Chapa a callback to `chapa-webhook` by default, so on hosted a credit payment cannot be verified and applied until `chapa-webhook` is deployed |

### Existing database functions

Inspected in `supabase/schema.sql`, the migrations, and the local test
database (owner `postgres` for all).

| Function | Security | Callers | Grants | Notes |
|---|---|---|---|---|
| `consume_station_scan_credit(uuid, text)` | definer, empty search path | `gemini-grade` with the user's token | `authenticated`, `service_role` | Checks `owner_id = auth.uid()`, locks the station row, idempotent through `station_credit_ledger` key `scan:<key>`, free while Pro is active |
| `consume_station_scan_credit(uuid)` | invoker, empty search path | none in the repository | `authenticated`, `service_role` | Older overload without idempotency. Because clients have no update grant on `stations.credits`, it cannot debit when called by a client. Left in place |
| `apply_verified_chapa_payment(text, jsonb)` | invoker, empty search path | `chapa-webhook` with the service role | `service_role` only | Works on `station_payments`; raises for any package other than `starter_50` or `station_pro_monthly` |
| `apply_verified_payment_transaction(text, jsonb)` | definer | none in the repository | `service_role` only | Works on `payment_transactions` and `station_credits`, an older parallel payment path |
| `project_batch_assessment()` | invoker trigger | before insert or update of `grading_result`, `pricing_result` on `coffee_batches` | default | Copies grade, quality and confidence from the JSON into typed columns |
| `upsert_normalized_grading_result()` | invoker trigger | after insert or update of `grading_result` | default | Maintains one `grading_results` row per batch |
| `sync_station_entitlements()`, `initialize_station_credits()` | definer triggers | on `stations` | revoked from clients | Keep `station_credits` in step with `stations.credits` |

Two payment tables exist for the same purpose: `payment_transactions` (base
schema, unused by the Edge Functions) and `station_payments` (used). The
sprint does not touch either.

## Reused structures

| Need | Reused |
|---|---|
| Seller, operator and station ownership | `stations` and `stations.owner_id`, with four new approval columns |
| Coffee lot | `coffee_batches`. Its `id` is the single lot identifier. `grading_status = 'queued'` already allows a lot that has no photo yet |
| Photo assessment | `coffee_batches.grading_result`, `grading_results`, and their triggers |
| Privileged roles | The existing `app_metadata.role` claim |
| Timestamps | `set_updated_at()` trigger function |
| Client access pattern | Clients read through RLS; writes happen in server-side code |

## Sprint schema

Migration:
`supabase/migrations/20261121134500_hackathon_lot_to_order_foundation.sql`.
It only adds objects.

| Object | Purpose |
|---|---|
| `stations.marketplace_seller_status` and three review columns | Admin approval of a seller. Not client-writable |
| `coffee_batches.farmer_name`, `farmer_phone` | Farmer who supplied the lot. Private |
| `coffee_batches.moisture_pct`, `screen_size`, `measurements_recorded_at` | Operator measurements for the publication criteria |
| `coffee_batches.eligibility_status`, `eligibility_updated_at` | Current publication eligibility, separate from `ecx_grade` |
| `warehouse_zones` | Zones of a station |
| `station_devices` | One active device per zone; stores a SHA-256 hash of the device token, never the token |
| `lot_zone_assignments` | Which zone a lot is in, with a time window. One open assignment per lot |
| `device_readings` | Temperature in °C and relative humidity in %, device time and receive time, `live` or `simulated`. Unique on device and message id |
| `lot_environment_readings` (view) | Readings of a lot: its zone's readings during its assignment window |
| `lot_reviews` | Append-only eligibility decisions with reason, reviewer and the inputs used |
| `marketplace_listings` | Buyer-facing fields only, one listing per lot |
| `coffee_orders` | Buyer order with a price copied at submission and a generated total |
| `coffee_order_payments` | Chapa references for coffee orders, with an `is_test` flag. Separate from `station_payments` |
| `bunalens_jwt_role()`, `bunalens_is_reviewer()`, `bunalens_owns_station(uuid)` | Authorization helpers used by policies |

Rules enforced in the database for every writer, including the service role:

- A listing must belong to the station that owns the lot.
- A listing can be `published` only while the lot is `eligible`, the seller is
  `approved`, and stock is above zero.
- When a lot stops being eligible or a seller stops being approved, its
  published listings become `paused`.
- A repeated device message cannot create a second reading.

## Authorization

| Responsibility | Source of authority | Can read | Can write |
|---|---|---|---|
| Buyer | Any signed-in account | Published listings, own orders and their payment status | Nothing directly; order RPCs come in Phase 6 |
| Seller / operator | Owner of the station row | Own zones, devices (not the token hash), readings, lots, reviews, listings, and orders placed with the station | Nothing directly; server-side functions come in Phases 3 to 6 |
| Reviewer | `app_metadata.role = 'reviewer'` | All lots, assessments, readings, reviews and listings; not orders | Review RPC comes in Phase 5 |
| Admin | `app_metadata.role = 'admin'` | Everything above plus orders and payments | Seller approval comes in Phase 5 |
| Anonymous | none | Published listings only | Nothing |

`user_metadata` is never consulted for authority. The check script signs in
as a user whose `user_metadata.role` is `admin` and confirms it gains nothing.

## Environment variables (names only)

| File (all ignored by Git) | Variables |
|---|---|
| `.env` — client, points at the local test stack | `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_DEMO_MODE`, `EXPO_PUBLIC_ENABLE_REAL_PAYMENTS`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_BUNALENS_SYNC_URL`, `EXPO_PUBLIC_CHAPA_INITIALIZE_URL`, `EXPO_PUBLIC_CERTIFICATE_VERIFY_BASE_URL`, `EXPO_PUBLIC_CHAPA_DEMO_MODE` |
| `.env.hosted` — same client names with the hosted URL and publishable key; Expo does not load this file | same names as `.env` |
| `supabase/functions/.env` — local Edge Function secrets | `CHAPA_SECRET_KEY`, `BUNALENS_INTERNAL_FUNCTION_KEY`. `GEMINI_API_KEY` is not set |
| `.env.backend` — sprint scripts; Expo does not load this file | `BUNALENS_TEST_SUPABASE_URL`, `BUNALENS_TEST_SUPABASE_ANON_KEY`, `BUNALENS_TEST_SUPABASE_SERVICE_ROLE_KEY`, `BUNALENS_TEST_DB_CONTAINER`, `SUPABASE_SECRET_KEY` |

Naming rules followed:

- The client keeps the existing `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The hosted publishable key goes in
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`. No `NEXT_PUBLIC_*` variable is used.
- Edge Function secrets cannot start with `SUPABASE_`. The runtime injects
  `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` itself,
  and the existing functions read those names.
- `SUPABASE_SECRET_KEY` is the hosted production key. It is kept out of the
  function environment so local functions cannot reach production, and it was
  used only for one read-only schema listing.

## Test environment

A local Supabase stack was already running in Docker from an earlier test:
project `bunalens-db-test-20261118-165455`, API on `http://127.0.0.1:54321`,
Postgres on port `54322`, sign-up auto-confirmation on. It held two users,
two stations and no batches.

It is the designated write-safe environment for this sprint. Before any
change, its `public`, `auth` and `storage` schemas were dumped to
`%TEMP%\bunalens-hackathon-backup\pre_hackathon_backup_20261121.sql`.

It had the base schema and the six `20261115` migrations. During this phase
the three later repository migrations and the sprint migration were applied
to it with `psql`. It has no `supabase_migrations` history table, so the
Supabase CLI does not track what is applied.

To run the checks again:

```powershell
$c = "supabase_db_bunalens-db-test-20261118-165455"
docker cp supabase\tests\hackathon_foundation_check.sql "${c}:/tmp/check.sql"
docker exec $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/check.sql
```

## Auth URL configuration

Hosted settings as shown in the screenshots; nothing was changed.

| Setting | Current value | What the app does | Gap |
|---|---|---|---|
| Site URL | `http://localhost:3000` | `signUp` passes no redirect, so confirmation emails link to the Site URL. Hosted requires email confirmation | Nothing in this app listens on port 3000. The Expo web dev server uses port 8081 and the deployed site is `https://bunalens.vercel.app`. A confirmation link opened on a phone or another computer fails |
| Redirect | `https://bunalens.vercel.app/reset-password` | Web always requests this URL, hard-coded in `app/forgot-password.tsx` | None |
| Redirect | `bunalens://reset-password` | Native builds request `Linking.createURL('reset-password')` with scheme `bunalens` from `app.json` | None for installed builds |
| Missing redirect | `exp://<LAN-IP>:8081/--/reset-password` (pattern `exp://**/--/reset-password`) | This is what `Linking.createURL` produces inside Expo Go | Password reset from Expo Go is rejected and falls back to the Site URL. Development only |
| Not needed today | `http://localhost:8081/reset-password` | The web client never requests a local reset URL | Add it only if the web redirect is made origin-aware for local testing |

Recommended changes for the project owner to make, when ready:

1. Set the Site URL to `https://bunalens.vercel.app`.
2. Add `exp://**/--/reset-password` if password reset must work in Expo Go.

The local test stack uses Site URL `http://127.0.0.1:3000` and confirms
sign-ups automatically, so these gaps do not block local verification.

## Known gaps carried forward

1. `GEMINI_API_KEY` is not available for local functions, so a real scan
   cannot run locally yet.
2. The local Edge runtime serves functions from the earlier test directory,
   not from this checkout. Phase 3 has to serve this checkout's functions.
3. Publication limits could be stored in `grading_rule_sets`, but that table
   exists only on hosted and its definition is unknown. Phase 5 has to choose
   between recording limits in `lot_reviews.criteria_snapshot` only, or
   adding a compatible table.
4. Six imported migrations share the version prefix `20261115`, which the
   Supabase CLI treats as one version. `supabase db push` is not a safe way
   to apply this repository as it stands.
5. Device token checking, lot registration, review, publishing and ordering
   have tables and rules but no write path yet.
