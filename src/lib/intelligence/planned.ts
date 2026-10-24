import { working, type Data, type Performed, type Session } from '../model';

/**
 * Plan vs. achieved, per calendar day.
 *
 * "Planned" is what the workout itself prescribed: each exercise's planned working sets and its rep range.
 * "Achieved" is what was logged: completed non-warm-up sets and their reps. Both come from stored records;
 * nothing is estimated. Scheduled days with no logged workout use the template's *current* prescription
 * (REPWISE does not store past template versions) and are marked as such.
 */
export type ActivityStatus = 'met' | 'partial' | 'not-done' | 'scheduled';
export type Activity = {
  name: string; muscle: string; source: 'session' | 'template';
  plannedSets: number; achievedSets: number; countedSets: number;
  repMin: number; repMax: number; plannedRepsMin: number; plannedRepsMax: number;
  achievedReps: number; setsMeetingMin: number; sets: { weight: number; reps: number }[];
  status: ActivityStatus;
};
export type DayStatus = 'completed' | 'partial' | 'draft' | 'missed' | 'scheduled' | 'rest';
export type DayRecord = {
  date: string; weekday: number; status: DayStatus;
  sessions: { id: string; name: string; status: 'draft' | 'complete' }[];
  templateName: string | null; plannedFromTemplate: boolean;
  activities: Activity[];
  plannedSets: number; achievedSets: number; countedSets: number;
  plannedRepsMin: number; plannedRepsMax: number; achievedReps: number;
  setAdherence: number | null;
};
export type PlanSummary = {
  days: number; daysWithPlan: number; daysTrained: number; scheduledDaysMissed: number;
  plannedSets: number; countedSets: number; achievedSets: number; setAdherence: number | null;
  plannedRepsMin: number; plannedRepsMax: number; achievedReps: number;
};

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function activityFrom(e: Performed, source: Activity['source']): Activity {
  const sets = source === 'session' ? working(e) : [];
  const countedSets = Math.min(sets.length, e.required);
  const meeting = sets.filter(s => s.reps >= e.min).length;
  const status: ActivityStatus = source === 'template' ? 'scheduled' : sets.length >= e.required && meeting === sets.length ? 'met' : 'partial';
  return { name: e.name, muscle: e.muscle, source, plannedSets: e.required, achievedSets: sets.length, countedSets, repMin: e.min, repMax: e.max,
    plannedRepsMin: e.required * e.min, plannedRepsMax: e.required * e.max, achievedReps: sets.reduce((n, s) => n + s.reps, 0), setsMeetingMin: meeting,
    sets: sets.map(s => ({ weight: s.weight, reps: s.reps })), status };
}

export function buildPlanTracker(data: Pick<Data, 'sessions' | 'templates'>, today: Date, days: number): { days: DayRecord[]; summary: PlanSummary } {
  const todayKey = dayKey(today);
  const sessionsByDay = new Map<string, Session[]>();
  data.sessions.forEach(s => { const k = dayKey(new Date(s.date)); sessionsByDay.set(k, [...(sessionsByDay.get(k) ?? []), s]); });
  const records: DayRecord[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(d);
    const sessions = sessionsByDay.get(key) ?? [];
    const template = data.templates.find(t => t.days.includes(d.getDay())) ?? null;
    let activities: Activity[] = [];
    let status: DayStatus;
    let fromTemplate = false;
    if (sessions.length) {
      activities = sessions.flatMap(s => s.exercises.map(e => activityFrom(e, 'session')));
      const complete = sessions.some(s => s.status === 'complete');
      const full = activities.length > 0 && activities.every(a => a.status === 'met');
      status = !complete ? 'draft' : full ? 'completed' : 'partial';
    } else if (template) {
      fromTemplate = true;
      activities = template.exercises.map(e => activityFrom(e, 'template'));
      status = key < todayKey ? 'missed' : 'scheduled';
      if (key < todayKey) activities = activities.map(a => ({ ...a, status: 'not-done' as const }));
    } else status = 'rest';
    const sum = (f: (a: Activity) => number) => activities.reduce((n, a) => n + f(a), 0);
    const plannedSets = sum(a => a.plannedSets), countedSets = sum(a => a.countedSets);
    records.push({ date: key, weekday: d.getDay(), status, sessions: sessions.map(s => ({ id: s.id, name: s.name, status: s.status })), templateName: fromTemplate ? template!.name : null,
      plannedFromTemplate: fromTemplate, activities, plannedSets, achievedSets: sum(a => a.achievedSets), countedSets, plannedRepsMin: sum(a => a.plannedRepsMin),
      plannedRepsMax: sum(a => a.plannedRepsMax), achievedReps: sum(a => a.achievedReps), setAdherence: plannedSets ? Math.round((countedSets / plannedSets) * 100) : null });
  }
  // Adherence compares what was planned on days that are over or being trained; future scheduled days are excluded.
  const counted = records.filter(r => r.status !== 'rest' && r.status !== 'scheduled' && r.status !== 'draft');
  const planned = counted.reduce((n, r) => n + r.plannedSets, 0);
  const hit = counted.reduce((n, r) => n + r.countedSets, 0);
  return { days: records, summary: {
    days, daysWithPlan: counted.length, daysTrained: records.filter(r => r.status === 'completed' || r.status === 'partial').length, scheduledDaysMissed: records.filter(r => r.status === 'missed').length,
    plannedSets: planned, countedSets: hit, achievedSets: counted.reduce((n, r) => n + r.achievedSets, 0), setAdherence: planned ? Math.round((hit / planned) * 100) : null,
    plannedRepsMin: counted.reduce((n, r) => n + r.plannedRepsMin, 0), plannedRepsMax: counted.reduce((n, r) => n + r.plannedRepsMax, 0), achievedReps: counted.reduce((n, r) => n + r.achievedReps, 0) } };
}
