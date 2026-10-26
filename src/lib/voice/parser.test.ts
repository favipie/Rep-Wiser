import { describe, it, expect } from 'vitest';
import { parseVoice, reviewedSet, commitVoiceSet, exerciseSnapshot } from './parser';
import { perform, type Session } from '../model';
import { exercises } from '../exercises';

const context = { exerciseId: 'bench', exercises: [{ id: 'bench', name: 'Bench press' }, { id: 'squat', name: 'Back squat' }] };
const previous = { id: 'last', weight: 25, reps: 8, rir: 2, done: true, warmup: false };
const valid = { id: 'voice-1', weight: '30', unit: 'kg', reps: '10', rir: '2', warmup: false, dumbbell: false, basis: '' };
describe('spoken set parser', () => {
  it.each([
    ['10 reps at 5 kg with 2 RIR', 5, 10, 2],
    ['Thirty kilos for eight reps', 30, 8, null],
    ['Das reps, paanch kilo', 5, 10, null],
    ['Pachaas kilo pe aath reps', 50, 8, null],
    ['दस रेप्स पांच किलो दो आरआईआर', 5, 10, 2],
    ['३० किलो १० रेप्स २ आरआईआर', 30, 10, 2],
    ['Ten reps at thirty kilos with two reps in reserve', 30, 10, 2],
    ['twenty five point five kilos, twelve reps, zero RIR', 25.5, 12, 0],
    ['one hundred and thirty five kilos eight reps', 135, 8, null],
  ])('%s', (text, weight, reps, rir) => {
    expect(parseVoice(text, context)).toMatchObject({ weight, reps, rir, requiresConfirmation: true });
  });
  it('resolves a previous weight without inventing one', () => {
    expect(parseVoice('12 reps at the same weight', { ...context, previous })).toMatchObject({ weight: 25, reps: 12, unit: 'kg' });
    expect(parseVoice('12 reps at the same weight', context).weight).toBeNull();
  });
  it('handles warm-up shorthand', () => expect(parseVoice('Warm-up, 20 kilos for 15', context)).toMatchObject({ weight: 20, reps: 15, warmup: true }));
  it('handles the brief’s warm-up phrase', () => expect(parseVoice('Do a warm-up set of fifteen reps at twenty kilos', context)).toMatchObject({ weight: 20, reps: 15, warmup: true }));
  it('keeps missing values editable', () => {
    expect(parseVoice('I managed eight reps with one in reserve', context)).toMatchObject({ weight: null, reps: 8, rir: 1 });
    expect(parseVoice('Das reps kiye, do RIR bache', context)).toMatchObject({ weight: null, reps: 10, rir: 2 });
    expect(parseVoice('30 kilos', context).reps).toBeNull();
    expect(parseVoice('30 for 10 reps', context).unit).toBeNull();
  });
  it('surfaces exercise conflicts', () => {
    expect(parseVoice('squat 30 kg 10 reps', context)).toMatchObject({ exerciseId: 'squat', issues: [expect.stringContaining('different exercise')] });
    expect(parseVoice('bench squat 30 kg 10 reps', context).issues.join()).toContain('More than one');
    expect(parseVoice('dumbbell curl 10 kg 8 reps', { ...context, knownExerciseNames: ['Dumbbell curl'] }).issues.join()).toContain('not in this workout');
  });
  it('does not choose among multiple weights or repetitions', () => {
    expect(parseVoice('30 kg or 40 kg, 10 reps', context).weight).toBeNull();
    expect(parseVoice('30 kg 10 reps actually 8 reps', context).reps).toBeNull();
  });
  it('does not add barbell plates or infer a dumbbell convention', () => {
    expect(parseVoice('20 kilos per side 10 reps', context).weight).toBeNull();
    expect(parseVoice('10 kg 10 reps', context).spokenBasis).toBeNull();
    expect(parseVoice('10 kg each hand 10 reps', context).spokenBasis).toBe('per_hand');
    expect(parseVoice('20 kg combined 10 reps', context).spokenBasis).toBe('total');
    expect(() => reviewedSet({ ...valid, dumbbell: true })).toThrow('convention');
  });
  it.each(['start rest timer', 'stop rest timer', 'show previous set', 'repeat last weight', 'next exercise', 'open workout history', "show today's analysis", 'cancel recording'])('recognizes %s', text => expect(parseVoice(text, context).intent).not.toBe('log_set'));
  it('converts pounds only at validated save', () => expect(reviewedSet({ ...valid, weight: '66.138678654', unit: 'lb' }).weight).toBeCloseTo(30));
  it.each([{ weight: '-5' }, { weight: 'Infinity' }, { weight: '1501' }, { reps: '-1' }, { reps: '0' }, { reps: '2.5' }, { reps: '201' }, { rir: '11' }, { rir: '-1' }, { weight: '' }, { unit: '' }])('rejects invalid reviewed values %j', values => expect(() => reviewedSet({ ...valid, ...values })).toThrow());
  it('preserves a spoken negative for validation rather than making it positive', () => expect(parseVoice('minus five kg ten reps', context).weight).toBe(-5));
});
describe('confirmed set commit', () => {
  function fixture(): Session { return { id: 'workout', name: 'Push', status: 'draft', date: '2026-10-25', exercises: [perform(exercises[0])] }; }
  it('fills one blank slot and retries idempotently', () => {
    const session = fixture(), id = session.exercises[0].id, snapshot = exerciseSnapshot(session, id), set = reviewedSet(valid);
    const next = commitVoiceSet(session, id, snapshot, set);
    expect(next.exercises[0].sets).toHaveLength(3);
    expect(next.exercises[0].sets[0]).toEqual(set);
    expect(session.exercises[0].sets[0].done).toBe(false);
    expect(commitVoiceSet(next, id, snapshot, set)).toBe(next);
  });
  it('rejects a stale preview instead of overwriting manual edits', () => {
    const session = fixture(), id = session.exercises[0].id, snapshot = exerciseSnapshot(session, id);
    session.exercises[0].sets[0].weight = 40;
    expect(() => commitVoiceSet(session, id, snapshot, reviewedSet(valid))).toThrow('changed');
  });
  it('rejects changed retry values rather than claiming they were saved', () => {
    const session = fixture(), id = session.exercises[0].id, snapshot = exerciseSnapshot(session, id);
    const next = commitVoiceSet(session, id, snapshot, reviewedSet(valid));
    expect(() => commitVoiceSet(next, id, snapshot, reviewedSet({ ...valid, reps: '9' }))).toThrow('different values');
  });
  it('preserves completed and partly entered sets', () => {
    const session = fixture(), e = session.exercises[0]; e.sets[0] = previous; e.sets[1].weight = 40;
    const next = commitVoiceSet(session, e.id, exerciseSnapshot(session, e.id), reviewedSet(valid));
    expect(next.exercises[0].sets[0]).toEqual(previous); expect(next.exercises[0].sets[1].weight).toBe(40);
    expect(next.exercises[0].sets[2].id).toBe('voice-1');
  });
});
