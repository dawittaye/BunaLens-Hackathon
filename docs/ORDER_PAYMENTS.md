# Chapa test payments for coffee orders (Phase 7)

Recorded 2026-11-21. Sprint additions. Applied to the local test database
only; not deployed anywhere.

## Actual payment status

One coffee order was paid through Chapa in **test mode** and verified by the
server with Chapa's verify endpoint:

| Item | Value |
|---|---|
| Lot | BNL-JMA-0688 (demo lot, DEMO listing) |
| Order | 2 kg × 450 ETB = 900 ETB, order status `accepted` |
| Chapa reference | `BNLO-5d62cb9fe7bf4963822b3f7b0902099b` |
| Chapa answer | status `success`, mode `test`, 900 ETB |
| Stored result | payment `verified`, `is_test = true`; order `payment_status = paid_test` |

Chapa's receipt page for this checkout carried the label "Test Mode: Not a
real payment." No money moved. Nothing was received, settled, held in escrow
or paid out, and the app does not show a wallet balance. The seller view
lists verified checkouts and says so.

Live Chapa keys are refused: the function stops unless `CHAPA_SECRET_KEY` is
a test key.

## Flow

Buyer submits → seller accepts (stock reserved) → buyer presses "Pay with
Chapa (TEST)" → the server opens a Chapa checkout for the stored order total
→ buyer pays on Chapa's page → the server asks Chapa's verify endpoint → the
order's payment status changes.

| Piece | Path |
|---|---|
| Edge Function: `initialize`, `verify`, provider callback | `supabase/functions/chapa-order-payment/index.ts` |
| Database functions and columns | `supabase/migrations/20261121150500_hackathon_order_payments.sql` |
| Client calls, payment rows | `services/marketplace.ts` |
| Buyer pay and check buttons, seller verified-payment list | `app/market/orders.tsx` |

## Rules

- The checkout is opened by the server. The client sends an order id and a
  key, nothing else; an amount or currency in the request is ignored (checked).
- The amount is `coffee_orders.total_etb`. The currency is ETB.
- The reference `BNLO-<32 hex>` is generated in the database and stored on a
  payment row bound to the order before Chapa is called.
- Only the buyer of an accepted, unpaid order can open a checkout.
- One open checkout per order. A retry returns the same reference and URL.
- Verification always asks Chapa with the stored reference. Nothing in a
  callback or redirect is used except the reference. The database then
  requires status `success`, the same reference, ETB and the stored amount.
  Any mismatch is rejected and recorded with its reason.
- A verified payment is final. Repeated or contradictory callbacks change nothing.
- Order status and payment status are separate columns. A payment never
  accepts, cancels or fulfils an order.

## Stock for unpaid, expired and late payments

| Situation | Behaviour |
|---|---|
| Checkout open | The order cannot be cancelled; its kilograms stay reserved |
| Checkout not paid within 30 minutes | The next verification marks it `expired` and the order payment `failed`. The buyer can open a new checkout, or the buyer or seller can cancel, which returns the kilograms |
| Chapa reports failure | Payment `failed`, order payment `failed`, order still accepted. Same choices as above |
| Chapa reports success after the order was cancelled, or after another payment already paid it | The payment is stored as verified with `late_success = true` and a note that it needs manual refund handling. The order and the stock are not changed |
| Paid order | Cannot be cancelled. Refunds are not implemented |

Expiry is applied when someone verifies or opens a new checkout. There is no
scheduled job, so an abandoned checkout holds its kilograms until the buyer
or the seller opens the orders screen and checks the payment.

## Station-credit checkout

Not touched. `chapa-initialize`, `chapa-webhook`, `services/chapaService.ts`
and `apply_verified_chapa_payment` have no changes in Git. The three local
`station_payments` rows had the same checksum before and after this phase.
The credit checkout itself was not exercised in this sprint.

## What ran

| Check | How | Result |
|---|---|---|
| Open a real Chapa test checkout, retry, authorization, forged callbacks, unpaid verification | `node scripts/hackathon/verify-order-payment.mjs`, normal buyer and seller sessions, function served from this checkout with Deno, Chapa test API | 18 of 18 passed |
| Pay the checkout | Chapa's hosted page in a browser: "Test Bank Payment", Chapa's test phone number, "Pay using Test Mode" | Receipt: Paid, 900.00 ETB, "Test Mode: Not a real payment." |
| Server verification of that payment, duplicate verification and callback, seller reads the payment, no second payment, no cancellation | `node scripts/hackathon/verify-order-payment.mjs --confirm` | 6 of 6 passed |
| Mismatched amount, currency and reference; duplicate and contradictory results; failure and retry; expiry; cancellation and stock release; late success; unknown reference; client roles locked out | `supabase/tests/hackathon_order_payment_check.sql`, one transaction, rolled back, with SIMULATED provider answers | 19 of 19 passed |
| Edge Function type check | `npx -y deno check` | Passed |
| App type check and web export | `npm run typecheck`, `npx expo export --platform web` | Both passed |
| Marketplace checks after the paid order | `node scripts/hackathon/verify-marketplace.mjs` | 59 of 59 passed |

Verified with Chapa itself: checkout creation, an unpaid checkout not being
treated as paid, and one successful test payment. Verified only with
simulated provider answers in a rolled-back transaction: failure, mismatch,
expiry and late success. A real failed or cancelled Chapa checkout was not
produced.

## Not verified

- The pay and check buttons in the app. The screen is type-checked only; the
  test payment was started by the script and paid on Chapa's page.
- Chapa calling the callback URL. Chapa cannot reach a local machine, so the
  callback path was exercised by local requests only.
- The function inside the Supabase Edge runtime. It ran under Deno 2.9.6
  directly. The local runtime container still serves an older directory.
- The return URL after payment (`CHAPA_ORDER_RETURN_URL` is not set).

## Run it again

1. Create an env file outside the repository with `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (local stack values from
   `.env.backend`) and `CHAPA_SECRET_KEY` (test key from
   `supabase/functions/.env`).
2. `npx -y deno run --allow-net --allow-env --no-lock --env-file=<file> supabase/functions/chapa-order-payment/index.ts`
   (listens on port 8000).
3. `node scripts/hackathon/verify-order-payment.mjs`, pay the printed
   checkout in a browser, then run it again with `--confirm`.
4. For the app, set `EXPO_PUBLIC_CHAPA_ORDER_PAYMENT_URL=http://127.0.0.1:8000`
   in the ignored `.env`. Without it the app calls the deployed function name
   `chapa-order-payment`.

Optional backend names: `CHAPA_ORDER_CALLBACK_URL`, `CHAPA_ORDER_RETURN_URL`.
