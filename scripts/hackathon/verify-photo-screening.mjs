// Phase 4 verification against the LOCAL Supabase test stack, through the same
// HTTP API the app uses, with normal user sessions (no service role).
//
//   node scripts/hackathon/verify-photo-screening.mjs
//
// What this exercises: screening rules (pure module), private photo upload to
// Storage, and the DEMO-FIXTURE assessment saved on an existing lot.
// What it does NOT exercise: the live Gemini path in coffee-sync. That needs
// GEMINI_API_KEY and a function runtime serving this checkout.
//
// The uploaded image is a generated 1x1 PNG placeholder, not a coffee photo.
import crypto from 'node:crypto';
import { localStack, api, rpc, ensureUser, ensureStation } from './lib.mjs';
import { buildScreening } from '../../supabase/functions/_shared/screening.ts';

const stack = localStack();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
};
const meta = (source) => ({ source, provider: 'test', model: 'test-model', assessedAt: new Date().toISOString(), captureKey: 'unit-test-key' });
const base = (breakdown, extra = {}) => ({ breakdown, confidence_score: 90, export_readiness: 'Commercial Export', assessment_limitations: ['Single photo.'], ...extra });

// ---- Part 1: screening rules (no network) -----------------------------------
const cherry = buildScreening(base({ sound_or_ripe_pct: 70, unripe_green_pct: 18, black_overfermented_pct: 4, insect_broken_pct: 6, foreign_matter_pct: 2 }), 'red_cherry', meta('live_inference'));
const bean = buildScreening(base({ sound_or_ripe_pct: 70, unripe_green_pct: 4, black_overfermented_pct: 18, insect_broken_pct: 6, foreign_matter_pct: 2 }), 'green_bean', meta('live_inference'));
check('cherry screening uses cherry wording and ripeness', cherry.sample_stage === 'red_cherry' && cherry.observations.some((o) => o.startsWith('Ripeness')) && cherry.suspected_defects[0]?.label.includes('cherries') && cherry.next_action.includes('pulping'));
check('bean screening uses bean wording and discolouration', bean.sample_stage === 'green_bean' && bean.observations.some((o) => o.startsWith('Discolouration')) && bean.suspected_defects[0]?.label.includes('beans') && !bean.next_action.includes('pulping'));
check('defects below 3% are not listed; shares are the model estimate', cherry.suspected_defects.length === 3 && cherry.suspected_defects[0].visible_share_pct === 18);
check('official grade stays Unclassified', cherry.official_grade === 'Unclassified' && bean.official_grade === 'Unclassified');
check('clear live photo does not need review', cherry.needs_review === false && cherry.photo.usable === true && cherry.photo.retake_guidance === null);
const allText = JSON.stringify([cherry, bean]);
check('moisture, size and grade are listed as not assessed', cherry.not_assessed.some((n) => n.startsWith('Bean moisture')) && cherry.not_assessed.some((n) => n.startsWith('Physical bean size')) && cherry.not_assessed.some((n) => n.startsWith('Official grade')));
check('size variation is "not assessed" unless the model reports it', cherry.apparent_size_variation === 'not_assessable' && allText.includes('Apparent size variation was not assessed'));
const mixed = buildScreening(base(cherry_breakdown(), { apparent_size_variation: 'appears_mixed' }), 'green_bean', meta('live_inference'));
check('reported size variation is worded as apparent, not measured', mixed.observations.some((o) => o.includes('This is not a measured size')));
const lowConfidence = buildScreening(base(cherry_breakdown(), { confidence_score: 40 }), 'green_bean', meta('live_inference'));
check('low confidence triggers review and retake guidance', lowConfidence.needs_review && lowConfidence.photo.usable === false && lowConfidence.next_action.startsWith('Retake the photo'));
const poor = buildScreening(base(cherry_breakdown(), { photo_issues: ['blurry', 'too_dark'] }), 'red_cherry', meta('live_inference'));
check('reported photo problems give specific retake steps', poor.needs_review && poor.photo.retake_guidance.includes('hold the phone steady') && poor.photo.retake_guidance.includes('brighter even light'));
const insufficient = buildScreening(base(cherry_breakdown(), { export_readiness: 'Insufficient Evidence' }), 'green_bean', meta('live_inference'));
check('insufficient evidence triggers review', insufficient.needs_review && insufficient.review_reasons.some((r) => r.includes('insufficient visual evidence')));
const fixture = buildScreening(base(cherry_breakdown()), 'green_bean', meta('demo_fixture'));
check('demo fixture always needs review and says the photo was not analysed', fixture.needs_review && fixture.review_reasons[0].includes('not analysed'));
function cherry_breakdown() { return { sound_or_ripe_pct: 80, unripe_green_pct: 8, black_overfermented_pct: 5, insect_broken_pct: 5, foreign_matter_pct: 2 }; }

// ---- Part 2: persistence on a lot, normal seller sessions --------------------
const sellerA = await ensureUser(stack, 'demo-seller@bunalens.test', 'BUNALENS_DEMO_SELLER_PASSWORD');
const sellerB = await ensureUser(stack, 'demo-seller-b@bunalens.test', 'BUNALENS_DEMO_SELLER_B_PASSWORD');
const stationA = await ensureStation(stack, sellerA, 'DEMO Gomma Washing Station', 'Gomma');
const stationB = await ensureStation(stack, sellerB, 'DEMO Mana Washing Station', 'Mana');
const register = (key, type, user) => rpc(stack, 'bunalens_register_lot', {
  p_idempotency_key: key, p_sample_type: type, p_woreda: 'Gomma', p_lot_weight_kg: 600, p_farmer_name: 'DEMO farmer (not a real person)',
}, { token: user.token });
const demoLot = (await register('demo-lot-0001', 'green_bean', sellerA)).json.lot;
const run = crypto.randomBytes(4).toString('hex');
const cherryLot = (await register('p4-check-cherry-' + run, 'red_cherry', sellerA)).json.lot;
check('lots available', Boolean(demoLot?.id && cherryLot?.id), demoLot?.batch_code + ' and ' + cherryLot?.batch_code);

const preset = (stage, defective) => {
  const breakdown = defective
    ? { sound_or_ripe_pct: 72, unripe_green_pct: 8, black_overfermented_pct: 7, insect_broken_pct: 8, foreign_matter_pct: 5 }
    : { sound_or_ripe_pct: 96, unripe_green_pct: 1, black_overfermented_pct: 1, insect_broken_pct: 1, foreign_matter_pct: 1 };
  const result = {
    is_coffee_sample: true, ecx_grade: 'Unclassified', quality_score: defective ? 72 : 96, confidence_score: 95, breakdown,
    estimated_price_per_feresula_etb: 0, potential_gain_if_sorted_etb: 0, export_readiness: defective ? 'Commercial Export' : 'Specialty Export',
    sorting_action_advice: 'Demonstration only.', assessment_limitations: ['Simulated demonstration data; no photograph was analyzed.'],
    assessment_method: 'ai_visual_estimate',
  };
  return { ...result, screening: buildScreening(result, stage, { source: 'demo_fixture', provider: 'bunalens-demo-fixture', model: 'none', assessedAt: new Date().toISOString() }) };
};
const attach = (user, lotId, key, assessment, imagePath = null) => rpc(stack, 'bunalens_attach_demo_assessment', {
  p_batch_id: lotId, p_capture_key: key, p_assessment: assessment, p_image_path: imagePath,
}, user ? { token: user.token } : {});

// Generated placeholder image (1x1 PNG). Not a coffee photo.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = async (user, objectPath) => {
  const response = await fetch(stack.url + '/storage/v1/object/coffee-samples/' + objectPath, {
    method: 'POST', headers: { apikey: stack.anon, Authorization: 'Bearer ' + user.token, 'Content-Type': 'image/png' }, body: png,
  });
  return response.status;
};

const key = 'p4-demo-' + run;
const photoPath = stationA + '/' + demoLot.id + '-' + key + '.png';
check('seller stores the photo privately under its own station', (await upload(sellerA, photoPath)) === 200);
check('another seller cannot store a photo under this station', (await upload(sellerB, stationA + '/' + demoLot.id + '-intruder-' + run + '.png')) >= 400);

const anon = await attach(null, demoLot.id, key, preset('green_bean', false));
check('signed-out request is refused', anon.status === 401 || anon.status === 403 || anon.status === 404, 'HTTP ' + anon.status);
const other = await attach(sellerB, demoLot.id, key, preset('green_bean', false));
check('another station cannot attach an assessment to this lot', other.status === 403, 'HTTP ' + other.status);
const wrongStage = await attach(sellerA, demoLot.id, key, preset('red_cherry', false));
check('cherry assessment is refused on a green-bean lot', wrongStage.status === 400 && String(wrongStage.json?.message).includes('stage does not match'), 'HTTP ' + wrongStage.status);
const foreignPhoto = await attach(sellerA, demoLot.id, key, preset('green_bean', false), stationB + '/x-' + run + '.png');
check('photo reference outside the station is refused', foreignPhoto.status === 400 && String(foreignPhoto.json?.message).includes('not a stored photo of this station'), 'HTTP ' + foreignPhoto.status);
const missingPhoto = await attach(sellerA, demoLot.id, key, preset('green_bean', false), stationA + '/not-uploaded-' + run + '.png');
check('photo reference that was never stored is refused', missingPhoto.status === 400 && String(missingPhoto.json?.message).includes('not a stored photo of this station'), 'HTTP ' + missingPhoto.status);

// A forged payload claiming live inference and a grade must be stored as a demo fixture.
const forged = preset('green_bean', false);
forged.ecx_grade = 'Grade 1';
forged.screening.source = 'live_inference';
forged.screening.provider = 'google';
forged.screening.model = 'gemini-3.1-flash-lite';
forged.screening.needs_review = false;
forged.screening.official_grade = 'Grade 1';
const saved = await attach(sellerA, demoLot.id, key, forged, photoPath);
check('demo assessment saved on the lot', saved.status === 200 && saved.json?.already_saved === false && saved.json?.lot?.id === demoLot.id, 'HTTP ' + saved.status + ' ' + (saved.json?.message || ''));
const replay = await attach(sellerA, demoLot.id, key, forged, photoPath);
check('retry with the same capture key changes nothing', replay.status === 200 && replay.json?.already_saved === true);

const row = (await api(stack, 'GET', '/rest/v1/coffee_batches?select=id,sample_type,image_path,grading_status,is_demo,ecx_grade,eligibility_status,grading_result&id=eq.' + demoLot.id, { token: sellerA.token })).json?.[0];
const s = row?.grading_result?.screening;
check('lot row keeps its id and stage', row?.id === demoLot.id && row?.sample_type === 'green_bean' && s?.sample_stage === 'green_bean');
check('photo reference persisted', row?.image_path === photoPath);
check('assessment time, provider and model persisted', Boolean(s?.assessed_at) && s?.provider === 'bunalens-demo-fixture' && String(s?.model).startsWith('none'));
check('forged live-inference claim stored as demo fixture', s?.source === 'demo_fixture' && s?.needs_review === true && row?.is_demo === true && row?.grading_status === 'demo');
check('forged grade stored as Unclassified', row?.ecx_grade === 'Unclassified' && row?.grading_result?.ecx_grade === 'Unclassified' && s?.official_grade === 'Unclassified');
check('observations, defects, limitations and next action persisted', s?.observations?.length >= 3 && Array.isArray(s?.suspected_defects) && s?.limitations?.length >= 1 && typeof s?.next_action === 'string' && s.next_action.length > 10);
check('lot is not made eligible by an assessment', row?.eligibility_status === 'unreviewed');

const signed = await api(stack, 'POST', '/storage/v1/object/sign/coffee-samples/' + photoPath, { token: sellerA.token, body: { expiresIn: 60 } });
check('owner can read the stored photo', signed.status === 200 && Boolean(signed.json?.signedURL || signed.json?.signedUrl), 'HTTP ' + signed.status);
const signedOther = await api(stack, 'POST', '/storage/v1/object/sign/coffee-samples/' + photoPath, { token: sellerB.token, body: { expiresIn: 60 } });
check('another seller cannot read the stored photo', signedOther.status >= 400, 'HTTP ' + signedOther.status);
const otherRead = await api(stack, 'GET', '/rest/v1/coffee_batches?select=id&id=eq.' + demoLot.id, { token: sellerB.token });
check('another seller cannot read the lot assessment', otherRead.status === 200 && otherRead.json.length === 0);

const cherrySaved = await attach(sellerA, cherryLot.id, 'p4-cherry-' + run, preset('red_cherry', true));
const cherryScreening = cherrySaved.json?.lot?.screening;
check('red-cherry lot gets a cherry assessment without a photo', cherrySaved.status === 200 && cherryScreening?.sample_stage === 'red_cherry' && cherryScreening?.suspected_defects?.[0]?.label.includes('cherries') && cherrySaved.json.lot.image_path === null);

const environment = await rpc(stack, 'bunalens_lot_environment', { p_batch_id: demoLot.id }, { token: sellerA.token });
check('warehouse readings stay separate and still attached to the same lot', environment.status === 200 && environment.json?.batch_id === demoLot.id && !('screening' in (environment.json || {})), 'state ' + environment.json?.state);

console.log('\nDemo lot: ' + demoLot.batch_code + ' (' + demoLot.id + ')');
console.log(failed === 0 ? 'All checks passed.' : failed + ' check(s) failed.');
process.exitCode = failed === 0 ? 0 : 1;
