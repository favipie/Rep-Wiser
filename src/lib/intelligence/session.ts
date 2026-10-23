import { working, defaultPreferences, type Data, type Exercise, type Performed, type Preferences, type Session } from '../model';
import { exercises as builtIn } from '../exercises';
import { defaultAnalysisConfig, ENGINE_VERSION, SCHEMA_VERSION, type AnalysisConfig } from './config';
import { analyzeExercise, type Prior } from './exercise';
import { fingerprint, makeFormatter, plural, round2, shortDate } from './text';
import type { ExerciseAnalysis, Fact, MuscleRow, Observation, SessionAnalysis } from './types';

export const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core'];
export const ATTRIBUTION_CONVENTION =
  'Each completed working set counts once, toward the exercise’s primary muscle only. Secondary muscles are shown separately as indirect exposure and are never added into the primary totals, so compound lifts are not counted as a full set for every muscle they involve. Warm-ups and sets not marked complete are excluded. This differs from the Analytics tab, which counts only sets with RIR ≤ 3.';

const weekStart = (iso: string) => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); };
const WEEK = 7 * 86400000;

export type AnalyzeOptions = { config?: AnalysisConfig };

/** Complete sessions (other than `session`) on or before its date, oldest first. Mirrors the logger's history rule so live hints and reports agree. */
export function priorSessions(session: Session, all: Session[]): Session[] {
  return all.filter(s => s.status === 'complete' && s.id !== session.id && s.date <= session.date).sort((a, b) => a.date.localeCompare(b.date));
}

export function analyzeSession(session: Session, data: Pick<Data, 'sessions' | 'custom' | 'preferences'>, opts: AnalyzeOptions = {}): SessionAnalysis {
  const config = opts.config ?? defaultAnalysisConfig;
  const prefs: Preferences = data.preferences ?? defaultPreferences;
  const fmt = makeFormatter(prefs.units);
  const library: Exercise[] = [...builtIn, ...data.custom];
  const prior = priorSessions(session, data.sessions);

  const analyses: ExerciseAnalysis[] = session.exercises.map((e, i) => {
    const priors: Prior[] = prior.flatMap(s => s.exercises.filter(x => x.exerciseId === e.exerciseId).map(x => ({ session: { id: s.id, date: s.date, name: s.name }, exercise: x })));
    return analyzeExercise(e, priors, { id: session.id, date: session.date, name: session.name }, { key: `ex${i + 1}`, prefs, fmt, config, library: library.find(l => l.id === e.exerciseId) });
  });

  const withSets = analyses.filter(a => a.completed > 0);
  const plannedSets = analyses.reduce((n, a) => n + a.planned, 0);
  const completedSets = analyses.reduce((n, a) => n + a.completed, 0);
  const counted = analyses.reduce((n, a) => n + Math.min(a.completed, a.planned), 0);
  const totalReps = analyses.reduce((n, a) => n + a.totalReps, 0);
  const external = analyses.filter(a => a.loadKind === 'external');
  const excluded = analyses.filter(a => a.loadKind !== 'external' && a.completed > 0).map(a => a.name);
  const volume = external.reduce((n, a) => n + a.loadVolume, 0);
  const prCount = analyses.filter(a => a.records.load || a.records.reps).length;
  const outcomes: Record<string, number> = {};
  analyses.forEach(a => { outcomes[a.decision.action] = (outcomes[a.decision.action] ?? 0) + 1; });

  const sameName = [...prior].reverse().find(s => s.name.trim().toLowerCase() === session.name.trim().toLowerCase());
  const previousSession = sameName ? { id: sameName.id, name: sameName.name, date: sameName.date,
    completedSets: sameName.exercises.reduce((n, e) => n + working(e).length, 0), totalReps: sameName.exercises.reduce((n, e) => n + working(e).reduce((v, s) => v + s.reps, 0), 0),
    volume: sameName.exercises.filter(e => !(working(e).length && working(e).every(s => s.weight === 0))).reduce((n, e) => n + working(e).reduce((v, s) => v + s.weight * s.reps, 0), 0) } : null;

  const recoveryNotes: string[] = [];
  analyses.filter(a => a.flags.pain).forEach(a => recoveryNotes.push(`Pain concern flagged on ${a.name}.`));
  analyses.filter(a => a.flags.techniqueConcern).forEach(a => recoveryNotes.push(`Technique flagged as not acceptable on ${a.name}.`));
  session.exercises.filter(e => e.notes.trim()).forEach(e => recoveryNotes.push(`Note on ${e.name}: “${e.notes.trim().slice(0, 140)}”`));

  // Muscle attribution
  const ws = weekStart(session.date);
  const complete = data.sessions.filter(s => s.status === 'complete' || s.id === session.id);
  const primary = (s: Session, muscle: string) => s.exercises.filter(e => e.muscle === muscle).reduce((n, e) => n + working(e).length, 0);
  const secondaryOf = (e: Performed) => library.find(l => l.id === e.exerciseId)?.secondary ?? [];
  const inWeek = (s: Session, start: number) => { const t = new Date(s.date).getTime(); return t >= start && t < start + WEEK; };
  const present = new Set(MUSCLES);
  session.exercises.forEach(e => present.add(e.muscle));
  const rows: MuscleRow[] = [...present].map(muscle => {
    const wk = (start: number) => complete.filter(s => inWeek(s, start)).reduce((n, s) => n + primary(s, muscle), 0);
    const four = [1, 2, 3, 4].map(k => wk(ws - k * WEEK));
    return { muscle, session: primary(session, muscle), thisWeek: wk(ws), lastWeek: wk(ws - WEEK), fourWeekAverage: round2(four.reduce((a, b) => a + b, 0) / 4),
      indirectThisWeek: complete.filter(s => inWeek(s, ws)).reduce((n, s) => n + s.exercises.filter(e => secondaryOf(e).includes(muscle)).reduce((v, e) => v + working(e).length, 0), 0) };
  }).filter(r => r.session || r.thisWeek || r.lastWeek || r.fourWeekAverage || r.indirectThisWeek || MUSCLES.includes(r.muscle));

  const wentWell: Observation[] = analyses.flatMap(a => a.observations.filter(o => o.tone === 'positive'));
  const needsAttention: Observation[] = analyses.flatMap(a => a.observations.filter(o => o.tone === 'attention'));
  const sessionFacts: Fact[] = [
    { id: 'session.plannedSets', label: 'Working sets planned', value: plannedSets }, { id: 'session.completedSets', label: 'Working sets completed', value: completedSets },
    { id: 'session.totalReps', label: 'Total working reps', value: totalReps }, { id: 'session.volume', label: 'Logged external-load volume', value: round2(volume * fmt.factor), unit: `${fmt.units}·reps` },
  ];
  if (plannedSets > 0 && counted >= plannedSets) wentWell.unshift({ id: 'session.o1', tone: 'positive', title: 'Planned session volume completed', detail: `You completed ${completedSets} working sets against ${plannedSets} planned across ${plural(analyses.length, 'exercise')}.`, facts: ['session.completedSets', 'session.plannedSets'] });
  if (plannedSets > 0 && counted < plannedSets) needsAttention.unshift({ id: 'session.o2', tone: 'attention', title: 'Session was short of the planned working sets', detail: `${counted} of ${plannedSets} planned working sets were completed (${Math.round(counted / plannedSets * 100)}%).`, facts: ['session.completedSets', 'session.plannedSets'] });

  const dataGaps = [
    'Session duration is not recorded; REPWISE saves only the workout date.',
    'Rest between sets is not saved with sets (the rest timer is not logged), so rest cannot be analyzed.',
    'Readiness, sleep and soreness are not captured.',
    ...(analyses.some(a => a.rir.of > 0 && a.rir.recorded < a.rir.of) ? ['RIR was missing on some sets, which lowers confidence and holds loads.'] : []),
    ...(analyses.length && priorSessions(session, data.sessions).length === 0 ? ['This is your first completed session, so this report is a baseline: nothing is compared to earlier training.'] : []),
  ];

  const fp = fingerprint({ session, prior: prior.map(s => ({ id: s.id, date: s.date, exercises: s.exercises })), rir: [prefs.rirMin, prefs.rirMax], units: prefs.units, config });
  return {
    schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION, fingerprint: fp, status: session.status,
    overview: { sessionId: session.id, name: session.name, date: session.date, duration: { available: false, note: 'Not recorded' }, exercisesLogged: analyses.length, exercisesWithWorkingSets: withSets.length,
      plannedSets, completedSets, countedTowardPlan: counted, extraSets: Math.max(0, completedSets - counted), totalReps,
      volume: { value: volume, label: `Sum of load × reps for external-load exercises only (${fmt.units}·reps). Not a strength score.`, included: external.filter(a => a.completed > 0).map(a => a.name), excluded },
      prCount, outcomes, recovery: { available: recoveryNotes.length > 0, notes: recoveryNotes }, previousSession,
      comparisonNote: previousSession ? `Compared with your previous “${previousSession.name}” session on ${shortDate(previousSession.date)}.` : 'No earlier session with this workout name, so no session-level comparison is shown.' },
    exercises: analyses, wentWell, needsAttention, plan: analyses.map(a => ({ exercise: a.name, performedId: a.performedId, target: a.next })),
    muscles: { rows, convention: ATTRIBUTION_CONVENTION }, dataGaps,
    criteria: { trend: `A direction is reported after ${config.trendSessions} comparable sessions (same load, set count and rep range).`, plateau: `A possible plateau needs ${config.plateauSessions} comparable sessions where none beat the first.`,
      consistent: `Rep counts within ${config.consistentSpread} are called consistent.`, largeDrop: `A first-to-last-set rep drop of ${Math.round(config.largeDropFraction * 100)}% or more is mentioned. Descriptive, not physiological.`,
      evidence: `Moderate at ${config.moderateSessions} comparable sessions, stronger at ${config.strongerSessions}; missing RIR lowers it one level.` },
    facts: [...sessionFacts, ...analyses.flatMap(a => a.facts)],
  };
}
