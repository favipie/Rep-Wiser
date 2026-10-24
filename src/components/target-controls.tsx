'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { type Data, type Session } from '@/lib/model';
import { type ExerciseAnalysis } from '@/lib/intelligence';
import { applyToExercise, contextFor, decideTarget, isActive, listTargets, staleReason, type Context, type Target } from '@/lib/targets';

const messageOf = (e: unknown) => e instanceof Error ? e.message : 'The target could not be saved. Please try again.';
export function TargetDecision({ owner, data, source, analysis }: { owner: string; data: Data; source: Session; analysis: ExerciseAnalysis }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const [modify, setModify] = useState(false);
  const [generation, setGeneration] = useState(0);
  const factor = data.preferences?.units === 'lb' ? 2.2046226218 : 1;
  const units = data.preferences?.units ?? 'kg';
  const next = analysis.next;
  const [weight, setWeight] = useState(next.weight === null ? '' : String(Math.round(next.weight * factor * 100) / 100));
  const [min, setMin] = useState(String(next.repMin));
  const [max, setMax] = useState(String(next.repMax));
  const [sets, setSets] = useState(String(next.sets));
  useEffect(() => {
    let cancelled = false;
    Promise.all([listTargets(owner), contextFor(owner, source, analysis.performedId)]).then(([ts, ctx]) => {
      if (!cancelled) { setTargets(ts); setContext(ctx); setError(''); }
    }).catch(e => { if (!cancelled) setError(messageOf(e)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [owner, source, analysis.performedId, generation]);
  const active = targets.find(t => t.exercise_id === context?.exerciseId && isActive(t));
  const history = targets.filter(t => t.source_performed_id === analysis.performedId);
  async function save(status: 'accepted' | 'modified' | 'rejected') {
    if (!context) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (status === 'modified' && [weight, min, max, sets].some(v => !v.trim())) throw new Error('Complete all four target fields.');
      const prescription = status === 'modified' ? { weight: Number(weight) / factor, min: Number(min), max: Number(max), sets: Number(sets) } : { weight: next.weight ?? 0, min: next.repMin, max: next.repMax, sets: next.sets };
      await decideTarget(owner, data, source, analysis.performedId, context, status, { ...next }, prescription, active?.id ?? null);
      setTargets(await listTargets(owner)); setModify(false);
      setMessage(status === 'rejected' ? 'Suggestion rejected. Your decision was saved.' : `Target saved ${owner === 'guest' ? 'on this device' : 'to your account'}. Choose Apply saved target in your next workout.`);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return <div className="target-controls">
    <h4>Choose your next target</h4>
    <p className="small-text muted">{owner === 'guest' ? 'Saved only in this browser.' : 'Saved to your account after your workout is synced.'} {active ? 'Saving a new decision replaces your current active target and keeps its history.' : 'Your plan changes only when you apply a saved target.'}</p>
    {modify && <div className="target-fields">
      <label>Weight ({units})<input type="number" min="0" step="any" value={weight} onChange={e => setWeight(e.target.value)} /></label>
      <label>Minimum reps<input type="number" min="1" max="200" value={min} onChange={e => setMin(e.target.value)} /></label>
      <label>Maximum reps<input type="number" min="1" max="200" value={max} onChange={e => setMax(e.target.value)} /></label>
      <label>Working sets<input type="number" min="1" max="20" value={sets} onChange={e => setSets(e.target.value)} /></label>
    </div>}
    <div className="set-actions">
      <Button size="small" disabled={busy || !context || (!modify && next.weight === null)} onClick={() => void save(modify ? 'modified' : 'accepted')}>{busy ? 'Please wait…' : modify ? 'Save modified target' : 'Accept target'}</Button>
      <Button size="small" variant="outline" disabled={busy || !context} onClick={() => setModify(!modify)}>{modify ? 'Cancel changes' : 'Modify target'}</Button>
      <Button size="small" variant="ghost" disabled={busy || !context} onClick={() => void save('rejected')}>Reject suggestion</Button>
    </div>
    {message && <p role="status" className="lime">{message}</p>}
    {error && <div role="alert" className="error"><p>{error}</p><Button size="small" variant="outline" disabled={busy} onClick={() => { setBusy(true); setGeneration(g => g + 1); }}>Reload saved decisions</Button></div>}
    {history.length > 0 && <details><summary>Saved decision history ({history.length})</summary>{history.map(t => <p key={t.id} className="small-text">{new Date(t.decided_at).toLocaleString()} · {t.status}{t.weight_kg !== null ? ` · ${Math.round(t.weight_kg * factor * 100) / 100} ${units} × ${t.rep_min}–${t.rep_max} × ${t.sets} sets` : ''}</p>)}</details>}
  </div>;
}

export function WorkoutTargets({ owner, data, session, onChange }: { owner: string; data: Data; session: Session; onChange: (s: Session) => void }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => { let cancelled = false; listTargets(owner).then(ts => { if (!cancelled) { setTargets(ts); setError(''); } }).catch(e => { if (!cancelled) setError(messageOf(e)); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [owner, generation]);
  async function apply(t: Target, performedId: string) {
    setBusy(true); setError('');
    try {
      const current = (await listTargets(owner)).find(x => x.id === t.id);
      if (!current || !isActive(current)) throw new Error('This target changed. Reload saved targets.');
      const stale = staleReason(current, data); if (stale) throw new Error(stale);
      if (owner !== 'guest') {
        const source = data.sessions.find(s => s.id === t.source_session_id)!;
        // Draft edits can be unsynced; source freshness is checked again when finishing.
        const { supabase } = await import('@/lib/supabase');
        const result = await supabase!.rpc('target_context', { p_session_id: source.id, p_performed_id: t.source_performed_id });
        if (result.error) throw new Error(result.error.message);
        if (result.data.fingerprint !== t.analysis_fingerprint) throw new Error('Cloud source changed. Sync and review the analysis.');
      }
      if (!confirm('Replace this exercise’s uncompleted working sets with the saved target?')) return;
      onChange({ ...session, exercises: session.exercises.map(e => e.id === performedId ? applyToExercise(e, current) : e) });
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  const factor = data.preferences?.units === 'lb' ? 2.2046226218 : 1;
  return <section className="panel target-planner"><h3>Saved next-workout targets</h3>
    {loading && <p role="status">Loading saved targets…</p>}
    {!loading && !targets.some(t => isActive(t)) && !error && <p className="muted small-text">Accept a suggestion in a completed workout’s analysis, then apply it here after adding the exercise.</p>}
    {session.exercises.filter(e => e.targetId).map(e => <div key={e.id} className="recommendation"><b>{e.name} · saved target selected</b><p className="small-text muted">If the recommendation changed, keep your logged workout and remove its target link before finishing or syncing again.</p><Button size="small" variant="outline" onClick={() => onChange({ ...session, exercises: session.exercises.map(x => x.id === e.id ? { ...x, targetId: undefined, targetWeight: undefined } : x) })}>Keep workout without target link</Button></div>)}
    {session.status === 'draft' && targets.filter(isActive).map(t => {
      const e = session.exercises.find(e => e.exerciseId === t.exercise_id);
      const stale = staleReason(t, data);
      return <div className="recommendation" key={t.id}><b>{e?.name ?? data.sessions.find(s => s.id === t.source_session_id)?.exercises.find(e => e.id === t.source_performed_id)?.name ?? 'Saved exercise'}</b><p>{Math.round((t.weight_kg ?? 0) * factor * 100) / 100} {data.preferences?.units ?? 'kg'} × {t.rep_min}–{t.rep_max} reps × {t.sets} sets</p>
        {stale ? <p className="warn">{stale}</p> : !e ? <p className="muted small-text">Add this exercise to use its target.</p> : <Button size="small" disabled={busy || e.targetId === t.id || e.sets.some(s => s.done)} onClick={() => void apply(t, e.id)}>{e.targetId === t.id ? 'Added to this workout' : 'Apply saved target'}</Button>}</div>;
    })}
    {error && <p role="alert" className="error">{error}</p>}
    <Button size="small" variant="ghost" disabled={busy || loading} onClick={() => { setLoading(true); setGeneration(g => g + 1); }}>Refresh targets</Button>
    <Button size="small" variant="ghost" disabled={loading || !!error} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(targets, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'repwise-target-decisions.json'; a.click(); URL.revokeObjectURL(url); }}>Export target decisions</Button>
  </section>;
}
