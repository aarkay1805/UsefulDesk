# Native mobile Inbox Stage 2 acceptance

**Date:** 2026-09-02

**Branch:** `feature/mobile-native-inbox-stage-1`

**Status:** **PARTIAL ACCEPTANCE — implementation and provider submission passed;
delivery and parts of the physical matrix remain unverified.**

## Outcome

Stage 2 is built and its final mobile lint, typecheck, and complete Jest suite
pass. Physical iPhone testing passed branch isolation, the closed-window
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

| Command                                                                                                                                | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run mobile:verify`                                                                                                                | Pass    | Final revision after `ee34cc7`: Expo lint and `tsc --noEmit` passed; Jest 46 suites / 482 tests, 0 snapshots; 12.833 s.                                                                                                                                                                                                                                               |
| `npm test -- src/lib/auth/mobile-operational-access.test.ts src/app/api/whatsapp/send/route.test.ts src/proxy.test.ts`                 | Pass    | Final revision: Vitest 4.1.9; 3 files / 66 tests; 234 ms.                                                                                                                                                                                                                                                                                                             |
| `(cd apps/mobile && npx expo-doctor)`                                                                                                  | Pass    | Earlier branch run: 21/21 checks passed. It was not rerun after the final presentation-only fixes.                                                                                                                                                                                                                                                                    |
| `(cd apps/mobile && npx expo export --platform ios --output-dir "$stage2_ios_export")`                                                 | Pass    | Earlier branch run exported 2,483 modules, 23 assets, and one 6.2 MB iOS bundle to `/tmp/usefuldesk-stage2-ios.w5MLSu`. It was not rerun after the final presentation-only fixes.                                                                                                                                                                                     |
| `npm run verify`                                                                                                                       | Blocked | The latest attempted repository gate stopped at `prettier --check .` on `apps/mobile/.expo/types/router.d.ts`, `apps/mobile/expo-env.d.ts`, and `docs/pricing-and-packaging-research.md`. The generated paths are ignored and the tracked pricing document is an unchanged baseline failure. Later lint/typecheck/test/build stages were not reached by this command. |
| `npx prettier --check PRDs/roadmap.md docs/changelog.md docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md` | Pass    | The three Task 9 documentation files pass targeted formatting.                                                                                                                                                                                                                                                                                                        |
| `git diff --check`                                                                                                                     | Pass    | No whitespace errors.                                                                                                                                                                                                                                                                                                                                                 |

An earlier full root Vitest run passed 406 suites / 3,053 tests. A later agent
reported 3,055 / 3,055 root tests after additional coverage. Neither full root
run occurred after final presentation commit `ee34cc7`, so neither is claimed as
a final-revision gate; the fresh 66-test root selection above covers the bearer,
send-route, and proxy boundaries touched by Stage 2.

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

## Remaining acceptance limits

The following are implemented or covered by automated tests but were not
accepted on the physical device in this exercise:

- free-form send inside the 24-hour window;
- local optimistic text failure, draft retention, and text Retry;
- physical viewer read-only mode;
- large Dynamic Type and light appearance;
- keyboard/reachability behavior and a safe induced network interruption;
- successful provider delivery/read status patching; and
- Android interaction smoke and remote EAS builds.

Dark appearance, the closed-window template flow, two-branch isolation, and the
provider-failure row are visible in the evidence under `.impeccable/review/`.
Those screenshots are local review artifacts and are intentionally not
committed. Stage 3 media, quoted replies, reactions, push notifications, and
advanced message actions remain deferred.
