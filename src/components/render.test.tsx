import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisReport } from './analysis-report';
import { PlanTracker } from './plan-tracker';
import { exercises } from '@/lib/exercises';
import { analyzeSession } from '@/lib/intelligence';
import { blankData, defaultPreferences, perform, type Data, type Performed, type Session } from '@/lib/model';

const row = (name: string, reps: number[], o: Partial<Performed> = {}): Performed => {
  const p = perform(exercises.find(e => e.name === name)!);
  return { ...p, min: 6, max: 10, ...o, sets: reps.map((r, i) => ({ id: `${p.id}${i}`, weight: 30, reps: r, rir: null, done: true, warmup: false })) };
};
const when = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const sess = (daysAgo: number, exs: Performed[]): Session => ({ id: 's' + daysAgo, name: 'Push', date: when(daysAgo), status: 'complete', exercises: exs });
const dataOf = (sessions: Session[]): Data => ({ ...blankData(), preferences: defaultPreferences, sessions });

describe('analysis report rendering', () => {
  it('renders the spec’s first-session example with specific language', () => {
    const s = sess(0, [row('Bench press', [6, 5, 6])]);
    const html = renderToStaticMarkup(<AnalysisReport analysis={analyzeSession(s, dataOf([s]))} units="kg" />);
    for (const text of ['What happened', 'Exercise by exercise', 'What went well', 'What needs attention', 'Next workout', 'Bench press', '6, 5 and 6 repetitions at 30 kg', 'set 2 fell 1 repetition short', 'LIMITED EVIDENCE', 'RIR missing on 3 of 3', 'Not recorded', 'never changes your plan']) expect(html, text).toContain(text);
    expect(html).not.toContain('Keep progressing');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
  it('renders a multi-exercise session in lb without invented comparisons', () => {
    const s = sess(0, [row('Bench press', [8, 8, 8]), row('Lateral raise', [12, 12, 12], { min: 8, max: 15 }), row('Pull-up', [8, 7, 6], { min: 5, max: 10, increment: 0 })]);
    const html = renderToStaticMarkup(<AnalysisReport analysis={analyzeSession(s, dataOf([s]))} units="lb" />);
    expect(html).toContain('66.14 lb');
    expect(html).toContain('Excluded (bodyweight only): Pull-up');
    expect(html).toContain('No earlier session with this workout name');
    expect(html).not.toContain('NaN');
  });
  it('renders a session whose exercises have no completed sets', () => {
    const e = row('Bench press', [8]); e.sets[0].done = false;
    const s = sess(0, [e]);
    expect(() => renderToStaticMarkup(<AnalysisReport analysis={analyzeSession(s, dataOf([s]))} units="kg" />)).not.toThrow();
  });
});

describe('plan tracker rendering', () => {
  it('shows an empty state with no data', () => {
    expect(renderToStaticMarkup(<PlanTracker data={blankData()} />)).toContain('Nothing planned or logged yet');
  });
  it('shows planned vs achieved sets, reps and activities', () => {
    const html = renderToStaticMarkup(<PlanTracker data={dataOf([sess(1, [row('Bench press', [8, 7, 6], { required: 3 }), row('Lateral raise', [12, 12], { min: 8, max: 15, required: 3 })])])} />);
    for (const text of ['Planned sets', 'Bench press', '3 × 6–10', '8, 7, 6 reps', '2/3 sets', 'PARTIAL', 'Sets <b>5/6</b>', 'Analyze']) expect(html, text).toContain(text);
  });
});
