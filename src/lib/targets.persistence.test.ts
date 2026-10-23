import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankData, defaultPreferences, perform, uid, type Session } from './model';
import { exercises } from './exercises';
import { applyToExercise, completeTargets, contextFor, decideTarget, listTargets } from './targets';

beforeEach(() => {
  const records = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => records.get(k) ?? null, setItem: (k: string, v: string) => records.set(k, v) });
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, callback: () => Promise<void>) => callback() } });
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const e = perform(exercises[0]); e.sets.forEach(s => { s.weight = 30; s.reps = 8; s.done = true; });
  const source: Session = { id: uid(), name: 'Workout', date: '2026-10-20T12:00:00Z', status: 'complete', exercises: [e] };
  const data = { ...blankData(), preferences: defaultPreferences, sessions: [source] };
  const ctx = await contextFor('guest', source, e.id);
  const t = await decideTarget('guest', data, source, e.id, ctx, 'modified', {}, { weight: 32.5, min: 6, max: 10, sets: 3 }, null);
  return { data, source, e, ctx, t };
}
it('persists a device decision, applies it to a subsequent workout, and safely retries', async () => {
  const { data, e, t } = await fixture();
  expect((await listTargets('guest'))[0].weight_kg).toBe(32.5);
  const draft = { ...e, id: uid(), sets: e.sets.map(s => ({ ...s, id: uid(), done: false })) };
  const next: Session = { id: uid(), name: 'Next', date: '2026-10-21T12:00:00Z', status: 'complete', exercises: [applyToExercise(draft, t)] };
  data.sessions.push(next); await completeTargets('guest', data); await completeTargets('guest', data);
  expect((await listTargets('guest'))[0]).toMatchObject({ status: 'applied', applied_session_id: next.id });
});
it('preserves device history when rejecting an earlier choice', async () => {
  const { data, source, e, ctx, t } = await fixture();
  await decideTarget('guest', data, source, e.id, ctx, 'rejected', {}, { weight: 0, min: 1, max: 1, sets: 1 }, t.id);
  expect((await listTargets('guest')).map(t => t.status)).toEqual(['rejected', 'superseded']);
});
it('reports storage failure without claiming a decision was saved', async () => {
  const { data, source, e, ctx, t } = await fixture();
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  await expect(decideTarget('guest', data, source, e.id, ctx, 'accepted', {}, { weight: 35, min: 6, max: 10, sets: 3 }, t.id)).rejects.toThrow('Storage full');
  expect((await listTargets('guest'))[0].id).toBe(t.id);
});
it('does not consume a target in its source workout', async () => {
  const { data, e, t } = await fixture(); e.targetId = t.id; e.targetWeight = 32.5;
  await expect(completeTargets('guest', data)).rejects.toThrow('subsequent workout');
  expect((await listTargets('guest'))[0].status).toBe('modified');
});
