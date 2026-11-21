# BunaLens Authentication-First Navigation

## Expected route behavior

- A user without a valid session is routed to `/auth` before application screens are exposed.
- The existing auth screen provides Sign In and Create Account modes.
- A user with a persisted valid session can enter the tab application.
- Signing out invalidates the session; the root route guard returns the user to `/auth`.
- The guard covers the tabs, batch details, settings, and other app routes.

## Station profile persistence

The app restores the signed-in user's station profile from the database after the local cache is loaded. The onboarding screen retrieves an existing station or creates one after successful sign-in. The client may only read the signed-in owner's station and create/update permitted profile fields.

The migration `supabase/migrations/20261118145504_bunalens_authentication_stations.sql` creates the station profile table, enables Row Level Security, and grants only the column-level permissions required by the mobile app. It does not grant client-side permission to change credits or Pro entitlements.

The migration has been applied to the connected project and verified by inspecting the table, RLS policies, and database grants. Do not run the legacy `supabase/schema.sql` as a substitute: that file and the older payment/grading migrations need a separate consistency review.

## Email confirmation

Email confirmation remains enabled. When registration returns without a session, the app tells the user to confirm their email and then sign in. The confirmation template is in `supabase/templates/confirmation.html`; it must be pasted into the hosted Auth email template settings. A branded sender address requires a verified sending domain and is deferred until one is available.

## User-facing provider neutrality

The account screen and authentication errors use BunaLens language. Backend implementation names, raw provider errors, and database diagnostics are not exposed in account alerts. Technical repository documentation may still name internal dependencies.

## Local verification

1. Confirm the app environment contains the project URL and public publishable/anonymous client key. Never put a service-role key in the Expo client.
2. Run `npm run typecheck`.
3. With no valid session, launch the app and verify that the auth screen is shown and direct navigation to protected routes returns to auth.
4. Create a test account. Confirm the email, then sign in.
5. Verify that one station record is created for the signed-in user and the station screen displays the cloud profile.
6. Restart the app and verify that the session and station profile are restored.
7. Sign out from Settings and verify that the app returns to auth.
8. Test a second account and confirm it cannot read or modify the first account's station.

## Scope and limitations

This change covers account entry, session restoration, and the station profile required for onboarding. It does not complete the remaining grading, batch synchronization, storage, payment, or certificate database setup. Those application features must not be described as production-ready until their separate schemas, policies, and Edge Functions are validated.
