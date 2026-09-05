# Internal tester release

The first distribution target is internal tester builds. Use the `preview`
profile in `apps/mobile/eas.json`: it produces a standalone Android APK and an
iOS internal-distribution build, without Metro or the development launcher.
An iOS build needs distribution signing and registered tester devices.

## Configuration

The profile uses the existing UsefulDesk EAS project and its `preview`
environment. Configure these public variables in that environment:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_APP_ENV=preview`

The profile also pins `EXPO_PUBLIC_APP_ENV` to `preview`, so installations are
registered in that push environment. This label does not isolate customer
data: the API and Supabase hosts choose the backend. The current local setup
targets the existing live UsefulDesk backend. Use designated test contacts and
branches. Never include server credentials in a build or commit local env files.

Version source is local. Increment the platform build number in app config before
a later tester release; this first build uses version 0.1.0 / build 1.

The bundle identifiers match the development app. Installing the tester build
can replace it; verify session restoration and push registration after install.

## Build and acceptance gates

1. Run `npm ci`, `npm run mobile:verify`, and Expo Doctor from the root.
2. Export both native bundles and run the root verification gates because the
   npm lockfile is shared with the web app.
3. Verify EAS preview configuration and signing, then build `preview` for each
   platform. Record build IDs, source revision, version, and status. Keep signed
   artifact URLs and provisioning credentials out of repository documentation.
4. Install the resulting binaries on registered iOS and Android tester devices.
   Cold-launch with Metro stopped. Confirm Diagnostics shows the intended API
   and Supabase hosts, Preview environment, version, and build number.
5. Exercise sign-in, Google callback, restart/session recovery, branch switching,
   viewer restrictions, and sign-out on these exact binaries.
6. With the designated test contact, prove text delivery, media selection/upload
   and delivery, a quoted reply, reaction add/change/remove synchronization,
   incoming realtime, and foreground/background recovery. Record provider
   outcomes separately from HTTP acceptance. Do not retry an ambiguous send.
7. Verify notification permission recovery, foreground/background/terminated
   delivery, tap routing, token registration, and sign-out on the Preview
   installation. Development-build push evidence does not prove release signing.
8. Check large text, light/dark appearance, keyboard reachability, iOS Back and
   VoiceOver, and Android Back on the actual tester binaries.

Build success is not device acceptance. Retain explicit unverified entries
until each relevant workflow has been exercised; do not infer delivery from an
API 200 or provider ID.

## Readiness record — 2026-09-05

Baseline source: `d47c9ed`, with release-readiness changes in the working tree.

| Check                                | Evidence/status                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline mobile lint/typecheck/tests | Pass: 69 suites, 785 tests                                                                                                                              |
| Clean dependency install             | Pass: `npm ci`; original unrelated Supabase versions retained                                                                                           |
| Expo SDK health                      | Pass: 21/21 after patch alignment and native dependency deduplication                                                                                   |
| Post-repair mobile gates             | Pass: lint, typecheck, 69 suites / 785 tests                                                                                                            |
| Native bundle export                 | Pass: iOS and Android Preview bundles                                                                                                                   |
| Distribution profile                 | Standalone `preview` profile added                                                                                                                      |
| EAS authentication                   | Existing configured owner authenticated                                                                                                                 |
| EAS environments                     | Four public Preview variables configured; Development remains unchanged                                                                                 |
| Available hardware                   | iPhone Air and connected OnePlus 6 (Android 11) available                                                                 |
| Android tester build                 | `9804b99c-c920-4c0a-bd50-49303b10f660`: finished; APK installed after owner-approved development-app replacement, version 0.1.0 / build 1                                                               |
| iOS tester build                     | `3e0f1a92-8010-4081-8a78-9dcfc4f08607`: finished; signed IPA downloaded and installed on registered iPhone Air; version 0.1.0 / build 1                 |
| Tester-binary acceptance             | Partial: standalone launch and delivered text on both phones; iOS quoted reply and incoming realtime passed; remaining gates below |
| Live test contact                    | Rajat in the Rajat Kashyap branch; explicitly selected by the owner                                                                                     |

Root verification: lint and typecheck passed; the full run passed 3,145 tests
and found one stale Expo-version expectation. That expectation is updated and
its focused rerun passes. The Next production build is blocked by the host
denying Turbopack a local worker port, including after escalation; do not count
the aggregate root gate as passed. A supplemental Webpack build compiled and
typechecked but failed collecting the invoice PDF route configuration
(`module.createRequire` / undefined `resolve`); no unrelated finance code was
changed.

Historical evidence is recorded in `PRDs/roadmap.md` and the Stage 2 acceptance
report. Physical iPhone maximum-standard text reflow was accepted after its fix;
the later runtime Dynamic Type fix passed the simulator light/dark size matrix.
Development-build iOS remote push, tap routing, sign-out, and token registration
passed; Android 11 foreground/background push passed. Media delivery, remote
reactions, viewer interaction, and several accessibility/device checks remain
unverified. Recheck these on the tester binaries.

## Tester-device session — 2026-09-05

Both installed tester binaries launched. Android Diagnostics confirmed Preview,
version 0.1.0 / build 1, the intended live API/Supabase hosts, the Rajat Kashyap
branch, and readiness Ready. Android Back navigation from Diagnostics through
Account to Inbox passed. iOS restored its authenticated Inbox session.

Only the owner-designated Rajat contact in the Rajat Kashyap branch was used.
Provider-backed message records confirmed delivered status without provider
errors for iPhone text (`95d82979-3047-459a-9669-e2df7c4318fe`), Android text
(`789dc70c-be13-427b-a333-5d5802637dcd`), and the iPhone quoted reply
(`1a135713-b2e2-4a85-bc97-f20d841ae5c8`). The quote references incoming message
`601731d5-1b47-4e33-85bc-46b15949fd29`, which appeared in the open iPhone thread
without manual refresh. Android also rendered the synchronized quote.

**Release blocker found:** Android reaction add displayed an optimistic state,
then returned to sign-in; no reaction persisted. `src/proxy.ts` allowed native
bearer sends through to route authorization but rejected native reactions before
their existing bearer/RLS checks. The working-tree fix extends the exact-path
exception to `/api/whatsapp/react` and preserves its explicit branch header.
Anonymous cookie requests and unrelated WhatsApp paths remain protected.
Regression tests reproduced the failure before the fix; the proxy, mobile
operational-access, and reaction-route suites now pass 66 tests. Focused lint
and root typecheck pass. **This backend fix is not deployed; live reaction
add/change/remove acceptance is still pending.** No mobile rebuild is needed
for this proxy-only change.

The Android document picker opened, but injected taps did not reliably navigate
its folder list. Follow-up confirmed all four fixtures exist on disk: the
Downloads provider showed an empty folder, while OnePlus 6 internal-storage
search for `test-document` exposed `test-document.txt` (68 B). Selecting the
visible result needed a physical tap. The synthetic document, image, video, and audio
were subsequently sent through the installed Android tester app. All four have
provider-confirmed delivered status without provider errors:

- Document: `d9870a4c-5cc5-4efb-b781-5f5cff4623e6`.
- Image: `28b4783d-c6a9-4792-a6ac-0e507175469b`.
- Video: `e0d1e3f9-7838-4248-b99e-9d82ecf4dd3c`.
- Audio: `842d07a3-19b7-448b-b83e-229ec6d1ab8d`.

Document and image additionally reached Read. The composer cleared after each
successful send, and no duplicate retry was performed. These checks prove
Android selection/upload/send and delivery; attachment opening/playback, captions,
and iOS media remain separate acceptance items.

The document's filename becomes generic “Document” after server synchronization;
this presentation finding is handed to the separate attachment UI task. Video
and audio selection also required physical taps because injected picker taps
were unreliable. iPhone testing paused while the owner
used the phone. Preview push delivery/tap routing, branch isolation/viewer flows,
iOS media, attachment opening/playback, reaction synchronization, and the remaining accessibility/recovery matrix
remain unverified on these binaries. Do not promote this partial acceptance to
release sign-off.

## Subsequent media development check — 2026-09-05

After owner-approved replacement of the Android tester app, the connected
OnePlus 6 now runs a local development client with `expo-video` and `expo-audio`,
connected to Metro. The media UI pass verified existing synthetic photo opening,
inline audio completion, inline/fullscreen video rendering and playback, and
light/dark appearance with enlarged Android text. No additional messages were
sent during this check. Lint, typecheck, and 70 suites / 791 tests pass.
An appearance-restoration crash from pausing an already released Expo player
was reproduced and fixed; the final lint/typecheck and 151 focused media and
conversation tests pass.

This is development evidence, not acceptance of the standalone build 1 APK or
IPA. The new media modules require an iOS rebuild, and the remaining tester
release gates above still apply. See [media-ui-benchmark.md](media-ui-benchmark.md)
for the WhatsApp comparison, file metadata limitation, and exact scope.
