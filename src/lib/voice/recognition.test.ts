import { afterEach, describe, expect, it, vi } from 'vitest';
import { listen, recognitionFactory, type Recognition } from './recognition';
class Fake implements Recognition {
  static instance: Fake;
  lang = ''; continuous = true; interimResults = true;
  onstart: Recognition['onstart'] = null; onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null; onend: Recognition['onend'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Fake.instance = this; }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() { vi.useFakeTimers(); const callbacks = { state: vi.fn(), result: vi.fn(), error: vi.fn() }; const handle = listen(Fake, 'en-IN', callbacks); return { callbacks, handle, r: Fake.instance }; }
describe('bounded browser recognition', () => {
  it('detects unsupported browsers and the prefixed implementation', () => { vi.stubGlobal('window', {}); expect(recognitionFactory()).toBeUndefined(); vi.stubGlobal('window', { webkitSpeechRecognition: Fake }); expect(recognitionFactory()).toBe(Fake); });
  it('requests only once, accepts a final result once and aborts', () => {
    const { r, callbacks } = setup(); const result = r.onresult!;
    r.onstart!(); expect(callbacks.state).toHaveBeenCalledWith('listening');
    result({ results: [{ isFinal: true, 0: { transcript: '30 kilos 10 reps' } }] });
    result({ results: [{ isFinal: true, 0: { transcript: 'duplicate' } }] });
    expect(callbacks.result).toHaveBeenCalledExactlyOnceWith('30 kilos 10 reps'); expect(r.abort).toHaveBeenCalledOnce();
  });
  it('ignores late recognition after cancellation', () => {
    const { r, callbacks, handle } = setup(); const result = r.onresult!; handle.cancel();
    result({ results: [{ isFinal: true, 0: { transcript: '30 kg 10 reps' } }] });
    vi.runAllTimers(); expect(callbacks.result).not.toHaveBeenCalled(); expect(callbacks.error).not.toHaveBeenCalled();
  });
  it.each(['not-allowed', 'no-speech', 'network', 'audio-capture', 'service-not-allowed'])('handles %s without writing data', error => { const { r, callbacks } = setup(); r.onerror!({ error }); expect(callbacks.error).toHaveBeenCalledOnce(); expect(callbacks.result).not.toHaveBeenCalled(); expect(r.abort).toHaveBeenCalledOnce(); });
  it('times out permission/listening', () => { const { callbacks, r } = setup(); vi.advanceTimersByTime(20000); expect(callbacks.error).toHaveBeenCalledWith(expect.stringContaining('timed out')); expect(r.abort).toHaveBeenCalledOnce(); });
  it('times out processing after an explicit stop', () => { const { callbacks, r, handle } = setup(); handle.stop(); expect(r.stop).toHaveBeenCalledOnce(); vi.advanceTimersByTime(5000); expect(callbacks.error).toHaveBeenCalledWith(expect.stringContaining('Transcription timed out')); });
});
