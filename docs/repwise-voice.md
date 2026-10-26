# REPWISE Voice — implementation and verification

## Architecture audit

- `src/components/logger.tsx` owns manual set editing and the rest timer. `src/app/train/page.tsx` owns the journal and persists edits through `saveSession` → `change` → `writeLocal`. Voice confirmation uses that same path.
- Sets use the existing `LiftSet` schema: kilograms internally, reps, optional RIR, warm-up and completed flags. Session exercise IDs differ from exercise-library IDs. No schema or migration is introduced.
- Workout history and deterministic recommendations remain the source of recorded performance and progression guidance. Speech playback reads existing explanations; it does not generate new training recommendations.
- Next.js uses static export, with a service worker for manual offline logging. Existing Supabase authentication/RPC journal synchronization is optional. The deployment currently uses device-only mode. This feature needs no server, environment variables, API key or new dependencies.

## Implemented

1. Explicit microphone activation with standard/prefixed SpeechRecognition, language selection, visible states, cancellation, 20-second overall timeout and 5-second finish timeout. No automatic restart or background listening. Hidden pages and component unmount abort recognition; late events are ignored.
2. Typed-transcript alternative using the same deterministic parser. Common English, Hindi and Hinglish number words, Devanagari digits, units, reps, RIR, warm-up, known exercise names/aliases and previous-weight references. This is a limited vocabulary parser, not unrestricted natural-language understanding.
3. Editable preview, explicit units, exercise selection, required review checkbox and explicit save. Dumbbells require the user to choose their existing convention and adjust the weight if necessary; the app never doubles/halves the weight silently. Barbell guidance includes the bar. The current journal does not store a per-exercise convention, so users must keep that choice consistent with earlier entries.
4. Existing set validation rejects negative/non-finite/out-of-range values and fractional reps. Confirmation fills a truly empty matching slot or appends; it never replaces a completed or partially entered set. Snapshot validation rejects changes made to the exercise while reviewing. A stable entry ID prevents duplicate retries; conflicting retry values are rejected. Device-storage failures are reported as in-memory-only, not saved.
5. Browser text-to-speech for existing coaching explanations and confirmations: explicit playback, mute, optional automatic confirmations, rate/voice selection, pause/resume/stop. Audio starts off. New utterances cancel prior playback; starting recognition, hiding the page and leaving the workout cancel audio. Text stays visible.
6. Simple contextual commands: start 90-second rest, stop rest, previous completed set, repeat last weight (requires new reps and confirmation), next exercise and cancel. History/analysis phrases are recognized but currently explain how to navigate; they do not navigate or finish a workout automatically.

## Privacy, security and costs

No new cloud calls or credentials are added. REPWISE neither records audio blobs nor persists transcripts. The browser's recognition service may send audio to its provider and require connectivity; this is disclosed before recording. Browser online TTS voices may send text to their provider. No paid transcription/model API is used, so this implementation has no per-request AI API charge. Device/browser data and service availability still apply.

Manual logging remains available without speech or an AI service. Existing account ownership and journal synchronization are reused unchanged. Recognition text has a 500-character input cap and is displayed as React text, never HTML or executable instructions. No AI output writes records.

## Tests and limitations

Unit tests cover the brief's parser examples, ambiguity, missing/invalid values, conversion, exercise conflicts, stale previews, preserved sets, idempotent retries, prefixed/unsupported recognition, permission/network/no-speech errors, timeout and late-event cancellation.

Playwright covers device-only typed preview/edit/confirm, duplicate activation, reload persistence, subsequent manual logging, stale previews, storage-failure retry, unsupported recognition, speech-result review, default-off playback, stopping speech, new-recording cancellation, permission denial and navigation cleanup. It runs in desktop Chromium and a Pixel 7 viewport. Speech API doubles are test-only; these tests do not establish actual microphone recognition quality, actual voice playback or physical-device compatibility.

SpeechRecognition support varies by browser, OS, language and browser service availability. Speech synthesis voice availability also varies. A failed or unsupported service falls back to typed/manual logging, not to a cloud transcription endpoint. Hindi/Hinglish accuracy in a noisy gym is unverified.

Before production approval, test a real microphone on the intended Android Chrome and iOS Safari devices: permission allow/deny, English/Hindi/Hinglish, noisy-room numbers, cancellation, lock screen/background, interruptions, headphones, unavailable network, real speech pause/stop and resumed manual entry. Confirm a set and refresh the journal. This manual hardware test is still outstanding.

## Remaining optional work

- Dedicated Ask REPWISE conversational coach with sourced education and authorized journal context; no chatbot/backend or custom ML training is implemented here.
- Opt-in cloud transcription, if desired. It needs a configured backend, authenticated/per-user access, server-only provider keys, payload limits, rate limits, no default audio retention and verified current model/API compatibility. Static export favors a separate secured function endpoint.
- History/analysis navigation commands and broader language vocabulary.
- Real-device speech QA, then explicit approval before merging, deployment or production migrations. No production changes are part of this branch.
