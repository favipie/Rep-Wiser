'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { type Exercise, type Session, uid } from '@/lib/model';
import { commitVoiceSet, exerciseSnapshot, parseVoice, reviewedSet, type VoiceDraft } from '@/lib/voice/parser';
import { listen, recognitionFactory } from '@/lib/voice/recognition';
import { useVoiceSpeech } from './voice-speech';

type Preview = { draft: VoiceDraft; id: string; snapshot: string; weight: string; unit: string; reps: string; rir: string; basis: string; checked: boolean };
export function VoiceLogger({ session, library, history, onChange, onRest }: {
  session: Session; library: Exercise[]; history: Session[]; onChange: (session: Session) => void | boolean; onRest: (seconds: number) => void;
}) {
  const [selected, setSelected] = useState(session.exercises[0]?.id ?? '');
  const exerciseId = session.exercises.some(e => e.id === selected) ? selected : session.exercises[0]?.id ?? '';
  const [language, setLanguage] = useState('en-IN');
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const recognition = useRef<ReturnType<typeof listen> | null>(null);
  const busy = useRef(false);
  const saving = useRef(false);
  const speech = useVoiceSpeech();
  const isRecording = ['requesting', 'listening', 'processing'].includes(state);
  useEffect(() => {
    setSupported(!!recognitionFactory());
    const hide = () => { if (document.hidden) { recognition.current?.cancel(); recognition.current = null; busy.current = false; setState('idle'); setMessage('Microphone stopped because this page was hidden.'); } };
    document.addEventListener('visibilitychange', hide);
    return () => { recognition.current?.cancel(); busy.current = false; document.removeEventListener('visibilitychange', hide); };
  }, []);
  function previous(id: string) {
    const exercise = session.exercises.find(e => e.id === id);
    return exercise?.sets.filter(s => s.done).at(-1) ?? history.filter(s => s.id !== session.id && s.status === 'complete' && s.date <= session.date)
      .sort((a, b) => b.date.localeCompare(a.date)).flatMap(s => s.exercises.filter(e => e.exerciseId === exercise?.exerciseId).flatMap(e => e.sets.filter(s => s.done).slice().reverse()))[0];
  }
  function review(text: string, id = exerciseId) {
    setMessage(''); setPreview(null); saving.current = false;
    const draft = parseVoice(text, { exerciseId: id, exercises: session.exercises, knownExerciseNames: library.map(e => e.name), previous: previous(id) });
    if (draft.intent !== 'log_set' && draft.intent !== 'repeat_weight') {
      setState('idle');
      if (draft.intent === 'cancel') { setTranscript(''); setMessage('Entry cancelled. Nothing saved.'); }
      else if (draft.intent === 'start_rest' || draft.intent === 'stop_rest') { onRest(draft.intent === 'start_rest' ? 90 : 0); setMessage(draft.intent === 'start_rest' ? '90-second rest timer started.' : 'Rest timer stopped.'); }
      else if (draft.intent === 'previous_set') { const last = previous(id); setMessage(last ? `Previous completed set: ${Math.round(last.weight * 100) / 100} kg, ${last.reps} reps, ${last.rir === null ? 'RIR not recorded' : last.rir + ' RIR'}.` : 'No previous completed set is available.'); }
      else if (draft.intent === 'next_exercise') { const next = session.exercises[session.exercises.findIndex(e => e.id === id) + 1]; if (next) setSelected(next.id); setMessage(next ? `Selected ${next.name}.` : 'This is the last exercise.'); }
      else setMessage('Save & close this workout to open History or its analysis. No workout data was changed.');
      return;
    }
    if (draft.intent === 'repeat_weight') { const last = previous(id); draft.weight = last?.weight ?? null; draft.unit = last ? 'kg' : null; draft.issues.push('Enter the repetitions for your new set.'); }
    setSelected(draft.exerciseId);
    setPreview({ draft, id: uid(), snapshot: exerciseSnapshot(session, draft.exerciseId), weight: draft.weight === null ? '' : String(draft.weight), unit: draft.unit ?? '', reps: draft.reps === null ? '' : String(draft.reps), rir: draft.rir === null ? '' : String(draft.rir), basis: '', checked: false });
    setState('review');
  }
  function cancel() { recognition.current?.cancel(); recognition.current = null; busy.current = false; setPreview(null); setTranscript(''); setState('idle'); setMessage('Entry cancelled. Nothing saved.'); speech.stop(); }
  function start() {
    if (busy.current || !exerciseId) return;
    const Factory = recognitionFactory();
    if (!Factory) { setMessage('Speech recognition is unavailable. Type your entry below.'); return; }
    speech.stop(); busy.current = true; setPreview(null); setTranscript(''); setMessage('');
    try {
      recognition.current = listen(Factory, language, {
        state: setState,
        result: text => { busy.current = false; setTranscript(text); review(text, exerciseId); },
        error: text => { busy.current = false; setState('error'); setMessage(text); },
      });
    } catch { busy.current = false; setState('error'); setMessage('The microphone could not start. Type your entry below.'); }
  }
  function edit(values: Partial<Preview>) { setPreview(p => p ? { ...p, ...values, checked: false } : p); setMessage(''); }
  function confirm() {
    if (!preview || saving.current || !preview.checked) return;
    saving.current = true; setState('saving');
    try {
      const selectedExercise = session.exercises.find(e => e.id === preview.draft.exerciseId);
      const equipment = library.find(e => e.id === selectedExercise?.exerciseId)?.equipment ?? '';
      const set = reviewedSet({ ...preview, warmup: preview.draft.warmup, dumbbell: /dumbbell/i.test(equipment + ' ' + selectedExercise?.name) });
      const next = commitVoiceSet(session, preview.draft.exerciseId, preview.snapshot, set);
      const saved = onChange(next);
      if (saved === false) { setState('error'); setMessage('This set is in memory, but device storage failed. Free storage and retry confirmation, or export your journal before leaving. Retrying will not add another set.'); saving.current = false; return; }
      const response = `Set saved. ${selectedExercise?.name}: ${set.reps} reps at ${Math.round(set.weight * 100) / 100} kg${set.rir === null ? ', RIR not recorded' : ', ' + set.rir + ' RIR'}.`;
      setMessage(response); setPreview(null); setTranscript(''); setState('saved'); speech.speak(response, true);
    } catch (error) { setState('error'); setMessage(error instanceof Error ? error.message : 'Could not save this entry.'); saving.current = false; }
  }
  const reviewedExercise = session.exercises.find(e => e.id === preview?.draft.exerciseId);
  const equipment = library.find(e => e.id === reviewedExercise?.exerciseId)?.equipment ?? '';
  const dumbbell = /dumbbell/i.test(equipment + ' ' + reviewedExercise?.name);
  return <section className="panel voice-panel" aria-label="REPWISE Voice">
    <span className="eyebrow">REPWISE VOICE</span><h2>Say your set. Check it. Save it.</h2>
    <p className="muted">Your browser may send audio to its speech provider and may require internet. REPWISE does not store recordings. Nothing is logged until you confirm.</p>
    <div className="form-grid"><label>Voice exercise<select value={exerciseId} disabled={isRecording || !!preview} onChange={e => setSelected(e.target.value)}>{session.exercises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label>Recognition language<select value={language} disabled={isRecording} onChange={e => setLanguage(e.target.value)}><option value="en-IN">English / Hinglish (India)</option><option value="hi-IN">Hindi (India)</option><option value="en-US">English (US)</option></select></label></div>
    <div className="set-actions"><button type="button" className="voice-mic" disabled={!supported || !exerciseId || isRecording || !!preview} onClick={start}><Mic size={20}/>Record a set</button>
      {isRecording && <button type="button" onClick={() => recognition.current?.stop()} disabled={state === 'processing'}>Finish speaking</button>}
      <button type="button" disabled={!isRecording && !preview && !transcript} onClick={cancel}>Cancel entry</button></div>
    <p className="voice-status" role="status">{({ idle: 'Ready', requesting: 'Requesting microphone permission…', listening: 'Listening — microphone active', processing: 'Processing speech…', review: 'Review entry — not saved yet', saving: 'Saving…', saved: 'Saved on this device', error: 'Please check the message below' } as Record<string, string>)[state]}</p>
    {!supported && <p>Microphone recognition is unavailable here. Type an entry below or use the normal set fields.</p>}
    {!session.exercises.length && <p>Add an exercise to start voice logging.</p>}
    <label>Spoken or typed entry<textarea maxLength={500} value={transcript} disabled={isRecording || state === 'saving'} placeholder="30 kilos, 10 reps, 2 RIR" onChange={e => { setTranscript(e.target.value); setPreview(null); setState('idle'); }}/></label>
    <button type="button" disabled={isRecording || !exerciseId || !transcript.trim()} onClick={() => review(transcript)}>Review entry</button>
    {preview && <fieldset className="voice-preview"><legend>Confirm your set</legend>
      {preview.draft.issues.length > 0 && <ul>{preview.draft.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      <div className="form-grid"><label>Confirm exercise<select value={preview.draft.exerciseId} onChange={e => edit({ draft: { ...preview.draft, exerciseId: e.target.value }, snapshot: exerciseSnapshot(session, e.target.value), basis: '' })}>{session.exercises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Set type<select value={preview.draft.warmup ? 'warmup' : 'working'} onChange={e => edit({ draft: { ...preview.draft, warmup: e.target.value === 'warmup' } })}><option value="working">Working set</option><option value="warmup">Warm-up</option></select></label>
        <label>Confirm weight<input inputMode="decimal" type="number" min="0" step="any" value={preview.weight} onChange={e => edit({ weight: e.target.value })}/></label>
        <label>Confirm unit<select value={preview.unit} onChange={e => edit({ unit: e.target.value })}><option value="">Choose units</option><option value="kg">kg</option><option value="lb">lb</option></select></label>
        <label>Confirm repetitions<input inputMode="numeric" type="number" min="1" max="200" step="1" value={preview.reps} onChange={e => edit({ reps: e.target.value })}/></label>
        <label>Confirm RIR (optional)<input inputMode="decimal" type="number" min="0" max="10" step="any" value={preview.rir} onChange={e => edit({ rir: e.target.value })}/></label></div>
      {dumbbell ? <><label>My existing dumbbell weight convention<select value={preview.basis} onChange={e => edit({ basis: e.target.value })}><option value="">Choose your usual convention</option><option value="per_hand">Weight of one dumbbell / per hand</option><option value="total">Combined weight of both dumbbells</option></select></label><p>Enter the weight using the same convention as your earlier sets. {preview.draft.spokenBasis ? `You said ${preview.draft.spokenBasis === 'per_hand' ? 'per hand' : 'combined weight'}. ` : ''}Weights are not automatically doubled or halved; adjust the field if needed.</p></> : <p>{/bodyweight/i.test(equipment) ? 'Enter added external load only. Use 0 for bodyweight alone.' : 'Use your usual total external load. For barbells, include the bar.'}</p>}
      <label className="voice-verify"><input type="checkbox" checked={preview.checked} onChange={e => setPreview({ ...preview, checked: e.target.checked })}/>I checked the exercise, weight convention and all values.</label>
      <button type="button" className="voice-mic" disabled={!preview.checked || state === 'saving'} onClick={confirm}>Confirm & save set</button>
    </fieldset>}
    {message && <div><p role={state === 'error' ? 'alert' : 'status'}>{message}</p>{state === 'saved' && <button type="button" onClick={() => speech.speak(message)}>Speak confirmation</button>}</div>}
  </section>;
}
