import { setSchema, type LiftSet, type Session } from '../model';

export type VoiceIntent = 'log_set' | 'start_rest' | 'stop_rest' | 'previous_set' | 'repeat_weight' | 'next_exercise' | 'history' | 'analysis' | 'cancel';
export type WeightBasis = 'per_hand' | 'total';
export type VoiceDraft = {
  intent: VoiceIntent; exerciseId: string; weight: number | null; unit: 'kg' | 'lb' | null;
  reps: number | null; rir: number | null; warmup: boolean; spokenBasis: WeightBasis | null;
  issues: string[]; requiresConfirmation: true;
};
export type VoiceContext = { exerciseId: string; exercises: { id: string; name: string; aliases?: string[] }[]; knownExerciseNames?: string[]; previous?: LiftSet };
const small: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  shunya: 0, ek: 1, do: 2, teen: 3, chaar: 4, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6,
  saat: 7, aath: 8, ath: 8, nau: 9, das: 10, dus: 10, gyarah: 11, barah: 12, terah: 13,
  chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20,
  pachis: 25, pachees: 25, pachchees: 25, tees: 30, paintis: 35, chalis: 40, chaalis: 40,
  pachaas: 50, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'तेरह': 13,
  'चौदह': 14, 'पंद्रह': 15, 'पन्द्रह': 15, 'सोलह': 16, 'सत्रह': 17, 'अठारह': 18,
  'उन्नीस': 19, 'बीस': 20, 'पच्चीस': 25, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'साठ': 60,
  'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90,
};

// Limited, explicit vocabulary: unrecognised phrases stay visible for correction.
export function normalizeSpeech(text: string): string {
  const words = text.toLowerCase().normalize('NFKC').replace(/[०-९]/g, d => String('०१२३४५६७८९'.indexOf(d)))
    .replace(/([a-z])-([a-z])/g, '$1 $2').replace(/[,;!?]/g, ' ').replace(/\.(?!\d)/g, ' ')
    .replace(/\bdo a warm\b/g, 'a warm').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let n = small[words[i]];
    if (n === undefined) { out.push(words[i]); continue; }
    if (words[i + 1] === 'hundred' || words[i + 1] === 'सौ') { n *= 100; i++; if (words[i + 1] === 'and') i++; if (small[words[i + 1]] !== undefined) n += small[words[++i]]; }
    if (n >= 20 && n % 10 === 0 && small[words[i + 1]] > 0 && small[words[i + 1]] < 10) n += small[words[++i]];
    if (['point', 'decimal', 'दशमलव'].includes(words[i + 1])) {
      i++; let decimals = '';
      while (small[words[i + 1]] !== undefined && small[words[i + 1]] < 10) decimals += small[words[++i]];
      if (decimals) { out.push(n + '.' + decimals); continue; }
    }
    out.push(String(n));
  }
  return out.join(' ').replace(/\b(?:minus|negative)\s+(\d)/g, '-$1');
}

const aliases: Record<string, string[]> = {
  'bench press': ['bench', 'बेंच प्रेस'], 'lat pulldown': ['lat pull down', 'लैट पुलडाउन'],
  'back squat': ['squat', 'स्क्वाट'], 'lateral raise': ['lateral raises', 'side raise', 'लेटरल रेज'],
  'romanian deadlift': ['rdl'], 'overhead press': ['shoulder press', 'ohp'],
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numeric = '(-?\\d+(?:\\.\\d+)?)';

export function parseVoice(text: string, context: VoiceContext): VoiceDraft {
  const t = normalizeSpeech(text.slice(0, 500));
  const draft: VoiceDraft = { intent: 'log_set', exerciseId: context.exerciseId, weight: null, unit: null, reps: null, rir: null, warmup: /\bwarm\s*up\b|वार्म\s*अप/.test(t), spokenBasis: null, issues: [], requiresConfirmation: true };
  if (text.length > 500) { draft.issues.push('Use one short set entry at a time.'); return draft; }
  const commands: [RegExp, VoiceIntent][] = [
    [/^(?:please )?(?:start rest(?: timer)?|rest timer|आराम शुरू)$/, 'start_rest'],
    [/^(?:please )?(?:stop rest(?: timer)?|stop timer)$/, 'stop_rest'],
    [/^(?:show )?(?:previous|last) set$/, 'previous_set'], [/^repeat (?:last|previous) weight$/, 'repeat_weight'],
    [/^(?:go to )?next exercise$/, 'next_exercise'], [/^(?:open|show) (?:workout )?history$/, 'history'],
    [/^(?:show|open) (?:today'?s? )?analysis$/, 'analysis'], [/^(?:cancel(?: recording)?|stop recording|रद्द)$/, 'cancel'],
  ];
  const command = commands.find(([pattern]) => pattern.test(t));
  if (command) { draft.intent = command[1]; return draft; }
  const matches = context.exercises.filter(e => [e.name.toLowerCase(), ...(e.aliases ?? []), ...(aliases[e.name.toLowerCase()] ?? [])]
    .some(name => new RegExp('(?:^|\\s)' + escape(name) + '(?=\\s|$)').test(t)));
  if (matches.length === 1) draft.exerciseId = matches[0].id;
  if (matches.length > 1) draft.issues.push('More than one exercise was mentioned. Select the intended exercise.');
  if (draft.exerciseId !== context.exerciseId) draft.issues.push('A different exercise was mentioned. Check the exercise before saving.');
  const unavailable = context.knownExerciseNames?.find(name => !context.exercises.some(e => e.name.toLowerCase() === name.toLowerCase()) && new RegExp('(?:^|\\s)' + escape(name.toLowerCase()) + '(?=\\s|$)').test(t));
  if (unavailable) draft.issues.push(`${unavailable} is not in this workout. Cancel and add it, or explicitly choose the intended exercise.`);
  function extract(pattern: RegExp, label: string): number | null {
    const values = [...t.matchAll(pattern)].map(m => Number(m[1]));
    if (values.length > 1) { draft.issues.push(`Several ${label} values were spoken. Enter one value.`); return null; }
    return values[0] ?? null;
  }
  const units = '(kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pound|pounds|किलो|किलोग्राम|पाउंड)';
  draft.weight = extract(new RegExp(numeric + '\\s*' + units + '(?=\\s|$)', 'g'), 'weight');
  const unitMatch = t.match(new RegExp(numeric + '\\s*' + units + '(?=\\s|$)'));
  if (unitMatch) draft.unit = /^(lb|lbs|pound|pounds|पाउंड)$/.test(unitMatch[2]) ? 'lb' : 'kg';
  draft.reps = extract(new RegExp(numeric + '\\s*(?:reps?|repetitions?|रेप्स?|रिप्स?|दोहराव)(?!\\s+in reserve)(?=\\s|$)', 'g'), 'repetition');
  if (draft.reps === null && !draft.issues.some(i => i.includes('repetition'))) {
    const shorthand = t.match(new RegExp(units + '\\s+for\\s+' + numeric + '$'));
    if (shorthand) draft.reps = Number(shorthand[2]);
  }
  draft.rir = extract(new RegExp(numeric + '\\s*(?:(?:reps? )?in reserve|rir|r i r|आरआईआर|रिजर्व)(?=\\s|$)', 'g'), 'RIR');
  if (/\b(?:same|last|previous) weight\b|उसी वजन/.test(t)) {
    if (draft.weight !== null) { draft.weight = null; draft.issues.push('Both a weight and a previous-weight reference were spoken. Choose the load.'); }
    else if (context.previous) { draft.weight = context.previous.weight; draft.unit = 'kg'; }
    else draft.issues.push('No previous completed set is available. Enter the weight.');
  }
  if (/\bper (?:hand|dumbbell)|\beach(?: hand)?\b|हर हाथ/.test(t)) draft.spokenBasis = 'per_hand';
  if (/\btotal|\bcombined|दोनों/.test(t)) {
    if (draft.spokenBasis) { draft.spokenBasis = null; draft.issues.push('Both per-hand and total load were mentioned. Clarify the weight.'); }
    else draft.spokenBasis = 'total';
  }
  if (/\bper side|\beach side|\bplates?\b/.test(t)) { draft.weight = null; draft.issues.push('Enter the total barbell load, including the bar. Plate weights are not added automatically.'); }
  // Never infer units or a missing weight from the preferred display unit.
  if (draft.weight === null) draft.issues.push('Enter the weight and unit.');
  if (draft.reps === null) draft.issues.push('How many repetitions did you complete?');
  if (/\b(?:not|actually|instead|or)\b|नहीं/.test(t)) draft.issues.push('A correction or alternative was spoken. Check every value.');
  return draft;
}

export function reviewedSet(input: { id: string; weight: string; unit: string; reps: string; rir: string; warmup: boolean; dumbbell: boolean; basis: string }): LiftSet {
  if (!input.weight.trim() || !input.reps.trim() || !['kg', 'lb'].includes(input.unit)) throw new Error('Enter weight, units and repetitions before saving.');
  if (input.dumbbell && !['per_hand', 'total'].includes(input.basis)) throw new Error('Choose your existing dumbbell logging convention.');
  const set = { id: input.id, weight: Number(input.weight) / (input.unit === 'lb' ? 2.2046226218 : 1), reps: Number(input.reps), rir: input.rir.trim() === '' ? null : Number(input.rir), warmup: input.warmup, done: true };
  if (!setSchema.safeParse(set).success || set.reps < 1) throw new Error('Use weight 0–1500 kg, whole reps 1–200, and RIR 0–10 (or leave RIR blank).');
  return set;
}

export const exerciseSnapshot = (session: Session, id: string) => JSON.stringify(session.exercises.find(e => e.id === id) ?? null);
export function commitVoiceSet(session: Session, exerciseId: string, expected: string, set: LiftSet): Session {
  const existing = session.exercises.flatMap(e => e.sets.map(s => ({ exerciseId: e.id, set: s }))).find(s => s.set.id === set.id);
  if (existing) {
    if (existing.exerciseId !== exerciseId || JSON.stringify(existing.set) !== JSON.stringify(set)) throw new Error('This entry already exists with different values. Cancel this preview and edit the saved set directly.');
    return session; // retry the identical journal write, never append twice
  }
  if (exerciseSnapshot(session, exerciseId) !== expected) throw new Error('This exercise changed during review. Parse the entry again before saving.');
  if (!session.exercises.some(e => e.id === exerciseId)) throw new Error('The selected exercise no longer exists.');
  if (!setSchema.safeParse(set).success || !set.done || set.reps < 1) throw new Error('The proposed set is invalid.');
  return { ...session, exercises: session.exercises.map(e => {
    if (e.id !== exerciseId) return e;
    const blank = e.sets.findIndex(s => !s.done && s.warmup === set.warmup && s.weight === 0 && s.reps === 0 && s.rir === null);
    return { ...e, sets: blank < 0 ? [...e.sets, set] : e.sets.map((s, i) => i === blank ? set : s) };
  }) };
}
