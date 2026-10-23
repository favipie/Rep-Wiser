'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, LineChart, Line, Legend } from 'recharts';
import type { ExerciseAnalysis, NextTarget, Observation, SessionAnalysis } from '@/lib/intelligence';

const LIME = '#c7ff42', GREY = '#6b6b66', TIP = { background: '#191919', borderColor: '#444' };
const LEVEL: Record<string, string> = { limited: 'LIMITED EVIDENCE', moderate: 'MODERATE EVIDENCE', stronger: 'STRONGER HISTORICAL SUPPORT' };
const MARK = { met: '✓', unmet: '✗', unknown: '?' } as const;
const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
type Fmt = { units: 'kg' | 'lb'; factor: number };
const wt = (kg: number, f: Fmt) => `${Math.round(kg * f.factor * 100) / 100} ${f.units}`;

function ObservationList({ items, empty }: { items: Observation[]; empty: string }) {
  if (!items.length) return <p className="muted small-text">{empty}</p>;
  return <ul className="obs-list">{items.map(o => <li key={o.id}><b>{o.title}</b>{o.exercise && <span className="pill">{o.exercise.toUpperCase()}</span>}<p>{o.detail}</p></li>)}</ul>;
}

function Target({ t, f }: { t: NextTarget; f: Fmt }) {
  return <div className={'next-target action-' + t.action}>
    <div className="next-head"><span className="pill">{t.actionLabel.toUpperCase()}</span><span className="pill pill-quiet">{LEVEL[t.level]}</span></div>
    <p className="next-line">{t.weight !== null ? <b>{wt(t.weight, f)}</b> : <b>Choose a working load</b>} × {t.repMin}–{t.repMax} reps × {t.sets} sets <span className="muted">· RIR {t.rirMin}–{t.rirMax}</span></p>
    <p><b>Immediate goal.</b> {t.immediateGoal}</p>
    <p className="muted small-text"><b>Progression.</b> {t.progression}</p>
    {t.missing.length > 0 && <ul className="missing"><li className="muted small-text"><b>Affecting confidence:</b></li>{t.missing.map((m, i) => <li key={i} className="small-text muted">{m}</li>)}</ul>}
  </div>;
}

function ExerciseCard({ a, index, f, controls }: { a: ExerciseAnalysis; index: number; f: Fmt; controls?: React.ReactNode }) {
  const prev = a.previousComparable ?? null;
  const data = a.sets.map(s => ({ set: 'Set ' + s.index, Today: s.reps, [prev ? 'Last comparable' : 'x']: prev?.sets[s.index - 1]?.reps ?? null }));
  const hist = a.history.map(h => ({ date: dateText(h.date), load: Math.round(h.topWeight * f.factor * 100) / 100, reps: h.totalReps, e1rm: h.estimated1RM === null ? null : Math.round(h.estimated1RM * f.factor * 10) / 10 }));
  const showE1 = hist.filter(h => h.e1rm !== null).length >= 2;
  return <section className="panel exercise-analysis" id={'exercise-' + a.performedId}>
    <header><div><span className="eyebrow">{String(index + 1).padStart(2, '0')} / {a.muscle.toUpperCase()}{a.secondary.length ? ' · ALSO ' + a.secondary.join(', ').toUpperCase() : ''}</span><h2>{a.name}</h2></div>
      <div className="exercise-meta"><span className="pill">{a.completed}/{a.planned} SETS</span><span className="pill pill-quiet">TARGET {a.repMin}–{a.repMax}</span></div></header>
    <p className="narrative">{a.narrative}</p>
    <div className="set-table" role="table" aria-label={a.name + ' working sets'}>
      <div className="set-line set-head" role="row"><span>SET</span><span>LOAD</span><span>REPS</span><span>RIR</span><span>VS TARGET</span></div>
      {a.sets.map(s => <div className="set-line" role="row" key={s.index}><span>{s.index}</span><span>{wt(s.weight, f)}</span><span>{s.reps}</span><span>{s.rir ?? '—'}</span><span className={s.reachesMax ? 'lime' : s.meetsMin ? '' : 'warn'}>{s.reachesMax ? 'At top' : s.meetsMin ? 'In range' : `${a.repMin - s.reps} below min`}</span></div>)}
      {a.sets.length === 0 && <p className="muted small-text">No completed working sets.</p>}
    </div>
    {a.sets.length > 0 && <div role="img" aria-label={`Reps per set for ${a.name}: ${a.sets.map(s => s.reps).join(', ')}`}><ResponsiveContainer width="100%" height={190}><BarChart data={data}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="set" stroke="#888" fontSize={11} /><YAxis stroke="#888" fontSize={11} width={30} allowDecimals={false} domain={[0, Math.max(a.repMax, ...a.sets.map(s => s.reps)) + 1]} /><Tooltip contentStyle={TIP} />{prev && <Legend wrapperStyle={{ fontSize: 11 }} />}<ReferenceLine y={a.repMin} stroke="#ff9d7a" strokeDasharray="4 3" label={{ value: 'min', fill: '#ff9d7a', fontSize: 10, position: 'insideTopRight' }} /><ReferenceLine y={a.repMax} stroke={LIME} strokeDasharray="4 3" label={{ value: 'top', fill: LIME, fontSize: 10, position: 'insideTopRight' }} />{prev && <Bar dataKey="Last comparable" fill={GREY} />}<Bar dataKey="Today" fill={LIME} /></BarChart></ResponsiveContainer></div>}
    <div className="compare-grid">
      <div><span className="eyebrow">TOTAL REPS</span><strong>{a.totalReps}</strong></div>
      <div><span className="eyebrow">RIR RECORDED</span><strong>{a.rir.recorded}/{a.rir.of}</strong></div>
      <div><span className="eyebrow">{a.loadKind === 'bodyweight' ? 'LOAD' : 'EST. 1RM'}</span><strong>{a.estimated1RM !== null ? wt(a.estimated1RM, f) : a.loadKind === 'bodyweight' ? 'Bodyweight' : 'n/a'}</strong></div>
    </div>
    <p className="small-text muted"><b>Previous session.</b> {a.previous ? a.previous.summary + (a.previous.comparable ? ' (comparable)' : a.previous.differences.length ? ` — not directly comparable: ${a.previous.differences.join('; ')}.` : '') : 'None logged for this exercise.'}</p>
    {(a.records.load || a.records.reps) && <p className="record-note">★ {a.records.detail.join(' ')}</p>}
    <Target t={a.next} f={f} />
    {controls}
    <details><summary>Why this recommendation, and the data behind it</summary>
      <p className="small-text"><b>Rule applied.</b> {a.evidence.rules[0]}</p>
      <p className="small-text muted">{a.next.explanation}</p>
      <h4>Progression checklist</h4>
      <ul className="criteria">{a.criteria.map(c => <li key={c.id} className={'crit-' + c.status}><span aria-label={c.status}>{MARK[c.status]}</span><div><b>{c.label}</b><small>{c.detail}</small></div></li>)}</ul>
      <h4>Evidence</h4>
      <p className="small-text"><span className="pill">{LEVEL[a.evidenceLevel]}</span> <span className="muted">{a.evidenceBasis}</span></p>
      <p className="small-text muted"><b>Trend.</b> {a.trend.summary}</p>
      <p className="small-text muted"><b>Assumptions.</b> {a.evidence.assumptions.join(' ')}</p>
      {a.evidence.limitations.length > 0 && <p className="small-text muted"><b>Limitations.</b> {a.evidence.limitations.join(' ')}</p>}
      <p className="small-text muted"><b>Volume.</b> {a.loadKind === 'external' ? wt(a.loadVolume, f).replace(f.units, f.units + '·reps') : '—'}. {a.volumeLabel}.</p>
      {hist.length >= 2 ? <><h4>History for this exercise</h4><div className="chart-grid">
        <div role="img" aria-label={a.name + ' top working load by session'}><p className="small-text muted">Top working load ({f.units})</p><ResponsiveContainer width="100%" height={170}><LineChart data={hist}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#888" fontSize={10} /><YAxis stroke="#888" fontSize={10} width={36} /><Tooltip contentStyle={TIP} /><Line dataKey="load" stroke={LIME} strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>
        <div role="img" aria-label={a.name + ' total working reps by session'}><p className="small-text muted">Total working reps (all prescriptions; compare with care)</p><ResponsiveContainer width="100%" height={170}><LineChart data={hist}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#888" fontSize={10} /><YAxis stroke="#888" fontSize={10} width={36} /><Tooltip contentStyle={TIP} /><Line dataKey="reps" stroke={LIME} strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>
        {showE1 && <div role="img" aria-label={a.name + ' estimated 1RM by session'}><p className="small-text muted">Estimated 1RM ({f.units}, Epley, sets of 1–12 reps; an estimate, not a test)</p><ResponsiveContainer width="100%" height={170}><LineChart data={hist}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#888" fontSize={10} /><YAxis stroke="#888" fontSize={10} width={36} /><Tooltip contentStyle={TIP} /><Line dataKey="e1rm" stroke={LIME} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} /></LineChart></ResponsiveContainer></div>}
      </div></> : <p className="small-text muted">Charts over time appear once this exercise has two or more logged sessions.</p>}
    </details>
  </section>;
}

export function AnalysisReport({ analysis, units, renderControls }: { analysis: SessionAnalysis; units: 'kg' | 'lb'; renderControls?: (a: ExerciseAnalysis) => React.ReactNode }) {
  const f: Fmt = { units, factor: units === 'lb' ? 2.2046226218 : 1 };
  const o = analysis.overview;
  const adherence = analysis.exercises.map(a => ({ name: a.name.length > 14 ? a.name.slice(0, 13) + '…' : a.name, Planned: a.planned, Completed: a.completed, 'Met minimum': a.setsMeetingMin }));
  const muscles = analysis.muscles.rows.filter(r => r.session || r.thisWeek || r.lastWeek || r.fourWeekAverage).map(r => ({ muscle: r.muscle, 'This week': r.thisWeek, 'Last week': r.lastWeek, '4-wk avg': r.fourWeekAverage }));
  const outcomes = Object.entries(o.outcomes).map(([k, v]) => `${v} ${k === 'smaller' ? 'smaller step' : k}`).join(' · ');
  return <>
    <div className="panel provenance small-text muted">Generated from your saved records every time you open it, so edits to this or earlier workouts always change it. Engine {analysis.engineVersion} · record fingerprint <code>{analysis.fingerprint}</code>. All numbers come from your logs; nothing here is estimated by AI.</div>

    <section aria-labelledby="sec-a"><h2 id="sec-a" className="section-title">What happened</h2>
      <div className="stat-grid">
        <div className="panel"><span>Exercises completed</span><strong>{o.exercisesWithWorkingSets}<small> of {o.exercisesLogged} logged</small></strong></div>
        <div className="panel"><span>Working sets</span><strong>{o.completedSets}<small> of {o.plannedSets} planned{o.extraSets ? ` (+${o.extraSets} extra)` : ''}</small></strong></div>
        <div className="panel"><span>Total working reps</span><strong>{o.totalReps}</strong></div>
        <div className="panel"><span>Logged load volume</span><strong>{Math.round(o.volume.value * f.factor).toLocaleString()}<small> {units}·reps</small></strong></div>
        <div className="panel"><span>Personal bests</span><strong>{o.prCount}<small> vs your logs</small></strong></div>
        <div className="panel"><span>Duration</span><strong>—<small> {o.duration.note}</small></strong></div>
      </div>
      <div className="panel overview-notes small-text">
        <p><b>Volume.</b> {o.volume.label}{o.volume.excluded.length ? ` Excluded (bodyweight only): ${o.volume.excluded.join(', ')}.` : ''}</p>
        <p><b>Comparison.</b> {o.comparisonNote}{o.previousSession ? ` Then: ${o.previousSession.completedSets} working sets, ${o.previousSession.totalReps} reps, ${Math.round(o.previousSession.volume * f.factor).toLocaleString()} ${units}·reps. Today: ${o.completedSets} sets, ${o.totalReps} reps, ${Math.round(o.volume.value * f.factor).toLocaleString()} ${units}·reps.` : ''}</p>
        {outcomes && <p><b>Next-session outcomes.</b> {outcomes}</p>}
        <p><b>Recovery context.</b> {o.recovery.available ? o.recovery.notes.join(' ') : 'No pain, technique or note flags were logged. Readiness, sleep and rest times are not captured.'}</p>
      </div>
      {adherence.length > 0 && <section className="panel"><h3>Target adherence by exercise</h3><ResponsiveContainer width="100%" height={220}><BarChart data={adherence}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="name" stroke="#888" fontSize={10} /><YAxis stroke="#888" fontSize={11} allowDecimals={false} width={30} /><Tooltip contentStyle={TIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Planned" fill={GREY} /><Bar dataKey="Completed" fill="#8fb82f" /><Bar dataKey="Met minimum" fill={LIME} /></BarChart></ResponsiveContainer><p className="muted small-text">“Met minimum” counts completed working sets at or above each exercise’s minimum reps.</p></section>}
    </section>

    <section aria-labelledby="sec-b"><h2 id="sec-b" className="section-title">Exercise by exercise</h2>{analysis.exercises.map((a, i) => <ExerciseCard key={a.performedId} a={a} index={i} f={f} controls={renderControls?.(a)} />)}</section>

    <div className="two-col">
      <section className="panel" aria-labelledby="sec-c"><h2 id="sec-c" className="section-title small">What went well</h2><ObservationList items={analysis.wentWell} empty="No standout positives were identified from the logged data. That is not a judgement; it just means nothing crossed a defined marker." /></section>
      <section className="panel" aria-labelledby="sec-d"><h2 id="sec-d" className="section-title small">What needs attention</h2><ObservationList items={analysis.needsAttention} empty="Nothing in the logged data was flagged. Observations are facts from your log; they do not by themselves mean fatigue, poor recovery or poor technique." />{analysis.needsAttention.length > 0 && <p className="muted small-text">These are observations from the log. A dip does not by itself mean poor recovery, overtraining or bad technique.</p>}</section>
    </div>

    <section aria-labelledby="sec-e"><h2 id="sec-e" className="section-title">Next workout</h2>
      <p className="muted small-text">Suggestions only. REPWISE never changes your plan on its own. Rest intervals are not logged, so none is prescribed.</p>
      {analysis.plan.map(p => <section className="panel plan-card" key={p.performedId}><h3><a href={'#exercise-' + p.performedId}>{p.exercise}</a></h3><Target t={p.target} f={f} /></section>)}
    </section>

    <section className="panel" aria-labelledby="sec-m"><h2 id="sec-m" className="section-title small">Working sets by muscle</h2>
      <div className="stat-grid">{analysis.muscles.rows.filter(r => r.session > 0).map(r => <div className="panel" key={r.muscle}><span>{r.muscle} · this session</span><strong>{r.session}<small> {r.thisWeek} this week · {r.lastWeek} last week</small></strong></div>)}</div>
      {muscles.length > 0 && <div role="img" aria-label="Weekly working sets by primary muscle"><ResponsiveContainer width="100%" height={240}><BarChart data={muscles}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="muscle" stroke="#888" fontSize={10} interval={0} angle={-30} textAnchor="end" height={55} /><YAxis stroke="#888" fontSize={11} allowDecimals={false} width={30} /><Tooltip contentStyle={TIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="This week" fill={LIME} /><Bar dataKey="Last week" fill={GREY} /><Bar dataKey="4-wk avg" fill="#8fb82f" /></BarChart></ResponsiveContainer></div>}
      <p className="muted small-text">{analysis.muscles.convention} Set counts describe programmed work; they do not measure recovery or muscle growth, and there is no universal target.</p>
    </section>

    <details className="panel"><summary>Data gaps and report settings</summary>
      <h4>What would improve this report</h4><ul className="gap-list">{analysis.dataGaps.map((g, i) => <li key={i} className="small-text muted">{g}</li>)}</ul>
      <h4>Criteria used (descriptive, not physiological thresholds)</h4><ul className="gap-list">{Object.entries(analysis.criteria).map(([k, v]) => <li key={k} className="small-text muted">{v}</li>)}</ul>
    </details>
  </>;
}
