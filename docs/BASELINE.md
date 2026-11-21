# BunaLens Hackathon Baseline

This repository starts from a single committed snapshot of the existing
BunaLens application. Git history was not copied; this repository has its own
independent history that begins with the baseline import commit.

## Source

| Item | Value |
|---|---|
| Source repository | https://github.com/Newaznezif/BunaLens |
| Source branch | `main` (remote default branch, confirmed with `git ls-remote --symref`) |
| Source commit | `3168b3009b02d1bc9ee745954a3d443d77f7bda2` |
| Source commit subject | Merge pull request #18 from Newaznezif/feature/admin-user-monitoring |
| Source commit date | 2026-11-19T02:54:42+03:00 |
| Source tree hash | `4f5b1daaacc2f9930b89f21d4586313c2b43809a` |
| Import timestamp | 2026-11-21T13:33:40+03:00 |
| Import method | `git archive` of the source commit, extracted into a new directory |
| Tracked files imported | 81 |

The original checkout was only read. Its branch, index, working tree,
untracked files, and remote-tracking refs were left as they were.

## Existing features in the imported snapshot

These are features present as code in the snapshot. Unless the verification
table below says otherwise, they were not exercised against live services
during the import.

| Area | Imported capability | Main paths |
|---|---|---|
| Client | Expo SDK 54 / React Native 0.81 / Expo Router 6 app, also exportable for web | `app/`, `components/`, `app.json`, `vercel.json` |
| Dashboard and tabs | Station overview, scan, batches, and station tabs | `app/(tabs)/` |
| Sample capture | Camera capture and gallery selection for red cherry and green bean samples | `components/CameraScanner.tsx`, `app/(tabs)/scan.tsx` |
| Visual screening | Gemini 2.5 Flash called server-side; official grade stays `Unclassified` | `supabase/functions/gemini-grade/`, `supabase/functions/coffee-sync/`, `services/geminiVision.ts` |
| Batches | Batch history, filters, and batch detail | `app/(tabs)/batches.tsx`, `app/batch/[id].tsx` |
| Station and auth | Supabase Auth, station registration and ownership, password reset | `app/auth.tsx`, `contexts/StationContext.tsx`, `supabase/migrations/20261118145504_bunalens_authentication_stations.sql` |
| Scan credits and payments | Chapa hosted checkout for station credits with server-side webhook verification; local payment demo mode | `components/ChapaTopUpModal.tsx`, `services/chapaService.ts`, `supabase/functions/chapa-initialize/`, `supabase/functions/chapa-webhook/` |
| Certificates | Verification identifier, QR, public verification function | `components/CertificateCard.tsx`, `app/verify/[id].tsx`, `supabase/functions/certificate-verify/` |
| Admin console | Read-only admin overview, station search, payment review, user management | `app/admin-login.tsx`, `app/admin/`, `components/admin/`, `supabase/functions/admin-users/` |
| Offline queue | Local capture queue with later synchronization | `services/offlineQueue.ts`, `contexts/OfflineQueueContext.tsx` |
| Demo mode | Labelled demo samples and seeded records | `constants/demoSamples.ts`, `EXPO_PUBLIC_DEMO_MODE` |
| Localization | English and Afaan Oromo labels | `constants/translations.ts`, `contexts/LanguageContext.tsx` |
| Database | Base schema plus nine ordered migrations | `supabase/schema.sql`, `supabase/migrations/` |
| CI | TypeScript check, Expo Doctor, Android bundle export, Deno check of Edge Functions | `.github/workflows/` |

Not present in the snapshot: a text search of the application source for
marketplace, listing, device, sensor, and humidity found no implementation
code. Warehouse device ingestion, marketplace listings, and buyer orders are
sprint additions, not imported features.

## Verification results

All checks below were run in the new checkout on 2026-11-21 with Node.js
v24.12.0 and npm 11.6.2, with no `.env` file present.

| Check | Command | Result |
|---|---|---|
| Snapshot integrity | `git write-tree` in the new checkout compared with the source commit tree | Identical tree hash `4f5b1da…`; all 81 files match the source commit byte for byte as Git stores them |
| Secret scan of snapshot | Pattern search for Chapa, Supabase secret, Google API, and JWT key shapes | No matches |
| Dependency install | `npm ci --no-audit --no-fund` | Passed, 818 packages, deprecation warnings only |
| TypeScript | `npm run typecheck` | Passed, exit code 0 |
| Web build | `npx expo export --platform web` | Passed, exported to `dist/` (ignored by Git) |
| Expo Doctor | `npx expo-doctor` | Not run |
| Android bundle export | `npx expo export --platform android` | Not run |
| Edge Function type check | `deno check supabase/functions/*/index.ts` | Not run; Deno is not installed on this machine |
| Live Supabase, Gemini, Chapa | — | Not exercised during import |

## Git LFS and submodules

The source commit has no `.gitattributes`, no LFS-tracked files
(`git lfs ls-files` returned nothing), and no `.gitmodules`. Nothing extra
needed to be fetched.

## Intentional exclusions

Only files tracked in the source commit were imported. The following items in
the original checkout were left behind on purpose.

| Excluded item | Reason |
|---|---|
| `.git/` and all source history, branches, and tags | Independent history was required |
| `.env`, `.env.local`, `.env.chapa-test.backup` | Local environment files that may hold secrets |
| `node_modules/` | Reinstalled from `package-lock.json` |
| `.expo/`, `expo-env.d.ts` | Generated local output, ignored by the source `.gitignore` |
| `.cursor/` | Untracked local editor rules; not part of the source commit |
| `supabase/.temp/` | Untracked Supabase CLI local state |
| Other remote branches | Only the default-branch commit was selected |

`.env.example` was imported because it is a committed template with blank
values.

## Notes for later phases

- The README lists six migrations in its manual order, but the snapshot
  contains nine migration files. The three newest cover authentication
  stations, admin dashboard access, and admin user monitoring.
- The source has no license file. The README states that all rights are
  reserved unless the owner adds a license.
