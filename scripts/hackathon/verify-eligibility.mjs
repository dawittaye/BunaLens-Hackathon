// Phase 5 verification against the LOCAL Supabase test stack, through the HTTP
// API, with normal user sessions for sellers, a reviewer and an administrator.
//
//   node scripts/hackathon/verify-eligibility.mjs
//
// It creates (or reuses) three durable demo lots under the demo seller:
//   demo-case-pass, demo-case-fail, demo-case-review
// All measurements recorded here are SIMULATED and stored with source
// "simulated". Photo screenings are DEMO FIXTURES (no photo analysed).
//
// Privileged steps, each marked below, use the local service role:
//   * giving the reviewer and administrator test accounts their role
//     (app_metadata, which a user cannot edit);
//   * writing marketplace_listings rows, standing in for the Phase 6 server
//     code, to prove the database refuses publication that breaks the rules.
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
const service = { key: stack.service, token: stack.service };

// ---- accounts ---------------------------------------------------------------
const sellerA = await ensureUser(stack, 'demo-seller@bunalens.test', 'BUNALENS_DEMO_SELLER_PASSWORD');
const sellerB = await ensureUser(stack, 'demo-seller-b@bunalens.test', 'BUNALENS_DEMO_SELLER_B_PASSWORD');
const stationA = await ensureStation(stack, sellerA, 'DEMO Gomma Washing Station', 'Gomma');
await ensureStation(stack, sellerB, 'DEMO Mana Washing Station', 'Mana');
const withRole = async (email, passwordKey, role) => {
  const user = await ensureUser(stack, email, passwordKey);
  // PRIVILEGED (local service role): set the role in app_metadata.
  const set = await api(stack, 'PUT', '/auth/v1/admin/users/' + user.id, { ...service, body: { app_metadata: { role } } });
  if (set.status !== 200) throw new Error('Could not set role for ' + email + ': HTTP ' + set.status);
  return ensureUser(stack, email, passwordKey); // sign in again so the token carries the role
};
const reviewer = await withRole('demo-reviewer@bunalens.test', 'BUNALENS_DEMO_REVIEWER_PASSWORD', 'reviewer');
const admin = await withRole('demo-admin@bunalens.test', 'BUNALENS_DEMO_ADMIN_PASSWORD', 'admin');

// ---- helpers ----------------------------------------------------------------
const lot = async (key, stage) => (await rpc(stack, 'bunalens_register_lot', {
  p_idempotency_key: key, p_sample_type: stage, p_woreda: 'Gomma', p_lot_weight_kg: 600, p_farmer_name: 'DEMO farmer (not a real person)',
}, { token: sellerA.token })).json.lot;
const screening = async (lotId, stage, breakdown) => {
  const result = {
    is_coffee_sample: true, ecx_grade: 'Unclassified', quality_score: breakdown.sound_or_ripe_pct, confidence_score: 95, breakdown,
    estimated_price_per_feresula_etb: 0, potential_gain_if_sorted_etb: 0, export_readiness: 'Commercial Export',
    sorting_action_advice: 'Demonstration only.', assessment_limitations: ['Simulated demonstration data; no photograph was analyzed.'],
    assessment_method: 'ai_visual_estimate',
  };
  const body = { ...result, screening: buildScreening(result, stage, { source: 'demo_fixture', provider: 'bunalens-demo-fixture', model: 'none', assessedAt: new Date().toISOString() }) };
  const saved = await rpc(stack, 'bunalens_attach_demo_assessment', { p_batch_id: lotId, p_capture_key: 'p5-' + run + '-' + crypto.randomBytes(3).toString('hex'), p_assessment: body, p_image_path: null }, { token: sellerA.token });
  if (saved.status !== 200) throw new Error('Could not attach demo screening: ' + saved.text);
};
const CLEAN = { sound_or_ripe_pct: 96, unripe_green_pct: 1, black_overfermented_pct: 1, insect_broken_pct: 1, foreign_matter_pct: 1 };
const METHODS = { defect_pct: 'hand_sort_weighed_sample', bean_moisture_pct: 'moisture_meter', screen_size: 'screen_sieve_set' };
const UNITS = { defect_pct: '% by weight', bean_moisture_pct: '%', screen_size: 'screen (1/64 inch)' };
const evidence = (user, lotId, kind, value, extra = {}) => rpc(stack, 'bunalens_record_lot_evidence', {
  p_batch_id: lotId, p_kind: kind, p_value: value, p_unit: UNITS[kind], p_method: METHODS[kind], p_source: 'simulated',
  p_recorded_at: new Date().toISOString(), p_note: 'SIMULATED reading for the demo; no instrument was used.', ...extra,
}, { token: user.token });
const evaluate = (user, lotId) => rpc(stack, 'bunalens_evaluate_lot_eligibility', { p_batch_id: lotId }, { token: user.token });
const review = (user, lotId, decision, reason, override = false) => rpc(stack, 'bunalens_review_lot', { p_batch_id: lotId, p_decision: decision, p_reason: reason, p_override: override }, { token: user.token });
const statusOf = (result, input) => result.json?.evaluation?.checks?.find((c) => c.input === input);
// PRIVILEGED (local service role): stands in for the Phase 6 server-side listing code.
const listing = (lotId, status) => api(stack, 'POST', '/rest/v1/marketplace_listings?on_conflict=batch_id', {
  ...service, headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: { batch_id: lotId, station_id: stationA, seller_display_name: 'DEMO Gomma Washing Station', origin_woreda: 'Gomma', coffee_stage: 'green_bean',
    available_kg: 600, price_per_kg_etb: 450, screening_summary: 'DEMO listing. Screening is a demo fixture.', is_demo: false, status },
});
const publicListings = async (lotId) => (await api(stack, 'GET', '/rest/v1/marketplace_listings?select=batch_id,status,is_demo&batch_id=eq.' + lotId)).json;

// ---- Case 1: pass with sufficient (simulated) evidence -----------------------
const passLot = await lot('demo-case-pass', 'green_bean');
await screening(passLot.id, 'green_bean', CLEAN);
await evidence(sellerA, passLot.id, 'defect_pct', 3.5);
await evidence(sellerA, passLot.id, 'bean_moisture_pct', 11.0);
await evidence(sellerA, passLot.id, 'screen_size', 15);
const pass = await evaluate(sellerA, passLot.id);
check('case 1 passes', pass.status === 200 && pass.json.evaluation.outcome === 'pass' && pass.json.eligibility_status === 'eligible', pass.json?.evaluation?.reasons?.join(' ') || pass.text);
check('case 1 is flagged as using simulated evidence under a demo policy', pass.json?.evaluation?.uses_simulated_evidence === true && pass.json?.evaluation?.policy?.is_demo === true);
check('each input keeps value, unit, method, source, time and verification status', ['defect_pct', 'bean_moisture_pct', 'screen_size', 'visible_damage_pct'].every((k) => { const c = statusOf(pass, k); return c && c.value !== undefined && c.unit && c.method && c.source === 'simulated' && c.recorded_at && c.verification_status; }));
check('official grade stays Unclassified', pass.json?.evaluation?.official_grade === 'Unclassified');

// ---- Case 2: fail with a specific violation ----------------------------------
const failLot = await lot('demo-case-fail', 'green_bean');
await screening(failLot.id, 'green_bean', CLEAN);
await evidence(sellerA, failLot.id, 'defect_pct', 4.0);
await evidence(sellerA, failLot.id, 'bean_moisture_pct', 14.2);
await evidence(sellerA, failLot.id, 'screen_size', 15);
const fail = await evaluate(sellerA, failLot.id);
check('case 2 fails with the specific violation', fail.json?.evaluation?.outcome === 'fail' && fail.json?.eligibility_status === 'rejected' && fail.json.evaluation.reasons.length === 1 && fail.json.evaluation.reasons[0].includes('Bean moisture 14.2 % is above the policy limit of 12'), fail.json?.evaluation?.reasons?.join(' ') || fail.text);

// ---- Case 3: manual review with missing evidence -----------------------------
const reviewLot = await lot('demo-case-review', 'green_bean');
await screening(reviewLot.id, 'green_bean', CLEAN);
await evidence(sellerA, reviewLot.id, 'defect_pct', 4.0);
await evidence(sellerA, reviewLot.id, 'screen_size', 15);
// Warehouse humidity offered as bean moisture: stored, but never accepted.
await evidence(sellerA, reviewLot.id, 'bean_moisture_pct', 61.5, { p_method: 'warehouse_humidity_sensor', p_unit: '%RH' });
const manual = await evaluate(sellerA, reviewLot.id);
check('case 3 goes to manual review', manual.json?.evaluation?.outcome === 'manual_review' && manual.json?.eligibility_status === 'needs_review', manual.json?.evaluation?.reasons?.join(' ') || manual.text);
check('warehouse humidity does not satisfy bean moisture and is not a failure', statusOf(manual, 'bean_moisture_pct')?.status === 'manual_review' && statusOf(manual, 'bean_moisture_pct')?.reason.includes('warehouse_humidity_sensor'));

// ---- More rule behaviour on fresh lots ---------------------------------------
const missingLot = await lot('p5-missing-' + run, 'green_bean');
const missing = await evaluate(sellerA, missingLot.id);
check('a lot with no evidence at all goes to manual review, listing each missing input', missing.json?.evaluation?.outcome === 'manual_review' && missing.json.evaluation.reasons.length === 4 && missing.json.evaluation.checks.every((c) => c.source === 'missing'));
const visualLot = await lot('p5-visual-' + run, 'green_bean');
await screening(visualLot.id, 'green_bean', CLEAN);
await evidence(sellerA, visualLot.id, 'bean_moisture_pct', 11.0);
await evidence(sellerA, visualLot.id, 'screen_size', 15, { p_method: 'looked_at_photo', p_source: 'visually_estimated' });
await evidence(sellerA, visualLot.id, 'defect_pct', 2.0, { p_method: 'photo_estimate', p_source: 'visually_estimated' });
const visual = await evaluate(sellerA, visualLot.id);
check('visually estimated defect percentage and size are not accepted', visual.json?.evaluation?.outcome === 'manual_review' && statusOf(visual, 'defect_pct')?.status === 'manual_review' && statusOf(visual, 'screen_size')?.status === 'manual_review');
const damageLot = await lot('p5-damage-' + run, 'green_bean');
await screening(damageLot.id, 'green_bean', { sound_or_ripe_pct: 60, unripe_green_pct: 4, black_overfermented_pct: 18, insect_broken_pct: 14, foreign_matter_pct: 4 });
const damage = await evaluate(sellerA, damageLot.id);
check('clearly high visible damage fails with its own reason', damage.json?.evaluation?.outcome === 'fail' && statusOf(damage, 'visible_damage_pct')?.status === 'fail' && damage.json.evaluation.reasons[0].includes('32'), damage.json?.evaluation?.reasons?.[0]);
const cherryLot = await lot('p5-cherry-' + run, 'red_cherry');
await screening(cherryLot.id, 'red_cherry', CLEAN);
await evidence(sellerA, cherryLot.id, 'defect_pct', 4, { p_method: 'hand_count_sample', p_unit: '% by count' });
await evidence(sellerA, cherryLot.id, 'bean_moisture_pct', 55); // would fail a green-bean rule
const cherry = await evaluate(sellerA, cherryLot.id);
check('red cherries: moisture and size are not applied, lot passes on cherry rules', cherry.json?.evaluation?.outcome === 'pass' && statusOf(cherry, 'bean_moisture_pct')?.status === 'not_applicable' && statusOf(cherry, 'screen_size')?.status === 'not_applicable', cherry.json?.evaluation?.reasons?.join(' ') || cherry.text);
const cherryWrong = await lot('p5-cherry-method-' + run, 'red_cherry');
await screening(cherryWrong.id, 'red_cherry', CLEAN);
await evidence(sellerA, cherryWrong.id, 'defect_pct', 4); // green-bean method and unit on cherries
check('red cherries: the green-bean defect method is not accepted', (await evaluate(sellerA, cherryWrong.id)).json?.evaluation?.outcome === 'manual_review');

// ---- Authorization -----------------------------------------------------------
check('another seller cannot evaluate this lot', (await evaluate(sellerB, reviewLot.id)).status === 403);
check('another seller cannot record evidence on this lot', (await evidence(sellerB, reviewLot.id, 'bean_moisture_pct', 11)).status === 403);
check('signed-out request cannot evaluate', [401, 403, 404].includes((await rpc(stack, 'bunalens_evaluate_lot_eligibility', { p_batch_id: reviewLot.id })).status));
check('seller cannot approve its own lot', (await review(sellerA, reviewLot.id, 'eligible', 'Looks fine to me, approve please.')).status === 403);
// A user can edit user_metadata but not app_metadata; the role must not come from user_metadata.
await api(stack, 'PUT', '/auth/v1/user', { token: sellerB.token, body: { data: { role: 'admin' } } });
const sellerBAgain = await ensureUser(stack, 'demo-seller-b@bunalens.test', 'BUNALENS_DEMO_SELLER_B_PASSWORD');
check('a self-assigned role in user metadata gives no reviewer rights', (await review(sellerBAgain, reviewLot.id, 'eligible', 'Self-assigned admin tries to approve.')).status === 403);
check('seller cannot change eligibility by a direct table update', await (async () => {
  await api(stack, 'PATCH', '/rest/v1/coffee_batches?id=eq.' + failLot.id, { token: sellerA.token, body: { eligibility_status: 'eligible' } });
  const row = (await api(stack, 'GET', '/rest/v1/coffee_batches?select=eligibility_status&id=eq.' + failLot.id, { token: sellerA.token })).json[0];
  return row.eligibility_status === 'rejected';
})());
check('seller cannot write a review row directly', (await api(stack, 'POST', '/rest/v1/lot_reviews', { token: sellerA.token, body: { batch_id: failLot.id, decision: 'eligible', decided_by: 'rule', reason: 'forged', criteria_snapshot: {} } })).status >= 400);
check('seller cannot write a listing directly', (await api(stack, 'POST', '/rest/v1/marketplace_listings', { token: sellerA.token, body: { batch_id: passLot.id, station_id: stationA, seller_display_name: 'x', origin_woreda: 'Gomma', coffee_stage: 'green_bean', available_kg: 1, price_per_kg_etb: 1, screening_summary: 'x', status: 'published' } })).status >= 400);
check('seller cannot approve itself as a marketplace seller', (await rpc(stack, 'bunalens_set_seller_status', { p_station_id: stationA, p_status: 'approved', p_note: 'self approval' }, { token: sellerA.token })).status === 403);
check('reviewer cannot approve a seller (administrator only)', (await rpc(stack, 'bunalens_set_seller_status', { p_station_id: stationA, p_status: 'approved', p_note: 'reviewer tries' }, { token: reviewer.token })).status === 403);

// ---- Reviewer decisions ------------------------------------------------------
check('a reviewer decision needs a reason', (await review(reviewer, reviewLot.id, 'eligible', 'ok')).status === 400);
const resolveLot = await lot('p5-resolve-' + run, 'green_bean');
await screening(resolveLot.id, 'green_bean', CLEAN);
await evidence(sellerA, resolveLot.id, 'defect_pct', 4.0);
await evidence(sellerA, resolveLot.id, 'screen_size', 15);
await evaluate(sellerA, resolveLot.id);
const entered = await evidence(reviewer, resolveLot.id, 'bean_moisture_pct', 11.2, { p_source: 'reviewer_entered', p_note: 'DEMO: reviewer-entered reading, no instrument was used.' });
check('reviewer-entered moisture is stored under the reviewer identity as verified', entered.status === 200 && entered.json.source === 'reviewer_entered' && entered.json.recorded_by === reviewer.id && entered.json.verification_status === 'verified');
check('station staff cannot record a reviewer-entered reading', (await evidence(sellerA, resolveLot.id, 'bean_moisture_pct', 11, { p_source: 'reviewer_entered' })).status === 400);
const afterEntry = await evaluate(reviewer, resolveLot.id);
check('new evidence is re-evaluated: lot now passes by rule', afterEntry.json?.evaluation?.outcome === 'pass' && afterEntry.json?.decided_by === 'rule');
// A separate lot is decided here so the durable case 3 lot stays in manual review.
const decideLot = await lot('p5-decide-' + run, 'green_bean');
await screening(decideLot.id, 'green_bean', CLEAN);
await evidence(sellerA, decideLot.id, 'defect_pct', 4.0);
await evidence(sellerA, decideLot.id, 'screen_size', 15);
await evaluate(sellerA, decideLot.id);
const resolved = await review(reviewer, decideLot.id, 'eligible', 'DEMO decision: moisture confirmed by reviewer on site, reading not recorded.');
check('reviewer resolves a manual review; reviewer, time, policy and reason are recorded', resolved.status === 200 && resolved.json.reviewer_id === reviewer.id && Boolean(resolved.json.decided_at) && resolved.json.policy_id === 'demo-policy-2026-11-21' && resolved.json.rule_outcome === 'manual_review' && resolved.json.is_override === false, resolved.text.slice(0, 120));
const history = (await api(stack, 'GET', '/rest/v1/lot_reviews?select=decision,decided_by,reviewer_id,reason,policy_id,rule_outcome,evidence_refs,is_override&batch_id=eq.' + decideLot.id + '&order=created_at.desc&limit=2', { token: sellerA.token })).json;
check('decision, reasons and evidence references persist and the seller can read them', history?.[0]?.decided_by === 'reviewer' && history[0].reason.startsWith('DEMO decision') && history[0].evidence_refs.length >= 3 && history?.[1]?.decided_by === 'rule' && history[1].decision === 'needs_review');
check('re-evaluating without new evidence keeps the reviewer decision', (await evaluate(sellerA, decideLot.id)).json?.kept_previous_decision === true);
check('a reviewer cannot pass a lot that fails a rule', (await review(reviewer, failLot.id, 'eligible', 'Reviewer tries to pass a failed lot.')).status === 403);
check('an administrator cannot pass a failed lot without requesting an override', (await review(admin, failLot.id, 'eligible', 'Administrator without the override flag.')).status === 403);
const overrideLot = await lot('p5-override-' + run, 'green_bean');
await screening(overrideLot.id, 'green_bean', CLEAN);
await evidence(sellerA, overrideLot.id, 'defect_pct', 4.0);
await evidence(sellerA, overrideLot.id, 'bean_moisture_pct', 12.4);
await evidence(sellerA, overrideLot.id, 'screen_size', 15);
await evaluate(sellerA, overrideLot.id);
const overridden = await review(admin, overrideLot.id, 'eligible', 'DEMO override: buyer accepts 12.4 % moisture in writing.', true);
check('an administrator override is recorded as an override of a failed rule', overridden.status === 200 && overridden.json.is_override === true && overridden.json.rule_outcome === 'fail');
check('the case 2 lot is still rejected', (await api(stack, 'GET', '/rest/v1/coffee_batches?select=eligibility_status&id=eq.' + failLot.id, { token: sellerA.token })).json[0].eligibility_status === 'rejected');

// ---- Publication -------------------------------------------------------------
check('an eligible lot is not published by itself', (await publicListings(passLot.id)).length === 0);
// PRIVILEGED (local service role): reset seller approval so the run is repeatable.
await api(stack, 'PATCH', '/rest/v1/stations?id=eq.' + stationA, { ...service, body: { marketplace_seller_status: 'pending' } });
check('failed lot cannot be published, even by server code', (await listing(failLot.id, 'published')).status >= 400);
check('unreviewed lot cannot be published', (await listing(missingLot.id, 'published')).status >= 400);
const unapproved = await listing(passLot.id, 'published');
check('eligible lot of an unapproved seller cannot be published', unapproved.status >= 400 && unapproved.text.includes('Seller is not approved'), unapproved.text.slice(0, 90));
const approved = await rpc(stack, 'bunalens_set_seller_status', { p_station_id: stationA, p_status: 'approved', p_note: 'DEMO approval for the sprint walkthrough.' }, { token: admin.token });
check('administrator approves the seller', approved.status === 200);
const draft = await listing(passLot.id, 'draft');
check('a draft listing is not visible to the public', draft.status < 300 && (await publicListings(passLot.id)).length === 0, 'HTTP ' + draft.status);
const published = await listing(passLot.id, 'published');
check('eligible lot of an approved seller publishes', published.status < 300 && published.json?.[0]?.status === 'published', published.text.slice(0, 120));
check('a listing that rests on simulated evidence is forced to demo', published.json?.[0]?.is_demo === true);
check('the public sees the published lot and none of the failed, review or draft lots', (await publicListings(passLot.id)).length === 1 && (await publicListings(failLot.id)).length === 0 && (await publicListings(missingLot.id)).length === 0);
const publicLots = await api(stack, 'GET', '/rest/v1/coffee_batches?select=id&id=eq.' + passLot.id);
check('the public cannot read lot records, evidence or reviews', (publicLots.status >= 400 || publicLots.json.length === 0) && ((await api(stack, 'GET', '/rest/v1/lot_evidence?select=id&limit=1')).json?.length ?? 0) === 0 && ((await api(stack, 'GET', '/rest/v1/lot_reviews?select=id&limit=1')).json?.length ?? 0) === 0);
await evidence(sellerA, passLot.id, 'bean_moisture_pct', 11.4);
check('new evidence takes the listing off the marketplace', (await publicListings(passLot.id)).length === 0);
const stale = await listing(passLot.id, 'published');
check('publishing again before re-evaluation is refused', stale.status >= 400, stale.text.slice(0, 90));
const again = await evaluate(sellerA, passLot.id);
check('re-evaluation alone does not publish', again.json?.eligibility_status === 'eligible' && (await publicListings(passLot.id)).length === 0);
check('after re-evaluation, an explicit publication succeeds', (await listing(passLot.id, 'published')).status < 300 && (await publicListings(passLot.id)).length === 1);
const overridePublish = await listing(overrideLot.id, 'published');
check('an overridden lot can be published; the override stays on record', overridePublish.status < 300);
await listing(overrideLot.id, 'withdrawn');
// PRIVILEGED (local service role): evidence written straight into the table, bypassing the
// function that resets eligibility, to prove publication re-checks the evidence itself.
const direct = await api(stack, 'POST', '/rest/v1/lot_evidence', { ...service, body: { batch_id: overrideLot.id, station_id: stationA, kind: 'bean_moisture_pct', value: 13.9, unit: '%', method: 'moisture_meter', source: 'simulated', recorded_at: new Date().toISOString(), note: 'SIMULATED, inserted directly by the verification run.' } });
const bypass = await listing(overrideLot.id, 'published');
check('publication re-checks evidence even when the eligibility flag was not reset', direct.status === 201 && bypass.status >= 400 && bypass.text.includes('changed since the eligibility decision'), bypass.text.slice(0, 110));

console.log('\nDemo cases: pass ' + passLot.batch_code + ', fail ' + failLot.batch_code + ', manual review ' + reviewLot.batch_code + '');
console.log(failed === 0 ? 'All checks passed.' : failed + ' check(s) failed.');
process.exitCode = failed === 0 ? 0 : 1;
