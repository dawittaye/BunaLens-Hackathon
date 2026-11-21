# BunaLens authentication email branding

This repository contains the branded email body for the account-confirmation message. The template is provider-neutral in its visible copy and uses the hosted authentication service only to generate and validate the one-time confirmation link.

## Confirmation email template

File: `supabase/templates/confirmation.html`

In the BunaLens authentication project's dashboard:

1. Open **Authentication → Email Templates → Confirm signup**.
2. Set the subject to **Confirm your BunaLens account**.
3. Replace the message body with the complete contents of `supabase/templates/confirmation.html`.
4. Save the template and send a test signup to verify rendering in Gmail and mobile mail clients.

The template uses the supported `{{ .Email }}` and `{{ .ConfirmationURL }}` variables. Keep the confirmation URL variable intact; do not replace it with a hard-coded project URL or a manually constructed token URL.

## Production URL configuration

The Vercel project currently has the domain `https://bunalens.vercel.app`. Before production signups:

- Set the authentication **Site URL** to `https://bunalens.vercel.app`.
- Add `https://bunalens.vercel.app/**` to the allowed redirect URLs.
- Keep the local development redirect needed by your Expo web/local workflow only if you actively use it.
- Do not add broad wildcard redirects for arbitrary domains.

The current mobile signup call does not pass a custom `emailRedirectTo`. Therefore, confirmation uses the configured Site URL. After confirming in the browser, users can return to the app and sign in. A seamless return to the installed mobile app requires a separate deep-link callback implementation and must be tested on Android/iOS before enabling it.

## Sender identity and provider visibility

The HTML and subject are branded as BunaLens. The sender display name and sending address are controlled by the project's email delivery configuration, not by this HTML file.

For a fully branded sender such as `BunaLens <accounts@your-domain>`, configure a custom SMTP provider and verify a domain you control, then set the sender name to `BunaLens`. Do not invent a sender address or use an address on a domain you do not own. The default hosted sender may still expose the underlying provider's domain in the From address or confirmation-link host; a branded template alone cannot change that infrastructure detail.

## Release and verification

- Confirm signup and sign-in on a test account.
- Confirm that the station lookup/creation step succeeds after authentication; this requires the production database schema and row-level security policies.
- Verify that the email subject, sender identity, button, fallback URL, and mobile layout render correctly.
- Merge the authentication changes only after these checks pass.
