'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const SpeechContext = createContext<{ speak: (text: string, automatic?: boolean) => void; stop: () => void }>({ speak: () => {}, stop: () => {} });
export const useVoiceSpeech = () => useContext(SpeechContext);

export function VoiceSpeech({ children }: { children: ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(true);
  const [automatic, setAutomatic] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('');
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  function stop() {
    current.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setPlaying(false); setPaused(false);
  }
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    setSupported(true);
    const refresh = () => setVoices(synth.getVoices());
    refresh(); synth.addEventListener('voiceschanged', refresh);
    const hide = () => { if (document.hidden) { current.current = null; synth.cancel(); setPlaying(false); setPaused(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => { current.current = null; synth.cancel(); synth.removeEventListener('voiceschanged', refresh); document.removeEventListener('visibilitychange', hide); };
  }, []);
  function speak(text: string, auto = false) {
    if (!supported || (auto && (muted || !automatic))) return;
    stop(); setMessage(''); if (!auto) setMuted(false);
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1800));
    utterance.voice = voices.find(v => v.voiceURI === voice) ?? null;
    utterance.rate = rate;
    current.current = utterance;
    utterance.onend = () => { if (current.current === utterance) { current.current = null; setPlaying(false); setPaused(false); } };
    utterance.onerror = () => { if (current.current === utterance) { current.current = null; setPlaying(false); setPaused(false); setMessage('Audio playback is unavailable. The written response is still available.'); } };
    setPlaying(true);
    try { window.speechSynthesis.speak(utterance); } catch { stop(); setMessage('Audio playback is unavailable.'); }
  }
  return <SpeechContext.Provider value={{ speak, stop }}>
    {children}
    <details className="panel voice-settings"><summary>Spoken feedback · {muted ? 'off' : 'on'}</summary>
      <p>Audio is off initially. Use a Speak button to listen. Available voices depend on your device; online voices may send text to the browser’s speech provider.</p>
      {!supported ? <p>Speech playback is unavailable in this browser.</p> : <>
        <div className="checks"><label><input type="checkbox" checked={muted} onChange={e => { setMuted(e.target.checked); if (e.target.checked) stop(); }}/>Mute audio</label>
          <label><input type="checkbox" checked={automatic} onChange={e => { setAutomatic(e.target.checked); if (e.target.checked) setMuted(false); }}/>Read set confirmations automatically</label></div>
        <div className="form-grid"><label>Speech speed<select value={rate} onChange={e => setRate(Number(e.target.value))}>{[0.75, 1, 1.25, 1.5].map(v => <option key={v} value={v}>{v}×</option>)}</select></label>
          <label>Playback voice<select value={voice} onChange={e => setVoice(e.target.value)}><option value="">Device default</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}{v.localService ? ' · device' : ' · online'}</option>)}</select></label></div>
        <div className="set-actions"><button type="button" disabled={!playing} onClick={() => { if (paused) window.speechSynthesis.resume(); else window.speechSynthesis.pause(); setPaused(!paused); }}>{paused ? 'Resume speech' : 'Pause speech'}</button><button type="button" disabled={!playing} onClick={stop}>Stop speech</button></div>
      </>}{message && <p role="status">{message}</p>}
    </details>
  </SpeechContext.Provider>;
}

export function SpeakButton({ text }: { text: string }) {
  const speech = useVoiceSpeech();
  return <button type="button" className="voice-speak" onClick={() => speech.speak(text)}>Speak explanation</button>;
}
