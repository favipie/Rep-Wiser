import { working, estimatedMax, type Performed, type Preferences, type Session, type Exercise } from '../model';
import { recommend } from '../progression';
import type { AnalysisConfig } from './config';
import { joinList, plural, round2, shortDate, type Formatter } from './text';
import type { Comparison, Criterion, EvidenceLevel, ExerciseAnalysis, Fact, NextTarget, Observation, SessionPoint, SetView, Trend } from './types';

export type Prior = { session: Pick<Session, 'id' | 'date' | 'name'>; exercise: Performed };
export type ExerciseContext = { key: string; prefs: Pick<Preferences, 'rirMin' | 'rirMax'>; fmt: Formatter; config: AnalysisConfig; library?: Exercise };

/**
 * Same comparability test recommend() uses for its decline rule: identical working-set count,
 * one identical working load equal to today's first working set, and the same rep range.
 */
export function isComparable(current: Performed, other: Performed): boolean {
  const sets = working(current);
  const weight = sets[0]?.weight;
  return sets.length > 0 && sets.every(s => s.weight === weight) && working(other).length === sets.length && working(other).every(s => s.weight === weight) && other.min === current.min && other.max === current.max;
}

const RULES: { id: string; prefix: string; description: string }[] = [
  { id: 'concern', prefix: 'A pain or technique concern', description: 'A pain or technique concern was recorded, so no load increase is suggested.' },
  { id: 'override', prefix: 'Your chosen next load', description: 'You entered a next load, which replaces the calculated suggestion.' },
  { id: 'incomplete-sets', prefix: 'Complete all prescribed', description: 'Progression is evaluated only after all prescribed working sets are completed.' },
  { id: 'mixed-loads', prefix: 'Working loads differ', description: 'Progression compares sets at one consistent working load.' },
  { id: 'decline-review', prefix: 'Performance declined', description: 'Total reps fell across three comparable sessions, or minimum reps were missed in all three.' },
  { id: 'smaller-step', prefix: 'The previous successful load', description: 'The previous load met every target, but a larger jump missed the minimum; a smaller available step is suggested.' },
  { id: 'minimum-missed', prefix: 'A minimum rep target', description: 'At least one working set fell below the minimum rep target; one session alone is not a trend.' },
  { id: 'rir-missing', prefix: 'RIR is missing', description: 'Load increases require recorded RIR; missing RIR holds the load.' },
  { id: 'build-reps', prefix: 'Build reps within', description: 'Double progression: every working set must reach the upper rep target before the load rises.' },
  { id: 'rir-out-of-range', prefix: 'Your recorded RIR', description: 'Recorded RIR was outside your configured effort range, so the load is held.' },
  { id: 'no-increment', prefix: 'No available weight increment', description: 'No weight increment is configured for this exercise.' },
  { id: 'increase', prefix: 'All working sets reached', description: 'Every working set reached the upper rep target at an acceptable RIR with no concerns.' },
];
export const ruleFor = (reason: string) => RULES.find(r => reason.startsWith(r.prefix)) ?? { id: 'unrecognized', prefix: '', description: 'Rule not recognized by the analysis layer; the engine decision is shown unchanged.' };
export const knownRuleIds = RULES.map(r => r.id);

const ACTION_LABEL: Record<NextTarget['action'], string> = { increase: 'Increase load', smaller: 'Increase by a smaller step', maintain: 'Maintain load', review: 'Review before progressing', override: 'Your chosen load' };

const total = (e: Performed) => working(e).reduce((n, s) => n + s.reps, 0);
const topOf = (e: Performed) => Math.max(0, ...working(e).map(s => s.weight));
const loadVolumeOf = (e: Performed) => working(e).reduce((n, s) => n + s.weight * s.reps, 0);
const best1RM = (e: Performed) => { const v = working(e).map(estimatedMax).filter((x): x is number => x !== null); return v.length ? Math.max(...v) : null; };

function modeLoad(sets: { weight: number }[]): number | null {
  if (!sets.length) return null;
  const counts = new Map<number, number>();
  sets.forEach(s => counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1));
  // Most-used load; ties resolve to the lighter load (the conservative choice).
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function describeSets(sets: { weight: number; reps: number }[], fmt: Formatter): string {
  if (!sets.length) return 'no completed working sets';
  const loads = new Set(sets.map(s => s.weight));
  return loads.size === 1 ? `${fmt.w(sets[0].weight)} × ${sets.map(s => s.reps).join(', ')}` : sets.map(s => `${fmt.w(s.weight)} × ${s.reps}`).join(' / ');
}

function compare(current: Performed, p: Prior, fmt: Formatter): Comparison {
  const sets = working(p.exercise).map(s => ({ weight: s.weight, reps: s.reps }));
  const mine = working(current);
  const differences: string[] = [];
  const myLoad = modeLoad(mine), theirLoad = modeLoad(sets);
  if (myLoad !== null && theirLoad !== null && myLoad !== theirLoad) differences.push(`working load was ${fmt.w(theirLoad)} (today ${fmt.w(myLoad)})`);
  if (sets.length !== mine.length) differences.push(`${plural(sets.length, 'working set')} then, ${mine.length} today`);
  if (p.exercise.min !== current.min || p.exercise.max !== current.max) differences.push(`rep range was ${p.exercise.min}–${p.exercise.max} (today ${current.min}–${current.max})`);
  const comparable = isComparable(current, p.exercise);
  const totalReps = total(p.exercise);
  return { sessionId: p.session.id, date: p.session.date, sets, totalReps, topWeight: topOf(p.exercise), comparable, differences,
    summary: `${shortDate(p.session.date)}: ${describeSets(sets, fmt)} (${plural(totalReps, 'rep')} total)` };
}

export function classifyTrend(items: { date: string; total: number; belowMin: boolean }[], cfg: AnalysisConfig): Trend {
  const n = items.length;
  const totals = items.map(i => i.total), dates = items.map(i => i.date);
  const base = { sessions: n, totals, dates };
  if (n <= 1) return { ...base, kind: 'none', summary: 'No earlier session matches today’s working load, set count and rep range, so no comparison or trend is possible yet.' };
  if (n < cfg.trendSessions) return { ...base, kind: 'two-session', summary: `Total working reps ${totals.join(' → ')} across ${n} comparable sessions. This is a comparison, not a trend; ${cfg.trendSessions} comparable sessions are needed before a direction is reported.` };
  const last = items.slice(-cfg.trendSessions);
  const lt = last.map(i => i.total);
  const strictly = (f: (a: number, b: number) => boolean) => lt.every((v, i) => i === 0 || f(v, lt[i - 1]));
  if (strictly((a, b) => a < b)) return { ...base, kind: 'declining', summary: `Total working reps fell in each of the last ${cfg.trendSessions} comparable sessions (${lt.join(' → ')}) at the same load, sets and rep range.` };
  if (last.every(i => i.belowMin)) return { ...base, kind: 'declining', summary: `At least one working set fell below the minimum rep target in each of the last ${cfg.trendSessions} comparable sessions.` };
  if (strictly((a, b) => a > b)) return { ...base, kind: 'improving', summary: `Total working reps rose in each of the last ${cfg.trendSessions} comparable sessions (${lt.join(' → ')}) at the same load, sets and rep range.` };
  if (n >= cfg.plateauSessions) {
    const win = totals.slice(-cfg.plateauSessions);
    if (Math.max(...win.slice(1)) <= win[0]) return { ...base, kind: 'possible-plateau', summary: `Over the last ${cfg.plateauSessions} comparable sessions (${win.join(' → ')} total reps) no session beat the first. This is a possible plateau, not a confirmed one; criteria are shown in the report settings.` };
  }
  return { ...base, kind: 'mixed', summary: `Total working reps across the last ${last.length} comparable sessions (${lt.join(' → ')}) show no consistent direction, which is normal day-to-day variation.` };
}

export function analyzeExercise(current: Performed, priors: Prior[], session: Pick<Session, 'id' | 'date' | 'name'>, ctx: ExerciseContext): ExerciseAnalysis {
  const { key, prefs, fmt, config, library } = ctx;
  const sets = working(current);
  const n = sets.length;
  const required = current.required;
  const equipment = library?.equipment ?? null;
  const allZero = n > 0 && sets.every(s => s.weight === 0);
  const loadKind: 'external' | 'bodyweight' = equipment === 'Bodyweight' || allZero ? 'bodyweight' : 'external';
  const topWeight = topOf(current);
  const mode = modeLoad(sets);
  const views: SetView[] = sets.map((s, i) => ({ index: i + 1, weight: s.weight, reps: s.reps, rir: s.rir, meetsMin: s.reps >= current.min, reachesMax: s.reps >= current.max }));
  const totalReps = total(current);
  const meeting = views.filter(v => v.meetsMin).length;
  const atMax = views.filter(v => v.reachesMax).length;
  const below = views.filter(v => !v.meetsMin);
  const rirVals = sets.filter(s => s.rir !== null).map(s => s.rir as number);
  const rir = { recorded: rirVals.length, of: n, average: rirVals.length ? round2(rirVals.reduce((a, b) => a + b, 0) / rirVals.length) : null };
  const notCompleted = current.sets.filter(s => !s.done && !s.warmup).length;
  const loadVolume = loadKind === 'external' ? loadVolumeOf(current) : sets.reduce((a, s) => a + s.weight * s.reps, 0);
  const volumeLabel = loadKind === 'external' ? `Sum of load × reps (${fmt.units}·reps)` : topWeight > 0 ? `Added-load volume only (${fmt.units}·reps); bodyweight is not included` : 'Not meaningful at bodyweight only; compare reps instead';
  const est = loadKind === 'external' ? best1RM(current) : null;

  // History: every earlier entry of this exercise, oldest first.
  const prevAny = [...priors].reverse().find(p => working(p.exercise).length > 0) ?? null;
  const comparablePriors = priors.filter(p => isComparable(current, p.exercise));
  const previous = prevAny ? compare(current, prevAny, fmt) : null;
  const previousComparable = comparablePriors.length ? compare(current, comparablePriors.at(-1)!, fmt) : null;
  const points: SessionPoint[] = [...priors.map(p => ({ p, comp: isComparable(current, p.exercise) })), { p: { session, exercise: current } as Prior, comp: true }]
    .filter(x => working(x.p.exercise).length > 0)
    .map(({ p, comp }) => ({ sessionId: p.session.id, date: p.session.date, name: p.session.name, topWeight: topOf(p.exercise), totalReps: total(p.exercise), sets: working(p.exercise).length,
      estimated1RM: loadKind === 'external' ? best1RM(p.exercise) : null, loadVolume: loadVolumeOf(p.exercise), comparable: comp }));
  const trend = classifyTrend([...comparablePriors, { session, exercise: current }].map(p => ({ date: p.session.date, total: total(p.exercise), belowMin: working(p.exercise).some(s => s.reps < current.min) })), config);
  const comparableSessions = comparablePriors.length + 1;

  // Records: only when earlier history exists. Never invented.
  const priorSets = priors.flatMap(p => working(p.exercise));
  const records = { load: false, reps: false, baseline: priorSets.length === 0, detail: [] as string[] };
  if (priorSets.length) {
    const maxLoad = Math.max(...priorSets.map(s => s.weight));
    if (topWeight > maxLoad && topWeight > 0) { records.load = true; records.detail.push(`Heaviest logged working load: ${fmt.w(topWeight)} (previous best ${fmt.w(maxLoad)}).`); }
    for (const s of sets) {
      const same = priorSets.filter(x => x.weight === s.weight);
      if (same.length && s.reps > Math.max(...same.map(x => x.reps)) && !records.detail.some(d => d.includes(`at ${fmt.w(s.weight)}`))) { records.reps = true; records.detail.push(`Most reps logged at ${fmt.w(s.weight)}: ${s.reps} (previous best ${Math.max(...same.map(x => x.reps))}).`); }
    }
  }

  // Engine decision — the single source of truth. Nothing below changes it.
  const decision = recommend(current, priors.map(p => p.exercise), prefs);
  const rule = ruleFor(decision.reason);

  const inRange = (r: number) => r >= prefs.rirMin && r <= prefs.rirMax;
  const allRir = n > 0 && rir.recorded === n;
  const rirIn = allRir && sets.every(s => inRange(s.rir as number));
  const criteria: Criterion[] = [
    { id: 'sets', label: 'All prescribed working sets completed', status: n >= required ? 'met' : 'unmet', detail: `${n} of ${required} working sets completed.` },
    { id: 'load', label: 'One consistent working load', status: n === 0 ? 'unknown' : new Set(sets.map(s => s.weight)).size === 1 ? 'met' : 'unmet', detail: n === 0 ? 'No working sets logged.' : new Set(sets.map(s => s.weight)).size === 1 ? `All sets at ${fmt.w(sets[0].weight)}.` : `Loads logged: ${joinList([...new Set(sets.map(s => fmt.w(s.weight)))])}.` },
    { id: 'top', label: `Every set reached ${current.max} reps`, status: n === 0 ? 'unknown' : atMax === n ? 'met' : 'unmet', detail: n === 0 ? 'No working sets logged.' : `${atMax} of ${n} sets reached ${current.max}${atMax < n ? `; ${plural(views.reduce((a, v) => a + Math.max(0, current.max - v.reps), 0), 'rep')} short in total` : ''}.` },
    { id: 'rir-recorded', label: 'RIR recorded on every set', status: allRir ? 'met' : 'unknown', detail: allRir ? 'RIR recorded on every working set.' : `RIR missing on ${n - rir.recorded} of ${n} sets. Missing RIR is never assumed.` },
    { id: 'rir-range', label: `RIR within your target (${prefs.rirMin}–${prefs.rirMax})`, status: !allRir ? 'unknown' : rirIn ? 'met' : 'unmet', detail: !allRir ? 'Cannot be checked without RIR on every set.' : rirIn ? 'Every set was inside your configured RIR range.' : 'At least one set was outside your configured RIR range.' },
    { id: 'concerns', label: 'No pain or technique concern flagged', status: current.pain || !current.technique ? 'unmet' : 'met', detail: current.pain ? 'A pain concern was flagged.' : !current.technique ? 'Technique was flagged as not acceptable.' : 'None flagged. REPWISE cannot verify technique from reps and weights.' },
    { id: 'increment', label: 'A weight increment is configured', status: current.increment > 0 ? 'met' : 'unmet', detail: current.increment > 0 ? `Smallest step: ${fmt.w(current.increment)}.` : 'No increment configured for this exercise.' },
  ];

  // Evidence level
  let level: EvidenceLevel = comparableSessions >= config.strongerSessions ? 'stronger' : comparableSessions >= config.moderateSessions ? 'moderate' : 'limited';
  const rirComplete = allRir;
  if (!rirComplete) level = level === 'stronger' ? 'moderate' : 'limited';
  const evidenceBasis = `${plural(comparableSessions, 'comparable session')} including today${rirComplete ? '' : ', RIR incomplete (lowers evidence by one level)'}. Thresholds: moderate at ${config.moderateSessions}, stronger at ${config.strongerSessions}.`;

  const missing: string[] = [];
  if (n === 0) missing.push('No completed working sets were logged.');
  if (!rirComplete && n > 0) missing.push(`RIR missing on ${n - rir.recorded} of ${n} sets. Record it next time so effort can be part of the decision.`);
  if (!previousComparable) missing.push(prevAny ? `No earlier session used the same load, set count and rep range${previous?.differences.length ? ` (last time: ${joinList(previous.differences)})` : ''}.` : 'No earlier sessions of this exercise are logged.');
  if (notCompleted > 0) missing.push(`${plural(notCompleted, 'set')} on this exercise ${notCompleted === 1 ? 'was' : 'were'} not marked complete and ${notCompleted === 1 ? 'is' : 'are'} excluded.`);

  // ---- Next-session target ----
  const w0 = mode;
  const shortTotal = views.reduce((a, v) => a + Math.max(0, current.max - v.reps), 0);
  const W = (v: number | null) => (v === null ? 'your working load' : fmt.w(v));
  let goal: string;
  switch (rule.id) {
    case 'concern': goal = 'Do not add load. Reps and weights cannot show what caused a pain or technique concern; if discomfort continues, consider having it assessed by a qualified professional. Use a load you can control.'; break;
    case 'override': goal = `Use your chosen ${fmt.w(decision.weight ?? 0)} for ${plural(required, 'set')} in the ${current.min}–${current.max} rep range.`; break;
    case 'incomplete-sets': goal = `Complete all ${required} working sets at ${W(w0)}. Only ${n} ${n === 1 ? 'was' : 'were'} completed this time.`; break;
    case 'mixed-loads': goal = `Pick one working load for every set. ${W(w0)} was used on the most sets (loads logged: ${joinList([...new Set(sets.map(s => fmt.w(s.weight)))])}).`; break;
    case 'decline-review': goal = `Repeat ${W(w0)} and treat the next session as a reassessment: compare it with your recent sessions, and look at what else changed (sleep, other training, rest between sets) before changing the plan.`; break;
    case 'smaller-step': goal = `Try ${W(decision.weight)} for ${plural(required, 'set')}, a smaller step than your last jump.`; break;
    case 'minimum-missed': goal = `Repeat ${W(w0)} and aim for at least ${current.min} sound reps on all ${required} sets (${below.map(v => `set ${v.index}`).join(', ')} fell short this time).`; break;
    case 'rir-missing': goal = `Keep ${W(w0)} and record RIR on every set. Without it the load cannot be increased by the rules, even if reps reach ${current.max}.`; break;
    case 'build-reps': goal = `Keep ${W(w0)} and build toward ${current.max} reps on every set. You are ${plural(shortTotal, 'rep')} from the top of the range across ${plural(n, 'set')}.`; break;
    case 'rir-out-of-range': goal = `Every set reached ${current.max}, but RIR was outside ${prefs.rirMin}–${prefs.rirMax}. Repeat ${W(w0)} and aim to finish inside your configured effort range.`; break;
    case 'no-increment': goal = `Every set reached ${current.max}, but no increment is configured. Set one for this exercise to get a next load.`; break;
    case 'increase': goal = `Move to ${W(decision.weight)} for ${plural(required, 'set')}. Expect reps to fall back toward ${current.min}; build up again from there.`; break;
    default: goal = decision.reason;
  }
  const nextWeight = decision.action === 'increase' || decision.action === 'smaller' || decision.action === 'override' ? decision.weight : w0;
  const progression = current.increment > 0
    ? `Double progression: build reps within ${current.min}–${current.max} at one load. Once every set reaches ${current.max} with RIR ${prefs.rirMin}–${prefs.rirMax} recorded and no pain or technique concern, add your smallest increment (${fmt.w(current.increment)}${w0 !== null ? `; from ${fmt.w(w0)} that is ${fmt.w(round2(w0 + current.increment))}` : ''}).`
    : `Double progression needs a weight increment. None is configured for this exercise, so a next load cannot be calculated.`;
  const next: NextTarget = { action: decision.action, actionLabel: ACTION_LABEL[decision.action], weight: nextWeight, repMin: current.min, repMax: current.max, sets: required,
    rirMin: prefs.rirMin, rirMax: prefs.rirMax, rest: null, immediateGoal: goal, progression, explanation: decision.reason, level, missing };

  // ---- Facts + observations ----
  const facts: Fact[] = [
    { id: `${key}.completed`, label: 'Working sets completed', value: n }, { id: `${key}.planned`, label: 'Working sets planned', value: required },
    { id: `${key}.totalReps`, label: 'Total working reps', value: totalReps }, { id: `${key}.topWeight`, label: 'Heaviest working load', value: round2(topWeight * fmt.factor), unit: fmt.units },
    { id: `${key}.meetingMin`, label: 'Sets meeting minimum reps', value: meeting }, { id: `${key}.atMax`, label: 'Sets reaching upper reps', value: atMax },
    { id: `${key}.comparable`, label: 'Comparable sessions incl. today', value: comparableSessions },
  ];
  if (previous) facts.push({ id: `${key}.prevTotal`, label: 'Previous session total reps', value: previous.totalReps });
  const obs: Observation[] = [];
  const add = (tone: Observation['tone'], title: string, detail: string, f: string[]) => obs.push({ id: `${key}.o${obs.length + 1}`, tone, title, detail, facts: f, exercise: current.name });
  if (n > 0 && n >= required) add('positive', 'Planned sets completed', `You completed ${n} of ${required} planned working sets.`, [`${key}.completed`, `${key}.planned`]);
  if (n > 0 && below.length === 0) add('positive', `Every set met the ${current.min}-rep minimum`, `Reps were ${joinList(views.map(v => String(v.reps)))} against a minimum of ${current.min}.`, [`${key}.meetingMin`]);
  if (n > 0 && atMax === n) add('positive', `Every set reached ${current.max} reps`, `All ${n} working sets hit the top of your ${current.min}–${current.max} range.`, [`${key}.atMax`]);
  if (previousComparable && totalReps > previousComparable.totalReps) add('positive', 'More reps than last comparable session', `${totalReps} total reps vs ${previousComparable.totalReps} on ${shortDate(previousComparable.date)} at the same load, sets and rep range.`, [`${key}.totalReps`]);
  if (previous && !previous.comparable && previous.topWeight > 0 && topWeight > previous.topWeight && n > 0 && below.length === 0) add('positive', 'Load increased and every set still met the minimum', `Top load rose from ${fmt.w(previous.topWeight)} to ${fmt.w(topWeight)}; reps were ${views.map(v => v.reps).join(', ')} against a minimum of ${current.min}.`, [`${key}.topWeight`]);
  if (records.load || records.reps) add('positive', 'New personal best in your logs', records.detail.join(' '), [`${key}.topWeight`]);
  if (n >= 3 && Math.max(...views.map(v => v.reps)) - Math.min(...views.map(v => v.reps)) <= config.consistentSpread) add('positive', 'Consistent reps across sets', `Reps stayed within ${plural(config.consistentSpread, 'rep')} across all ${n} sets (${views.map(v => v.reps).join(', ')}).`, [`${key}.totalReps`]);
  if (n > 0 && allRir) add('positive', 'Effort recorded on every set', `RIR was logged for all ${n} sets, so effort-based progression rules could be applied.`, [`${key}.completed`]);
  if (below.length) add('attention', `${plural(below.length, 'set')} below the minimum`, `${below.map(v => `Set ${v.index}: ${v.reps} reps (${plural(current.min - v.reps, 'rep')} short)`).join('; ')}. Minimum: ${current.min}.`, [`${key}.meetingMin`]);
  if (n < required) add('attention', 'Fewer working sets than planned', `${n} of ${required} planned working sets were completed.`, [`${key}.completed`, `${key}.planned`]);
  if (n > 0 && new Set(sets.map(s => s.weight)).size > 1) add('attention', 'Working loads varied between sets', `Loads logged: ${joinList([...new Set(sets.map(s => fmt.w(s.weight)))])}. Progression compares sets at one working load.`, [`${key}.topWeight`]);
  if (n >= 2 && views[0].reps > 0 && (views[0].reps - views.at(-1)!.reps) / views[0].reps >= config.largeDropFraction) add('attention', 'Large rep drop across sets', `Reps fell from ${views[0].reps} to ${views.at(-1)!.reps} between set 1 and set ${n}. This is an observation; the log cannot say why (rest, effort, and load all affect it).`, [`${key}.totalReps`]);
  if (current.pain) add('attention', 'Pain concern flagged', 'You flagged a pain concern. No load increase is suggested. REPWISE cannot assess pain; consider a qualified professional if it persists.', []);
  if (!current.technique) add('attention', 'Technique flagged as not acceptable', 'You marked technique as not acceptable, so no load increase is suggested. REPWISE cannot verify technique from reps and weights.', []);
  if (n > 0 && !allRir) add('attention', 'Effort (RIR) not fully recorded', `RIR is missing on ${n - rir.recorded} of ${n} sets, which lowers confidence and holds the load.`, [`${key}.completed`]);
  if (trend.kind === 'declining') add('attention', 'Repeated decline across comparable sessions', `${trend.summary} Possible contributors cannot be identified from the log; other training, sleep, stress and rest between sets are all candidates. This is not a diagnosis of fatigue or overtraining.`, [`${key}.comparable`]);
  if (trend.kind === 'possible-plateau') add('attention', 'Possible plateau', trend.summary, [`${key}.comparable`]);
  if (previous && !previous.comparable && previous.differences.length) add('info', 'Prescription changed since last time', `Last session differed (${joinList(previous.differences)}), so totals are not directly comparable.`, []);

  const loadText = new Set(sets.map(s => s.weight)).size === 1 ? `at ${fmt.w(sets[0].weight)}` : `at varying loads (${joinList([...new Set(sets.map(s => fmt.w(s.weight)))])})`;
  const s1 = n ? `You completed ${joinList(views.map(v => String(v.reps)))} repetitions ${loadText}.` : 'No completed working sets were logged for this exercise.';
  const s2 = n ? `${meeting} of ${n} working sets met your minimum of ${current.min} repetitions${below.length ? `; ${joinList(below.map(v => `set ${v.index} fell ${plural(current.min - v.reps, 'repetition')} short`))}` : ''}.` : '';
  const s3 = comparableSessions === 1 ? (prevAny ? 'No earlier session matches today’s load, sets and rep range, so there is not enough evidence to identify a trend.' : 'This is your first logged session of this exercise, so there is not enough evidence to identify a trend.') : trend.summary;
  const narrative = [s1, s2, s3, goal].filter(Boolean).join(' ');

  const evidence = {
    observed: [s1, s2].filter(Boolean),
    rules: [`${rule.id}: ${rule.description}`],
    assumptions: ['Logged reps are treated as technically sound; REPWISE cannot verify technique.', 'Warm-up sets and sets not marked complete are excluded.', 'Reps are used as logged; REPWISE has no per-side (unilateral) convention.'],
    limitations: missing,
  };

  return { performedId: current.id, exerciseId: current.exerciseId, name: current.name, muscle: current.muscle, secondary: library?.secondary ?? [], equipment, loadKind, planned: required, completed: n, notCompleted,
    repMin: current.min, repMax: current.max, sets: views, totalReps, topWeight, loadVolume, volumeLabel, setsMeetingMin: meeting, setsAtMax: atMax, rir, estimated1RM: est,
    previous, previousComparable, comparableSessions, trend, history: points, records, flags: { pain: current.pain, techniqueConcern: !current.technique, override: current.override },
    criteria, ruleId: rule.id, decision, narrative, observations: obs, next, evidence, evidenceLevel: level, evidenceBasis, facts };
}
