# Native Mobile Android 11 Physical Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the current UsefulDesk Agent Stage 2 Inbox on the connected physical Android 11 device without sending a customer message or mutating CRM/provider data.

**Architecture:** Install the existing Expo development client on the authorized OnePlus 6, connect it to local Metro over ADB, and run normal authenticated branch-scoped reads separately from the exact `__DEV__` local conversation fixture. Use focused ADB metadata/log commands for objective evidence, require fresh approval before device-wide appearance/font changes, and route any discovered product defect through diagnosis plus a failing regression test before a minimal fix.

**Tech Stack:** Expo SDK 57, Expo Router, React Native 0.86, Android Debug Bridge, Android 11/API 30, Jest/React Native Testing Library, Markdown acceptance records.

**Spec:** `docs/superpowers/specs/2026-09-02-mobile-android-physical-smoke-design.md`

## Global Constraints

- Target only the connected physical OnePlus 6 / ONEPLUS A6000 running Android 11 (API 30), 1080 × 2280, 450 dpi.
- Use the existing ignored `apps/mobile/.env.local` without printing, copying, screenshotting, or documenting its values.
- Install a local development client only. Do not create EAS, Play Store, signing, push, or provider state.
- Normal app checks may authenticate, select an authorized account, and perform branch-scoped reads. They may not create, update, delete, or send customer/CRM/provider data.
- Do not press Send. The only permitted draft text is `Android layout check — do not send`, entered in the fail-closed local fixture and cleared before leaving it.
- The fixture is valid only for conversation id `7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141`, query flag `fixture=local-layout`, and `__DEV__ === true`.
- Obtain fresh user confirmation immediately before changing system appearance or font scale. Record the original values first and restore them before completion.
- Android 11 validates classic system Back only; do not claim predictive Back, Android 12+ dynamic color, tablet, foldable, or remote-distribution coverage.
- Normal-app screenshots are prohibited because they may contain customer data. Fixture screenshots are local evidence only and remain uncommitted.
- If authentication is required, pause while the user enters credentials directly on the device. Do not request, type, capture, or log credentials.
- A product defect stops this plan before source edits. Use
  `superpowers:systematic-debugging`, reproduce it narrowly, then add an exact
  TDD repair task to this plan from the concrete evidence before changing code.
- Do not add dependencies, migrations, shared UI masters, broad refactors, or Stage 3 behavior during this smoke.
- Generated `apps/mobile/android/`, APKs, Metro state, device logs, and screenshots are local artifacts and must not be staged.
- Update `docs/changelog.md` and `PRDs/roadmap.md` only with behavior actually verified or fixed. Record blocked and unverified paths honestly in the acceptance report.

## File Structure

- `docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md`: authoritative Android device, interaction, log, and coverage evidence.
- `PRDs/roadmap.md`: current Stage 2 acceptance status and remaining physical/release gates.
- `docs/changelog.md`: terse shipped/verified Android closeout note and future-agent gotcha.
- `apps/mobile/src/features/auth/screens/sign-in-screen.test.tsx`: regression boundary for sign-in keyboard/reachability defects.
- `apps/mobile/src/features/inbox/screens/inbox-screen.test.tsx`: regression boundary for Inbox navigation, filters, search, lifecycle, and screen-level adaptive layout defects.
- `apps/mobile/src/features/inbox/components/conversation-row.test.tsx`: regression boundary for Android row reflow, truncation, and touch-target defects.
- `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx`: regression boundary for fixture selection, thread navigation, keyboard avoidance, Back, and screen-level layout defects.
- `apps/mobile/src/features/inbox/components/message-bubble.test.tsx`: regression boundary for message body/metadata reflow defects.
- `apps/mobile/src/features/inbox/components/conversation-composer.test.tsx`: regression boundary for composer draft, focus, clear, send-gating, and keyboard-visible layout defects.
- `apps/mobile/src/ui/*.test.tsx`: regression boundary only when evidence proves a defect belongs to an existing shared master; warn the user and enumerate all call sites before editing that master.

---

### Task 1: Preflight, automated baseline, and current client installation

**Files:**

- Verify only: `apps/mobile/.env.local`
- Read: `apps/mobile/app.config.ts`
- Read: `docs/mobile/development-build.md`
- Verify ignored output: `apps/mobile/android/`

**Interfaces:**

- Consumes: one authorized ADB device, the existing public mobile environment, Android SDK/Gradle, package `com.usefulmade.usefuldesk.agent`, and Metro port 8081.
- Produces: an installed current debug development client, a running Metro session reachable through ADB reverse, and a clean automated baseline.

- [ ] **Step 1: Resolve exactly one authorized target without persisting its serial**

  Run from the repository root:

  ```bash
  adb devices -l
  android_target=$(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  test "$(printf '%s\n' "$android_target" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
  adb -s "$android_target" shell getprop ro.product.manufacturer
  adb -s "$android_target" shell getprop ro.product.model
  adb -s "$android_target" shell getprop ro.build.version.release
  adb -s "$android_target" shell getprop ro.build.version.sdk
  adb -s "$android_target" shell wm size
  adb -s "$android_target" shell wm density
  ```

  Expected: `OnePlus`, `ONEPLUS A6000`, Android `11`, SDK `30`, physical size `1080x2280`, physical density `450`. Stop if zero, multiple, unauthorized, or different devices resolve.

- [ ] **Step 2: Verify the saved environment is present and ignored without reading it**

  Run:

  ```bash
  test -s apps/mobile/.env.local
  git check-ignore -q apps/mobile/.env.local
  ```

  Expected: both commands exit 0 and print no value.

- [ ] **Step 3: Run the pre-device automated baseline**

  Run:

  ```bash
  npm run mobile:verify
  ```

  Expected: Expo lint and TypeScript pass; all 48 Jest suites / 528 tests pass. If counts change because another accepted edit added tests, record the observed passing counts rather than copying the older baseline.

- [ ] **Step 4: Start Metro and keep its terminal session open**

  Run from the repository root in a persistent terminal:

  ```bash
  npm run mobile:start
  ```

  Expected: Expo starts a development-client server on port 8081 without printing credential values. Keep the session id for later polling and shutdown.

- [ ] **Step 5: Reverse Metro and build/install the current client on the named device**

  Run in a second terminal with the Step 1 `android_target` value:

  ```bash
  adb -s "$android_target" reverse tcp:8081 tcp:8081
  cd apps/mobile
  npx expo run:android --device "ONEPLUS_A6000" --no-bundler
  ```

  Expected: Expo selects the physical OnePlus by device name, Gradle succeeds, package `com.usefulmade.usefuldesk.agent` installs, and the development client launches. Current Expo CLI resolves the non-interactive `--device` value by device name rather than ADB serial.

- [ ] **Step 6: Prove installation and cold launch**

  Run from the repository root:

  ```bash
  adb -s "$android_target" shell pm path com.usefulmade.usefuldesk.agent
  adb -s "$android_target" shell am force-stop com.usefulmade.usefuldesk.agent
  adb -s "$android_target" shell am start -n com.usefulmade.usefuldesk.agent/.MainActivity
  app_pid=$(adb -s "$android_target" shell pidof com.usefulmade.usefuldesk.agent | tr -d '\r')
  test -n "$app_pid"
  adb -s "$android_target" shell dumpsys activity activities | rg -m 1 'com\.usefulmade\.usefuldesk\.agent/(\.MainActivity|expo\.modules\.devlauncher\.launcher\.DevLauncherActivity)'
  ```

  Expected: `pm path` returns the installed APK path, the start intent is delivered,
  the package has a running process, and either MainActivity or Expo's
  DevLauncherActivity is resumed. Metro completes the bundle, and on screen the
  app reaches sign-in, branch selection, or Inbox without a native crash, red
  screen, or endless spinner. Do not use `am start -W`: Expo's MainActivity
  hands off to DevLauncherActivity on this client, causing Android 11's wait
  client to remain attached after the app is already resumed.

- [ ] **Step 7: Handle authentication without credential exposure**

  If sign-in is visible, pause execution and ask the user to authenticate directly on the device. After the user reports completion, verify the app reaches the selected branch Inbox. Do not inspect keyboard input, accessibility text, screenshots, or logs during credential entry.

- [ ] **Step 8: Prove session restoration**

  Run:

  ```bash
  adb -s "$android_target" shell am force-stop com.usefulmade.usefuldesk.agent
  adb -s "$android_target" shell am start -n com.usefulmade.usefuldesk.agent/.MainActivity
  ```

  Expected: the valid authenticated session returns to the selected branch Inbox without requesting credentials again. If the test account is intentionally signed out or expired, record the fail-closed sign-in result instead of treating sign-in as restored.

---

### Task 2: Normal authenticated Inbox, branch, Back, and lifecycle smoke

**Files:**

- Read: `apps/mobile/src/features/inbox/screens/inbox-screen.tsx`
- Read: `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`
- Read: `apps/mobile/src/features/foundation/account-screen.tsx`
- Evidence target: `docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md`

**Interfaces:**

- Consumes: the installed client, running Metro session, an authenticated account, and normal RLS-protected branch reads.
- Produces: pass/fail/blocked observations for Inbox loading, All/Unread, search, account navigation, available branch isolation, classic system Back, and foreground resynchronization.

- [ ] **Step 1: Verify the selected branch and initial Inbox**

  Observe the branch identity shown by the app and the initial Inbox. Confirm loading resolves to rows or an honest empty state, controls remain operable, and no prior-branch row flashes during startup. Do not photograph the normal Inbox.

- [ ] **Step 2: Exercise All, Unread, and search as local/read-only interactions**

  Tap **All**, tap **Unread**, enter a substring already visible in the current branch, clear it, and return to **All**. Expected: filters/search update the branch-scoped list without navigation loss, stale rows, clipping, or a mutation prompt. If there is no visible row suitable for search, record search-result coverage as blocked by available account data while still verifying entry/clear behavior.

- [ ] **Step 3: Exercise Account navigation and Android system Back**

  Open **Account**, verify the same selected branch is shown, then use the device/system Back gesture or button. Expected: the app returns to Inbox exactly once and does not exit, reveal sign-in, or show stale-branch content.

- [ ] **Step 4: Verify branch isolation only when two authorized branches exist**

  If the account offers at least two active branches, select the second branch in Account and verify the prior list clears before the new branch resolves. Navigate back to Inbox and switch back to the original branch using the same path. If only one branch exists, record this row as blocked by account data; do not create a branch or record.

- [ ] **Step 5: Exercise background/foreground resynchronization**

  With Inbox visible, send the app to the Android app switcher/home screen, wait long enough for the transition to settle, and reopen it. Expected: the session and selected branch remain correct, the list resynchronizes without duplicate rows, and the prior navigation state is coherent.

- [ ] **Step 6: Inspect focused runtime logs**

  Run immediately after the interaction sequence:

  ```bash
  app_pid=$(adb -s "$android_target" shell pidof com.usefulmade.usefuldesk.agent | tr -d '\r')
  test -n "$app_pid"
  adb -s "$android_target" logcat -d --pid="$app_pid" AndroidRuntime:E ReactNativeJS:V '*:S'
  ```

  Expected: no fatal Android exception, React Native red-screen exception, credential value, or unhandled promise rejection related to the exercised paths. Keep the output transient; record only the error-free result or a minimal redacted defect excerpt.

- [ ] **Step 7: Add a failing regression for branch-keyed unmount during selection**

  Modify
  `apps/mobile/src/features/auth/screens/select-branch-screen.test.tsx`. Render
  the exported `BranchChoices` directly with a deferred successful `onSelect`.
  Spy on React's two `useState` calls for this component so their setters retain
  normal behavior while recording invocations. Press a non-current branch,
  verify its pending setter ran for the selection, clear the setter spy, unmount
  the rendered component, resolve `onSelect`, and flush the promise. Assert that
  neither local-state setter runs after unmount. This setter-level lifecycle
  assertion is required because React Native's Jest renderer does not emit the
  physical development-overlay warning through `console.error`.

  Run:

  ```bash
  npm run mobile:test -- src/features/auth/screens/select-branch-screen.test.tsx
  ```

  Expected before the fix: the new test fails because `BranchChoices.choose`
  reaches its unconditional `finally` pending-state setter after unmount. If the
  hook spy cannot observe that setter call, remove only the attempted regression,
  do not change source code, and report the coverage blocker for controller
  review.

- [ ] **Step 8: Guard async BranchChoices cleanup across unmount**

  Modify
  `apps/mobile/src/features/auth/screens/select-branch-screen.tsx`. Track whether
  `BranchChoices` is mounted with a ref set by an effect cleanup. Keep the
  synchronous duplicate-selection lock in `selectingRef`. After `onSelect`
  settles, update `error` and `pendingBranchId` only while mounted; always release
  `selectingRef` so a still-mounted branch chooser remains retryable. Do not
  change labels, styling, navigation, or branch authorization behavior.

- [ ] **Step 9: Prove the focused regression is green**

  Run:

  ```bash
  npm run mobile:test -- src/features/auth/screens/select-branch-screen.test.tsx
  npm run mobile:test -- src/features/foundation/account-screen.test.tsx src/features/auth/screens/select-branch-screen.test.tsx src/features/auth/auth-context.test.tsx
  ```

  Expected: the new unmount regression passes; the mounted-success retry and
  failed-selection recovery tests still pass.

- [ ] **Step 10: Run automated gates for the repair**

  Run:

  ```bash
  npm run mobile:verify
  npx prettier --check apps/mobile/src/features/auth/screens/select-branch-screen.test.tsx apps/mobile/src/features/auth/screens/select-branch-screen.tsx
  git diff --check
  ```

  Expected: all mobile verification, formatting, and whitespace gates pass.

- [ ] **Step 11: Re-test branch transitions on the physical device**

  With Metro still serving the installed development client, switch from the
  original branch to the alternate authorized branch, then switch back. Confirm
  the prior branch rows clear before the destination resolves, Inbox navigation
  remains coherent, and the React development warning does not appear on either
  transition. Leave the original branch selected and delete transient UI dumps
  or screenshots.

- [ ] **Step 12: Re-inspect focused runtime logs**

  Repeat the Step 6 PID-scoped log command after the repaired branch sequence.
  Expected: no fatal Android exception, React development warning, red-screen
  exception, credential value, or unhandled promise rejection related to the
  branch transitions.

---

### Task 3: Fail-closed fixture, keyboard, Back, appearance, and font scale

**Files:**

- Read: `apps/mobile/src/features/inbox/inbox-test-fixtures.ts`
- Modify: `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`
- Modify: `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx`
- Local evidence only: `.impeccable/review/android-11-fixture-light-large.png`
- Local evidence only: `.impeccable/review/android-11-fixture-dark-large.png`

**Interfaces:**

- Consumes: custom scheme `usefuldesk-agent`, the exact fixture conversation id/flag, the authenticated account context needed to enter protected routes, and the original Android appearance/font settings.
- Produces: safe deterministic evidence for message/composer reflow, software-keyboard avoidance, harmless draft clearing, Back, both appearances, large font scale, and zero send transport.

- [ ] **Step 1: Record original device-wide settings without changing them**

  Run in one persistent shell so the values remain available for restoration:

  ```bash
  android_original_night=$(adb -s "$android_target" shell cmd uimode night | sed -n 's/^Night mode: //p' | tr -d '\r')
  android_original_font_scale=$(adb -s "$android_target" shell settings get system font_scale | tr -d '\r')
  test -n "$android_original_night"
  test -n "$android_original_font_scale"
  ```

  Expected: a recognized night mode and numeric font scale. Keep these variables until Step 8.

- [ ] **Step 2: Open the exact local fixture**

  Run:

  ```bash
  adb -s "$android_target" shell am start \
    -a android.intent.action.VIEW \
    -d 'usefuldesk-agent://conversation/7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141?fixture=local-layout' \
    com.usefulmade.usefuldesk.agent
  ```

  Expected: the protected production conversation screen opens with **Asha Rao · Local fixture**, one date separator, three chronological multi-line bubbles, timestamps/read metadata, and the Stage 2 composer. A different screen or network-backed conversation is a failure; do not continue typing.

- [ ] **Step 3: Verify software-keyboard avoidance without sending**

  Focus the **Message** field and type exactly `Android layout check — do not send`. Expected: the software keyboard appears, the focused field and newest bubble remain visible, the composer does not overlap system navigation, and the Send target stays reachable. Clear the entire draft and verify the field is empty. Never press Send.

  If Android's `input text` command rejects the Unicode em dash before changing
  the field, first verify the draft stayed empty, then use the ASCII-only fallback
  `Android layout check - do not send` for physical layout coverage. Record the
  Unicode input failure as an ADB harness limitation, not an app result. The
  layout expectation and zero-Send rule are unchanged.

- [ ] **Step 3A: Add a failing regression for the keyboard container's window offset**

  Modify
  `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx`. Replace
  the old expectation that `keyboardVerticalOffset` is undefined. Render an
  open-text conversation, obtain a new
  `conversation-keyboard-offset-container`, and invoke its `onLayout` with a
  typed synthetic event whose captured current target exposes
  `measureInWindow`. Have the measurement callback return a nonzero window Y
  such as `84`, await the rerender, and assert the existing
  `conversation-keyboard-avoiding-view` receives
  `keyboardVerticalOffset={84}` while retaining the platform-specific behavior
  assertion.

  Run:

  ```bash
  npm run mobile:test -- src/features/inbox/screens/conversation-screen.test.tsx
  ```

  Expected before the fix: the regression fails because the measurable
  container is absent and the keyboard offset remains undefined.

- [ ] **Step 3B: Measure the real container offset with public React Native APIs**

  Modify `apps/mobile/src/features/inbox/screens/conversation-screen.tsx` using
  only installed public React Native APIs; do not import Expo Router's private
  vendored navigation modules and do not add an external React Navigation
  package. Wrap the existing `KeyboardAvoidingView` in a non-collapsible
  `View` with `className="flex-1"`,
  `testID="conversation-keyboard-offset-container"`, and an `onLayout`
  handler. Capture `event.currentTarget` synchronously, call its
  `measureInWindow`, normalize finite Y values to at least zero, and pass the
  measured state as `keyboardVerticalOffset`. Guard callbacks with mounted and
  request-generation refs so an unmounted or superseded measurement cannot set
  state. Preserve the existing Android `height`, iOS `padding`, list, footer,
  styling, and no-send fixture behavior.

- [ ] **Step 3C: Prove the keyboard-offset repair is green**

  Run:

  ```bash
  npm run mobile:test -- src/features/inbox/screens/conversation-screen.test.tsx
  npm run mobile:verify
  npx prettier --check apps/mobile/src/features/inbox/screens/conversation-screen.tsx apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx
  git diff --check
  ```

  Expected: the focused regression and all mobile gates pass. Commit only the
  two repair files; do not stage pre-existing Stage 2 changes.

- [ ] **Step 3D: Re-test keyboard avoidance on the physical fixture**

  Reopen the exact local-layout fixture through the approved custom scheme,
  focus Message, enter the approved harmless draft (using the documented ASCII
  fallback only if the Unicode ADB harness fails atomically), and confirm the
  newest bubble, full field, and Send target remain above Gboard and reachable.
  Clear the entire draft, verify Send is disabled, never press it, then repeat
  Step 4's two-stage Back behavior. Remove transient diagnosis artifacts and
  leave the app on Inbox before requesting device-setting approval.

- [ ] **Step 4: Verify fixture system Back behavior**

  First use system Back while the keyboard is open and confirm it dismisses the keyboard without losing the conversation. Use system Back again and confirm the app returns to Inbox rather than exiting or revealing stale state.

- [ ] **Step 5: Obtain action-time approval for appearance/font changes**

  Pause and ask the user for confirmation immediately before changing the device-wide settings. Do not treat approval of the design or this plan as action-time approval. If the user declines, skip Steps 6–8 and record appearance/font coverage as blocked by declined device-setting authority.

- [ ] **Step 5A: Add failing viewport-resize follow tests**

  Modify
  `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx` with two
  focused regressions. For a bottom-following reader, fire an initial list layout
  at height `700`, complete the one-time content-size positioning, clear the
  scroll mock, then fire a reduced list layout at height `360`. Expect exactly
  one `scrollToEnd({ animated: false })`; repeating height `360` must not add a
  call, and the first layout alone must not scroll. In the complementary test,
  fire an `onScroll` event whose metrics place the reader away from the bottom,
  then shrink `700` to `360`; expect no scroll and retain **Jump to latest**.

  Run:

  ```bash
  npm run mobile:test -- src/features/inbox/screens/conversation-screen.test.tsx
  ```

  Expected before the fix: the bottom-following viewport-shrink regression
  fails because the list has no layout-change handler; the away-from-bottom
  preservation remains green.

- [ ] **Step 5B: Re-pin only a bottom-following reader after viewport resize**

  Modify `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`.
  Store the last message-list viewport height in a ref. Add a `FlatList.onLayout`
  handler that updates the stored height and returns without scrolling for the
  first layout, an unchanged height, an uncompleted initial position, or a reader
  whose existing `stickToBottomRef` is false. For a genuine later height change
  while bottom-following, call `scrollToEnd({ animated: false })`. Do not add a
  timer or keyboard listener: React Native updates VirtualizedList's visible
  length before invoking the public layout callback, so the synchronous scroll
  uses the resized viewport. Preserve the existing insert-follow behavior,
  top-pagination anchoring, and Jump-to-latest semantics.

- [ ] **Step 5C: Prove the viewport repair is green**

  Run:

  ```bash
  npm run mobile:test -- src/features/inbox/screens/conversation-screen.test.tsx
  npm run mobile:verify
  npx prettier --check apps/mobile/src/features/inbox/screens/conversation-screen.tsx apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx
  git diff --check
  ```

  Expected: both viewport regressions and all mobile gates pass. Commit only the
  two repair files; do not stage pre-existing Stage 2 changes.

- [ ] **Step 5D: Renew action-time approval after the repaired build is ready**

  The prior appearance run ended and restored the original settings after it
  found the large-font viewport defect. Pause again and obtain fresh user
  confirmation immediately before reapplying light/dark mode or font scale for
  Steps 6–8.

- [ ] **Step 6: Exercise light appearance at large standard font scale**

  After approval, run from the same persistent shell:

  ```bash
  adb -s "$android_target" shell cmd uimode night no
  adb -s "$android_target" shell settings put system font_scale 1.3
  adb -s "$android_target" shell am force-stop com.usefulmade.usefuldesk.agent
  adb -s "$android_target" shell am start \
    -a android.intent.action.VIEW \
    -d 'usefuldesk-agent://conversation/7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141?fixture=local-layout' \
    com.usefulmade.usefuldesk.agent
  ```

  Recheck the full fixture header, date separator, all message text, timestamps/read ticks, Message field, Send target, keyboard avoidance, clipping, overlap, truncation, and touch reachability. With only the synthetic fixture visible, capture local evidence:

  ```bash
  adb -s "$android_target" shell screencap -p /sdcard/usefuldesk-android-fixture-light-large.png
  adb -s "$android_target" pull /sdcard/usefuldesk-android-fixture-light-large.png .impeccable/review/android-11-fixture-light-large.png
  adb -s "$android_target" shell rm /sdcard/usefuldesk-android-fixture-light-large.png
  ```

- [ ] **Step 7: Exercise dark appearance at the same font scale**

  Run:

  ```bash
  adb -s "$android_target" shell cmd uimode night yes
  adb -s "$android_target" shell am force-stop com.usefulmade.usefuldesk.agent
  adb -s "$android_target" shell am start \
    -a android.intent.action.VIEW \
    -d 'usefuldesk-agent://conversation/7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141?fixture=local-layout' \
    com.usefulmade.usefuldesk.agent
  ```

  Repeat the same layout/keyboard inspection and confirm semantic text, bubbles, metadata, focus, and controls retain readable contrast. With only the synthetic fixture visible, capture local evidence:

  ```bash
  adb -s "$android_target" shell screencap -p /sdcard/usefuldesk-android-fixture-dark-large.png
  adb -s "$android_target" pull /sdcard/usefuldesk-android-fixture-dark-large.png .impeccable/review/android-11-fixture-dark-large.png
  adb -s "$android_target" shell rm /sdcard/usefuldesk-android-fixture-dark-large.png
  ```

- [ ] **Step 8: Restore and verify the original device-wide settings**

  Run before any further task, even when Step 6 or 7 reveals a defect:

  ```bash
  adb -s "$android_target" shell cmd uimode night "$android_original_night"
  adb -s "$android_target" shell settings put system font_scale "$android_original_font_scale"
  restored_night=$(adb -s "$android_target" shell cmd uimode night | sed -n 's/^Night mode: //p' | tr -d '\r')
  restored_font_scale=$(adb -s "$android_target" shell settings get system font_scale | tr -d '\r')
  test "$restored_night" = "$android_original_night"
  test "$restored_font_scale" = "$android_original_font_scale"
  ```

  Expected: both equality checks exit 0. Relaunch UsefulDesk Agent and leave it on Inbox in the restored appearance/font setting.

- [ ] **Step 9: Prove the fixture made no transport attempt**

  Run immediately after the fixture sequence:

  ```bash
  app_pid=$(adb -s "$android_target" shell pidof com.usefulmade.usefuldesk.agent | tr -d '\r')
  test -n "$app_pid"
  adb -s "$android_target" logcat -d --pid="$app_pid" AndroidRuntime:E ReactNativeJS:V '*:S'
  ```

  Expected: no `Local layout fixture cannot send messages` exception, no `/api/whatsapp/send` attempt, and no unhandled runtime error. The fixture screen test remains the automated proof that its injected sender throws before the real client.

---

### Task 4: Acceptance evidence, product status, and final gates

**Files:**

- Modify: `docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md`
- Modify: `PRDs/roadmap.md`
- Modify: `docs/changelog.md`
- Verify only: `.impeccable/review/android-11-fixture-light-large.png`
- Verify only: `.impeccable/review/android-11-fixture-dark-large.png`

**Interfaces:**

- Consumes: completed matrix results, install/launch output, focused logs, restored setting values, any focused TDD evidence, and explicit coverage limits.
- Produces: an honest Stage 2 Android acceptance record and synchronized roadmap/changelog status without exposing customer data or credentials.

- [ ] **Step 1: Update the acceptance report with an Android evidence section**

  Add **Physical Android evidence** containing the exact non-sensitive device facts, build/install result, cold launch/session result, Inbox/filter/search result, available branch-isolation result, system Back result, foreground result, fixture/keyboard result, light/dark/1.3-font result, original-setting restoration result, and filtered-log result. Use only `Pass`, `Fail`, or `Blocked` for each row and explain every `Blocked` result in one sentence.

  Replace the old claim that no Android runtime target was available. In **Remaining acceptance limits**, remove only the Android behaviors actually exercised and retain predictive Back, newer theming, alternate form factors, remote EAS, and any account-data-dependent check that remained blocked.

- [ ] **Step 2: Synchronize roadmap and changelog with verified facts**

  In `PRDs/roadmap.md`, replace the pending Android-runtime sentence with the observed Android 11 status and preserve all unrelated pending acceptance gates. In `docs/changelog.md`, add a terse note that names the physical device/API level, the validated normal-app and fixture boundaries, any defect/fix files, and the Android 11 coverage limitation. Do not describe a blocked or automated-only behavior as physically accepted.

- [ ] **Step 3: Run final automated and documentation gates**

  Run:

  ```bash
  npm run mobile:verify
  npx prettier --check PRDs/roadmap.md docs/changelog.md docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md docs/superpowers/plans/2026-09-02-mobile-android-physical-smoke.md
  git diff --check
  git status --short
  ```

  Expected: mobile lint/typecheck/Jest pass; targeted documentation formatting passes; the diff check exits 0; generated Android output, APKs, environment files, logs, and screenshots are absent from the staged/source change set.

- [ ] **Step 4: Review the evidence against the approved specification**

  Confirm every spec acceptance criterion has either passing physical evidence or an explicit blocker. Confirm the report does not include credentials, tokens, real customer phone numbers, message bodies, callback URLs, signed links, or screenshots. Confirm original device settings were restored and the app is left on Inbox.

- [ ] **Step 5: Present the closeout without broadening acceptance**

  Report the Android 11 outcome first, followed by verified interactions, fixed defects with test evidence, blockers, device-setting restoration, and remaining platform/release limits. Do not claim Android 13+ predictive Back, Android 12+ theming, tablet/foldable, provider delivery, or remote build acceptance.
