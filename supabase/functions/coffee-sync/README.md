# Offline sync API

The mobile client POSTs a queued capture to this authenticated Edge Function after connectivity returns. The same function is used for online grading so every accepted scan is graded, priced and persisted through one server-controlled path.

Required request headers:
- `Authorization: Bearer <Supabase user access token>`
- `apikey: <Supabase public anon/publishable key>`
- `Content-Type: application/json`

Request JSON:
- `idempotency_key`: stable capture key, reused for every retry.
- `station_id`: UUID of the authenticated user's washing station.
- `sample_type`: `red_cherry` or `green_bean`.
- `woreda`: selected Jimma origin woreda.
- `lot_weight_kg`: positive lot weight.
- `captured_at`: ISO-8601 capture timestamp.
- `image_mime_type`: JPEG, PNG or WebP.
- `image_base64`: image bytes encoded as base64.
- Optional `gps_latitude` and `gps_longitude`.

The function authenticates the user, verifies station ownership, calls the internal `gemini-grade` function using the server-only `BUNALENS_INTERNAL_FUNCTION_KEY`, uploads the image to the private `coffee-samples` bucket, derives indicative pricing from active database market benchmarks, and persists a canonical batch record.

The Gemini function validates the model result and consumes one scan credit through an atomic, idempotent database function. Reusing the same capture key does not debit a second credit. The mobile client cannot insert grading records directly.

A retry with the same key returns the existing batch when already persisted. Local images are removed from the queue only after a valid canonical batch response. If persistence fails after grading, retry with the same key; the credit ledger prevents duplicate debit.
