'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { type Data, defaultPreferences } from '@/lib/model';
import { buildPlanTracker, type DayRecord } from '@/lib/intelligence';

const STATUS: Record<DayRecord['status'], string> = { completed: 'PLAN MET', partial: 'PARTIAL', draft: 'DRAFT', missed: 'MISSED', scheduled: 'SCHEDULED', rest: 'REST' };
const dateLabel = (key: string) => new Date(key + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const short = (key: string) => new Date(key + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function PlanTracker({ data }: { data: Data }) {
  const [days, setDays] = useState(28);
  const [today] = useState(() => new Date());
  const units = (data.preferences ?? defaultPreferences).units;
  const f = units === 'lb' ? 2.2046226218 : 1;
  const w = (kg: number) => `${Math.round(kg * f * 100) / 100} ${units}`;
  const { days: records, summary } = buildPlanTracker(data, today, days);
  const shown = records.filter(r => r.status !== 'rest');
  const chart = [...records].reverse().filter(r => r.status !== 'rest' && r.status !== 'draft').map(r => ({ day: short(r.date), Planned: r.plannedSets, Achieved: r.status === 'scheduled' ? 0 : r.countedSets }));

  return <>
    <div className="page-heading"><div><span className="eyebrow">PLANNED VS ACHIEVED</span><h1>What you planned. What you did<span className="lime">.</span></h1><p className="muted">Every day, the sets and reps you prescribed next to what you logged, and the exercises behind them.</p></div>
      <label>Period<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={28}>Last 28 days</option><option value={90}>Last 90 days</option></select></label></div>
    {!shown.length ? <div className="panel empty"><h2>Nothing planned or logged yet.</h2><p>Finish a workout or assign template days in Workouts, and each day will appear here.</p></div> : <>
      <div className="stat-grid">
        <div className="panel"><span>Planned sets</span><strong>{summary.plannedSets}</strong></div>
        <div className="panel"><span>Sets achieved vs plan</span><strong>{summary.countedSets}<small> {summary.setAdherence === null ? 'no plan yet' : summary.setAdherence + '% of planned'}</small></strong></div>
        <div className="panel"><span>Scheduled days missed</span><strong>{summary.scheduledDaysMissed}<small> of {summary.daysWithPlan} planned days</small></strong></div>
      </div>
      <p className="muted small-text">Reps: {summary.achievedReps} logged against a planned {summary.plannedRepsMin}–{summary.plannedRepsMax} across the period (planned sets × each exercise’s rep range).</p>
      {chart.length > 0 && <section className="panel"><h3>Sets per day: planned vs achieved</h3><ResponsiveContainer width="100%" height={230}><BarChart data={chart}><CartesianGrid stroke="#333" strokeDasharray="3 3" /><XAxis dataKey="day" stroke="#888" fontSize={10} interval="preserveStartEnd" /><YAxis stroke="#888" fontSize={11} allowDecimals={false} width={30} /><Tooltip contentStyle={{ background: '#191919', borderColor: '#444' }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Planned" fill="#6b6b66" /><Bar dataKey="Achieved" fill="#c7ff42" /></BarChart></ResponsiveContainer><p className="muted small-text">Achieved counts completed working sets up to the planned number; extra sets are shown in the day details.</p></section>}
      {shown.map(d => <section className="panel plan-day" key={d.date}>
        <header><div><span className="eyebrow">{dateLabel(d.date).toUpperCase()}{d.sessions.length ? ' · ' + d.sessions.map(s => s.name).join(' + ') : d.templateName ? ' · ' + d.templateName : ''}</span></div><span className={'pill plan-' + d.status}>{STATUS[d.status]}</span></header>
        {d.status === 'draft' && <p className="muted small-text">Unfinished draft. Finish the workout to compare it with the plan.</p>}
        {d.plannedFromTemplate && <p className="muted small-text">{d.status === 'missed' ? 'No workout was logged on this scheduled day.' : 'Scheduled from your template.'} Plan shown is the template’s current prescription.</p>}
        <div className="plan-table" role="table" aria-label={'Plan vs achieved for ' + dateLabel(d.date)}>
          <div className="plan-row plan-head" role="row"><span>Exercise</span><span>Planned</span><span>Achieved</span></div>
          {d.activities.map((a, i) => <div className="plan-row" role="row" key={a.name + i}>
            <span><b>{a.name}</b><small>{a.muscle}</small></span>
            <span>{a.plannedSets} × {a.repMin}–{a.repMax}</span>
            <span className={'plan-' + a.status}>{a.source === 'template' ? (d.status === 'missed' ? 'Not done' : '—') : <>{a.achievedSets}/{a.plannedSets} sets · {a.sets.length ? a.sets.map(s => s.reps).join(', ') + ' reps' : 'no sets'}<small>{a.sets.length ? (new Set(a.sets.map(s => s.weight)).size === 1 ? w(a.sets[0].weight) : a.sets.map(s => w(s.weight)).join(' / ')) : ''}{a.sets.length && a.setsMeetingMin < a.sets.length ? ` · ${a.sets.length - a.setsMeetingMin} below ${a.repMin}` : ''}{a.achievedSets > a.plannedSets ? ` · ${a.achievedSets - a.plannedSets} extra` : ''}</small></>}</span>
          </div>)}
        </div>
        {d.status !== 'draft' && d.status !== 'scheduled' && <p className="plan-total">Sets <b>{d.countedSets}/{d.plannedSets}</b>{d.achievedSets > d.countedSets ? ` (+${d.achievedSets - d.countedSets} extra)` : ''} · Reps <b>{d.achievedReps}</b> vs planned {d.plannedRepsMin}–{d.plannedRepsMax}</p>}
        {d.sessions.filter(s => s.status === 'complete').map(s => <Link key={s.id} className="text-link" href={'/workouts/analysis/?session=' + s.id}>Analyze “{s.name}” ↗</Link>)}
      </section>)}
      <p className="muted small-text">Planned = the sets and rep range stored on each logged exercise. Achieved = completed working sets only (warm-ups excluded). Past template versions are not stored, so missed days use today’s template.</p>
    </>}
  </>;
}
