# Native mobile Inbox Stage 2 acceptance

**Date:** 2026-09-02

**Branch:** `main`

**Status:** **PARTIAL ACCEPTANCE — implementation and local native builds pass;
the iPhone maximum Dynamic Type matrix passes its recorded post-fix surfaces,
and Android 11 passes normal Inbox interaction plus standard-font fixture
keyboard safety. Post-repair Android large-font appearance, remote EAS, and
other listed platform boundaries remain unverified.**

## Outcome

Stage 2 is built and its final mobile lint, typecheck, and complete Jest suite
pass. Physical iPhone testing passed branch isolation, the closed-window
Approved-template picker, exact request submission, durable provider-failure
rendering, foreground/session recovery, and base light/dark appearance. The
maximum standard Dynamic Type check found a P1 adaptivity defect: Inbox and
conversation metadata, controls, and the failed template status clipped or
truncated. The follow-up build removes fixed text-slot line metrics, lets Inbox
rows reflow without ellipses, replaces the constrained Account text action with
an SF Symbol target, and gives large-text bubbles an 88%-wide
metadata-below-body layout. On the same physical iPhone in dark appearance, the
Inbox and conversation now render the full tested content without clipping.
At the same maximum Text Size in light appearance, the Inbox and Account
surfaces also render without clipping or overlap. A `__DEV__`-only local layout
fixture now reuses the production conversation screen, message bubbles, and
composer with in-memory repositories, a no-op realtime feed, and a sender that
throws before any request. The fixture made the matching physical light-mode
conversation/composer check possible without creating customer data or
contacting anyone; its header, date separator, three multi-line bubbles,
below-body metadata, Message field, and Send target remained visible without
clipping or overlap. The physical accessibility matrix remains partial for the
separately listed unverified behaviors.

The 2026-09-02 closeout upgraded every Expo SDK 57 dependency to its recommended
patch, made clean-checkout typed-route generation deterministic, excluded
generated native trees from repository Prettier checks, and raised the shared
small button, icon button, composer, and text-field minimum target to 48pt for
Android parity. Expo Doctor now passes 21/21. A local development client built
and installed on the paired iPhone. After the device was unlocked and paired,
the same build launched through Metro and the safe physical interaction matrix
continued. Android first assembled a 258 MB debug APK successfully. A later
main-checkout run built, installed, and launched the development client on a
physical OnePlus 6 running Android 11 / API 30, restored its authenticated
selected-branch session, and completed the safe interaction matrix recorded
below.

After explicit action-time confirmation, the native app submitted one exact
Approved template to an approved test contact. `POST /api/whatsapp/send`
returned 200 and Meta returned a provider message ID. Meta's asynchronous status
callback then failed the message with code `131049`, described as maintaining
healthy ecosystem engagement. The test contact did **not** receive the message,
so this is provider-submission and failure-reconciliation evidence, not delivery
acceptance.

## Automated gates

| Command                                                                                                                                                                                                   | Result  | Evidence                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run mobile:verify`                                                                                                                                                                                   | Pass    | Current revision: Expo lint and `tsc --noEmit` passed; Jest 48 suites / 534 tests, 0 snapshots.                                                                                                                   |
| `npm run lint`                                                                                                                                                                                            | Pass    | Current revision: 0 errors and 3 existing warnings in the lead page. Agent tooling and ignored sibling worktrees are excluded from the application lint boundary.                                                 |
| `npm run typecheck`                                                                                                                                                                                       | Pass    | Current revision: TypeScript passed.                                                                                                                                                                              |
| `npm test`                                                                                                                                                                                                | Pass    | Current revision: Vitest 406 suites / 3,055 tests passed.                                                                                                                                                         |
| `npm test -- src/lib/auth/mobile-operational-access.test.ts src/app/api/whatsapp/send/route.test.ts src/proxy.test.ts`                                                                                    | Pass    | Current revision: Vitest 4.1.9; 3 files / 66 tests.                                                                                                                                                               |
| `npx expo-doctor@latest apps/mobile --verbose`                                                                                                                                                            | Pass    | Current revision: all 21 checks passed after the recommended Expo SDK 57 patch upgrade.                                                                                                                           |
| `(cd apps/mobile && npx expo export --platform ios --output-dir "$stage2_ios_export")`                                                                                                                    | Pass    | Current revision: 2,484 modules, 23 assets, and one 6.2 MB iOS bundle exported successfully.                                                                                                                      |
| `(cd apps/mobile && npx expo export --platform android --output-dir "$stage2_android_export")`                                                                                                            | Pass    | Current revision: 2,578 modules, 27 assets, and one 6.4 MB Android bundle exported successfully.                                                                                                                  |
| `npm run build`                                                                                                                                                                                           | Pass    | Current revision: the Next.js 16.3.0 production build compiled, typechecked, and generated all routes successfully.                                                                                               |
| `(cd apps/mobile && npx expo run:ios --device <paired-device> --no-bundler)`                                                                                                                              | Pass    | Xcode completed with 0 errors and installed version 0.1.0 (build 1) on the paired iPhone Air. Launch was blocked by the locked device.                                                                            |
| `(cd apps/mobile/android && ./gradlew app:assembleDebug --no-daemon)`                                                                                                                                     | Pass    | Gradle completed all 511 tasks in 10m 59s. The 258 MB APK SHA-256 is `77d3dee042c42f9ea69d0c75d7a2143e5ee21d9eaa22b8da5b74e6fc6a4a9988`.                                                                          |
| `npm run verify`                                                                                                                                                                                          | Blocked | The aggregate gate stops at the unchanged tracked Prettier baseline `docs/pricing-and-packaging-research.md`; generated Expo/native artifacts are now excluded from Prettier. The later gates pass independently. |
| `npx prettier --check PRDs/roadmap.md docs/changelog.md docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md docs/superpowers/plans/2026-09-02-mobile-android-physical-smoke.md` | Pass    | The four Android closeout documentation files pass targeted formatting.                                                                                                                                           |
| `git diff --check`                                                                                                                                                                                        | Pass    | No whitespace errors.                                                                                                                                                                                             |

The current root lint, typecheck, full Vitest suite, focused server selection,
production build, mobile gate, and both platform exports pass independently.
The aggregate `npm run verify` remains blocked before those later stages only by
the known tracked Prettier baseline. Expo Doctor passes 21/21 after the SDK
patch upgrade.

The earlier iOS export emitted six warnings that `NO_COLOR` was ignored while
`FORCE_COLOR` was set. No credential values were printed or recorded.

## Physical iPhone evidence

The test device was an iPhone Air (iPhone18,4), iOS 26.6, paired, booted, and in
Developer Mode. The installed app was `UsefulDesk Agent`
(`com.usefulmade.usefuldesk.agent`, version 0.1.0). The local development build
used the saved mobile environment without copying or recording environment
values. Generated native files remain ignored. `eas-cli@18.0.1` was not logged
in and the app has no linked EAS project ID, so remote build acceptance could
not start.

Observed on the physical device:

- switching between two permitted branches kept their Inbox state isolated;
- background/foreground, Metro reconnect, and app-switcher return retained the
  authenticated session, selected branch, and conversation;
- the closed customer-service window exposed only **Send a template**, and the
  Approved-template picker rendered its preview and exact positional fields;
- after explicit confirmation, the submitted request body exactly matched the
  authorized template body and `POST /api/whatsapp/send` returned 200 with a
  Meta provider ID;
- the asynchronous Meta callback persisted provider failure code `131049`;
- after the final rendering fixes, a no-resend retest showed a separate red
  **Failed** label matching the database and no stale checkmark;
- the persisted template row offered no unsafe text **Retry** action; and
- recent inbound messages subsequently opened the 24-hour window and exposed
  the text composer, but no free-form message was sent;
- light and dark appearances retained readable base surfaces and semantic
  contrast; and
- the first maximum-standard Text Size run clipped the Account control,
  filters, timestamps, row content, date/status metadata, and failed template
  state;
- after the reflow fix was served through Metro, the same physical iPhone in
  dark appearance showed an unclipped Account symbol, filters, conversation
  identity/preview/time rows, full template body, date separators, timestamps,
  delivery ticks, separate red **Failed** state, Message label/input, and 48pt
  Send target; and
- at the same maximum Text Size in light appearance, the Inbox search, All and
  Unread filters, Account symbol, empty state, and Account branch cards remained
  readable without clipping or overlap; and
- the local-only fixture then exercised the matching light conversation and
  composer without database, realtime, or provider access. Its full header,
  date separator, inbound/outbound multi-line bubbles, timestamps, read ticks,
  Message label/input, and Send target remained readable without clipping or
  overlap. No text was entered and no Send action was pressed.

VoiceOver was enabled without granting notification permission and the app
remained launchable. iPhone Mirroring did not expose or visibly advance the
native VoiceOver focus cursor, and safely proving the transition-only failure
announcement would require a new sent-to-failed provider transition. No second
outbound attempt was authorized, so the announcement remains automated-test
evidence rather than physical acceptance. The existing cold failed mount did
not introduce a visible action or resend path.

The physical keyboard provided by iPhone Mirroring kept the composer and Send
control visible, but it cannot prove software-keyboard avoidance. Pointer
injection also could not produce the iOS edge-swipe gesture, so only the visible
Back control was accepted. No live inbound event, viewer session, or induced
network failure was created.

For the closeout build, Xcode compiled and installed the development client on
the same paired device with 0 build errors. The later unlocked-device run
extends that evidence through launch, branch isolation, persisted failure
rendering, foreground recovery, appearance, and maximum Dynamic Type checks.

The approved outbound text and its exact positional fields were verified against
the authorized test fixture. Its content is intentionally omitted from this
report.

No resend was performed during the final failure-rendering retest. The approved
contact was targeted by one provider submission attempt, and zero messages were
delivered by this acceptance exercise.

## Physical Android evidence

The Android test target was a physical OnePlus 6 running Android 11 / API 30.
The main-checkout development client (`com.usefulmade.usefuldesk.agent`) built,
installed, launched through Metro, and loaded the saved local public environment
without recording any value. Authentication was entered privately by the user;
after a force-stop and relaunch, the user confirmed direct return to the
selected-branch Inbox without another sign-in prompt.

| Boundary                                                           | Result  | Evidence                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build, install, launch, and restored session                       | Pass    | `expo run:android` completed successfully for the physical target; bounded process/activity checks and Metro bundle completion confirmed launch, and the user confirmed session restoration to Inbox.                                                                 |
| Initial Inbox, All/Unread filters, and search                      | Pass    | The selected branch resolved without a prior-branch row flash. All, Unread, and private search entry/clear remained usable without stale rows, clipping, navigation loss, or mutation prompts.                                                                        |
| Branch isolation and branch-switch cleanup                         | Pass    | An authorized alternate branch cleared prior rows before resolving. The branch-choice cleanup guards and focused tests cover async unmount/rejection; two post-fix physical transitions restored the original branch without the prior development warning.           |
| Android system Back                                                | Pass    | System Back returned Account to Inbox. On the synthetic fixture, the first Back dismissed Gboard and the second returned to Inbox.                                                                                                                                    |
| Background/foreground lifecycle                                    | Pass    | Home/app-switcher return preserved the authenticated selected-branch Inbox with no duplicate structural rows or sign-in surface.                                                                                                                                      |
| Standard-font synthetic fixture and keyboard                       | Pass    | At font scale `1.0`, the local fail-closed fixture kept the newest bubble, Message field, and Send target above Gboard after the keyboard-offset repair; the harmless draft was fully cleared, Send returned to disabled, and Send was never pressed.                 |
| Historical light-mode font-scale `1.3` keyboard run                | Fail    | Before the viewport-resize repair, the composer remained reachable but the newest bubble fell below the resized viewport. The automated resize and banner-geometry repairs pass focused and full mobile tests, but this historical physical result remains a failure. |
| Post-repair light/dark font-scale `1.3` visibility and screenshots | Blocked | The user deferred the remaining accessibility and visibility matrix. The viewport-resize and banner-geometry repairs were not physically revalidated at font scale `1.3`; neither synthetic screenshot was captured.                                                  |
| Original device-setting restoration                                | Pass    | Exact checks restored night mode `auto` and font scale `1.0`; UsefulDesk Agent was left on Inbox.                                                                                                                                                                     |
| Focused runtime and transport-safety logs                          | Pass    | Final PID-scoped checks found no fatal Android exception, unhandled/red-screen marker, fixture-sender exception, `/api/whatsapp/send` attempt, or credential-pattern match. Raw logs and temporary fixture artifacts were not retained.                               |

No real conversation was used for the fixture sequence, no Send or template
flow was opened, and no customer, CRM, or provider state was changed. The two
large-font screenshot paths are absent; this report contains no Android
screenshot or private Android UI content.

## Device-discovered fixes

- `43e0414` changed the native message repository to the canonical message
  columns used by the deployed schema.
- `b54bfc5` allowed validated native bearer requests through the application
  proxy while retaining the existing cookie path.
- `9b60bb3` reconciled provider status races and durable failed state.
- `f599d4d` attempted the failed-state presentation correction; final commit
  `ee34cc7` placed the failure label outside the bubble so it renders reliably.
- `8e213a4` added a transition-only iOS accessibility announcement. Its focused
  TDD run moved from 2 announcement failures / 15 passes to 17 / 17 passes: a
  same-message sent-to-failed transition announces once with queued speech,
  while cold failed mounts, unrelated updates, and repeated failed renders are
  silent.
- `cb24306`, `e582204`, and `8198389` restrict Retry to definite pre-send
  rejections and lock an unchanged text/template attempt when delivery cannot
  be confirmed.
- `627613b` persists an account-and-conversation-scoped uncertain-template
  marker in SecureStore before the network call. Remounts and storage errors
  fail closed until the agent explicitly confirms checking the conversation.
- `fabdafd` separates open-window text readiness from template readiness,
  filters Authentication templates, and suppresses outbound controls for
  read-only or archived branches.
- `b9d6e0a` preserves the newest scoped realtime inbound timestamp when the
  initial readiness query resolves stale.
- `3abc9d6`, `e3dc081`, and `85c6d1b` make template selection perceivable,
  remove the Dynamic Type cap, give buttons content-driven minimum geometry,
  and raise audited light/dark accent, danger, and warning contrast above
  4.5:1.
- The closeout raises every shared small native input/action target used by
  authentication and Stage 2 messaging to at least 48pt and covers the geometry
  at both master and screen boundaries.
- The Dynamic Type P1 follow-up gives Button/Chip/Label/Input/Error text slots
  content-driven line metrics, removes Inbox row ellipses, moves row metadata
  into a wrapping line, uses a fixed Account SF Symbol target, and switches
  message bubbles at font scale 1.3+ to an 88%-wide body with metadata below.
  Focused tests plus the complete 48-suite / 534-test mobile gate pass, and the
  physical dark-appearance maximum-size retest shows no clipping.
- Recommended Expo SDK 57 patches are installed, `expo-font` and `expo-image`
  are explicit config plugins, and Expo Doctor passes all 21 checks.
- `mobile:typecheck` regenerates ignored Expo Router declarations first, so
  clean-source typecheck no longer relies on stale `.expo` output.
- The first unlocked-device launch exposed the same hoisted-CLI module boundary
  during `expo start`; the mobile start/iOS/Android scripts now provide the
  workspace-local module path and Metro serves the physical build successfully.
- `inbox-test-fixtures.ts` now provides a fail-closed local conversation layout
  fixture selected only by the exact development deep-link flag and fixture
  conversation ID. `conversation-screen.tsx` injects its in-memory
  conversation/message/template repositories and no-op realtime feed only when
  `__DEV__` is true; the fixture sender throws locally before any transport can
  run. The focused screen test proves the injected path does not call the real
  send client.
- `select-branch-screen.tsx` guards the branch chooser's post-await local state
  against a branch-keyed unmount; its focused tests cover matching rejection
  cleanup. The repaired branch path passed two physical Android transitions
  and focused logs.
- `conversation-screen.tsx` measures the conversation container's window
  offset so the Android composer remains above the software keyboard, adds
  guarded bottom-following on viewport resize, and keeps the measurement stable
  when runtime banners change. The standard-font keyboard repair passed
  physically; the later resize and banner repairs pass automated tests but not
  the deferred post-repair font-scale `1.3` physical matrix.

## Remaining acceptance limits

The following are implemented or covered by automated tests but were not
accepted on the physical device in this exercise:

- free-form send inside the 24-hour window;
- local optimistic text failure, retained/locked ambiguous drafts, and
  definite pre-send text Retry;
- physical viewer read-only mode and the transition-only VoiceOver
  announcement behavior;
- a safe induced network interruption;
- successful provider delivery/read status patching; and
- remote EAS iOS/Android builds, which require an authenticated owner and a
  linked EAS project.

Android 11 normal interaction smoke and standard-font software-keyboard
avoidance passed. The Android post-repair font-scale `1.3` validation,
light/dark large-font visibility and accessibility checks, and synthetic
screenshots remain user-deferred and are not accepted. Predictive Back on
Android 13+, Android 12+ system theming, tablet/foldable layouts, provider
delivery, and remote EAS builds were not exercised.

Base dark and light appearance, the earlier closed-window template flow,
two-branch isolation, and the provider-failure row were exercised physically.
The first maximum-standard Dynamic Type run failed; the post-fix dark-mode run
passes the affected Inbox and conversation surfaces. The matching light-mode
run now passes Inbox and Account plus the local-only conversation/composer
fixture. VoiceOver was restored off. iPhone Mirroring could move the standard
Text Size control to maximum but could not activate the protected appearance
control or reliably restore the slider; those steps were completed directly on
the device. Mirroring then confirmed Dark selected with Automatic off, the Text
Size thumb at its original middle position, and UsefulDesk Agent open on the
Inbox. Existing screenshots under
`.impeccable/review/` are local review artifacts and intentionally uncommitted.
Stage 3 media, quoted replies, reactions, push notifications, and advanced
message actions remain deferred.
