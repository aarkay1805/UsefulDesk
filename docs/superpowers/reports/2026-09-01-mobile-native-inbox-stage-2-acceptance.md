# Native mobile Inbox Stage 2 acceptance

**Date:** 2026-09-02

**Branch:** `feature/mobile-native-inbox-stage-1`

**Status:** **PARTIAL ACCEPTANCE — implementation and provider submission passed;
delivery and parts of the physical matrix remain unverified.**

## Outcome

Stage 2 is built and its final mobile lint, typecheck, and complete Jest suite
pass. Final review found no remaining P0/P1 implementation issue. Physical
iPhone testing passed branch isolation, the closed-window
Approved-template picker, exact request submission, and durable provider-failure
rendering.

After explicit action-time confirmation, the native app submitted one exact
Approved template to the approved Rajat contact. `POST /api/whatsapp/send`
returned 200 and Meta returned a provider message ID. Meta's asynchronous status
callback then failed the message with code `131049`, described as maintaining
healthy ecosystem engagement. Rajat did **not** receive the message, so this is
provider-submission and failure-reconciliation evidence, not delivery
acceptance.

## Automated gates

| Command                                                                                                                                | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run mobile:verify`                                                                                                                | Pass    | Current revision: Expo lint and `tsc --noEmit` passed; Jest 48 suites / 526 tests, 0 snapshots.                                                                                                                                                                                                                                                                                                                          |
| `npm run lint`                                                                                                                         | Pass    | Current revision: 0 errors and 155 existing warnings.                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run typecheck`                                                                                                                    | Pass    | Current revision: TypeScript passed.                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm test`                                                                                                                             | Pass    | Current revision: Vitest 406 suites / 3,055 tests passed.                                                                                                                                                                                                                                                                                                                                                                |
| `npm test -- src/lib/auth/mobile-operational-access.test.ts src/app/api/whatsapp/send/route.test.ts src/proxy.test.ts`                 | Pass    | Current revision: Vitest 4.1.9; 3 files / 66 tests.                                                                                                                                                                                                                                                                                                                                                                      |
| `(cd apps/mobile && npx expo-doctor)`                                                                                                  | Fail    | Current revision: 20/21 checks passed. The only failure is recommended Expo SDK 57 patch drift: `@expo/ui` 57.0.14→57.0.15, `expo` 57.0.18→57.0.19, `expo-constants` 57.0.16→57.0.17, `expo-dev-client` 57.0.16→57.0.18, `expo-font` 57.0.2→57.0.3, `expo-image` 57.0.3→57.0.4, `expo-linking` 57.0.8→57.0.9, `expo-router` 57.0.17→57.0.18, and `expo-secure-store` 57.0.2→57.0.3. No dependency upgrade was attempted. |
| `(cd apps/mobile && npx expo export --platform ios --output-dir "$stage2_ios_export")`                                                 | Pass    | Current revision: 2,484 modules, 23 assets, and one 6.2 MB iOS bundle exported to `/tmp/usefuldesk-stage2-ios.final.R7cllC`.                                                                                                                                                                                                                                                                                             |
| `(cd apps/mobile && npx expo export --platform android --output-dir "$stage2_android_export")`                                         | Pass    | Current revision: 2,578 modules, 27 assets, and one 6.4 MB Android bundle exported to `/tmp/usefuldesk-stage2-android.final.o5Giev`.                                                                                                                                                                                                                                                                                     |
| `npm run build`                                                                                                                        | Pass    | Current revision: the Next.js 16.3.0 production build compiled, typechecked, and generated all routes successfully.                                                                                                                                                                                                                                                                                                      |
| `npm run verify`                                                                                                                       | Blocked | The latest attempted aggregate gate stopped at `prettier --check .` with 82 warnings, mostly ignored generated Expo/Pods/native artifacts plus unchanged tracked `docs/pricing-and-packaging-research.md`. The fresh lint, typecheck, test, and production-build commands above passed independently.                                                                                                                    |
| `npx prettier --check PRDs/roadmap.md docs/changelog.md docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md` | Pass    | The three Task 9 documentation files pass targeted formatting.                                                                                                                                                                                                                                                                                                                                                           |
| `git diff --check`                                                                                                                     | Pass    | No whitespace errors.                                                                                                                                                                                                                                                                                                                                                                                                    |

The current root lint, typecheck, full Vitest suite, focused server selection,
production build, mobile gate, and both platform exports all pass independently. The aggregate
`npm run verify` remains blocked before those later stages by the known
repository Prettier/generated-artifact baseline. Expo
Doctor passed 21/21 earlier in the branch but now reports the patch-version
recommendations above; updating nine SDK packages was deliberately left outside
this acceptance-only Stage 2 closeout.

The earlier iOS export emitted six warnings that `NO_COLOR` was ignored while
`FORCE_COLOR` was set. No credential values were printed or recorded.

## Physical iPhone evidence

The test device was an iPhone Air (iPhone18,4), iOS 26.6, paired, booted, and in
Developer Mode. The installed app was `UsefulDesk Agent`
(`com.usefulmade.usefuldesk.agent`, version 0.1.0). The local development build
used the saved mobile environment without copying or recording environment
values. Generated native files remain ignored. `eas-cli@23.2.0` was not logged
in, so remote EAS build acceptance was not attempted.

Observed on the physical device:

- switching between two permitted branches kept their Inbox state isolated;
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
  the text composer, but no free-form message was sent.

The exact authorized body was:

> Hi Rajat, your Acceptance Test membership ends on 2026-09-01 TEST. Renewing at
> the current price of INR 0 TEST will continue your membership. Use the buttons
> below to respond.

No resend was performed during the final failure-rendering retest. The approved
contact was targeted by one provider submission attempt, and zero messages were
delivered by this acceptance exercise.

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

## Remaining acceptance limits

The following are implemented or covered by automated tests but were not
accepted on the physical device in this exercise:

- free-form send inside the 24-hour window;
- local optimistic text failure, retained/locked ambiguous drafts, and
  definite pre-send text Retry;
- physical viewer read-only mode and VoiceOver announcement behavior;
- large Dynamic Type and light appearance;
- keyboard/reachability behavior and a safe induced network interruption;
- successful provider delivery/read status patching; and
- Android interaction smoke and remote EAS builds.

Dark appearance, the earlier closed-window template flow, two-branch isolation,
and the provider-failure row are visible in the evidence under
`.impeccable/review/`. The later durable send-safety, contrast, and Dynamic Type
changes passed source review and automated tests but were not physically
retested. Those screenshots are local review artifacts and are intentionally
not committed. Stage 3 media, quoted replies, reactions, push notifications,
and advanced message actions remain deferred.
