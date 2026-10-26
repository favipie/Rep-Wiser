import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const config = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.API_URL).hostname), 'Refusing remote database');
const client = key => createClient(config.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = client(config.SERVICE_ROLE_KEY), anon = client(config.ANON_KEY);
const users = [];
async function actor() {
  const email = `coach-${randomUUID()}@example.test`, password = `${randomUUID()}Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(created.error, null);
  const id = created.data.user.id; users.push(id); const c = client(config.ANON_KEY); assert.equal((await c.auth.signInWithPassword({ email, password })).error, null); return { id, c };
}
try {
  const a = await actor(), b = await actor();
  for (const c of [anon, a.c]) {
    assert((await c.rpc('reserve_coach_request', { p_user: b.id })).error, 'Clients must not reserve quota');
    assert((await c.from('coach_usage').select('*')).error, 'Clients must not read quota');
    assert((await c.from('coach_usage').insert({ bucket: 'forged', requests: 0, expires_at: new Date().toISOString() })).error, 'Clients must not alter quota');
  }
  // All requests must be inside one minute to assert the minute cap deterministically.
  const offset = Date.now() % 60000;
  if (offset > 45000) await new Promise(resolve => setTimeout(resolve, 60500 - offset));
  const start = Math.floor(Date.now() / 60000);
  const results = await Promise.all(Array.from({ length: 20 }, () => admin.rpc('reserve_coach_request', { p_user: a.id })));
  assert.equal(Math.floor(Date.now() / 60000), start, 'Test crossed a minute boundary; rerun');
  results.forEach(r => assert.equal(r.error, null)); assert.equal(results.filter(r => r.data).length, 5, 'Concurrent requests respect quota');
  const independent = await admin.rpc('reserve_coach_request', { p_user: b.id }); assert.equal(independent.error, null); assert.equal(independent.data, true);
  assert.equal((await admin.rpc('reserve_coach_request', { p_user: randomUUID() })).data, false);
  console.log('Coach quota: real Auth/PostgREST permissions, identity and 20-way concurrency passed.');
} finally { for (const id of users) await admin.auth.admin.deleteUser(id); }
