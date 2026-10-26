export type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
export type RecognitionFactory = new () => Recognition;
export function recognitionFactory(): RecognitionFactory | undefined {
  if (typeof window === 'undefined') return;
  const browser = window as unknown as { SpeechRecognition?: RecognitionFactory; webkitSpeechRecognition?: RecognitionFactory };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
const errors: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. Allow it in browser settings, or type your entry.',
  'service-not-allowed': 'Speech recognition is unavailable in this browser. Type your entry.',
  'audio-capture': 'No microphone is available. Check your microphone or type your entry.',
  'no-speech': 'No speech was detected. Try again or type your entry.',
  network: 'Speech recognition could not connect. Type your entry; manual logging still works.',
  'language-not-supported': 'This speech language is unavailable. Choose another language or type your entry.',
};

// One bounded recognition attempt. Every terminal path invalidates late browser events.
export function listen(Factory: RecognitionFactory, lang: string, callbacks: {
  state: (state: 'requesting' | 'listening' | 'processing') => void;
  result: (text: string) => void; error: (message: string) => void;
}) {
  const recognition = new Factory();
  let active = true;
  let timer: ReturnType<typeof setTimeout>;
  function finish() {
    if (!active) return false;
    active = false; clearTimeout(timer);
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
    try { recognition.abort(); } catch { /* already stopped */ }
    return true;
  }
  function fail(message: string) { if (finish()) callbacks.error(message); }
  recognition.lang = lang; recognition.continuous = false; recognition.interimResults = false;
  recognition.onstart = () => { if (active) callbacks.state('listening'); };
  recognition.onresult = event => {
    if (!active) return;
    const text = Array.from(event.results).filter(r => r.isFinal).map(r => r[0].transcript).join(' ').trim();
    if (text && finish()) callbacks.result(text);
  };
  recognition.onerror = event => fail(errors[event.error] ?? 'Recognition stopped. Try again or type your entry.');
  recognition.onend = () => fail('No final transcript was received. Try again or type your entry.');
  callbacks.state('requesting');
  timer = setTimeout(() => fail('Recording timed out. Tap the microphone to try again, or type your entry.'), 20000);
  try { recognition.start(); } catch { fail('Could not start the microphone. Try again or type your entry.'); }
  return {
    cancel: () => { finish(); },
    stop: () => {
      if (!active) return;
      callbacks.state('processing'); clearTimeout(timer);
      timer = setTimeout(() => fail('Transcription timed out. Try again or type your entry.'), 5000);
      try { recognition.stop(); } catch { fail('Recognition stopped without a transcript.'); }
    },
  };
}
