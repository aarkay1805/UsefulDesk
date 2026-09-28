# Mobile UI acceptance follow-up — 28 September 2026

**Partial device acceptance; release acceptance remains open.** This follows
[the UI audit](ui-audit-2026-09-27.md) and its three implemented repair batches.
The source baseline for this pass is `bc487d8f` on main, plus the conversation
footer repair described below. No customer message, template, reaction, or media
was sent, and no internal build or store release was published.

## Runtime identity and limits

- Physical iPhone Air, inspected through iPhone Mirroring. App details confirmed
  version **0.1.0 / build 2 / Development**, Owner, Home office branch, and the
  intended Production API/Supabase hosts. Metro served the local checkout.
  This is development-client evidence, not a standalone Preview acceptance.
- The existing API 36 ARM64 `UsefulDesk_Preview_API36` Android emulator booted;
  package diagnostics showed 0.1.0 / versionCode 2. The available UI automation
  could not attach to its unbundled emulator window. No Android interaction or
  current-source acceptance is claimed from this inventory check.
- The iOS simulator is available to command-line tooling, but this host has no
  Simulator GUI to inspect. The earlier ExpoAudio development-client rebuild
  does not substitute for visual acceptance.
- Mirroring focused and typed into search without displaying the iPhone software
  keyboard. A focused-field tap is not a keyboard-open first-tap test.
- Account screenshots remain outside Git; observations were inspected in the
  native UI session. No customer screenshot is added to this record.

## Directly observed on the physical iPhone

| Check                                           | Result and boundary                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final home-only branch placement                | Pass: Chats displays Home office; conversation and template headers retain recipient identity.                                                                       |
| Chat previews and metadata                      | Pass: ordinary preview stays bounded; time/ticks remain adjacent and the reply quote uses the blue accent.                                                           |
| Search navigation                               | A single mirrored tap opened the matching chat after typing. Software-keyboard-open behavior remains pending.                                                        |
| Dark Account/App details navigation             | Pass: coherent chrome; details → Account → Chats returns correctly.                                                                                                  |
| Maximum accessibility text, template navigation | Pass for the exercised legacy-template path: title/recipient clear the notch; list and detail scroll; Back → list → Close works. No send was attempted.              |
| Maximum accessibility text, closed chat         | Defect reproduced: the notice consumed all visible history and the template action reached the bottom edge. Repair is built; post-fix native retest remains pending. |
| Older history                                   | Only a short four-message conversation was observed. This does not accept pagination or scroll anchoring.                                                            |

## Reproduced defect and repair

`apps/mobile/src/features/inbox/screens/conversation-screen.tsx` previously placed
the composer/action footer in an unbounded View. At the largest accessibility
text setting, its closed-window Notice could occupy the entire available body.
The footer is now a ScrollView limited to half the keyboard-adjusted body, leaving
room for message history and allowing the action to be reached by scrolling.
Text scaling, native masters, authorization, and send uncertainty gates are
unchanged. Child actions retain taps with `keyboardShouldPersistTaps="handled"`.

The 66 conversation-screen tests pass, including draft/uncertainty preservation,
viewer restrictions, older-history anchoring, and shrinking viewport behavior.
These are mocked component checks; they do not prove native footer geometry.
Mirroring required a Mac unlock before the post-fix device retest could run.

After the repair, `npm run mobile:verify` passed lint, typecheck, and all 75 suites
(833 tests). `npm run verify` passed root lint, typecheck, all 505 suites
(3,945 tests), and the production build. These gates do not produce or accept
new standalone mobile binaries.

## Mocked coverage and remaining acceptance

The mobile verification suite exercises safe transports/repositories:

- `screens/conversation-screen.test.tsx`: viewer controls, retained uncertainty
  locks during readiness refresh, pagination anchoring, and the 48dp jump action.
- `use-message-thread.test.tsx`: failed foreground/reconnect resync preserves
  history, ordered older-page prepends, and viewers never mutate unread state.
- `components/template-picker.test.tsx` and the template uncertainty tests:
  contract mismatch explanations, usable templates, validation, and guarded retry.

Do not relabel those mocks as native offline, permission, or network acceptance.
The remaining device/release checks are:

1. Retest the bounded footer at maximum accessibility text and normal text,
   including an open-window composer with the software keyboard visible.
2. Search first-tap navigation and template last-field/action reachability with
   the software keyboard open.
3. VoiceOver/TalkBack reading order and actual 48-point touch targets; Android
   system Back; Photo and transition animation.
4. Older-page scrolling and controlled offline/reconnect, viewer/read-only, and
   uncertain-send behavior using isolated fixtures or mocked transport.
5. Current standalone Preview binaries: record build/source identity, cold-launch
   without Metro, and repeat the device checks. Existing build-2 release evidence
   predates these UI repairs; no release sign-off is implied.

Follow [internal testing](internal-testing.md) for exact-binary release gates.
