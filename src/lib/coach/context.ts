import { z } from 'zod';
import { type Data, type Session, defaultPreferences, setSchema, working } from '../model';
import { analyzeSession, isComparable } from '../intelligence';

const label = z.string().max(100);
const performed = z.object({ id: label, exerciseId: label, name: label, muscle: label, min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(200), increment: z.number().min(0).max(100), required: z.number().int().min(1).max(30), sets: z.array(setSchema.extend({ id: label })).max(30), notes: z.literal(''), pain: z.boolean(), technique: z.boolean(), override: z.number().min(0).max(1500).nullable() }).strict().refine(e => e.max >= e.min);
const preference = z.object({ goal: label, experience: label, units: z.enum(['kg', 'lb']), split: label, days: z.number().int().min(1).max(7), equipment: z.array(label).max(20), increment: z.number().min(0).max(100), rirMin: z.number().min(0).max(10), rirMax: z.number().min(0).max(10) }).strict();
const custom = z.object({ id: label, name: label, muscle: label, secondary: z.array(label).max(10), equipment: label, movement: label, min: z.number().min(1).max(100), max: z.number().min(1).max(200), increment: z.number().min(0).max(100), notes: z.literal('') }).strict();
export const snapshotSchema = z.object({
  preferences: preference,
  custom: z.array(custom).max(30),
  sessions: z.array(z.object({ id: label, name: z.literal('Workout'), date: z.string().datetime({ offset: true }), status: z.enum(['draft', 'complete']), exercises: z.array(performed).max(20) }).strict()).max(60),
  omittedSessions: z.number().int().min(0).max(100000),
}).strict();
export type CoachSnapshot = z.infer<typeof snapshotSchema>;
export type Evidence = { id: string; title: string; facts: string; guidance: string };
export type CoachContext = { scope: string; evidence: Evidence[]; limitations: string[] };

// Minimize before transmission: no notes, workout titles, account IDs or templates.
export function makeSnapshot(data: Data, focus = ''): CoachSnapshot {
  const all = data.sessions.filter(s => !focus || s.exercises.some(e => e.exerciseId === focus)).slice().sort((a, b) => b.date.localeCompare(a.date));
  const sessions = all.slice(0, 60).map(s => ({ id: s.id, name: 'Workout' as const, date: s.date, status: s.status, exercises: s.exercises.filter(e => !focus || e.exerciseId === focus).map(e => ({ id: e.id, exerciseId: e.exerciseId, name: e.name, muscle: e.muscle, min: e.min, max: e.max, increment: e.increment, required: e.required, sets: e.sets.map(s => ({ id: s.id, weight: s.weight, reps: s.reps, rir: s.rir, done: s.done, warmup: s.warmup })), notes: '' as const, pain: e.pain, technique: e.technique, override: e.override })) }));
  const snapshot = { preferences: data.preferences ?? defaultPreferences, custom: data.custom.filter(e => sessions.some(s => s.exercises.some(p => p.exerciseId === e.id))).map(e => ({ ...e, notes: '' as const })), sessions, omittedSessions: all.length - sessions.length };
  while (new TextEncoder().encode(JSON.stringify(snapshot)).length > 96000 && snapshot.sessions.length > 1) { snapshot.sessions.pop(); snapshot.omittedSessions++; }
  return snapshotSchema.parse(snapshot);
}

export function buildContext(snapshot: CoachSnapshot, now = new Date()): CoachContext {
  const sessions: Session[] = snapshot.sessions.filter(s => new Date(s.date) <= now).slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<string, Session>();
  for (const s of sessions) for (const e of s.exercises) latest.set(e.exerciseId, s);
  const evidence: Evidence[] = [];
  for (const [id, session] of [...latest].sort((a, b) => b[1].date.localeCompare(a[1].date)).slice(0, 10)) {
    const analysis = analyzeSession(session, { ...snapshot, sessions }).exercises.find(e => e.exerciseId === id)!;
    evidence.push({ id: `workout-${evidence.length + 1}`, title: `${analysis.name} · ${session.date.slice(0, 10)} · ${session.status}`, facts: analysis.narrative, guidance: analysis.next.explanation + ' ' + analysis.next.progression });
  }
  const month = now.toISOString().slice(0, 7);
  const groups = new Map<string, { name: string; entries: Session['exercises'] }>();
  for (const s of sessions.filter(s => s.status === 'complete' && s.date.slice(0, 7) === month)) for (const e of s.exercises) {
    const group = groups.get(e.exerciseId) ?? { name: e.name, entries: [] }; group.entries.push(e); groups.set(e.exerciseId, group);
  }
  const gains = [...groups.values()].flatMap(g => {
    const first = g.entries[0], last = g.entries.at(-1)!;
    if (g.entries.length < 2 || !isComparable(first, last)) return [];
    const before = working(first).reduce((n, s) => n + s.reps, 0), after = working(last).reduce((n, s) => n + s.reps, 0);
    return [{ name: g.name, before, after, delta: after - before }];
  }).sort((a, b) => b.delta - a.delta).filter(g => g.delta > 0).slice(0, 3);
  evidence.push({ id: 'month-comparison', title: `This month · ${month} (UTC)`, facts: gains.length ? gains.map(g => `${g.name}: ${g.before} → ${g.after} total reps (+${g.delta}).`).join(' ') : 'No positive, comparable first-to-last change was found in the supplied completed sessions this month.', guidance: 'Ranking uses change in total completed working reps at the same load, set count and rep range, from first to last entry this month. It is not a universal strength or muscle-growth ranking; ties are equal. Changed-load exercises are excluded.' });
  return { scope: `${sessions.length} supplied sessions; ${snapshot.omittedSessions} older matching sessions omitted. Most recent ${Math.min(10, latest.size)} exercises shown.`, evidence, limitations: ['This is a user-supplied device snapshot, not independently verified performance.', 'Sleep, rest intervals, nutrition and illness are not measured here. Reasons for a change are possibilities, not established causes.', 'Draft workouts may be incomplete. Warm-ups and unfinished sets are excluded from completed working-set calculations.', 'REPWISE progression rules are product heuristics; they are not an individualized prescription or ACSM certification.'] };
}
