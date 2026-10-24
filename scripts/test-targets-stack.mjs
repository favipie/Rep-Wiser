// Real GoTrue + PostgREST + PostgreSQL tests. Refuses non-local endpoints.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const config = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = new URL(config.API_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Tests refuse remote databases');
const client = key => createClient(url.href, key, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = client(config.SERVICE_ROLE_KEY), anon = client(config.ANON_KEY);
const users = [];
let checks = 0;
function ok(result, label) { assert.equal(result.error, null, `${label}: ${result.error?.message}`); checks++; return result.data; }
function denied(result, label, code) { assert(result.error, `${label}: unexpectedly succeeded`); if (code) assert.equal(result.error.code, code, label); checks++; }
async function actor() {
  const email = `target-test-${randomUUID()}@example.test`, password = randomUUID() + 'Aa1!';
  const u = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create disposable user').user;
  users.push(u.id); const c = client(config.ANON_KEY); ok(await c.auth.signInWithPassword({ email, password }), 'authenticate real JWT'); return { c, id: u.id };
}
const exercise = () => ({ id: randomUUID(), exerciseId: 'bench', name: 'Bench', muscle: 'Chest', min: 6, max: 10, required: 3, increment: 2.5, pain: false, technique: true, override: null, notes: '', sets: Array.from({ length: 3 }, () => ({ id: randomUUID(), weight: 30, reps: 8, rir: 2, done: true, warmup: false })) });
const session = () => ({ id: randomUUID(), name: 'Push', date: '2026-10-20T12:00:00Z', status: 'complete', exercises: [exercise()] });
try {
  const a = await actor(), b = await actor(); const source = session(), other = session();
  const journal = { preferences: { rirMin: 1, rirMax: 3 }, custom: [], templates: [], sessions: [source] };
  let revision = ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: 0 }), 'save source');
  ok(await b.c.rpc('save_journal', { payload: { ...journal, sessions: [other] }, expected_revision: 0 }), 'save B journal');
  const context = async () => ok(await a.c.rpc('target_context', { p_session_id: source.id, p_performed_id: source.exercises[0].id }), 'read source context');
  const args = async (expected = null) => { const ctx = await context(); return { p_id: randomUUID(), p_exercise_id: 'bench', p_source_session_id: source.id, p_source_performed_id: source.exercises[0].id, p_fingerprint: ctx.fingerprint, p_engine_version: 'wie-1.0.0', p_status: 'modified', p_suggested: { _revision: ctx.revision, _expectedActive: expected }, p_weight_kg: 32.5, p_rep_min: 6, p_rep_max: 10, p_sets: 3 }; };
  denied(await anon.rpc('target_context', { p_session_id: source.id, p_performed_id: source.exercises[0].id }), 'anonymous RPC');
  denied(await b.c.rpc('decide_target', await args()), 'cross-user source');
  denied(await a.c.rpc('decide_target', { ...await args(), p_exercise_id: 'squat' }), 'mismatched exercise', 'PT409');
  denied(await a.c.rpc('decide_target', { ...await args(), p_fingerprint: 'forged' }), 'stale fingerprint', 'PT409');
  denied(await a.c.rpc('decide_target', { ...await args(), p_rep_max: 2 }), 'invalid prescription');
  const decision = await args(); const saved = ok(await a.c.rpc('decide_target', decision), 'save modified target');
  denied(await a.c.from('next_workout_targets').update({ status: 'rejected' }).eq('id', saved.id), 'direct update');
  denied(await a.c.from('next_workout_targets').delete().eq('id', saved.id), 'direct delete');
  denied(await a.c.from('next_workout_targets').insert({ ...saved, id: randomUUID() }), 'direct insert');
  assert.deepEqual(ok(await b.c.from('next_workout_targets').select('*'), 'B read own rows'), []);
  denied(await b.c.rpc('apply_target', { p_id: saved.id, p_session_id: other.id }), 'cross-user apply');
  denied(await a.c.rpc('apply_target', { p_id: saved.id, p_session_id: other.id }), 'foreign destination');
  denied(await a.c.rpc('apply_target', { p_id: saved.id, p_session_id: source.id }), 'source as destination');
  const fingerprint = (await context()).fingerprint;
  revision = ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: revision }), 'journal resync');
  assert.equal((await context()).fingerprint, fingerprint, 'resync preserves context');
  assert.equal(ok(await a.c.from('next_workout_targets').select('*'), 'decision survives resync').length, 1);
  // Concurrent requests have one winner; stale expected-active checks reject the loser.
  const contenders = await Promise.all(Array.from({ length: 12 }, () => args(saved.id)));
  const race = await Promise.all(contenders.map(p => a.c.rpc('decide_target', p)));
  assert.equal(race.filter(r => !r.error).length, 1); assert(race.filter(r => r.error).every(r => r.error.code === 'PT409')); checks++;
  const winner = race.find(r => !r.error).data;
  denied(await a.c.rpc('decide_target', { ...await args(winner.id), p_id: winner.id }), 'immutable decision ID', 'PT409');
  const destination = session(); destination.date = '2026-10-21T12:00:00Z'; journal.sessions.push(destination);
  revision = ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: revision }), 'save subsequent workout');
  denied(await a.c.rpc('apply_target', { p_id: winner.id, p_session_id: destination.id }), 'destination without target provenance');
  Object.assign(destination.exercises[0], { targetId: winner.id, targetWeight: 32.5 });
  revision = ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: revision }), 'save selected target');
  ok(await a.c.rpc('apply_target', { p_id: winner.id, p_session_id: destination.id }), 'apply matching target');
  ok(await a.c.rpc('apply_target', { p_id: winner.id, p_session_id: destination.id }), 'idempotent apply retry');
  // Reset only this disposable user's journal; preserve decision history.
  journal.sessions = [source]; revision = ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: revision }), 'remove destination');
  const stale = ok(await a.c.rpc('decide_target', await args()), 'new decision');
  source.exercises[0].sets[0].reps = 7;
  revision = ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: revision }), 'edit source');
  denied(await a.c.rpc('apply_target', { p_id: stale.id, p_session_id: destination.id }), 'edited source invalidates target', 'PT409');
  journal.sessions = []; ok(await a.c.rpc('save_journal', { payload: journal, expected_revision: revision }), 'delete source');
  denied(await a.c.rpc('apply_target', { p_id: stale.id, p_session_id: destination.id }), 'deleted source invalidates target', 'PT409');
  assert.equal(ok(await a.c.from('next_workout_targets').select('*'), 'audit survives deleted source').length, 3);
  console.log(`Passed ${checks} real-stack checks through GoTrue and PostgREST.`);
} finally {
  for (const id of users) { const result = await admin.auth.admin.deleteUser(id); if (result.error) throw new Error('Disposable user cleanup failed: ' + result.error.message); }
}
// Rollback/reinstall only after cleaning up disposable users.
const db = new URL(config.DB_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname), 'Rollback refuses remote databases');
const sql = file => execFileSync('psql', [config.DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'pipe' });
sql('supabase/rollback/202610220001_workout_targets.down.sql');
sql('supabase/migrations/202610220001_workout_targets.sql');
assert.throws(() => sql('supabase/migrations/202610220001_workout_targets.sql'), 'duplicate migration must refuse');
console.log('Rollback, reinstall and duplicate-install refusal passed.');
