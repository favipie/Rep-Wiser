import { describe, it, expect } from 'vitest';
import { applyToExercise, appendDecision, localContext, staleReason, prescriptionSchema, type Target } from './targets';
import { blankData, defaultPreferences, perform, type Data, type Session } from './model';
import { exercises } from './exercises';
import { ENGINE_VERSION } from './intelligence/config';

function fixture() {
  const e = perform(exercises[0]); e.sets.forEach(s => { s.weight = 30; s.reps = 8; s.done = true; });
  const source: Session = { id: 'source', name: 'Workout', date: '2026-10-20T12:00:00.000Z', status: 'complete', exercises: [e] };
  const data: Data = { ...blankData(), preferences: { ...defaultPreferences }, sessions: [source] };
  const t: Target = { id: 'target', exercise_id: e.exerciseId, source_session_id: source.id, source_performed_id: e.id, analysis_fingerprint: 'server-context', engine_version: ENGINE_VERSION, status: 'modified', suggested: { _localContext: localContext(data, source.id, e.id) }, weight_kg: 32.5, rep_min: 6, rep_max: 10, sets: 3, decided_at: new Date().toISOString() };
  return { data, source, e, t };
}
describe('saved target workflow', () => {
  it('applies a user-modified prescription without marking sets complete or inventing RIR', () => {
    const { e, t } = fixture(); e.sets.forEach(s => { s.done = false; });
    const applied = applyToExercise(e, t);
    expect(applied).toMatchObject({ targetId: t.id, min: 6, max: 10, required: 3 });
    expect(applied.sets.every(s => s.weight === 32.5 && !s.done && s.rir === null && s.reps === 0)).toBe(true);
    expect(e.sets[0].weight).toBe(30);
  });
  it('never overwrites logged sets', () => { const { e, t } = fixture(); expect(() => applyToExercise(e, t)).toThrow(); });
  it('does not apply another exercise’s target', () => { const { e, t } = fixture(); e.exerciseId = 'different'; expect(() => applyToExercise(e, t)).toThrow(); });
  it('rejects inactive targets', () => { const { e, t } = fixture(); t.status = 'superseded'; expect(() => applyToExercise(e, t)).toThrow(); });
  it('validates weights, ranges and integer set counts', () => {
    for (const p of [{ weight: -1, min: 6, max: 10, sets: 3 }, { weight: 30, min: 10, max: 6, sets: 3 }, { weight: 30, min: 6, max: 10, sets: 2.5 }, { weight: NaN, min: 6, max: 10, sets: 3 }]) expect(prescriptionSchema.safeParse(p).success).toBe(false);
  });
  it('keeps history while replacing an active decision', () => {
    const { t } = fixture(); const next = { ...t, id: 'new', weight_kg: 35 };
    const result = appendDecision([t], next, t.id);
    expect(result.map(t => t.status)).toEqual(['modified', 'superseded']); expect(result[1].weight_kg).toBe(32.5); expect(t.status).toBe('modified');
  });
  it('rejects conflicting concurrent decisions', () => {
    const { t } = fixture(); const a = appendDecision([], t, null);
    expect(() => appendDecision(a, { ...t, id: 'second' }, null)).toThrow('Another decision');
  });
  it('rejection retires an accepted target but preserves its record', () => {
    const { t } = fixture(); const result = appendDecision([t], { ...t, id: 'reject', status: 'rejected' }, t.id);
    expect(result.map(t => t.status)).toEqual(['rejected', 'superseded']);
  });
  it('accepts unchanged source data after JSON persistence', () => { const { data, t } = fixture(); expect(staleReason(t, JSON.parse(JSON.stringify(data)))).toBeNull(); });
  it('is stable across object key order and equivalent timestamp serialization', () => {
    const { data, t } = fixture(); const e = data.sessions[0].exercises[0];
    data.sessions[0].exercises[0] = { ...e, sets: e.sets.map(s => ({ warmup: s.warmup, done: s.done, rir: s.rir, reps: s.reps, weight: s.weight, id: s.id })) };
    data.sessions[0].date = '2026-10-20T12:00:00+00:00'; expect(staleReason(t, data)).toBeNull();
  });
  it('invalidates an edited source workout', () => { const { data, t, e } = fixture(); e.sets[0].reps++; expect(staleReason(t, data)).toContain('changed'); });
  it('invalidates a deleted or reopened source', () => { const { data, t, source } = fixture(); source.status = 'draft'; expect(staleReason(t, data)).toBeTruthy(); data.sessions = []; expect(staleReason(t, data)).toBeTruthy(); });
  it('invalidates preferences and engine updates', () => { const { data, t } = fixture(); data.preferences!.rirMin++; expect(staleReason(t, data)).toBeTruthy(); expect(staleReason({ ...t, engine_version: 'old' }, fixture().data)).toBeTruthy(); });
  it('ignores unrelated exercise edits', () => { const { data, t, source } = fixture(); source.exercises.push(perform(exercises[1])); expect(staleReason(t, data)).toBeNull(); });
  it('invalidates when a later workout exists, except the destination being completed', () => {
    const { data, t, source } = fixture(); data.sessions.push({ ...source, id: 'next', date: '2026-10-21T12:00:00.000Z' });
    expect(staleReason(t, data)).toContain('newer'); expect(staleReason(t, data, 'next')).toBeNull();
  });
  it('ignores new drafts', () => { const { data, t, source } = fixture(); data.sessions.push({ ...source, id: 'draft', status: 'draft', date: '2026-10-21T12:00:00.000Z' }); expect(staleReason(t, data)).toBeNull(); });
  it('invalidates when earlier exercise history changes', () => {
    const { data, t, source } = fixture(); data.sessions.push({ ...source, id: 'prior', date: '2026-10-19T12:00:00.000Z' }); expect(staleReason(t, data)).toBeTruthy();
  });
});
