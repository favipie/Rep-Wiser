'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Data } from '@/lib/model';
import { supabase } from '@/lib/supabase';
import { buildContext, makeSnapshot } from '@/lib/coach/context';
import { coachReplySchema, type CoachReply } from '@/lib/coach/contracts';
import { coachSources } from '@/lib/coach/sources';
import { listen, recognitionFactory } from '@/lib/voice/recognition';
import { VoiceSpeech, useVoiceSpeech } from './voice-speech';

type Turn = { question: string; reply: CoachReply };
const suggestions = ['Why did my bench press reps decrease today?', 'What is progressive overload?', 'What is the difference between whey concentrate and isolate?', 'Which exercises improved most this month?'];

export function AskRepwise(props: { data: Data; owner: string }) {
  return <VoiceSpeech automaticLabel="Read answers automatically"><Coach {...props}/></VoiceSpeech>;
}
function Coach({ data, owner }: { data: Data; owner: string }) {
  const [question, setQuestion] = useState('');
  const [sharing, setSharing] = useState(false);
  const [focus, setFocus] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState('');
  const [language, setLanguage] = useState('en-IN');
  const request = useRef<AbortController | null>(null);
  const microphone = useRef<ReturnType<typeof listen> | null>(null);
  const speech = useVoiceSpeech();
  const enabled = process.env.NEXT_PUBLIC_REPWISE_COACH_ENABLED === 'true' && !!supabase;
  const available = enabled && owner !== 'guest';
  const preview = useMemo(() => {
    if (!sharing) return null;
    try { const snapshot = makeSnapshot(data, focus); return { snapshot, context: buildContext(snapshot) }; }
    catch { return null; }
  }, [data, sharing, focus]);
  const choices = [...new Map(data.sessions.flatMap(s => s.exercises.map(e => [e.exerciseId, e.name] as const))).entries()];
  useEffect(() => {
    const hide = () => { if (document.hidden) { microphone.current?.cancel(); microphone.current = null; setRecording(''); } };
    document.addEventListener('visibilitychange', hide);
    return () => { request.current?.abort(); microphone.current?.cancel(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  function clear() {
    request.current?.abort(); request.current = null; microphone.current?.cancel(); microphone.current = null;
    speech.stop(); setTurns([]); setBusy(false); setError(''); setRecording(''); setQuestion('');
  }
  function dictate() {
    const Factory = recognitionFactory();
    if (!Factory) { setError('Voice input is unavailable in this browser. You can type your question.'); return; }
    microphone.current?.cancel(); speech.stop(); setError('');
    microphone.current = listen(Factory, language, { state: setRecording, result: text => { setQuestion(text.slice(0, 1500)); setRecording(''); microphone.current = null; }, error: message => { setError(message); setRecording(''); microphone.current = null; } });
  }
  async function send() {
    if (!available || !supabase || request.current || !question.trim() || (sharing && !preview)) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    const submitted = question.trim();
    microphone.current?.cancel(); setRecording(''); speech.stop(); setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError || !auth.session || auth.session.user.id !== owner) throw new Error('Sign in again to ask the coach.');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ask-repwise`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.session.access_token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        body: JSON.stringify({ question: submitted, history: turns.flatMap(t => [{ role: 'user', text: t.question }, { role: 'assistant', text: t.reply.answer }]).slice(-6), shareWorkouts: sharing, snapshot: sharing ? preview!.snapshot : null }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to ask the coach.' : response.status === 429 ? 'The coach has reached its request limit. Please try later.' : 'The coach is unavailable right now. Your workout journal still works.');
      const reply = coachReplySchema.parse(await response.json());
      if (request.current !== controller || controller.signal.aborted) return;
      setTurns(previous => [...previous, { question: submitted, reply }].slice(-6)); setQuestion(''); speech.speak(reply.answer, true);
    } catch (e) {
      if (request.current === controller) setError(controller.signal.aborted ? 'The answer timed out. Please try again.' : e instanceof Error && !(e.name === 'ZodError') ? e.message : 'The coach returned an unreadable answer. Please try again.');
    } finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  return <section className="coach" aria-label="Ask REPWISE">
    <div className="page-heading"><div><span className="eyebrow">YOUR AI GYM ASSISTANT</span><h1>Ask REPWISE<span className="lime">.</span></h1><p className="muted">Understand your training. Ask your next question.</p></div><button type="button" onClick={clear}>Clear conversation</button></div>
    {!available && <p className="notice" role="status">{enabled ? 'Sign in with an account to use AI answers. Device journaling remains available.' : 'AI answers are not connected yet. You can draft a question and preview your workout summary on this device.'}</p>}
    <div className="panel">
      <label className="coach-consent"><input type="checkbox" checked={sharing} onChange={e => { clear(); setSharing(e.target.checked); }}/>Allow workout history in this conversation</label>
      <p className="small-text muted">Off by default. Sending a question shares its text and recent conversation with the AI provider. With this option on, selected sets and training preferences go to the secure coach service; calculated summaries go to the AI provider. Private notes and workout titles are excluded. Changing sharing clears this conversation; it cannot recall previously sent data.</p>
      {sharing && <><label>Workout context<select value={focus} onChange={e => { clear(); setFocus(e.target.value); }}><option value="">All exercises</option>{choices.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        {preview ? <details><summary>Preview shared workout context</summary><p>Calculated on this device — not an AI answer. Nothing is sent until you ask.</p><p>{preview.context.scope}</p>{preview.context.evidence.map(e => <article className="recommendation" key={e.id}><h3>{e.title}</h3><p>{e.facts}</p><p><b>REPWISE guidance:</b> {e.guidance}</p></article>)}<details><summary>Exact workout data sent to the coach service</summary><pre className="coach-json">{JSON.stringify(preview.snapshot, null, 2)}</pre></details></details> : <p role="alert">This workout selection is too large or contains unsupported values. Select one exercise or turn off sharing.</p>}</>}
    </div>
    <div className="coach-turns" aria-live="polite" aria-busy={busy}>{turns.map((turn, index) => <article className="panel" key={index}><p className="eyebrow">YOU ASKED</p><h2>{turn.question}</h2><p className="eyebrow">ASK REPWISE · AI ANSWER</p><p className="coach-answer">{turn.reply.answer}</p>
      {!!turn.reply.possibleExplanations.length && <><h3>Possible explanations, not established causes</h3><ul>{turn.reply.possibleExplanations.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
      {turn.reply.followUp && <p>{turn.reply.followUp}</p>}
      {turn.reply.context?.evidence.filter(e => turn.reply.evidenceIds.includes(e.id)).map(e => <details key={e.id}><summary>Recorded evidence · {e.title}</summary><p>{e.facts}</p><p><b>Calculated guidance:</b> {e.guidance}</p></details>)}
      {!!turn.reply.sourceIds.length && <div><h3>Education references</h3><ul>{coachSources.filter(s => turn.reply.sourceIds.includes(s.id)).map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul></div>}
      <button type="button" onClick={() => speech.speak(turn.reply.answer)}>Speak answer</button>
    </article>)}</div>
    <form className="panel" onSubmit={e => { e.preventDefault(); void send(); }}>
      {!turns.length && <div className="coach-prompts">{suggestions.map(s => <button key={s} type="button" disabled={busy} onClick={() => setQuestion(s)}>{s}</button>)}</div>}
      <label>Your question<textarea rows={4} maxLength={1500} value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} placeholder="What would you like to understand about your training?"/></label>
      <p className="small-text muted">Microphone use is optional. Your browser may send speech to its recognition service. Review the transcript before sending.</p>
      <label>Speech language<select value={language} disabled={!!recording || busy} onChange={e => setLanguage(e.target.value)}><option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="hi-IN">Hindi (India)</option></select></label>
      <div className="set-actions"><button type="button" disabled={busy || !!recording} onClick={dictate}>Dictate question</button>{recording && <><button type="button" onClick={() => microphone.current?.stop()}>Finish recording</button><button type="button" onClick={() => { microphone.current?.cancel(); setRecording(''); }}>Cancel recording</button></>}<button type="submit" disabled={!available || busy || !!recording || !question.trim() || (sharing && !preview)}>{busy ? 'Thinking…' : 'Ask REPWISE'}</button>{busy && <button type="button" onClick={clear}>Cancel answer</button>}</div>
      {recording && <p role="status">Microphone: {recording}…</p>}{error && <p role="alert" className="error">{error}</p>}
    </form><p className="small-text muted">Educational support, not a replacement for a qualified trainer or healthcare professional. AI can make mistakes. Answers never change your workout targets. This conversation stays in memory and clears when you leave this page.</p>
  </section>;
}
