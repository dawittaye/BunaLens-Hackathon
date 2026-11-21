// Creates a throwaway account on the LOCAL test stack for checking the lot
// screen in a browser, with three lots in three states:
//   no zone, fresh simulated reading, stale simulated reading.
//
//   $env:SCREEN_CHECK_PASSWORD = "<any throwaway password>"
//   node scripts/hackathon/make-screen-check-account.mjs
//   node scripts/hackathon/make-screen-check-account.mjs --delete <user id>
//
// The stale case needs one privileged step with the local service role:
// the storage interval is backdated by 3 hours.
import crypto from 'node:crypto';
import { localStack, api, rpc, ensureStation } from './lib.mjs';

const stack = localStack();
const deleteIndex = process.argv.indexOf('--delete');
if (deleteIndex > 0) {
  const removed = await api(stack, 'DELETE', '/auth/v1/admin/users/' + process.argv[deleteIndex + 1], { key: stack.service, token: stack.service });
  console.log('delete HTTP ' + removed.status);
} else {
  const password = process.env.SCREEN_CHECK_PASSWORD;
  if (!password) throw new Error('Set SCREEN_CHECK_PASSWORD to a throwaway password.');
  const run = crypto.randomBytes(3).toString('hex');
  const email = 'screen-check-' + run + '@bunalens.test';
  const signUp = await api(stack, 'POST', '/auth/v1/signup', { body: { email, password, data: { full_name: 'Screen Check', manager: 'Screen Check', station_name: 'DEMO Screen Check Station', woreda: 'Gomma' } } });
  if (signUp.status !== 200) throw new Error('signup failed: HTTP ' + signUp.status);
  const user = { token: signUp.json.access_token, id: signUp.json.user.id, email };
  await ensureStation(stack, user, 'DEMO Screen Check Station', 'Gomma');
  const lot = async (key) => (await rpc(stack, 'bunalens_register_lot', { p_idempotency_key: 'screen-' + run + '-' + key, p_sample_type: 'green_bean', p_woreda: 'Gomma', p_lot_weight_kg: 250, p_farmer_name: 'DEMO farmer (not a real person)' }, { token: user.token })).json.lot.id;
  const [noZone, fresh, stale] = [await lot('nozone'), await lot('fresh'), await lot('stale')];
  const zone = async (name, uid) => (await rpc(stack, 'bunalens_create_zone_device', { p_zone_name: name, p_device_uid: uid, p_label: 'SIMULATED sensor', p_is_simulated: true }, { token: user.token })).json;
  const zoneA = await zone('Zone A', 'esp32-screen-' + run + '-a');
  const zoneB = await zone('Zone B', 'esp32-screen-' + run + '-b');
  await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: fresh, p_zone_id: zoneA.zone_id }, { token: user.token });
  await rpc(stack, 'bunalens_assign_lot_zone', { p_batch_id: stale, p_zone_id: zoneB.zone_id }, { token: user.token });
  await api(stack, 'PATCH', '/rest/v1/lot_zone_assignments?batch_id=eq.' + stale, { key: stack.service, token: stack.service, body: { assigned_at: new Date(Date.now() - 180 * 60000).toISOString() } });
  const send = (uid, token, id, minutesAgo, t, h) => rpc(stack, 'bunalens_ingest_device_reading', {
    p_device_uid: uid, p_message_id: id, p_recorded_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    p_temperature_c: t, p_temperature_unit: 'C', p_humidity_pct: h, p_humidity_unit: '%RH', p_source: 'simulated',
  }, { headers: { 'x-device-token': token } });
  const a = await send(zoneA.device_uid, zoneA.device_token, 'screen-1', 0, 22.4, 61.5);
  const b = await send(zoneB.device_uid, zoneB.device_token, 'screen-1', 95, 24.1, 68);
  console.log(JSON.stringify({ email, user_id: user.id, lots: { noZone, fresh, stale }, ingest: [a.json?.status, b.json?.status] }, null, 1));
}
