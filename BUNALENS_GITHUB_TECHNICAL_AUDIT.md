# BunaLens — GitHub Technical Audit

Audit date: 2026-11-18

Repository: https://github.com/Newaznezif/BunaLens

Audited default branch: `main`

Audited commit: `a788c7039b295be011eb573bf3b9810a53f3a93d`

Scope: Static repository and GitHub evidence review. No live Supabase project, Gemini project, Chapa merchant account, deployed Edge Functions, physical camera device, or native build credentials were available.

## Part 1 — Executive summary

BunaLens is a mobile-first Expo/React Native coffee sample workflow for Jimma, Ethiopia. The repository contains a coherent UI, demo workflow, Supabase and Edge Function architecture, local batch persistence, an offline queue, image capture, English/Afaan Oromo localization, certificate components, and hosted payment initialization code.

The default branch is substantially more complete than a prototype, but it is not yet production-proven. The strongest current implementation is the demo experience and static/mobile UI. Authentication and station ownership code exist, and the backend contains serious security-oriented validation. However, live Supabase/Gemini/Chapa behavior was not executed, cloud batch loading is absent, SQL configuration is inconsistent or duplicated, and some station-profile/payment flows do not match the database model consistently.

## Part 2 — Architecture

### Frontend

- Expo SDK 54.0.38
- Expo Router 6.0.24
- React 19.1.0
- React Native 0.81.5
- TypeScript 5.9.2 with strict configuration
- NativeWind 4.2.7 and Tailwind CSS 3.4.17
- Expo Camera, Image Picker, Location, FileSystem, Print, Sharing and Haptics
- `react-native-view-shot`, `html2canvas`, QR code and SVG support

The main routes are in `app/`, tab routes in `app/(tabs)/`, and shared state in `contexts/`. `StationContext` owns the station and local batch state, `OfflineQueueContext` owns connectivity and queue state, and `LanguageContext` owns bilingual UI state.

### Backend

Supabase supplies Auth, PostgreSQL, private Storage and Deno Edge Functions. The key functions are:

- `supabase/functions/coffee-sync/index.ts`
- `supabase/functions/gemini-grade/index.ts`
- `supabase/functions/chapa-initialize/index.ts`
- `supabase/functions/chapa-webhook/index.ts`
- `supabase/functions/certificate-verify/index.ts`

The intended cloud assessment path is mobile → `coffee-sync` → station ownership/credit validation → `gemini-grade` → Gemini 2.5 Flash → image upload to private Storage → batch persistence → mobile response.

### Database

The repository defines stations, batches, grading results, entitlement, payment and benchmark structures in `supabase/schema.sql`, with migration files under `supabase/migrations/`. RLS is enabled for station-owned data. Mobile clients have no direct batch, grading, entitlement or payment write policies; server-side service-role code performs authoritative writes.

### State and persistence

`AsyncStorage` stores station state, local batches and language selection. Captured files are stored in Expo's private document directory. `NetInfo` is used to detect connectivity and trigger queue synchronization.

## Part 3 — Functional inventory

| Area | Classification | Evidence |
|---|---|---|
| Expo application shell and navigation | Fully implemented | `app/_layout.tsx`, `app/(tabs)/_layout.tsx` |
| English and Afaan Oromo UI | Implemented but not fully verified | `contexts/LanguageContext.tsx` |
| Demo station and seeded batches | Fully implemented locally | `contexts/StationContext.tsx`, `constants/demoSamples.ts` |
| Camera and gallery selection | Implemented but device-unverified | `app/(tabs)/scan.tsx`, `components/CameraScanner.tsx` |
| Supabase email sign-in/sign-up | Implemented; live behavior unverified | `app/auth.tsx`, `services/supabaseClient.ts` |
| Station registration | Implemented but not end-to-end verified | `app/auth.tsx`, `supabase/schema.sql` |
| Cloud batch loading | Not implemented | `StationContext` only loads from `AsyncStorage` |
| Real Gemini visual assessment | Implemented in backend; live model behavior unverified | `supabase/functions/gemini-grade/index.ts` |
| Structured model validation | Implemented | Both client and Edge Function validators |
| Offline queue | Implemented; physical-device behavior unverified | `services/offlineQueue.ts`, `contexts/OfflineQueueContext.tsx` |
| Batch filtering/history UI | Implemented | `app/(tabs)/batches.tsx` |
| Batch update/delete operations | Not implemented | No update/delete UI or service identified |
| Station profile UI | Implemented; cloud persistence incomplete | `app/(tabs)/station.tsx` |
| Chapa checkout | Implemented in backend; live credentials unverified | `supabase/functions/chapa-initialize/index.ts` |
| Chapa verification/application | Partially implemented; implementation mismatches require resolution | `chapa-webhook`, migrations |
| PNG certificate export | Implemented; physical/web behavior unverified | `app/batch/[id].tsx`, `CertificateCard.tsx` |
| PDF certificate export | Implemented; native/web behavior unverified | `app/batch/[id].tsx` |
| Public certificate verification | Implemented as Edge endpoint; public deployment unverified | `supabase/functions/certificate-verify/index.ts` |
| Automated tests | Not implemented | No test script or test suite in package manifest |

## Part 4 — Workflow verification

### Authentication and station onboarding

Supabase authentication is implemented with `@supabase/supabase-js`, persistent AsyncStorage sessions and auto-refresh in `services/supabaseClient.ts`. `app/auth.tsx` supports sign-in, sign-up, station lookup and station creation.

A new sign-in account is expected to have a station with `owner_id = auth.uid()`. If no station exists, sign-up/sign-in creates one. This is the real source of station prerequisites; the UI message is in `app/(tabs)/scan.tsx` in `registerStationHint` and is emitted when `station.id === 'station-demo'`.

The station requirement is consistent with the backend: `coffee-sync` and `gemini-grade` verify station ownership, and RLS scopes station data to the owner. Demo mode explicitly bypasses real cloud grading.

Two verification gaps remain:

1. There is no session-to-station cloud rehydration on application startup. `StationContext` starts with the demo station and loads only local AsyncStorage station/batch keys.
2. There is no route guard. Authentication is enforced at backend operations and station lookups, but protected routes can still be opened and inspected by unauthenticated users.

Sign-out resets local station state to the demo station in `app/auth.tsx`.

### Dashboard

The dashboard uses local `StationContext` data. It separates demo batches from synchronized batches, avoids adding demo records to live averages, and shows station credits and illustrative coffee value. It does not load Supabase station/batch records or reconcile server-side balances unless explicitly refreshed on the Station screen.

### Sample assessment

The real submission path is implemented:

1. Form/input and image selection in `app/(tabs)/scan.tsx`
2. Weight and station/credit validation
3. Optional GPS consent and permission request
4. `submitCoffeeSample()` in `services/geminiVision.ts`
5. Authenticated `coffee-sync` Edge Function
6. Station ownership validation
7. `gemini-grade` internal call
8. Gemini 2.5 Flash structured response
9. Strict result validation and credit debit
10. Private image upload
11. Batch and pricing persistence
12. Local batch update and result navigation

Offline submission copies the image and metadata to `AsyncStorage` and Expo FileSystem. It does not run Gemini while offline.

### AI verification

Gemini integration is real server-side code, not a local mock. The model request and strict response schema are in `gemini-grade/index.ts`. The project intentionally restricts `ecx_grade` to `Unclassified`, and Gemini validation prevents unsupported grade claims. Demo presets remain fixed local assessments and are clearly marked demo-only.

### Batch management

Local batch listing, search, sorting and filtering are implemented. No Supabase batch hydration or update/delete workflow is implemented. Cloud records exist only if a user performs a scan on that device or queue synchronization adds the response to local state.

### Station management

Station creation and station lookup are implemented. Station profile editing is only written to `AsyncStorage` in `app/(tabs)/station.tsx`; the code does not call Supabase to update the station row. Cloud balance refresh is implemented for credits and Pro expiry.

### Certificates

The certificate card displays real batch data and a QR. Web PNG export uses `html2canvas`; native PNG export uses `react-native-view-shot`; PDF export uses Expo Print and native sharing or browser print. These are not yet physically device-verified. PDF content is escaped for HTML-sensitive text.

## Part 5 — Backend verification

### Supabase client

Configured only when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are both present. Session persistence, refresh and `detectSessionInUrl=false` are configured. No live project credentials or environment were available for runtime verification.

### Database schema

The base schema is broad and contains station, batch, grading, credit, payment and market structures. RLS restricts owners. Direct client writes to batches, entitlements and payments are revoked.

Two compatibility eras are visible:

- Base schema: `payment_transactions`, `market_prices` and `apply_verified_payment_transaction`
- Ordered migrations: `station_payments`, `market_benchmarks`, `station_credit_ledger`, `consume_station_scan_credit` and `apply_verified_chapa_payment`

This is confusing and can break deployments that apply only part of the setup. The README tells users to apply base schema plus migrations, but CI performs no SQL validation.

`supabase/schema.sql` also contains repeated table/function blocks in the retrieved file. This should be treated as a P1 SQL maintenance defect until the file is validated by a Supabase/Postgres parser and deduplicated.

### Edge Functions

Edge Functions validate user sessions and station ownership. Image size and signatures are checked. AI/credit operations use idempotency keys. Gemini and Supabase service secrets remain server-side.

The Chapa webhook deserves a P1 resolution before enabling live payments: it reads `station_payments` and calls `apply_verified_chapa_payment`, while the base schema defines a separate `payment_transactions` and `apply_verified_payment_transaction`. Live correctness depends on migrations being applied exactly as documented.

### Storage

The private `coffee-samples` bucket is configured for JPEG, PNG and WebP with a 10 MB limit. Storage and station-folder ownership policies are present. Image data should remain private.

## Part 6 — Security assessment

No confirmed live exploit can be claimed without a deployed backend, but the repository has several confirmed code or configuration risks.

### Confirmed protections

- Supabase keys exposed by the app are public/publishable keys, not service-role credentials.
- Gemini and Chapa secrets are server-only.
- Edge Functions verify Supabase user sessions.
- Station ownership is checked in grading and payment initialization.
- Direct mobile writes to batches, grading, payments and entitlements are revoked or have no write policy.
- Image signature, MIME type and size are validated.
- Structured Gemini output is strictly validated.

### Potential risks

- Public certificate verification and wildcard CORS expose random UUID verification records. This is not confirmed data leakage, but deployed response data should be minimized and rate-limited.
- Station and batch state is stored in plaintext AsyncStorage. This is normal for local app state but may retain sensitive GPS/phone data if those fields are persisted.
- Demo market and pricing values are clearly labelled locally, but can still be mistaken for real value by users outside demo/product screens. Continue strong UI disclaimers.
- Station profile fields edited locally do not have server persistence, creating false expectations and stale cross-device data.
- The app does not show an authenticated route shell or station onboarding gate; it relies on operation-level checks.
- There are no automated tests or RLS integration tests in the repository.
- The workflow does not run npm audit, Supabase SQL lint/migration checks or native build validation.

## Part 7 — Quality assessment

### Code quality

The repository has concise TypeScript modules and clear domain boundaries. Some UI files are dense and `app/auth.tsx` is compressed to few lines, reducing maintainability. `StationContext` and `OfflineQueueContext` have reasonable responsibilities but lack Supabase rehydration and cloud conflict reconciliation.

No lint or unit-test scripts are configured. CI has TypeScript, Expo Doctor and bundle export, but no tests or SQL validation.

### Runtime concerns

- `StationContext.consumeCredit()` has a closure over station state and can lose updates under rapid consecutive actions.
- Station profile updates in demo mode may be persisted locally but appear unsynchronized with Supabase in real mode.
- Offline queue synchronization checks a queue item, then breaks on station-demo or invalid station, preserving the queue until configuration is corrected.
- Direct and offline scan credits are enforced partly locally and partly at the backend. The server remains authoritative but UI balance may be stale.
- `station.pro_expires_at` refresh and mobile credit consumption should be reloaded after every server mutation.

### Accessibility and responsive layout

The UI uses many NativeWind cards, but buttons and text fields do not consistently include accessibility labels, hints or state. Some fixed widths/heights and horizontal chips may be unsuitable on very small devices. Device layout testing is absent.

### Localization

English and Afaan Oromo translations are present in `contexts/LanguageContext.tsx`. PR #10 also adds a complete set of guided-flow keys on its branch. `constants/translations.ts` appears to be a small compatibility file rather than the primary localization implementation. A key-level audit should compare each `t(...)` call with `TranslationKey` values.

Hardcoded English strings remain in station/payment screens and status alerts, including account labels and sync messages. They should be moved to translations for full Oromo coverage.

## Part 8 — CI/CD assessment

The workflow `.github/workflows/ci.yml` runs on pushes and pull requests to `main`.

Jobs:

1. Mobile: npm install, `npm run typecheck`, `npx expo-doctor`, Android export.
2. Edge: Deno type-check for five Edge Functions.

### Current default branch

Run `43872588733` passed on `main` after PR #9.

No failing job was present. The exact current commit is not fully encoded in the run summary result, but the run was associated with the latest default-branch merge history and followed successful PR #9 merge activity.

### Recently observed failures

- Run `43872466726`, commit `9d0c605ad121c74191c13467129dab028142a036`: failed TypeScript validation.
- Run `43872421746`, commit `219130b3c52e1dfa51015a509e9b7de84d332d04`: failed TypeScript validation.
- Run `43872391481`, commit `d5300f45434ae20cf2ff410053280df5bc)`: failed TypeScript validation.

Actual log:

`contexts/LanguageContext.tsx(116,5): error TS1005: ',' expected.`

These failures occur on open PR #10 branch activity, not on the latest passing merge to `main`.

### Earlier known failures

Historical runs `43820033920` and `43820103087` failed on `app/verify/[id].tsx(49,64)` with `TS1109: Expression expected`. The later certificate fix run `43820143350` passed. This historical syntax issue is resolved on the current default branch.

### Missing CI coverage

- No iOS build validation
- No web build/export validation
- No unit or integration tests
- No camera/device smoke tests
- No E2E authentication, station or RLS tests
- No live payment test
- No Supabase migration validation
- No SQL lint or rollback test
- No dependency vulnerability audit
- No lint configuration
- No release signing or EAS build

GitHub Actions logs shown: 20 runs out of 206 available in the recent run listing. The latest default-branch pass is evidence; live deployed behavior remains unverified.

## Part 9 — Bug register

### P0 — Critical

No P0 code defect can be confirmed from static evidence alone because the live Supabase/Gemini/Chapa environment was unavailable. Production safety must not be inferred without live configuration and RLS/migration testing.

### P1 — High

**BL-001 — P1 — Cloud station/batch state is not rehydrated**

- Files: `contexts/StationContext.tsx`, `contexts/OfflineQueueContext.tsx`, `app/auth.tsx`
- Function: `StationProvider`, app startup
- Explanation: The provider starts from demo state and only loads station/batches from AsyncStorage. It does not query Supabase after session restoration.
- Impact: After reinstall/logout/session expiry or another device, cloud batches and server entitlements may be missing or stale.
- Solution: Authenticate, load owned station via `owner_id`, load station credits and owned batches, then reconcile with local queue and demo records.
- Verification: Static confirmed; live behavior unverified.

**BL-002 — P1 — Station profile edits are local only**

- Files: `app/(tabs)/station.tsx`
- Function: station profile `Save`
- Explanation: `setStation(...)` updates context and AsyncStorage but does not update Supabase `stations`.
- Impact: Profile appears changed on one device but is not preserved server-side or synchronized to another device.
- Solution: Persist through an authenticated Supabase update constrained to profile columns, then rehydrate the canonical station record.
- Verification: Static confirmed; live behavior unverified.

**BL-003 — P1 — SQL compatibility and migration model is inconsistent**

- Files: `supabase/schema.sql`, `supabase/migrations/20261115_business_rules.sql`, `20261115_secure_transactions.sql`, Edge payment functions
- Explanation: The base schema defines `payment_transactions`/`apply_verified_payment_transaction`, while migrations and Edge Functions use `station_payments`/`apply_verified_chapa_payment`. The base file also contains repeated blocks.
- Impact: Payment or schema setup can fail or create different runtime behavior depending on deployment sequence.
- Solution: Establish one canonical schema, validate migrations in an isolated Supabase/Postgres instance, remove duplicate blocks and align Edge Functions/table names.
- Verification: Static confirmed; live migration execution unverified.

**BL-004 — P1 — Open PR #10 branch CI is failing**

- Files: `contexts/LanguageContext.tsx` on PR branch
- Run IDs: `43872466726`, `43872421746`, `43872391481`
- Branch/commit: open draft PR #10, commits `9d0c605`, `219130b`, `d5300f4`
- Explanation: TypeScript reports `TS1005: ',' expected` at line 116 of the translation file.
- Impact: PR #10 cannot merge in its current state and may block the guided-capture UX.
- Proposed fix: Repair the translation object syntax and rerun typecheck plus Edge/mobile CI.
- Verification: GitHub log confirmed; current main merge of PR #9 is separate and passing.

**BL-005 — P1 — No Supabase/AI/payment integration smoke tests**

- Files: package scripts, `.github/workflows/ci.yml`
- Explanation: CI has no unit, integration or live test coverage for Auth, RLS, Edge Functions, Gemini or Chapa.
- Impact: A passing build can coexist with a broken station, migration or paid workflow.
- Solution: Add isolated mock/unit tests plus deployment-environment smoke tests and RLS policy tests.
- Verification: Static confirmed; live environment unavailable.

### P2 — Medium

**BL-006 — P2 — Route protection is not implemented**

- Files: `app/_layout.tsx`, `app/(tabs)/`, `app/auth.tsx`
- Explanation: Expo routes are public and only backend operations or station-demo checks control access.
- Impact: Unauthenticated users can navigate UI screens, although sensitive operations should reject server-side.
- Solution: Add route guards and an explicit onboarding/sign-in state; preserve demo route behavior.
- Verification: Static confirmed.

**BL-007 — P2 — Batch update/delete is absent**

- Files: `app/(tabs)/batches.tsx`, `app/batch/[id].tsx`
- Explanation: Search/filter and detail viewing exist, but no update/delete workflows or Supabase mutations exist.
- Impact: Operators cannot correct or remove batches in the cloud workflow.
- Solution: Define product rules, add server RLS/write RPC and UI confirmation flows.
- Verification: Static confirmed.

**BL-008 — P2 — Cloud balance and batch state can be stale**

- Files: `contexts/StationContext.tsx`, `app/(tabs)/station.tsx`, `contexts/OfflineQueueContext.tsx`
- Explanation: Server credit changes and local UI credit changes are not synchronized through one authoritative subscription or rehydrate mechanism.
- Impact: Incorrect available-credit display and duplicate/failed submissions.
- Solution: Refresh station record after sign-in, payment, grading and queue sync; consider server credit data as canonical.
- Verification: Static confirmed; live backend unverified.

**BL-009 — P2 — Payment status is not fully exposed to the app**

- Files: `services/chapaService.ts`, `supabase/functions/chapa-webhook/index.ts`, `app/(tabs)/station.tsx`
- Explanation: Initialization and demo status exist, but the app does not implement an authoritative authenticated payment-status endpoint or return URL polling state.
- Impact: Users may have paid while local UI remains pending until balance refresh.
- Solution: Implement `chapa-status` or verified status endpoint and refresh balance after return/webhook.
- Verification: Static confirmed; live Chapa unverified.

**BL-010 — P2 — Offline queue status is too coarse**

- Files: `services/offlineQueue.ts`, `contexts/OfflineQueueContext.tsx`
- Explanation: Queue metadata uses one pending count and list; failures are logged by break/catch without per-item status.
- Impact: Operators cannot understand which item failed and why.
- Solution: Add queued/syncing/failed states, retry reason, last attempt and manual retry per item.
- Verification: Static confirmed; device behavior unverified.

**BL-011 — P2 — Station profile state may race in rapid updates**

- Files: `contexts/StationContext.tsx`
- Function: `setStation`, `addCredits`, `consumeCredit`
- Explanation: `addCredits` and `consumeCredit` capture the current closure's station value; rapidly chained updates can use stale state.
- Impact: Lost local credit updates.
- Solution: Make setStation functional and reconcile authoritative server updates after mutations.
- Verification: Static confirmed.

**BL-012 — P2 — Certificate/verification and payment CORS are over-open**

- Files: Edge Function `cors` definitions
- Explanation: Several functions use `Access-Control-Allow-Origin: "*"`.
- Impact: Public endpoints are callable cross-origin; risk depends on endpoint semantics and abuse controls.
- Solution: Restrict browser origins where applicable, add rate limiting and verify deployment needs.
- Verification: Static confirmed; live access unverified.

**BL-013 — P2 — Localization and hardcoded text are incomplete**

- Files: `contexts/LanguageContext.tsx`, `app/(tabs)/station.tsx`, `app/auth.tsx`, `app/batch/[id].tsx`
- Explanation: Status alerts and several labels remain hardcoded in English and translation key parity is not CI-validated.
- Impact: Afaan Oromo users encounter mixed-language UI.
- Solution: Extract all hardcoded UI text and add a translation key audit test.
- Verification: Static confirmed.

### P3 — Low

**BL-014 — P3 — Dense/auth UI maintainability**

- Files: `app/auth.tsx`, some station/batch screens
- Explanation: Compressed JSX and inline logic are difficult to review and test.
- Impact: Higher regression risk and slower feature development.
- Solution: Split auth sections and extract validated form components without changing architecture.
- Verification: Static confirmed.

**BL-015 — P3 — CI lacks lint and dependency audit**

- Files: `package.json`, `.github/workflows/ci.yml`
- Explanation: No lint script or audit step exists.
- Impact: Style violations and known dependency vulnerabilities are not detected.
- Solution: Add lint, npm audit policy and lockfile checks.
- Verification: Static confirmed.

**BL-016 — P3 — Accessibility metadata is inconsistent**

- Files: UI components and routes
- Explanation: Some controls lack labels, hints or accessibility states.
- Impact: Reduced screen-reader usability and touch-target confidence.
- Solution: Add accessibility roles/labels and test with VoiceOver/TalkBack.
- Verification: Static confirmed.

## Part 10 — Development roadmap

### Phase 1 — Stabilize and verify

1. Repair and merge PR #10 only after CI passes.
2. Select and validate one canonical Supabase schema/migration set in an isolated project.
3. Remove duplicate or conflicting SQL blocks and add migration validation to CI.
4. Implement cloud station and batch rehydration after session restoration.
5. Add one server-authoritative station entitlement and batch loading API/query.
6. Verify RLS and storage policies with authenticated test users.
7. Verify live Gemini and station ownership paths in a staging environment.

### Phase 2 — Complete core workflows

1. Persist station profile edits to Supabase.
2. Add server-backed station onboarding and first-run guidance.
3. Add route guards plus demo/cloud mode transitions.
4. Implement batch edit/delete with explicit server authorization.
5. Improve offline queue with per-item retry states and stale balance reconciliation.
6. Implement payment status polling/webhook reconciliation and return-state UX.

### Phase 3 — Production quality

1. Add unit, integration and RLS tests.
2. Add web export and Android/iOS smoke-test automation.
3. Add linting and dependency vulnerability scanning.
4. Audit every translation key and hardcoded UI string.
5. Add accessibility labels and physical-device layout checks.
6. Prepare EAS build profiles and physical-device certificate export verification.

### Phase 4 — Domain validation

1. Build a representative, consented coffee image dataset.
2. Add human review and uncertainty handling.
3. Calibrate grade and readiness mappings only after field validation.
4. Replace demo benchmarks with sourced, dated market data.
5. Add formal operational reporting and station-level summaries.

## GitHub status summary

- Default branch: `main`
- Default branch current merge: PR #9 merged
- PR #9: merged; title “Natural coffee-first UI/UX redesign”
- PR #10: open draft; title “Guide coffee sample capture with a two-step flow”; not merged
- `design/premium-coffee-experience`: branch remains at commit `7fcd20f8af6dfe18fd84336308bf3708fa278054`
- Latest relevant main CI run: `43872588733`, success
- PR #10 failing CI runs: `43872466726`, `43872421746`, `43872391481`
- No pull requests were merged, closed or modified during this audit.
- No source files or branches were modified except this audit report.
