// Phase 6 verification against the LOCAL Supabase test stack, through the HTTP
// API, with normal sessions for two sellers and two buyers.
//
//   node scripts/hackathon/verify-marketplace.mjs
//
// Run scripts/hackathon/verify-eligibility.mjs first (it creates the demo
// reviewer and administrator and the demo pass lot).
//
// It leaves three published DEMO listings for comparison:
//   demo-case-pass      green beans, Gomma, DEMO Gomma Washing Station
//   demo-listing-cherry red cherries, Gomma, DEMO Gomma Washing Station
//   demo-listing-mana   green beans, Mana,  DEMO Mana Washing Station
// All readings are SIMULATED and all screenings are DEMO FIXTURES.
// No privileged (service role) call is made in this script.
import crypto from 'node:crypto';
import { localStack, api, rpc, ensureUser, ensureStation } from './lib.mjs';
import { buildScreening } from '../../supabase/functions/_shared/screening.ts';

const stack = localStack();
const run = crypto.randomBytes(4).toString('hex');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
};

const sellerA = await ensureUser(stack, 'demo-seller@bunalens.test', 'BUNALENS_DEMO_SELLER_PASSWORD');
const sellerB = await ensureUser(stack, 'demo-seller-b@bunalens.test', 'BUNALENS_DEMO_SELLER_B_PASSWORD');
const stationA = await ensureStation(stack, sellerA, 'DEMO Gomma Washing Station', 'Gomma');
const stationB = await ensureStation(stack, sellerB, 'DEMO Mana Washing Station', 'Mana');
const admin = await ensureUser(stack, 'demo-admin@bunalens.test', 'BUNALENS_DEMO_ADMIN_PASSWORD');
const buyer = await ensureUser(stack, 'demo-buyer@bunalens.test', 'BUNALENS_DEMO_BUYER_PASSWORD');
const buyerB = await ensureUser(stack, 'demo-buyer-b@bunalens.test', 'BUNALENS_DEMO_BUYER_B_PASSWORD');

const CLEAN = { sound_or_ripe_pct: 96, unripe_green_pct: 1, black_overfermented_pct: 1, insect_broken_pct: 1, foreign_matter_pct: 1 };
// Registers a lot, seeds synthetic local evidence and gets administrator certification.
const eligibleLot = async (seller, key, stage, woreda, kg, moisture = 11.0) => {
  const lot = (await rpc(stack, 'bunalens_register_lot', { p_idempotency_key: key, p_sample_type: stage, p_woreda: woreda, p_lot_weight_kg: kg, p_farmer_name: 'DEMO farmer (not a real person)' }, { token: seller.token })).json.lot;
  const result = { is_coffee_sample: true, ecx_grade: 'Unclassified', quality_score: 96, confidence_score: 95, breakdown: CLEAN, estimated_price_per_feresula_etb: 0, potential_gain_if_sorted_etb: 0, export_readiness: 'Commercial Export', sorting_action_advice: 'Demonstration only.', assessment_limitations: ['Simulated demonstration data; no photograph was analyzed.'], assessment_method: 'ai_visual_estimate' };
  if (!stack.service) throw new Error('Set the service role for the local test stack.');
  const photo = lot.station_id + '/server-captures/fixture-' + crypto.randomUUID() + '.png';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const stored = await fetch(stack.url + '/storage/v1/object/coffee-samples/' + photo, {
    method: 'POST', headers: { apikey: stack.service, Authorization: 'Bearer ' + stack.service, 'Content-Type': 'image/png' }, body: png,
  });
  if (!stored.ok) throw new Error('Could not upload local certification test photo (' + stored.status + ').');
  // Synthetic live-shaped evidence for the local certification transaction. No AI call or real photograph.
  const assessment = { ...result, screening: buildScreening(result, stage, { source: 'live_inference', provider: 'local-test-fixture', model: 'none', assessedAt: new Date().toISOString() }) };
  const seeded = await api(stack, 'PATCH', '/rest/v1/coffee_batches?id=eq.' + encodeURIComponent(lot.id), {
    key: stack.service, token: stack.service, body: {
      grading_result: assessment, image_path: photo, grading_status: 'completed', is_demo: false, ecx_grade: 'Unclassified',
      certification_status: 'pending_admin_review', certified_grade: null, quality_classification: null,
      certification_origin_zone: null, certified_by: null, certified_at: null, certification_note: null,
    },
  });
  if (seeded.status !== 204) throw new Error('Could not seed the local certification fixture (' + seeded.status + ').');
  const reading = (kind, value, unit, method) => rpc(stack, 'bunalens_record_lot_evidence', { p_batch_id: lot.id, p_kind: kind, p_value: value, p_unit: unit, p_method: method, p_source: 'simulated', p_recorded_at: new Date().toISOString(), p_note: 'SIMULATED reading for the demo; no instrument was used.' }, { token: seller.token });
  if (stage === 'green_bean') {
    await reading('defect_pct', 3.5, '% by weight', 'hand_sort_weighed_sample');
    await reading('bean_moisture_pct', moisture, '%', 'moisture_meter');
    await reading('screen_size', 15, 'screen (1/64 inch)', 'screen_sieve_set');
  } else {
    await reading('defect_pct', 4, '% by count', 'hand_count_sample');
  }
  const evaluated = await rpc(stack, 'bunalens_evaluate_lot_eligibility', { p_batch_id: lot.id }, { token: seller.token });
  const certification = await rpc(stack, 'bunalens_admin_certify_reviewed_scan', {
    p_batch_id: lot.id, p_image_path: photo, p_decision: 'eligible', p_reason: 'Private local certification fixture audit note.',
    p_price_per_kg_etb: null, p_certified_grade: 'Grade 2', p_quality_classification: 'Local Market Only',
  }, { token: admin.token });
  if (certification.status !== 200) throw new Error('Local administrator could not certify the fixture: ' + certification.json?.message);
  return { ...lot, eligibility: evaluated.json?.eligibility_status };
};
const save = (seller, lotId, kg, price, status) => rpc(stack, 'bunalens_save_listing', { p_batch_id: lotId, p_available_kg: kg, p_price_per_kg_etb: price, p_status: status }, { token: seller.token });
const order = (user, listingId, kg, key, name = 'DEMO buyer (not a real person)') => rpc(stack, 'bunalens_submit_order', { p_listing_id: listingId, p_quantity_kg: kg, p_idempotency_key: key, p_buyer_name: name, p_buyer_phone: null }, user ? { token: user.token } : {});
const decide = (user, orderId, action) => rpc(stack, 'bunalens_decide_order', { p_order_id: orderId, p_action: action, p_note: null }, { token: user.token });
const cancel = (user, orderId) => rpc(stack, 'bunalens_cancel_order', { p_order_id: orderId, p_note: null }, { token: user.token });
const browse = async (query = '') => (await api(stack, 'GET', '/rest/v1/marketplace_listings?select=*' + query)).json; // signed out
const listingRow = async (id) => (await browse('&id=eq.' + id))[0];

// Kilograms of a lot not already taken by accepted or fulfilled orders (read with the seller's own session).
const freeKg = async (seller, lotId, weight) => weight - (await api(stack, 'GET', '/rest/v1/coffee_orders?select=quantity_kg&batch_id=eq.' + lotId + '&status=in.(accepted,fulfilled)', { token: seller.token })).json.reduce((sum, r) => sum + Number(r.quantity_kg), 0);

// ---- Seller approval and listings --------------------------------------------
for (const station of [stationA, stationB]) {
  await rpc(stack, 'bunalens_set_seller_status', { p_station_id: station, p_status: 'approved', p_note: 'DEMO approval for the sprint walkthrough.' }, { token: admin.token });
}
const lotA = await eligibleLot(sellerA, 'demo-case-pass', 'green_bean', 'Gomma', 600, 11.4);
const lotCherry = await eligibleLot(sellerA, 'demo-listing-cherry', 'red_cherry', 'Gomma', 800);
const lotMana = await eligibleLot(sellerB, 'demo-listing-mana', 'green_bean', 'Mana', 400);
const failLot = (await rpc(stack, 'bunalens_register_lot', { p_idempotency_key: 'demo-case-fail', p_sample_type: 'green_bean', p_woreda: 'Gomma', p_lot_weight_kg: 600, p_farmer_name: 'DEMO farmer (not a real person)' }, { token: sellerA.token })).json.lot;
check('three demo lots are eligible', [lotA, lotCherry, lotMana].every((l) => l.eligibility === 'eligible'), [lotA, lotCherry, lotMana].map((l) => l.batch_code + ' ' + l.eligibility).join(', '));

check('another seller cannot list this lot', (await save(sellerB, lotA.id, 100, 450, 'draft')).status === 403);
check('a buyer without a station cannot list a lot', (await save(buyer, lotA.id, 100, 450, 'draft')).status === 403);
const failPublish = await save(sellerA, failLot.id, 100, 450, 'published');
check('a failed lot cannot be published through the seller function', failPublish.status === 403 && failPublish.json?.message?.includes('must be certified'), failPublish.json?.message);
check('more kilograms than the lot holds are refused', (await save(sellerA, lotA.id, 601, 450, 'draft')).status === 400);
check('a zero or negative price is refused', (await save(sellerA, lotA.id, 100, 0, 'draft')).status === 400 && (await save(sellerA, lotA.id, 100, -5, 'draft')).status === 400);
const draft = await save(sellerA, lotCherry.id, 800, 38, 'draft');
check('a saved draft is not public', draft.status === 200 && draft.json.status === 'draft' && !(await listingRow(draft.json.id)));
const pubCherry = await save(sellerA, lotCherry.id, 800, 38, 'published');
// The 600 kg demo lot already has accepted or fulfilled demo orders (one of them paid in Chapa test mode).
const kgA = await freeKg(sellerA, lotA.id, 600);
const pubA = await save(sellerA, lotA.id, kgA, 450, 'published');
const pubMana = await save(sellerB, lotMana.id, 400, 520, 'published');
check('sellers publish explicitly', [pubA, pubCherry, pubMana].every((r) => r.status === 200 && r.json.status === 'published'), [pubA, pubCherry, pubMana].map((r) => r.status).join(','));
const ids = [pubA.json.id, pubCherry.json.id, pubMana.json.id];

// ---- Public browse -----------------------------------------------------------
const row = await listingRow(pubA.json.id);
const allowed = ['id', 'batch_id', 'station_id', 'seller_display_name', 'origin_woreda', 'coffee_stage', 'available_kg', 'price_per_kg_etb', 'screening_summary', 'assessed_at', 'is_demo', 'status', 'published_at', 'created_at', 'updated_at', 'batch_code', 'evidence_summary'];
check('public listing has the buyer fields', row && row.batch_id === lotA.id && row.batch_code === lotA.batch_code && row.seller_display_name === 'DEMO Gomma Washing Station' && row.origin_woreda === 'Gomma' && row.coffee_stage === 'green_bean' && Number(row.available_kg) === kgA && Number(row.price_per_kg_etb) === 450 && row.screening_summary.includes('BunaLens administrator-certified') && Boolean(row.assessed_at) && row.is_demo === true);
check('public listing has no field outside the buyer set', Object.keys(row).every((k) => allowed.includes(k)), Object.keys(row).filter((k) => !allowed.includes(k)).join(','));
const text = JSON.stringify(row);
check('public listing carries no credential, contact, reviewer, note or photo path', !/"(?:[^"]*(?:token|password|phone|farmer)|reviewer_id|recorded_by|[^"]*note|image_path|capture_key|evidence_id|owner_id|approval_reason)"\s*:/i.test(text));
const ev = row.evidence_summary;
check('evidence provenance: policy, decision, source and method per input', ev.policy_id === 'demo-policy-2026-11-21' && ev.policy_is_demo === true && ev.eligibility_status === 'eligible' && ev.decided_by === 'reviewer' && ev.uses_simulated_evidence === true && ev.official_grade === 'Grade 2' && ev.inputs.length === 4 && ev.inputs.every((i) => i.source === 'simulated' && i.method) && ev.screening.source === 'live_inference');
const inRun = (rows) => rows.filter((r) => ids.includes(r.id)).map((r) => r.id);
check('filter by origin', JSON.stringify(inRun(await browse('&origin_woreda=eq.Mana'))) === JSON.stringify([pubMana.json.id]));
check('filter by stage', JSON.stringify(inRun(await browse('&coffee_stage=eq.red_cherry'))) === JSON.stringify([pubCherry.json.id]));
check('filter by price range', inRun(await browse('&price_per_kg_etb=gte.400&price_per_kg_etb=lte.480')).join() === pubA.json.id && inRun(await browse('&price_per_kg_etb=lte.600')).length === 3);
check('two green-bean listings can be compared', inRun(await browse('&coffee_stage=eq.green_bean')).length === 2);
check('the public cannot read orders', ((await api(stack, 'GET', '/rest/v1/coffee_orders?select=id&limit=1')).json?.length ?? 0) === 0);

// ---- Orders: validation --------------------------------------------------------
// Orders are exercised on a lot made for this run, so the three demo listings stay unchanged.
const orderLot = await eligibleLot(sellerA, 'p6-orders-' + run, 'green_bean', 'Gomma', 600);
const L = (await save(sellerA, orderLot.id, 600, 450, 'published')).json.id;
check('signed-out order is refused', [401, 403, 404].includes((await order(null, L, 10, 'p6-anon-' + run)).status));
check('zero quantity is refused', (await order(buyer, L, 0, 'p6-zero-' + run)).status === 400);
check('negative quantity is refused', (await order(buyer, L, -5, 'p6-neg-' + run)).status === 400);
check('quantity above stock is refused', (await order(buyer, L, 600.01, 'p6-over-' + run)).status === 400);
check('quantity with three decimals is refused', (await order(buyer, L, 1.234, 'p6-dec-' + run)).status === 400);
check('missing buyer name is refused', (await order(buyer, L, 10, 'p6-name-' + run, ' ')).status === 400);
check('a seller cannot order from its own station', (await order(sellerA, L, 10, 'p6-self-' + run)).status === 403);
check('an order on a draft or unknown listing is refused', (await order(buyer, crypto.randomUUID(), 10, 'p6-none-' + run)).status === 403);

// ---- Orders: buyer submits, correct seller sees, seller accepts -----------------
const key = 'p6-order-' + run;
const placed = await order(buyer, L, 120.5, key);
const o = placed.json?.order;
check('order submitted with server-calculated total', placed.status === 200 && placed.json.already_submitted === false && o.status === 'submitted' && o.payment_status === 'unpaid' && Number(o.price_per_kg_etb) === 450 && Number(o.total_etb) === 54225, 'total ' + o?.total_etb + ' ETB');
check('order snapshots the listing details and price', o.listing_snapshot.seller_display_name === 'DEMO Gomma Washing Station' && o.listing_snapshot.batch_code === orderLot.batch_code && Number(o.listing_snapshot.price_per_kg_etb) === 450 && o.batch_id === orderLot.id);
const retry = await order(buyer, L, 120.5, key);
check('retry with the same key returns the same order', retry.json?.already_submitted === true && retry.json.order.id === o.id);
check('the same key with a different quantity is refused', (await order(buyer, L, 50, key)).status === 400);
check('submitting does not hold stock', Number((await listingRow(L)).available_kg) === 600);
const mine = (user) => api(stack, 'GET', '/rest/v1/coffee_orders?select=id,status,payment_status,total_etb,buyer_name&id=eq.' + o.id, { token: user.token });
check('buyer sees its own order', (await mine(buyer)).json.length === 1);
check('another buyer does not see it', (await mine(buyerB)).json.length === 0);
check('the correct seller sees it', (await mine(sellerA)).json.length === 1);
check('another seller does not see it', (await mine(sellerB)).json.length === 0);
check('buyer cannot change the order by a direct table update', (await api(stack, 'PATCH', '/rest/v1/coffee_orders?id=eq.' + o.id, { token: buyer.token, body: { status: 'accepted', price_per_kg_etb: 1 } })).status >= 400);
check('buyer cannot accept its own order', (await decide(buyer, o.id, 'accept')).status === 403);
check('another seller cannot accept or reject it', (await decide(sellerB, o.id, 'accept')).status === 403 && (await decide(sellerB, o.id, 'reject')).status === 403);
check('another buyer cannot cancel it', (await cancel(buyerB, o.id)).status === 403);
await save(sellerA, orderLot.id, 600, 480, 'published'); // price change after the order
const accepted = await decide(sellerA, o.id, 'accept');
check('seller accepts; payment stays unpaid; agreed price is unchanged', accepted.status === 200 && accepted.json.order.status === 'accepted' && accepted.json.order.payment_status === 'unpaid' && Number(accepted.json.order.price_per_kg_etb) === 450 && Number(accepted.json.order.total_etb) === 54225 && Boolean(accepted.json.order.decided_at));
check('acceptance decrements stock', Number((await listingRow(L)).available_kg) === 479.5);
check('accepting again is a no-op', (await decide(sellerA, o.id, 'accept')).json?.already_decided === true && Number((await listingRow(L)).available_kg) === 479.5);
check('an accepted order cannot be rejected', (await decide(sellerA, o.id, 'reject')).status === 400);
check('buyer reads the accepted status', (await mine(buyer)).json[0].status === 'accepted');
check('seller cannot relist more than the lot holds after acceptance', (await save(sellerA, orderLot.id, 600, 450, 'published')).status === 400);

// ---- Reject, cancel, stock release, fulfil --------------------------------------
const second = (await order(buyerB, L, 50, 'p6-second-' + run)).json.order;
check('seller rejects an order; stock is untouched', (await decide(sellerA, second.id, 'reject')).json?.order?.status === 'declined' && Number((await listingRow(L)).available_kg) === 479.5);
const third = (await order(buyerB, L, 30, 'p6-third-' + run)).json.order;
check('buyer cancels a submitted order', (await cancel(buyerB, third.id)).json?.order?.status === 'cancelled');
const cancelled = await cancel(buyer, o.id);
check('cancelling an accepted, unpaid order releases its stock', cancelled.status === 200 && cancelled.json.stock_released === true && Boolean(cancelled.json.order.stock_released_at) && Number((await listingRow(L)).available_kg) === 600);
check('cancelling again is a no-op', (await cancel(buyer, o.id)).json?.already_cancelled === true && Number((await listingRow(L)).available_kg) === 600);
const fourth = (await order(buyer, L, 100, 'p6-fourth-' + run)).json.order;
check('only an accepted order can be fulfilled', (await rpc(stack, 'bunalens_fulfill_order', { p_order_id: fourth.id, p_note: null }, { token: sellerA.token })).status === 400);
await decide(sellerA, fourth.id, 'accept');
check('the buyer cannot record fulfilment', (await rpc(stack, 'bunalens_fulfill_order', { p_order_id: fourth.id, p_note: null }, { token: buyer.token })).status === 403);
const fulfilled = await rpc(stack, 'bunalens_fulfill_order', { p_order_id: fourth.id, p_note: 'DEMO handover recorded by the verification run.' }, { token: sellerA.token });
check('seller records fulfilment; payment status is still unpaid', fulfilled.json?.order?.status === 'fulfilled' && Boolean(fulfilled.json.order.fulfilled_at) && fulfilled.json.order.payment_status === 'unpaid');
check('a fulfilled order cannot be cancelled', (await cancel(buyer, fourth.id)).status === 400);

// ---- Concurrency: six 100 kg orders accepted at once against 300 kg -------------
const raceLot = await eligibleLot(sellerA, 'p6-race-' + run, 'green_bean', 'Gomma', 300);
const raceListing = (await save(sellerA, raceLot.id, 300, 400, 'published')).json;
const raceOrders = [];
for (let i = 0; i < 6; i += 1) raceOrders.push((await order(i % 2 ? buyer : buyerB, raceListing.id, 100, 'p6-race-' + run + '-' + i)).json.order);
const results = await Promise.all(raceOrders.map((item) => decide(sellerA, item.id, 'accept'))); // sent in parallel
const won = results.filter((r) => r.status === 200).length;
const afterRace = (await api(stack, 'GET', '/rest/v1/marketplace_listings?select=available_kg,status&id=eq.' + raceListing.id, { token: sellerA.token })).json[0];
const acceptedKg = (await api(stack, 'GET', '/rest/v1/coffee_orders?select=quantity_kg&status=eq.accepted&listing_id=eq.' + raceListing.id, { token: sellerA.token })).json.reduce((sum, r) => sum + Number(r.quantity_kg), 0);
check('parallel acceptances: exactly three of six succeed', won === 3 && results.filter((r) => r.status === 400).length === 3, results.map((r) => r.status).join(','));
check('accepted kilograms equal the stock and never exceed it', acceptedKg === 300 && Number(afterRace.available_kg) === 0 && afterRace.status === 'sold_out', acceptedKg + ' kg accepted, ' + afterRace.available_kg + ' kg left, ' + afterRace.status);
check('a sold-out listing is no longer public and takes no orders', !(await listingRow(raceListing.id)) && (await order(buyer, raceListing.id, 10, 'p6-late-' + run)).status === 403);
const winner = raceOrders.find((item, i) => results[i].status === 200);
await cancel(sellerA, winner.id);
const released = (await api(stack, 'GET', '/rest/v1/marketplace_listings?select=available_kg,status&id=eq.' + raceListing.id, { token: sellerA.token })).json[0];
check('seller cancels one accepted order: 100 kg return and the listing waits, paused, for the seller', Number(released.available_kg) === 100 && released.status === 'paused');
// Parallel retries of one submission must create one order.
const twins = await Promise.all([0, 1, 2, 3].map(() => order(buyer, pubMana.json.id, 25, 'p6-twin-' + run)));
const twinIds = new Set(twins.map((r) => r.json?.order?.id));
check('four parallel submissions with one key create one order', twins.every((r) => r.status === 200) && twinIds.size === 1 && twins.filter((r) => r.json.already_submitted === false).length === 1);
await cancel(buyer, [...twinIds][0]);

// ---- Take the run's own listings off the marketplace ------------------------------
const withdrawnA = await save(sellerA, orderLot.id, 500, 450, 'withdrawn');
const withdrawnB = await save(sellerA, raceLot.id, 100, 400, 'withdrawn');
check('seller withdraws the run listings', withdrawnA.json?.status === 'withdrawn' && withdrawnB.json?.status === 'withdrawn' && !(await listingRow(L)));
const final = await browse('&id=in.(' + ids.join(',') + ')&order=price_per_kg_etb.asc');
console.log('\nPublished demo listings:');
for (const item of final) console.log('  ' + item.batch_code + '  ' + item.seller_display_name + '  ' + item.origin_woreda + '  ' + item.coffee_stage + '  ' + item.available_kg + ' kg  ' + item.price_per_kg_etb + ' ETB/kg');
check('three demo listings are published for comparison', final.length === 3);
console.log(failed === 0 ? 'All checks passed.' : failed + ' check(s) failed.');
process.exitCode = failed === 0 ? 0 : 1;
