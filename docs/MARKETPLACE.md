# Marketplace and orders (Phase 6)

Recorded 2026-11-21. Sprint additions. Applied to the local test database
only; pending on hosted.

## Existing functionality reused

The imported app had no marketplace or order screens. Reused: the sign-in
flow and route guard, station ownership, the `admin` and `reviewer` roles,
and the Phase 2 tables `marketplace_listings` and `coffee_orders` with their
row-level security. Clients still cannot write either table.

## Routes

| Route | File | Who | Status |
|---|---|---|---|
| `/marketplace` (new "Market" tab) | `app/(tabs)/marketplace.tsx` | Any signed-in account | Browse published listings; origin, stage and price filters run on the server |
| `/market/[id]` | `app/market/[id].tsx` | Any signed-in account | Details, evidence provenance, quantity, order |
| `/market/orders` | `app/market/orders.tsx` | Buyer and seller | Orders placed; incoming orders with accept, reject, record handover, cancel |
| Lot screen, "Marketplace listing" card | `components/LotListingCard.tsx` in `app/batch/[id].tsx` | Station owner | Save draft, publish, pause, withdraw |

All four are type-checked and bundled (`npm run typecheck`,
`npx expo export --platform web`). None was opened in a browser. The buyer
and seller journeys were verified through the HTTP API only.

The app's route guard still requires sign-in for every screen, so browsing
inside the app needs an account. The listing read itself is public: a
signed-out API request returns published listings only.

## Server functions

| Function | Caller | Checks |
|---|---|---|
| `bunalens_save_listing(lot, kg, price, status)` | Station owner of the lot | Ownership; kg above 0 and, with kg already accepted or fulfilled, within the lot weight; price above 0; publish only if the lot is eligible, the seller is approved, stock exists, and the Phase 5 re-check passes. Name, origin, stage, screening summary and evidence come from the lot record, not the request |
| `bunalens_submit_order(listing, kg, key, name, phone)` | Signed-in buyer | Listing is published; kg above 0, at most two decimals, within stock; buyer is not the seller; price and listing details copied to the order |
| `bunalens_decide_order(order, accept or reject)` | Station owner of the order | Order is submitted; on accept the listing is published and has the stock |
| `bunalens_cancel_order(order)` | The buyer or the seller of that order | Order is submitted or accepted and not paid or in payment |
| `bunalens_fulfill_order(order)` | Station owner of the order | Order is accepted |

## What a public listing contains

Lot id and lot code, seller display name, origin woreda, coffee stage,
available kilograms, ETB price per kilogram, screening summary and date,
demo flag, status, and `evidence_summary`: policy id and whether it is a demo
policy, eligibility decision and whether a rule or a reviewer made it,
override flag, simulated-evidence flag, official grade ("Unclassified"), and
per input the value, unit, method, source, time and verification status.

Not included: farmer name and phone, device data, reviewer identity, review
reasons, evidence notes, photo paths, seller approval notes. Seller approval
is implied by a listing being published; the note and approver stay private.

## Order states

`coffee_orders.status`: `submitted` → `accepted` → `fulfilled`, or
`declined` (shown as "Rejected by seller"), or `cancelled`.
`coffee_orders.payment_status` is separate: `unpaid`, `pending`, `paid_test`,
`paid`, `failed`. Phase 6 never changes it. Every order made so far is
`unpaid`. The screens show both, for example "Order accepted, not paid".

Handover can be recorded on an accepted order whatever its payment status;
the payment status stays visible next to it. Tying handover to payment is a
Phase 7 decision.

## Stock behaviour

| Event | Stock |
|---|---|
| Order submitted | Not held. Two buyers can both submit for the same kilograms |
| Order accepted | `available_kg` decremented in the same transaction, under a row lock on the listing. At 0 kg the listing becomes `sold_out` and leaves the public read |
| Acceptance without enough stock | Refused with the kilograms left; the order stays submitted |
| Order rejected | No change |
| Submitted order cancelled | No change |
| Accepted, unpaid order cancelled | Kilograms return to the listing. A sold-out listing returns as `paused`; the seller publishes it again |
| Paid, payment-pending or fulfilled order | Cannot be cancelled here. Refunds are not implemented |

The agreed price is copied to the order at submission. A later price change
on the listing does not change it (checked).

Retries: the same buyer key returns the same order; accepting, cancelling or
fulfilling twice is a no-op.

## Demo listings (local test stack, all DEMO, simulated evidence)

| Lot | Seller | Origin | Stage | Kilograms | ETB per kg |
|---|---|---|---|---|---|
| BNL-JMA-0688 | DEMO Gomma Washing Station | Gomma | Green beans | 500 | 450 |
| BNL-JMA-B7E4 | DEMO Mana Washing Station | Mana | Green beans | 400 | 520 |
| BNL-JMA-6D1D | DEMO Gomma Washing Station | Gomma | Red cherries | 800 | 38 |

The two green-bean listings are the comparison pair. Lot BNL-JMA-0688 is a
600 kg lot; 100 kg went to a fulfilled, unpaid demo order in the first run.
Demo buyers: `demo-buyer@bunalens.test`, `demo-buyer-b@bunalens.test`
(passwords in the ignored `.env.backend`).

## Checks

```
node scripts/hackathon/verify-eligibility.mjs
node scripts/hackathon/verify-marketplace.mjs
```

Run them in this order. The eligibility script rewrites the BNL-JMA-0688
listing with the local service role; the marketplace script puts it back to
500 kg. The marketplace script itself uses normal user sessions only.

Result on 2026-11-21: all checks passed. 58 of 58 on the first run; 59 of 59 on three further runs, after one check was added and the order checks were moved to a lot created per run.

- Journey: buyer submits → the correct seller sees the order → seller accepts
  → buyer reads "accepted" → stock is decremented.
- Unauthorized: another seller cannot list the lot, see, accept or reject the
  order; a buyer cannot accept or fulfil; another buyer cannot see or cancel;
  a direct table update by the buyer is refused; signed-out callers cannot
  order or read orders.
- Invalid input: zero, negative, three-decimal and above-stock quantities; a
  missing name; an own-station order; an unpublished or unknown listing; more
  kilograms than the lot holds; a zero or negative price.
- Public response: only the buyer fields, checked by key list and by a text
  scan.
- Concurrency, exercised against the database: six 100 kg orders on a 300 kg
  listing accepted by six parallel HTTP requests. Each run: exactly three
  accepted, three refused, 300 kg accepted, 0 kg left, listing sold out. Four
  parallel submissions with one key created one order.

## Not done or not verified

- No screen was opened in a browser.
- No payment. Chapa for orders is Phase 7.
- No notification to the seller; the seller opens the orders screen.
- No screens for recording readings or reviewer and administrator actions.
- The buyer cannot browse inside the app without signing in.
- New text is English only.
