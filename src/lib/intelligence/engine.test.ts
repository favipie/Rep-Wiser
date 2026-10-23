import { describe, it, expect } from 'vitest';
import { exercises } from '../exercises';
import { blankData, perform, defaultPreferences, type Data, type Performed, type Session } from '../model';
import { recommend } from '../progression';
import { analyzeSession, classifyTrend, defaultAnalysisConfig, isComparable, knownRuleIds, ruleFor } from './index';

const ex = (name: string) => exercises.find(e => e.name === name)!;
type Row = [number, number, number | null];
function entry(name: string, rows: Row[], o: Partial<Performed> = {}): Performed {
  const p = perform(ex(name));
  return { ...p, min: 6, max: 10, required: 3, ...o, sets: rows.map(([weight, reps, rir], i) => ({ id: `${p.id}-${i}`, weight, reps, rir, done: true, warmup: false })) };
}
let n = 0;
const session = (name: string, day: number, exs: Performed[], id = `s${++n}`): Session => ({ id, name, date: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`, status: 'complete', exercises: exs });
const dataOf = (sessions: Session[]): Data => ({ ...blankData(), preferences: defaultPreferences, sessions });
const analyzeLast = (sessions: Session[]) => analyzeSession(sessions.at(-1)!, dataOf(sessions));

it('does not compare a mixed-load workout with uniform-load history', () => {
  const prior = entry('Bench press', [[30, 8, 2], [30, 8, 2], [30, 8, 2]]);
  const current = entry('Bench press', [[30, 8, 2], [35, 7, 2], [35, 6, 2]]);
  expect(isComparable(current, prior)).toBe(false);
  expect(analyzeLast([session('Push', 1, [prior]), session('Push', 2, [current])]).exercises[0].previousComparable).toBeNull();
});
it('does not let extra sets on one exercise hide missing sets on another', () => {
  const s = session('Push', 1, [entry('Bench press', [[30, 8, 2], [30, 8, 2], [30, 8, 2], [30, 8, 2]]), entry('Lateral raise', [[5, 10, 2], [5, 10, 2]])]);
  const a = analyzeLast([s]);
  expect(a.overview.completedSets).toBe(6);
  expect(a.wentWell.some(o => o.id === 'session.o1')).toBe(false);
  expect(a.needsAttention.some(o => o.id === 'session.o2')).toBe(true);
});

describe('Test 1: first-session underperformance', () => {
  const s = session('Push', 1, [entry('Bench press', [[30, 6, null], [30, 5, null], [30, 6, null]], { min: 6, max: 10 })]);
  const a = analyzeLast([s]).exercises[0];
  it('counts two sets meeting the minimum and one below', () => {
    expect(a.setsMeetingMin).toBe(2);
    expect(a.sets.filter(x => !x.meetsMin).map(x => x.index)).toEqual([2]);
  });
  it('infers no trend and does not raise load', () => {
    expect(a.trend.kind).toBe('none');
    expect(a.decision.action).toBe('maintain');
    expect(a.next.weight).toBe(30);
    expect(a.ruleId).toBe('minimum-missed');
  });
  it('writes a specific explanation instead of generic text', () => {
    expect(a.narrative).toContain('6, 5 and 6 repetitions at 30 kg');
    expect(a.narrative).toContain('2 of 3 working sets met your minimum of 6');
    expect(a.narrative).toContain('set 2 fell 1 repetition short');
    expect(a.narrative).toContain('first logged session');
    expect(a.next.immediateGoal).toContain('at least 6 sound reps on all 3 sets');
  });
  it('is limited evidence and discloses missing RIR', () => {
    expect(a.evidenceLevel).toBe('limited');
    expect(a.next.missing.join(' ')).toMatch(/RIR missing on 3 of 3/);
  });
});

describe('Test 2: successful double progression', () => {
  const s = session('Push', 2, [entry('Bench press', [[40, 12, 2], [40, 12, 2], [40, 12, 2]], { min: 8, max: 12, increment: 2.5 })]);
  const a = analyzeLast([s]).exercises[0];
  it('recommends considering 42.5 kg and explains the rule', () => {
    expect(a.decision).toMatchObject({ action: 'increase', weight: 42.5 });
    expect(a.next.weight).toBe(42.5);
    expect(a.ruleId).toBe('increase');
    expect(a.next.progression).toContain('Double progression');
    expect(a.next.immediateGoal).toContain('42.5 kg');
  });
  it('shows every progression criterion as met', () => {
    expect(a.criteria.every(c => c.status === 'met')).toBe(true);
  });
});

describe('Test 3: missing RIR', () => {
  const s = session('Push', 3, [entry('Bench press', [[40, 12, null], [40, 12, null], [40, 12, null]], { min: 8, max: 12 })]);
  const a = analyzeLast([s]).exercises[0];
  it('does not fabricate effort and holds the load with a useful target', () => {
    expect(a.rir).toEqual({ recorded: 0, of: 3, average: null });
    expect(a.decision.action).toBe('maintain');
    expect(a.next.immediateGoal).toMatch(/record RIR/i);
    expect(a.criteria.find(c => c.id === 'rir-range')!.status).toBe('unknown');
    expect(a.next.missing.join(' ')).toContain('RIR missing');
    expect(a.evidence.limitations.join(' ')).toContain('RIR');
  });
});

describe('Test 4: multiple-exercise session', () => {
  const s = session('Push', 5, [
    entry('Bench press', [[40, 8, 2], [40, 8, 2], [40, 7, 2]]),
    entry('Incline dumbbell press', [[16, 10, 2], [16, 9, 2], [16, 9, 2]], { min: 8, max: 15 }),
    entry('Lateral raise', [[8, 12, 2], [8, 12, 2], [8, 11, 2]], { min: 8, max: 15 }),
    entry('Triceps pushdown', [[25, 12, 2], [25, 11, 2], [25, 10, 2]], { min: 8, max: 15 }),
  ]);
  const r = analyzeLast([s]);
  it('analyzes each exercise and builds one plan', () => {
    expect(r.exercises.map(e => e.name)).toEqual(['Bench press', 'Incline dumbbell press', 'Lateral raise', 'Triceps pushdown']);
    expect(r.plan).toHaveLength(4);
    expect(r.overview.plannedSets).toBe(12);
    expect(r.overview.completedSets).toBe(12);
    expect(r.overview.totalReps).toBe(23 + 28 + 35 + 33);
  });
  it('attributes sets to primary muscles only and shows secondary separately', () => {
    const row = (m: string) => r.muscles.rows.find(x => x.muscle === m)!;
    expect(row('Chest').session).toBe(6);
    expect(row('Shoulders').session).toBe(3);
    expect(row('Triceps').session).toBe(3);
    expect(row('Triceps').indirectThisWeek).toBe(6);
    expect(r.muscles.convention).toMatch(/never added into the primary totals/);
  });
  it('does not invent history', () => {
    expect(r.overview.previousSession).toBeNull();
    expect(r.exercises.every(e => e.previous === null)).toBe(true);
    expect(r.overview.duration.available).toBe(false);
  });
});

describe('Test 5: repeated regression', () => {
  const mk = (rows: number[], day: number) => session('Push', day, [entry('Bench press', rows.map(r => [40, r, 2] as Row), { min: 8, max: 12 })]);
  const sessions = [mk([10, 10, 10], 1), mk([9, 9, 9], 3), mk([8, 8, 8], 5)];
  const a = analyzeLast(sessions).exercises[0];
  it('identifies the decline across comparable sessions and suggests review', () => {
    expect(a.trend.kind).toBe('declining');
    expect(a.trend.totals).toEqual([30, 27, 24]);
    expect(a.decision.action).toBe('review');
    expect(a.ruleId).toBe('decline-review');
  });
  it('lists possible contributors without diagnosing', () => {
    const o = a.observations.find(x => x.title.startsWith('Repeated decline'))!;
    expect(o.detail).toContain('not a diagnosis');
    expect(o.detail.toLowerCase()).not.toMatch(/you are (overtrained|fatigued)/);
  });
  it('does not call a single miss a decline or a plateau', () => {
    const one = analyzeLast([mk([10, 10, 10], 1), mk([6, 6, 6], 3)]).exercises[0];
    expect(['two-session']).toContain(one.trend.kind);
  });
  it('does not mix sessions at different loads', () => {
    const light = session('Push', 1, [entry('Bench press', [[20, 15, 2], [20, 15, 2], [20, 15, 2]], { min: 8, max: 12 })]);
    const a2 = analyzeLast([light, mk([9, 9, 9], 3), mk([8, 8, 8], 5)]).exercises[0];
    expect(a2.comparableSessions).toBe(2);
    expect(a2.trend.kind).toBe('two-session');
  });
});

describe('Test 6: edited historical workout', () => {
  // Built once and cloned: perform() assigns random ids, so separate builds are different records.
  const seed = [session('Push', 1, [entry('Bench press', [[40, 10, 2], [40, 10, 2], [40, 10, 2]], { min: 8, max: 12 })], 'a'), session('Push', 4, [entry('Bench press', [[40, 11, 2], [40, 11, 2], [40, 11, 2]], { min: 8, max: 12 })], 'b')];
  const base = () => structuredClone(seed);
  it('is deterministic for identical records', () => {
    expect(analyzeLast(base()).fingerprint).toBe(analyzeLast(base()).fingerprint);
  });
  it('changes fingerprint and content when an earlier workout is edited', () => {
    const before = analyzeLast(base());
    const edited = base();
    edited[0].exercises[0].sets.forEach(s => (s.reps = 12));
    const after = analyzeLast(edited);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(before.exercises[0].previousComparable!.totalReps).toBe(30);
    expect(after.exercises[0].previousComparable!.totalReps).toBe(36);
  });
  it('changes fingerprint when the session itself is edited', () => {
    const b = base(); const f1 = analyzeSession(b[1], dataOf(b)).fingerprint;
    b[1].exercises[0].sets[0].reps = 12;
    expect(analyzeSession(b[1], dataOf(b)).fingerprint).not.toBe(f1);
  });
});

describe('data quality and edge cases', () => {
  it('handles variable working weights without a false comparison', () => {
    const a = analyzeLast([session('Push', 1, [entry('Bench press', [[40, 8, 2], [42.5, 7, 2], [40, 8, 2]])])]).exercises[0];
    expect(a.ruleId).toBe('mixed-loads');
    expect(a.next.weight).toBe(40);
    expect(a.observations.some(o => o.title.includes('varied'))).toBe(true);
  });
  it('handles incomplete sets and excludes them', () => {
    const e = entry('Bench press', [[40, 8, 2], [40, 8, 2], [40, 8, 2]]); e.sets[2].done = false;
    const r = analyzeLast([session('Push', 1, [e])]);
    expect(r.exercises[0].completed).toBe(2);
    expect(r.exercises[0].notCompleted).toBe(1);
    expect(r.exercises[0].ruleId).toBe('incomplete-sets');
    expect(r.overview.countedTowardPlan).toBe(2);
    expect(r.needsAttention.some(o => o.id === 'session.o2')).toBe(true);
  });
  it('excludes bodyweight-only work from external-load volume and says so', () => {
    const r = analyzeLast([session('Pull', 1, [entry('Pull-up', [[0, 8, 2], [0, 7, 2], [0, 6, 2]], { min: 5, max: 10, increment: 0 }), entry('Barbell row', [[50, 8, 2], [50, 8, 2], [50, 8, 2]])])]);
    expect(r.overview.volume.value).toBe(1200);
    expect(r.overview.volume.excluded).toEqual(['Pull-up']);
    expect(r.exercises[0].loadKind).toBe('bodyweight');
    expect(r.exercises[0].estimated1RM).toBeNull();
  });
  it('never labels a load or rep record on a first session', () => {
    const a = analyzeLast([session('Push', 1, [entry('Bench press', [[40, 8, 2], [40, 8, 2], [40, 8, 2]])])]);
    expect(a.exercises[0].records).toMatchObject({ load: false, reps: false, baseline: true });
    expect(a.overview.prCount).toBe(0);
  });
  it('detects a load record only against logged history', () => {
    const a = analyzeLast([session('Push', 1, [entry('Bench press', [[40, 8, 2], [40, 8, 2], [40, 8, 2]])]), session('Push', 4, [entry('Bench press', [[42.5, 8, 2], [42.5, 8, 2], [42.5, 8, 2]])])]);
    expect(a.exercises[0].records.load).toBe(true);
    expect(a.overview.prCount).toBe(1);
  });
  it('compares to the previous same-named session only', () => {
    const r = analyzeLast([session('Pull', 1, [entry('Barbell row', [[50, 8, 2]])]), session('Push', 4, [entry('Bench press', [[40, 8, 2]])])]);
    expect(r.overview.previousSession).toBeNull();
    expect(r.overview.comparisonNote).toMatch(/No earlier session/);
  });
  it('does not flag a plateau until enough comparable sessions exist', () => {
    const mk = (d: number) => session('Push', d, [entry('Bench press', [[40, 9, 2], [40, 9, 2], [40, 9, 2]], { min: 8, max: 12 })]);
    expect(analyzeLast([mk(1), mk(3), mk(5)]).exercises[0].trend.kind).toBe('mixed');
    expect(analyzeLast([mk(1), mk(3), mk(5), mk(7)]).exercises[0].trend.kind).toBe('possible-plateau');
  });
  it('raises evidence with more comparable sessions and lowers it for missing RIR', () => {
    const mk = (d: number, rir: number | null) => session('Push', d, [entry('Bench press', [[40, 9 + (d % 2), rir], [40, 9, rir], [40, 9, rir]], { min: 8, max: 12 })]);
    expect(analyzeLast([mk(1, 2), mk(3, 2), mk(5, 2), mk(7, 2)]).exercises[0].evidenceLevel).toBe('stronger');
    expect(analyzeLast([mk(1, 2), mk(3, 2), mk(5, 2), mk(7, null)]).exercises[0].evidenceLevel).toBe('moderate');
    expect(analyzeLast([mk(1, 2), mk(3, 2), mk(5, null)]).exercises[0].evidenceLevel).toBe('limited');
  });
  it('prioritizes caution when pain is reported', () => {
    const a = analyzeLast([session('Push', 1, [entry('Bench press', [[40, 12, 2], [40, 12, 2], [40, 12, 2]], { min: 8, max: 12, pain: true })])]).exercises[0];
    expect(a.decision.action).toBe('review');
    expect(a.next.immediateGoal).toMatch(/Do not add load/);
    expect(a.next.immediateGoal).not.toMatch(/diagnos|injur/i);
  });
  it('analyzes a session with no completed working sets without throwing', () => {
    const e = entry('Bench press', [[40, 8, 2]]); e.sets[0].done = false;
    const r = analyzeLast([session('Push', 1, [e])]);
    expect(r.exercises[0].narrative).toContain('No completed working sets');
    expect(r.exercises[0].next.weight).toBeNull();
  });
  it('converts displayed units without changing stored kg', () => {
    const s = session('Push', 1, [entry('Bench press', [[40, 8, 2], [40, 8, 2], [40, 8, 2]])]);
    const r = analyzeSession(s, { ...dataOf([s]), preferences: { ...defaultPreferences, units: 'lb' } });
    expect(r.exercises[0].narrative).toContain('88.18 lb');
    expect(r.exercises[0].topWeight).toBe(40);
  });
});

describe('consistency with the existing progression engine', () => {
  const scenarios: { label: string; cur: Performed; hist: Performed[] }[] = [];
  const e = (rows: Row[], o: Partial<Performed> = {}) => entry('Bench press', rows, { min: 8, max: 12, ...o });
  const t = (reps: number[], rir: number | null = 2, o: Partial<Performed> = {}) => e(reps.map(r => [40, r, rir] as Row), o);
  scenarios.push({ label: 'increase', cur: t([12, 12, 12]), hist: [] }, { label: 'partial', cur: t([12, 11, 12]), hist: [] }, { label: 'miss', cur: t([7, 7, 7]), hist: [] },
    { label: 'decline', cur: t([8, 8, 8]), hist: [t([10, 10, 10]), t([9, 9, 9])] }, { label: 'no increment', cur: t([12, 12, 12], 2, { increment: 0 }), hist: [] },
    { label: 'no rir', cur: t([12, 12, 12], null), hist: [] }, { label: 'rir high', cur: t([12, 12, 12], 0), hist: [] }, { label: 'override', cur: t([12, 12, 12], 2, { override: 41 }), hist: [] },
    { label: 'pain', cur: t([12, 12, 12], 2, { pain: true }), hist: [] }, { label: 'technique', cur: t([12, 12, 12], 2, { technique: false }), hist: [] },
    { label: 'mixed', cur: e([[40, 12, 2], [35, 12, 2], [40, 12, 2]]), hist: [] }, { label: 'smaller', cur: (() => { const c = t([7, 7, 7]); c.sets.forEach(s => (s.weight = 45)); c.increment = 1; return c; })(), hist: [t([12, 12, 12])] },
    { label: 'build', cur: t([10, 10, 10]), hist: [t([9, 9, 9])] });
  for (const sc of scenarios) {
    it(`never disagrees with recommend(): ${sc.label}`, () => {
      const s = session('X', 20, [sc.cur], `cur-${sc.label}`);
      const prior = sc.hist.map((h, i) => session('X', 1 + i * 2, [h], `h-${sc.label}-${i}`));
      const r = analyzeSession(s, dataOf([...prior, s])).exercises[0];
      const direct = recommend(sc.cur, sc.hist, defaultPreferences);
      expect(r.decision).toEqual(direct);
      expect(r.next.action).toBe(direct.action);
      expect(knownRuleIds).toContain(r.ruleId);
      expect(ruleFor(direct.reason).id).toBe(r.ruleId);
    });
  }
  it('criteria are all met exactly when the engine recommends an increase', () => {
    for (const sc of scenarios.filter(x => !['override', 'smaller', 'decline'].includes(x.label))) {
      const s = session('X', 20, [sc.cur], `k-${sc.label}`);
      const a = analyzeSession(s, dataOf([s])).exercises[0];
      expect(a.criteria.every(c => c.status === 'met'), sc.label).toBe(a.decision.action === 'increase');
    }
  });
  it('shares recommend()’s comparability rule', () => {
    expect(isComparable(t([8, 8, 8]), t([10, 10, 10]))).toBe(true);
    expect(isComparable(t([8, 8, 8]), t([10, 10], 2))).toBe(false);
    expect(isComparable(t([8, 8, 8]), e([[35, 10, 2], [35, 10, 2], [35, 10, 2]]))).toBe(false);
    expect(isComparable(t([8, 8, 8]), t([10, 10, 10], 2, { max: 15 }))).toBe(false);
  });
});

describe('trend classifier', () => {
  const it3 = (totals: number[], below = false) => totals.map((total, i) => ({ date: `2026-10-0${i + 1}`, total, belowMin: below }));
  it('reports a repeated minimum miss as decline', () => expect(classifyTrend(it3([20, 21, 22], true), defaultAnalysisConfig).kind).toBe('declining'));
  it('calls rising totals improving', () => expect(classifyTrend(it3([24, 26, 28]), defaultAnalysisConfig).kind).toBe('improving'));
  it('is configurable', () => expect(classifyTrend(it3([24, 26]), { ...defaultAnalysisConfig, trendSessions: 2 }).kind).toBe('improving'));
});
