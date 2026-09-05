# Mobile chat media benchmark

Reviewed 2026-09-05. Scope: attachment composition and message history in the
UsefulDesk Expo app. The visual direction remains UsefulDesk's native Inbox
system; WhatsApp provides the interaction benchmark.

## Reference and result

WhatsApp's official [messaging overview](https://www.whatsapp.com/messaging)
describes photo, video, file, and voice sharing. Its
[voice-message announcement](https://blog.whatsapp.com/making-voice-messages-better)
documents draft listening, waveform visualization, remembered playback, listening
outside the chat, and 1.5×/2× speed controls. This comparison uses those documented
capabilities and the inspected UsefulDesk app; it is not a pixel comparison with
a specific installed WhatsApp version.

| Area | UsefulDesk before | UsefulDesk after this pass | Remaining gap |
| --- | --- | --- | --- |
| Photos | Thumbnail in history; no full-image route | Compact image bubble with an accessible expand action; full image uses `contain`; staged photo stays uncropped | Android pinch zoom and gallery swiping are absent; iOS scroll-view zoom is implemented but unverified |
| Video | Generic external-open action | Inline native player in history and staged preview; play/pause, native seeking and fullscreen; loading/error/retry feedback | No clip editor or generated thumbnail cache |
| Audio | Generic external-open action | Deliberate inline play/pause, actual elapsed/duration progress, 1×/1.5×/2× speeds, staged listening and retry | No waveform, scrubbing, recording, transcript, or persisted playback position; leaving the screen or backgrounding pauses playback |
| Documents | Generic Document label after synchronization | Staged filename/type/size; persisted file-extension label when available; accessible Open document action with pending/error state | Server rows do not retain filename or size, so exact identity cannot survive synchronization; no embedded document viewer |
| Composition | Crowded attachment actions and preview | Clear filename/type/size header, independent discard, compact caption/send row and pending spinner; shared media players | Single attachment selection remains the supported flow |
| Bubble hierarchy | Text-style padding around media | Tighter rounded media shell, readable captions, inset delivery metadata, native control targets | No grouped multi-image layout |

The largest interaction gap closed is opening video/audio without leaving the
conversation. Audio progress reflects actual playback; no decorative waveform
pretends to represent the recording. Persisted document identity needs a
separate data-contract change, rather than a guessed filename.

## Validation and build status

- Android development client rebuilt with `expo-video` and `expo-audio`, installed
  on the connected OnePlus 6, and connected to Metro for Fast Refresh.
- Existing synthetic photo/video/audio/document messages inspected in the native
  chat in light mode and dark mode with Android font scale 1.3. The photo viewer
  opened; inline audio completed; inline and fullscreen video rendered and
  played. Device appearance and font scale were restored after review.
- Android fullscreen requires the default video surface: forcing `textureView`
  produced a black fullscreen frame on this device and was removed.
- Mobile verification passes: lint, typecheck, 70 suites / 791 tests. Playback
  tests include lazy audio loading, speed, errors/retry, background cancellation,
  delayed replay cancellation, and native video cleanup. Existing composer and
  send-state coverage continues to pass.
- Restoring appearance exposed cleanup after Expo had already released a native
  player. The lifecycle stop now tolerates disposal; the regression reproduced
  the crash before the fix. Final lint/typecheck and 151 focused playback,
  content, bubble, composer, and conversation tests pass after the fix.
- No new provider messages were sent for this polish validation. Existing
  tester-build delivery evidence remains in [internal-testing.md](internal-testing.md).
- The iOS client needs a native rebuild and device verification for these new
  media modules. Existing standalone v0.1.0/build 1 tester binaries do not
  contain this pass. Document opening, iOS media, push, and other release gates
  remain separate; development playback does not establish tester release acceptance.

## Implementation

`apps/mobile/src/features/inbox/components/media-playback.tsx` owns both native
players and exclusive playback/lifecycle handling. `message-content.tsx`,
`message-bubble.tsx`, and `conversation-composer.tsx` compose the existing native
masters. `apps/mobile/app/(app)/photo.tsx` provides the protected photo route.
`media-display.ts` handles truthful file size/type labels. The Expo config adds
playback modules without microphone, recording, or background playback permission.
