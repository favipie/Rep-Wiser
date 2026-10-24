import { describe, it, expect } from 'vitest';
import { exercises } from '../exercises';
import { blankData, perform, type Performed, type Session, type Template } from '../model';
import { buildPlanTracker, dayKey } from './planned';

const today = new Date(2026, 9, 22, 12);
const at = (daysAgo: number) => new Date(2026, 9, 22 - daysAgo, 12).toISOString();
const entry = (name: string, reps: number[], o: Partial<Performed> = {}): Performed => {
  const p = perform(exercises.find(e => e.name === name)!);
  return { ...p, min: 6, max: 10, required: 3, ...o, sets: reps.map((r, i) => ({ id: `${p.id}${i}`, weight: 40, reps: r, rir: 2, done: true, warmup: false })) };
};
const sess = (daysAgo: number, exs: Performed[], status: Session['status'] = 'complete'): Session => ({ id: `s${daysAgo}${exs.length}`, name: 'Push', date: at(daysAgo), status, exercises: exs });

describe('plan vs achieved tracker', () => {
  it('compares planned sets and rep ranges with logged work per day', () => {
    const r = buildPlanTracker({ ...blankData(), sessions: [sess(1, [entry('Bench press', [8, 7, 6]), entry('Lateral raise', [12, 12], { min: 8, max: 15 })])] }, today, 7);
    const d = r.days.find(x => x.date === dayKey(new Date(2026, 9, 21)))!;
    expect(d.plannedSets).toBe(6);
    expect(d.achievedSets).toBe(5);
    expect(d.plannedRepsMin).toBe(3 * 6 + 3 * 8);
    expect(d.plannedRepsMax).toBe(3 * 10 + 3 * 15);
    expect(d.achievedReps).toBe(21 + 24);
    expect(d.status).toBe('partial');
    expect(d.activities.map(a => a.status)).toEqual(['met', 'partial']);
    expect(d.setAdherence).toBe(83);
  });
  it('marks a fully met day completed and does not count extra sets toward adherence', () => {
    const r = buildPlanTracker({ ...blankData(), sessions: [sess(0, [entry('Bench press', [8, 8, 8, 8])])] }, today, 3);
    const d = r.days[0];
    expect(d.status).toBe('completed');
    expect(d.achievedSets).toBe(4);
    expect(d.countedSets).toBe(3);
    expect(d.setAdherence).toBe(100);
  });
  it('flags a below-minimum set as partial even when all sets were done', () => {
    const r = buildPlanTracker({ ...blankData(), sessions: [sess(0, [entry('Bench press', [8, 5, 8])])] }, today, 1);
    expect(r.days[0].activities[0]).toMatchObject({ status: 'partial', setsMeetingMin: 2 });
  });
  it('treats a scheduled day with no workout as missed, using the template and saying so', () => {
    const tpl: Template = { id: 't', name: 'Pull', days: [new Date(2026, 9, 20).getDay()], exercises: [entry('Barbell row', [])] };
    const r = buildPlanTracker({ ...blankData(), templates: [tpl] }, today, 5);
    const d = r.days.find(x => x.date === dayKey(new Date(2026, 9, 20)))!;
    expect(d).toMatchObject({ status: 'missed', plannedFromTemplate: true, templateName: 'Pull', achievedSets: 0, plannedSets: 3 });
    expect(r.summary.scheduledDaysMissed).toBe(1);
    expect(r.summary.setAdherence).toBe(0);
  });
  it('does not penalize today or future scheduled days, or invent plans for rest days', () => {
    const tpl: Template = { id: 't', name: 'Pull', days: [today.getDay()], exercises: [entry('Barbell row', [])] };
    const r = buildPlanTracker({ ...blankData(), templates: [tpl] }, today, 2);
    expect(r.days[0].status).toBe('scheduled');
    expect(r.days[1].status).toBe('rest');
    expect(r.days[1].plannedSets).toBe(0);
    expect(r.summary.scheduledDaysMissed).toBe(0);
    expect(r.summary.setAdherence).toBeNull();
  });
  it('keeps drafts out of adherence and combines two sessions on one day', () => {
    const r = buildPlanTracker({ ...blankData(), sessions: [sess(0, [entry('Bench press', [8, 8, 8])]), { ...sess(0, [entry('Barbell row', [8, 8, 8])]), id: 'second' }, sess(2, [entry('Bench press', [8])], 'draft')] }, today, 4);
    expect(r.days[0].activities).toHaveLength(2);
    expect(r.days[2].status).toBe('draft');
    expect(r.summary.plannedSets).toBe(6);
  });
  it('excludes warm-ups and uncompleted sets from achieved work', () => {
    const e = entry('Bench press', [8, 8, 8]); e.sets.push({ ...e.sets[0], id: 'w', warmup: true, reps: 12 }); e.sets[2].done = false;
    const a = buildPlanTracker({ ...blankData(), sessions: [sess(0, [e])] }, today, 1).days[0].activities[0];
    expect(a.achievedSets).toBe(2);
    expect(a.achievedReps).toBe(16);
  });
});
