// Phase 7 verification of the coffee-order payment function, through HTTP,
// with normal buyer and seller sessions, against the LOCAL Supabase test stack
// and the real Chapa TEST API (test secret key, no real money).
//
// 1. Serve the function from this checkout (see docs/ORDER_PAYMENTS.md):
//      npx -y deno run --allow-net --allow-env --no-lock --env-file=<env file> supabase/functions/chapa-order-payment/index.ts
// 2. Run:
//      node scripts/hackathon/verify-order-payment.mjs            checks up to an open, unpaid checkout
//      node scripts/hackathon/verify-order-payment.mjs --confirm  after paying the printed checkout in a browser
//
// This script never marks anything as paid by itself. A payment becomes
// "paid_test" only if Chapa's verify endpoint reports success for the stored
// reference, amount and currency.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { localStack, api, rpc, ensureUser, ensureStation, root } from './lib.mjs';

const stack = localStack();
const FN = process.env.BUNALENS_ORDER_PAYMENT_URL || 'http://127.0.0.1:8000';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+(?:\/[^?#]*)?$/.test(FN)) throw new Error('Use a local order-payment endpoint.');
const statePath = path.join(root, '.order-payment-check.json'); // ignored by Git; holds ids only
const run = crypto.randomBytes(4).toString('hex');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
};
const call = async (user, body, method = 'POST', query = '') => {
  const response = await fetch(FN + query, {
    method, headers: { 'Content-Type': 'application/json', apikey: stack.anon, ...(user ? { Authorization: 'Bearer ' + user.token } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

const sellerA = await ensureUser(stack, 'demo-seller@bunalens.test', 'BUNALENS_DEMO_SELLER_PASSWORD');
const sellerB = await ensureUser(stack, 'demo-seller-b@bunalens.test', 'BUNALENS_DEMO_SELLER_B_PASSWORD');
const sellerStation = await ensureStation(stack, sellerA, 'DEMO Gomma Washing Station', 'Gomma');
const buyer = await ensureUser(stack, 'demo-buyer@bunalens.test', 'BUNALENS_DEMO_BUYER_PASSWORD');
const buyerB = await ensureUser(stack, 'demo-buyer-b@bunalens.test', 'BUNALENS_DEMO_BUYER_B_PASSWORD');
const orderRow = async (id) => (await api(stack, 'GET', '/rest/v1/coffee_orders?select=status,payment_status,total_etb,quantity_kg&id=eq.' + id, { token: buyer.token })).json[0];
const payments = async (user, id) => (await api(stack, 'GET', '/rest/v1/coffee_order_payments?select=chapa_tx_ref,amount_etb,currency,status,is_test,verified_at,late_success&order_id=eq.' + id + '&order=created_at.asc', { token: user.token })).json;

if (process.argv.includes('--confirm')) {
  // ---- After the checkout was paid in a browser ---------------------------------
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const first = await call(buyer, { action: 'verify', orderId: state.orderId });
  console.log('Chapa verify answer: provider_status=' + first.json?.provider_status + ', result=' + first.json?.result);
  check('Chapa reports success and the payment is verified', first.status === 200 && ['verified', 'already_verified'].includes(first.json?.result), 'HTTP ' + first.status);
  const row = await orderRow(state.orderId);
  check('order payment status is paid_test; order status is still accepted', row.payment_status === 'paid_test' && row.status === 'accepted');
  const again = await call(buyer, { action: 'verify', orderId: state.orderId });
  const callback = await call(null, null, 'GET', '?trx_ref=' + state.txRef + '&status=success');
  check('repeating the verification and the callback changes nothing', again.json?.result === 'already_verified' && callback.json?.result === 'already_verified');
  const rows = await payments(sellerA, state.orderId);
  check('one verified TEST payment for the stored total, readable by the seller', rows.length === 1 && rows[0].status === 'verified' && rows[0].is_test === true && Number(rows[0].amount_etb) === Number(row.total_etb) && rows[0].currency === 'ETB' && Boolean(rows[0].verified_at) && rows[0].late_success === false);
  check('a paid order cannot start another payment', (await call(buyer, { action: 'initialize', orderId: state.orderId, idempotencyKey: 'pay-again-' + run })).status === 400);
  check('a paid order cannot be cancelled', (await rpc(stack, 'bunalens_cancel_order', { p_order_id: state.orderId, p_note: null }, { token: buyer.token })).status === 400);
} else {
  // ---- Up to an open checkout -----------------------------------------------------
  const listing = (await api(stack, 'GET', '/rest/v1/marketplace_listings?select=id,batch_code,available_kg,price_per_kg_etb&status=eq.published&coffee_stage=eq.green_bean&origin_woreda=eq.Gomma&station_id=eq.' + encodeURIComponent(sellerStation) + '&order=price_per_kg_etb.asc&limit=1')).json?.[0];
  if (!listing) throw new Error('Run scripts/hackathon/verify-marketplace.mjs first: no published certified fixture for the local seller.');
  const submit = (kg, key) => rpc(stack, 'bunalens_submit_order', { p_listing_id: listing.id, p_quantity_kg: kg, p_idempotency_key: key, p_buyer_name: 'DEMO buyer (not a real person)', p_buyer_phone: null }, { token: buyer.token });
  const order = (await submit(2, 'pay-order-' + run)).json.order;
  const init = (user, key = 'pay-key-' + run) => call(user, { action: 'initialize', orderId: order.id, idempotencyKey: key });

  check('signed-out caller cannot start a payment', (await init(null)).status === 401);
  const early = await init(buyer);
  check('an order the seller has not accepted cannot be paid', early.status === 400, early.json?.error);
  await rpc(stack, 'bunalens_decide_order', { p_order_id: order.id, p_action: 'accept', p_note: null }, { token: sellerA.token });
  const stockAfterAccept = Number((await api(stack, 'GET', '/rest/v1/marketplace_listings?select=available_kg&id=eq.' + listing.id)).json[0].available_kg);
  check('another buyer cannot start a payment for this order', (await init(buyerB)).status === 403);
  check('the seller cannot start a payment for the buyer', (await init(sellerA)).status === 403);

  const started = await call(buyer, { action: 'initialize', orderId: order.id, idempotencyKey: 'pay-key-' + run, amount: 1, currency: 'USD' });
  // The request carries amount 1 and currency USD on purpose; the server must ignore both.
  check('Chapa TEST checkout opens for the stored order total in ETB, ignoring an amount and currency sent by the client', started.status === 200 && /^https:\/\/checkout\.chapa\.co\//.test(started.json?.checkout_url || '') && Number(started.json.amount_etb) === Number(order.total_etb) && started.json.currency === 'ETB' && started.json.test_mode === true, started.status === 200 ? order.total_etb + ' ETB, ref ' + started.json.tx_ref : JSON.stringify(started.json));
  if (started.status !== 200) { console.log('Stopping: Chapa did not open a checkout.'); process.exitCode = 1; }
  else {
    const retry = await init(buyer);
    check('a retry returns the same checkout and reference', retry.status === 200 && retry.json.tx_ref === started.json.tx_ref && retry.json.checkout_url === started.json.checkout_url && retry.json.reused === true);
    const rows = await payments(buyer, order.id);
    check('one pending TEST payment row is bound to the order', rows.length === 1 && rows[0].chapa_tx_ref === started.json.tx_ref && rows[0].status === 'pending' && rows[0].is_test === true && Number(rows[0].amount_etb) === Number(order.total_etb));
    check('order: accepted, payment pending', JSON.stringify(await orderRow(order.id)).includes('"status":"accepted","payment_status":"pending"'));
    check('an unrelated buyer cannot read the payment row', (await payments(buyerB, order.id)).length === 0);
    check('the public cannot read payment rows', ((await api(stack, 'GET', '/rest/v1/coffee_order_payments?select=id&limit=1')).json?.length ?? 0) === 0);

    const unpaid = await call(buyer, { action: 'verify', orderId: order.id });
    check('verifying before paying: Chapa does not report success, nothing is marked paid', unpaid.status === 202 && unpaid.json.result === 'pending' && (await orderRow(order.id)).payment_status === 'pending', 'provider_status=' + unpaid.json?.provider_status);
    const forged = await call(null, null, 'GET', '?trx_ref=' + started.json.tx_ref + '&status=success&ref_id=FORGED');
    check('a callback or redirect that claims success is not trusted', forged.status === 202 && forged.json.result === 'pending' && (await orderRow(order.id)).payment_status === 'pending');
    const forgedPost = await call(null, { trx_ref: started.json.tx_ref, status: 'success', amount: order.total_etb, currency: 'ETB' });
    check('a forged POST callback with matching amount is not trusted either', forgedPost.status === 202 && (await orderRow(order.id)).payment_status === 'pending');
    check('a callback for an unknown reference is refused', (await call(null, null, 'GET', '?trx_ref=BNLO-' + 'f'.repeat(32))).status === 404 && (await call(null, null, 'GET', '?trx_ref=BNL-not-an-order')).status === 400);
    check('an unrelated buyer cannot trigger verification of this order', (await call(buyerB, { action: 'verify', orderId: order.id })).status === 403);
    check('another seller cannot trigger verification of this order', (await call(sellerB, { action: 'verify', orderId: order.id })).status === 403);
    check('the order seller may ask for verification', (await call(sellerA, { action: 'verify', orderId: order.id })).status === 202);
    const cancel = await rpc(stack, 'bunalens_cancel_order', { p_order_id: order.id, p_note: null }, { token: buyer.token });
    const stockNow = Number((await api(stack, 'GET', '/rest/v1/marketplace_listings?select=available_kg&id=eq.' + listing.id)).json[0].available_kg);
    check('with a checkout open the order cannot be cancelled and its stock stays reserved', cancel.status === 400 && stockNow === stockAfterAccept);

    fs.writeFileSync(statePath, JSON.stringify({ orderId: order.id, txRef: started.json.tx_ref, checkoutUrl: started.json.checkout_url }, null, 1));
    console.log('\nOpen TEST checkout (Chapa test mode, no real money):\n  ' + started.json.checkout_url);
    console.log('Order ' + order.id + ', lot ' + listing.batch_code + ', ' + order.quantity_kg + ' kg, ' + order.total_etb + ' ETB.');
    console.log('After paying it in a browser, run this script again with --confirm.');
  }
}
console.log(failed === 0 ? 'All checks passed.' : failed + ' check(s) failed.');
process.exitCode = failed === 0 ? (process.exitCode || 0) : 1;
