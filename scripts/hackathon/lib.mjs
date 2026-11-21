// Shared helpers for the hackathon sprint scripts.
// These scripts only talk to the LOCAL Supabase test stack and refuse any
// other URL. Secrets are read from the ignored .env.backend file and are
// never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envPath = path.join(root, '.env.backend');

export function loadEnv() {
  const out = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) out[match[1]] = match[2];
    }
  }
  return out;
}

export function saveEnv(key, value) {
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const index = lines.findIndex((line) => line.startsWith(key + '='));
  if (index >= 0) lines[index] = key + '=' + value;
  else lines.push(key + '=' + value);
  fs.writeFileSync(envPath, lines.join('\n').replace(/\n+$/, '') + '\n', 'ascii');
}

export function localStack() {
  const env = loadEnv();
  const url = env.BUNALENS_TEST_SUPABASE_URL;
  const anon = env.BUNALENS_TEST_SUPABASE_ANON_KEY;
  const service = env.BUNALENS_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) throw new Error('Set BUNALENS_TEST_SUPABASE_URL and BUNALENS_TEST_SUPABASE_ANON_KEY in .env.backend');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
    throw new Error('Refusing to run: BUNALENS_TEST_SUPABASE_URL must be a local test stack.');
  }
  return { env, url, anon, service };
}

export async function api(stack, method, pathname, { key, token, body, headers } = {}) {
  const response = await fetch(stack.url + pathname, {
    method,
    headers: {
      apikey: key || stack.anon,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: response.status, json, text };
}

// Signs in a demo account on the local stack, creating it on first use. The
// generated password is stored in .env.backend under passwordKey.
export async function ensureUser(stack, email, passwordKey) {
  let password = loadEnv()[passwordKey];
  if (password) {
    const signIn = await api(stack, 'POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
    if (signIn.status === 200) return { token: signIn.json.access_token, id: signIn.json.user.id, email };
  }
  password = crypto.randomBytes(18).toString('base64url');
  const signUp = await api(stack, 'POST', '/auth/v1/signup', { body: { email, password } });
  if (signUp.status !== 200 || !signUp.json?.access_token) {
    throw new Error('Could not sign in or create ' + email + ' (HTTP ' + signUp.status + '). If the account exists, set ' + passwordKey + ' in .env.backend.');
  }
  saveEnv(passwordKey, password);
  return { token: signUp.json.access_token, id: signUp.json.user.id, email };
}

export async function ensureStation(stack, user, name, woreda) {
  const existing = await api(stack, 'GET', '/rest/v1/stations?select=id&owner_id=eq.' + user.id, { token: user.token });
  if (existing.json?.length) return existing.json[0].id;
  const created = await api(stack, 'POST', '/rest/v1/stations?select=id', {
    token: user.token,
    headers: { Prefer: 'return=representation' },
    body: { owner_id: user.id, station_name: name, name, owner_name: 'Demo operator', manager: 'Demo operator', woreda, email: user.email },
  });
  if (created.status !== 201) throw new Error('Could not create station: HTTP ' + created.status + ' ' + created.text);
  return created.json[0].id;
}

export const rpc = (stack, name, body, options = {}) =>
  api(stack, 'POST', '/rest/v1/rpc/' + name, { ...options, body });
