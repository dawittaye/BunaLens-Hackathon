// Replays the labelled SIMULATED device fixture through the same HTTP
// ingestion path an ESP32 uses:
//   POST /rest/v1/rpc/bunalens_ingest_device_reading
//   headers: apikey (public key), x-device-token (device secret)
//
// Usage:
//   node scripts/hackathon/replay-device-reading.mjs
//   node scripts/hackathon/replay-device-reading.mjs --message-id sim-zone-a-000002
//
// Running it twice with the same message id must report "duplicate" the
// second time. Run verify-device-ingestion.mjs once first; it creates the demo
// zone and device and stores the device token in .env.backend.
import fs from 'node:fs';
import path from 'node:path';
import { localStack, rpc, root } from './lib.mjs';

const stack = localStack();
const token = stack.env.BUNALENS_DEMO_DEVICE_TOKEN;
if (!token) {
  console.error('BUNALENS_DEMO_DEVICE_TOKEN is not set. Run: node scripts/hackathon/verify-device-ingestion.mjs');
  process.exit(1);
}

const fixturePath = path.join(root, 'supabase', 'fixtures', 'device', 'simulated_reading.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const payload = Object.fromEntries(Object.entries(fixture).filter(([key]) => !key.startsWith('_')));
const argIndex = process.argv.indexOf('--message-id');
if (argIndex > 0 && process.argv[argIndex + 1]) payload.p_message_id = process.argv[argIndex + 1];
if (payload.p_recorded_at === 'NOW') payload.p_recorded_at = new Date().toISOString();

console.log('SIMULATED fixture: ' + fixture._label);
console.log('Sending message ' + payload.p_message_id + ' from device ' + payload.p_device_uid + ' captured at ' + payload.p_recorded_at);
const result = await rpc(stack, 'bunalens_ingest_device_reading', payload, { headers: { 'x-device-token': token } });
console.log('HTTP ' + result.status + ' ' + JSON.stringify(result.json ?? result.text));
process.exitCode = result.status === 200 ? 0 : 1;
