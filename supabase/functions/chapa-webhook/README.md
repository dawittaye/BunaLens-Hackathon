# Chapa payment verification contract

Deploy a trusted server-side Chapa integration. Never put the Chapa secret key in the Expo app.

1. The app calls the configured checkout-initialization endpoint with a package ID, station ID and idempotency key.
2. The server authenticates the station owner, loads the authoritative package price and creates a unique Chapa transaction reference.
3. The server initializes Chapa checkout using its secret key and returns only the checkout URL and public transaction reference.
4. Chapa's webhook is received by the server. Verify the provider signature/authenticity and independently call Chapa transaction verification using the secret key.
5. Only a verified successful transaction may insert a payment record and increment station credits, inside one database transaction.
6. Enforce unique transaction references and idempotency. Never grant credits from a mobile redirect, query parameter or client-supplied amount.
7. Return payment status to the app through an authenticated status endpoint.

Required environment variables on the server: CHAPA_SECRET_KEY, CHAPA_WEBHOOK_SECRET (if enabled by the merchant integration), SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. These are server-only secrets.
