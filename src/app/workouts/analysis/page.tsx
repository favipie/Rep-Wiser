'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnalysisReport } from '@/components/analysis-report';
import { loadJournal, resolveOwner } from '@/lib/journal';
import { defaultPreferences, type Data } from '@/lib/model';
import { analyzeSession } from '@/lib/intelligence';

type State = { status: 'loading' } | { status: 'signedout' } | { status: 'error'; message: string } | { status: 'ready'; data: Data; notice: string };

function Analysis() {
  const id = useSearchParams().get('session');
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const owner = await resolveOwner();
        if (cancelled) return;
        if (!owner) { setState({ status: 'signedout' }); return; }
        const j = await loadJournal(owner);
        if (!cancelled) setState({ status: 'ready', data: j.data, notice: j.notice });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String((e as { message?: string }).message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const session = state.status === 'ready' && id ? state.data.sessions.find(s => s.id === id) : undefined;
  const analysis = useMemo(() => (state.status === 'ready' && session?.status === 'complete' ? analyzeSession(session, state.data) : null), [state, session]);
  const units = state.status === 'ready' ? (state.data.preferences ?? defaultPreferences).units : 'kg';
  const back = <Button asChild variant="outline" size="small"><Link href="/train/">← Back to journal</Link></Button>;
  const panel = (title: string, body: string, extra?: React.ReactNode) => <section className="panel empty"><h2>{title}</h2><p>{body}</p>{extra}</section>;

  let content: React.ReactNode;
  if (state.status === 'loading') content = <p role="status">Opening your workout analysis…</p>;
  else if (state.status === 'signedout') content = panel('Sign in to see this analysis.', 'Open your training journal, sign in or continue on this device, then return to this page.', <Button asChild><Link href="/train/">Open journal <ArrowUpRight size={17} /></Link></Button>);
  else if (state.status === 'error') content = <div role="alert" className="error">Your journal could not be loaded: {state.message}. Your saved data has not been changed.</div>;
  else if (!id) content = panel('No workout selected.', 'Open a saved workout from History and choose Analyze workout.', back);
  else if (!session) content = panel('This workout was not found.', 'It may have been deleted, or it belongs to a different journal.', back);
  else if (session.status !== 'complete') content = panel('Finish this workout to analyze it.', 'Analysis only covers completed workouts. Your draft is saved.', back);
  else if (analysis) content = <>
    {state.status === 'ready' && state.notice && <div className="notice" role="status">{state.notice}</div>}
    <AnalysisReport analysis={analysis} units={units} />
  </>;

  return <main className="training analysis-page"><div className="analysis-wrap">
    <div className="page-heading"><div><Link href="/" className="wordmark">repwise<span>↗</span></Link><span className="eyebrow" style={{ marginTop: 28 }}>WORKOUT INTELLIGENCE</span><h1>{session ? session.name : 'Workout analysis'}<span className="lime">.</span></h1>{session && <p className="muted">{new Date(session.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>}</div>{back}</div>
    {content}
  </div></main>;
}
export default function AnalysisPage() { return <Suspense fallback={<main className="training analysis-page"><p role="status">Opening your workout analysis…</p></main>}><Analysis /></Suspense>; }
