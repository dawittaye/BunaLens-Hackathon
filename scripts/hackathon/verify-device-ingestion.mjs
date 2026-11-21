// Phase 3 verification against the LOCAL Supabase test stack, through the
// same HTTP API the app and a device use, with normal user sessions.
//
//   node scripts/hackathon/verify-device-ingestion.mjs
//
// Part 1 creates (once) the durable demo objects used by the replay command:
// demo seller, station, "Zone A" with the simulated device, and a demo lot.
// Part 2 creates fresh objects for this run and checks the rules.
// The only privileged step is clearly marked: backdating one storage interval
// with the local service role so a stale reading can be demonstrated.
import crypto from 'node:crypto';
import { localStack, api, rpc, ensureUser, ensureStation, saveEnv, loadEnv } from './lib.mjs';

const stack = localStack();
const run = crypto.randomBytes(4).toString('hex');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
};
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const reading = (deviceUid, messageId, recordedAt, extra = {}) => ({
  p_device_uid: deviceUid, p_message_id: messageId, p_recorded_at: recordedAt,
  p_temperature_c: 22.4, p_temperature_unit: 'C', p_humidity_pct: 61.5, p_humidity_unit: '%RH',
  p_source: 'simulated', ...extra,
});
const ingest = (body, token) => rpc(stack, 'bunalens_ingest_device_reading', body, token === undefined ? {} : { headers: { 'x-device-token': token } });

// ---- Part 1: durable demo objects ------------------------------------------
const sellerA = await ensureUser(stack, 'demo-seller@bunalens.test', 'BUNALENS_DEMO_SELLER_PASSWORD');
const sellerB = await ensureUser(stack, 'demo-seller-b@bunalens.test', 'BUNALENS_DEMO_SELLER_B_PASSWORD');
await ensureStation(stack, sellerA, 'DEMO Gomma Washing Station', 'Gomma');
await ensureStation(stack, sellerB, 'DEMO Mana Washing Station', 'Mana');

const demoLot = await rpc(stack, 'bunalens_register_lot', {
  p_idempotency_key: 'demo-lot-0001', p_sample_type: 'green_bean', p_woreda: 'Gomma',
  p_lot_weight_kg: 600, p_farmer_name: 'DEMO farmer (not a real person)',
}, { token: sellerA.token });
check('demo lot registered', demoLot.status === 200 && Boolean(demoLot.json?.lot?.id), 'lot ' + demoLot.json?.lot?.batch_code);
const demoLotId = demoLot.json.lot.id;

const again = await rpc(stack, 'bunalens_register_lot', {
  p_idempotency_key: 'demo-lot-0001', p_sample_type: 'green_bean', p_woreda: 'Gomma',
  p_lot_weight_kg: 600, p_farmer_name: 'DEMO farmer (not a real person)',
}, { token: sellerA.token });
check('registering the same lot again returns the same lot id', again.json?.lot?.id === demoLotId && again.json?.already_registered === true);

let demoToken = loadEnv().BUNALENS_DEMO_DEVICE_TOKEN;
const demoDevice = await api(stack, 'GET', '/rest/v1/station_devices?select=id,zone_id&device_uid=eq.esp32-sim-zone-a', { token: sellerA.token });
let demoZoneId = demoDevice.json?.[0]?.zone_id;
if (!demoZoneId) {
  const created = await rpc(stack, 'bunalens_create_zone_device', {
    p_zone_name: 'Zone A', p_device_uid: 'esp32-sim-zone-a', p_label: 'SIMULATED ESP32 temperature and humidity sensor', p_is_simulated: true,
  }, { token: sellerA.token });
  if (created.status !== 200) throw new Error('Could not create demo zone and device: HTTP ' + created.status + ' ' + created.text);
  demoZoneId = created.json.zone_id;
  demoToken = created.json.device_token;
  saveEnv('BUNALENS_DEMO_DEVICE_TOKEN', demoToken);
}
check('demo zone and simulated device exist, token stored in .env.backend only', Boolean(demoZoneId && demoToken));
const demoAssign = await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: demoLotId, p_zone_id: demoZoneId }, { token: sellerA.token });
check('demo lot stored in Zone A', demoAssign.status === 200);
saveEnv('BUNALENS_DEMO_LOT_ID', demoLotId);

// ---- Part 2: rules, with fresh objects for this run -------------------------
const device = 'esp32-verify-' + run;
const zone = await rpc(stack, 'bunalens_create_zone_device', {
  p_zone_name: 'Verify zone ' + run, p_device_uid: device, p_label: 'SIMULATED verification device', p_is_simulated: true,
}, { token: sellerA.token });
const token = zone.json?.device_token;
check('zone and device created; token returned once', zone.status === 200 && typeof token === 'string' && token.length === 64);

const lot = async (user, key) => (await rpc(stack, 'bunalens_register_lot', {
  p_idempotency_key: key, p_sample_type: 'green_bean', p_woreda: 'Gomma', p_lot_weight_kg: 100, p_farmer_name: 'DEMO farmer (not a real person)',
}, { token: user.token })).json.lot.id;
const lotNew = await lot(sellerA, 'verify-' + run + '-new');
const lotOld = await lot(sellerA, 'verify-' + run + '-old');
const lotB = await lot(sellerB, 'verify-' + run + '-b');
const environment = async (user, id) => (await rpc(stack, 'bunalens_lot_environment', { p_batch_id: id }, { token: user.token }));

check('lot with no zone reports state no_zone', (await environment(sellerA, lotNew)).json?.state === 'no_zone');

const otherAssign = await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: lotNew, p_zone_id: zone.json.zone_id }, { token: sellerB.token });
check('another seller cannot store this station\'s lot', otherAssign.status === 403, 'HTTP ' + otherAssign.status);
const crossAssign = await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: lotB, p_zone_id: zone.json.zone_id }, { token: sellerB.token });
check('a lot cannot be stored in another station\'s zone', crossAssign.status === 403, 'HTTP ' + crossAssign.status);

await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: lotOld, p_zone_id: zone.json.zone_id }, { token: sellerA.token });
// PRIVILEGED TEST STEP (local service role): pretend lotOld was stored 3 hours ago.
const backdate = await api(stack, 'PATCH', '/rest/v1/lot_zone_assignments?batch_id=eq.' + lotOld, {
  key: stack.service, token: stack.service, body: { assigned_at: minutesAgo(180) },
});
check('test fixture step: storage interval of the older lot backdated by 3 hours', backdate.status === 204, 'HTTP ' + backdate.status);
const assigned = await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: lotNew, p_zone_id: zone.json.zone_id }, { token: sellerA.token });
check('owner stores the new lot in the zone', assigned.status === 200 && assigned.json?.changed === true);
check('lot in a zone with no readings reports state no_reading', (await environment(sellerA, lotNew)).json?.state === 'no_reading');

const noToken = await ingest(reading(device, 'm-' + run + '-x', minutesAgo(1)));
check('message without a device token is rejected', noToken.status === 401 || noToken.status === 403, 'HTTP ' + noToken.status);
const wrongToken = await ingest(reading(device, 'm-' + run + '-x', minutesAgo(1)), 'f'.repeat(64));
check('message with a wrong token is rejected', wrongToken.status === 401 || wrongToken.status === 403, 'HTTP ' + wrongToken.status);
const wrongDevice = await ingest(reading('esp32-sim-zone-a', 'm-' + run + '-x', minutesAgo(1)), token);
check('a valid token cannot post as a different device', wrongDevice.status === 401 || wrongDevice.status === 403, 'HTTP ' + wrongDevice.status);
const fahrenheit = await ingest(reading(device, 'm-' + run + '-x', minutesAgo(1), { p_temperature_unit: 'F' }), token);
check('wrong temperature unit is rejected', fahrenheit.status === 400, 'HTTP ' + fahrenheit.status);
const humid = await ingest(reading(device, 'm-' + run + '-x', minutesAgo(1), { p_humidity_pct: 140 }), token);
check('humidity above 100 % is rejected', humid.status === 400, 'HTTP ' + humid.status);
const hot = await ingest(reading(device, 'm-' + run + '-x', minutesAgo(1), { p_temperature_c: 300 }), token);
check('implausible temperature is rejected', hot.status === 400, 'HTTP ' + hot.status);
const future = await ingest(reading(device, 'm-' + run + '-x', new Date(Date.now() + 3600000).toISOString()), token);
check('capture time in the future is rejected', future.status === 400, 'HTTP ' + future.status);

const old = await ingest(reading(device, 'm-' + run + '-old', minutesAgo(90)), token);
check('reading captured 90 minutes ago is stored and applies to one lot only', old.status === 200 && old.json?.status === 'stored' && old.json?.applicable_lot_count === 1, JSON.stringify(old.json));
const envOld = (await environment(sellerA, lotOld)).json;
check('older lot shows that reading as stale', envOld?.state === 'stale' && envOld?.reading?.age_minutes > 30, 'state ' + envOld?.state + ', age ' + envOld?.reading?.age_minutes + ' min');
const envNewBefore = (await environment(sellerA, lotNew)).json;
check('reading from before the new lot was stored is not attached to it', envNewBefore?.state === 'no_reading' && envNewBefore?.reading_count === 0);

const capturedAt = new Date().toISOString();
const first = await ingest(reading(device, 'm-' + run + '-1', capturedAt), token);
check('valid message is stored', first.status === 200 && first.json?.status === 'stored' && first.json?.applicable_lot_count === 2, JSON.stringify(first.json));
const replay = await ingest(reading(device, 'm-' + run + '-1', capturedAt), token);
check('replayed message is reported as duplicate with the same reading id', replay.status === 200 && replay.json?.status === 'duplicate' && replay.json?.reading_id === first.json?.reading_id);
const stored = await api(stack, 'GET', '/rest/v1/device_readings?select=id,source,temperature_c,humidity_pct&message_id=eq.m-' + run + '-1', { token: sellerA.token });
check('exactly one row exists for the replayed message', stored.json?.length === 1);
const liveClaim = await ingest(reading(device, 'm-' + run + '-2', new Date().toISOString(), { p_source: 'live' }), token);
check('a simulated device cannot produce a live reading', liveClaim.json?.source === 'simulated', 'source ' + liveClaim.json?.source);

const envNew = (await environment(sellerA, lotNew)).json;
check('new lot shows the latest reading as fresh with units, zone, device and simulated label',
  envNew?.state === 'fresh' && envNew?.reading?.source === 'simulated' && envNew?.reading?.temperature_unit === 'C'
  && envNew?.reading?.humidity_unit === '%RH' && envNew?.zone?.name === 'Verify zone ' + run
  && envNew?.device?.device_uid === device && envNew?.device?.is_simulated === true && envNew?.reading_count === 2,
  envNew?.reading?.temperature_c + ' C, ' + envNew?.reading?.humidity_pct + ' %RH, ' + envNew?.reading?.source);
check('lot environment response carries no device secret', !/token/i.test(JSON.stringify(envNew)));

const otherRead = await api(stack, 'GET', '/rest/v1/device_readings?select=id&device_id=not.is.null', { token: sellerB.token });
check('another seller reads none of this station\'s readings', otherRead.status === 200 && otherRead.json.length === 0);
const otherEnv = (await environment(sellerB, lotNew)).json;
check('another seller gets no zone or reading for this lot', otherEnv?.state === 'no_zone' && !otherEnv?.reading);
const anonEnv = await rpc(stack, 'bunalens_lot_environment', { p_batch_id: lotNew });
check('anonymous caller cannot read a lot environment', anonEnv.status === 401 || anonEnv.status === 403, 'HTTP ' + anonEnv.status);
const hash = await api(stack, 'GET', '/rest/v1/station_devices?select=token_hash', { token: sellerA.token });
check('owner cannot read the stored token hash', hash.status === 403, 'HTTP ' + hash.status);

console.log(failed === 0 ? '\nALL PHASE 3 CHECKS PASSED' : '\n' + failed + ' CHECK(S) FAILED');
console.log('Demo lot id: ' + demoLotId + ' (open /batch/' + demoLotId + ' when signed in as demo-seller@bunalens.test)');
process.exitCode = failed === 0 ? 0 : 1;
