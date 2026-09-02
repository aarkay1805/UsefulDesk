# Mobile development builds

This runbook verifies the UsefulDesk Agent native foundation and the shipped
Stage 2 Inbox. It covers the development client, authentication, secure session
restoration, branch-scoped conversation lists and history, realtime recovery,
role- and service-window-gated outbound controls, optimistic text state, and
Approved template sending. Stage 3 rich chat remains outside this boundary.

## Prerequisites

- Use Node.js 20.18.1 or newer and install dependencies from the repository
  root with `npm install`. The repository root owns the only lockfile.
- For iOS, install Xcode and its command-line tools. For Android, install the
  Android SDK and have either an emulator or an explicitly targeted development
  device available.
- Obtain the existing public Expo values through the approved team channel.
  Only the public Supabase URL, public Supabase anon key, UsefulDesk API base
  URL, and app environment belong in the installed app. Never add service-role,
  UsefulDesk API, Meta, Razorpay, signing, or other server credentials.

## Environment setup

Create the ignored local file from the committed contract:

```bash
cd apps/mobile
cp .env.example .env.local
chmod 600 .env.local
```

Use a trusted editor to replace the examples with the approved existing public
values. Do not use `cat`, `echo`, shell tracing, screenshots, or build logs to
copy or inspect them. Expo loads `.env.local` automatically. When a shell needs
the same values for a local command, source the file without printing it:

```bash
set -a
source .env.local
set +a
```

Keep `.env.local` local. Before committing, confirm it remains ignored with
`git check-ignore apps/mobile/.env.local` from the repository root.

## Start and build locally

After a development client is installed, start Metro from the repository root:

```bash
npm run mobile:routes
npm run mobile:start
```

Build the development client locally from `apps/mobile`:

```bash
npx expo run:ios
npx expo run:android
```

Each command creates the corresponding `ios/` or `android/` directory when it
is absent, compiles a debug development client with the local native toolchain,
installs it on the selected simulator/emulator or explicitly selected device,
and starts Metro. Later JavaScript or TypeScript changes need only Metro; rerun
the native build after changing a native dependency, native app configuration,
or the Expo SDK.

The native directories and local build outputs are derived artifacts. They are
ignored and must not be committed or treated as source. Make durable native
changes through `app.config.ts` or Expo config plugins so regeneration retains
them. Before committing, verify `git status --short` contains neither generated
native directories nor binaries.

To prove native compilation without starting Metro, regenerate the projects and
build their debug targets:

```bash
cd apps/mobile
npx expo prebuild --platform ios --clean
npx expo run:ios --device <device-identifier> --no-bundler
npx expo prebuild --platform android --clean
(cd android && ./gradlew app:assembleDebug --no-daemon)
```

The Android APK is written to
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. A successful
compile or install is build evidence only; it does not replace the interaction
checklist below.

## Foundation smoke checklist

Use a non-production test user and test branches. Record only pass/fail and the
simulator/emulator model; do not record credentials, tokens, callback URLs, or
signed build links.

Authentication and session:

- Cold launch starts signed out; password sign-in reaches **Native connection
  ready** and shows the expected user and branch.
- A wrong password stays on sign-in with a recoverable error and no sensitive
  detail.
- Google sign-in opens the provider, returns through the `usefuldesk-agent`
  callback, and reaches the same protected foundation.
- Relaunch restores a valid session without asking for the password again.
- After token refresh, the protected foundation remains available and the
  selected branch is unchanged.
- Sign out returns to sign-in. Relaunch must not restore the user or branch;
  the SecureStore session and saved branch selection must be cleared.

Branch isolation:

- A user with multiple active branches is asked to select one when no valid
  saved choice exists.
- Select a non-default branch and confirm the foundation and Account screen
  show that branch. Relaunch and confirm the valid choice is restored.
- Switch branches in Account and confirm the protected foundation changes to
  the selected branch without showing data from the prior branch.
- Archive or revoke the selected test branch from an authorized web session,
  then relaunch. The mobile app must fail closed, omit the archived branch from
  selectable choices, and require another authorized active branch or sign-out.

iOS behavior:

- Exercise swipe-back on Account and branch selection without bypassing the
  protected route.
- Open the keyboard on sign-in, dismiss it, and confirm fields and actions stay
  reachable at phone width.
- Increase Dynamic Type and confirm labels, errors, branch choices, and actions
  remain readable and operable.

Android behavior:

- Exercise system Back from Account, branch selection, and provider return;
  protected routes must not reveal signed-out or stale-branch content.
- Background or stop the process, allow Android to recreate it, and confirm the
  valid session/branch restores or an invalid one fails closed.
- Repeat sign-out followed by process recreation and confirm no cached session
  or branch returns.

This checklist authorizes reads required to authenticate, resolve branch
membership, and render the foundation only. Do not send a customer message,
create or change a payment, invoke a financial provider, change a mandate,
refund money, or perform any other customer/provider mutation.

### Native Inbox Stage 2

Treat outbound states as read-only acceptance unless the owner gives explicit
action-time approval for the exact test recipient and payload. Never send merely
to complete this checklist.

- Inbox opens as the authenticated home for the selected branch.
- All and Unread, search, pull-to-refresh, and pagination never show another branch.
- Opening a conversation shows chronological history and preserves the visible
  message when older history loads.
- Scrolling upward loads older history without moving the visible message.
- Incoming messages update the list and open thread once, without forcing an older reader to the bottom.
- Reconnect and foreground resync recover missed events.
- Agent-or-higher clears shared unread state; viewer remains read-only.
- Switching branch clears the old list/thread before the new branch loads.
- Inside the 24-hour customer-service window, agent-or-higher sees the text
  composer; outside it, only Approved/synced POSITIONAL templates are offered.
- A definite pre-send text failure keeps the draft and offers Retry. An
  ambiguous text result locks the unchanged draft rather than risking a
  duplicate send.
- Template attempts remain locked across remounts when their outcome is unknown
  until the agent explicitly confirms checking the conversation.
- A same-message sent-to-failed transition is announced once by VoiceOver;
  cold failed mounts, unrelated updates, and repeated failed renders stay
  silent.
- Light and dark appearances retain readable semantic states, and large Dynamic
  Type leaves every field and action operable.

Latest acceptance record:

- Device: physical iPhone Air (iPhone18,4) / iOS 26.6
- Stage 2 deterministic checks: pass
- Earlier Stage 2 native navigation/template/provider-failure flow: pass
- Realtime incoming test: not exercised
- Cross-branch isolation: pass
- Latest iOS build/install after the SDK patch upgrade: pass; the unlocked
  development client also launched through Metro
- Latest Android debug build, install, launch, and normal-font physical smoke:
  pass on a OnePlus 6 running Android 11
- Latest physical branch isolation, foreground/session recovery, persisted
  failed-row safety, and base light/dark appearance: pass
- Maximum standard Dynamic Type: fail; Inbox and conversation content clips or
  truncates
- Latest physical viewer, transition-only VoiceOver announcement,
  software-keyboard avoidance, edge-swipe navigation, optimistic
  Retry/ambiguous lock, and live realtime checks: not accepted

## Deterministic checks

From the repository root, use non-secret synthetic `EXPO_PUBLIC_*` values for
bundle-only checks when approved local values are unavailable:

```bash
npm run mobile:verify
npx expo-doctor@latest apps/mobile --verbose
mobile_ios_export="$(mktemp -d /tmp/usefuldesk-inbox-ios.XXXXXX)"
(cd apps/mobile && npx expo export --platform ios --output-dir "$mobile_ios_export")
mobile_android_export="$(mktemp -d /tmp/usefuldesk-inbox-android.XXXXXX)"
(cd apps/mobile && npx expo export --platform android --output-dir "$mobile_android_export")
npm run verify
git diff --check
git status --short
```

Never print or persist real environment values in test output.

Run Expo Doctor from the repository root with `apps/mobile` as its target. The
workspace dependency layout is hoisted, so invoking it from inside the mobile
package can incorrectly look for a package-local Expo installation. Mobile
typecheck first regenerates Expo Router declarations, so a missing ignored
`.expo/types/router.d.ts` cannot make a clean checkout fail.

The aggregate `npm run verify` can still stop at the unrelated, unchanged
tracked Prettier baseline `docs/pricing-and-packaging-research.md`. Generated
Expo/native directories are ignored by Prettier and must not be counted as
source-formatting failures.

## Remote EAS development builds

`apps/mobile/eas.json` provides an iOS simulator profile and an internal device
profile. Both development profiles read the EAS `development` environment. EAS
CLI is intentionally not installed in the repository; use the pinned on-demand
version and confirm authentication before attempting project or build state:

```bash
npx --yes eas-cli@18.0.1 --version
npx --yes eas-cli@18.0.1 whoami
```

If `app.config.ts` has no `extra.eas.projectId`, an authenticated project owner
must link or initialize the correct existing EAS project first. Do not invent a
project ID or create a duplicate project. Confirm that the EAS `development`
environment contains exactly the four public variable names from `.env.example`
without requesting or printing sensitive values:

```bash
npx --yes eas-cli@18.0.1 env:list development --format short
```

For an iOS internal device build, register the approved device before building:

```bash
npx --yes eas-cli@18.0.1 device:create
```

Remote builds create external state and may request Apple or Google
credentials. Run them only with explicit owner authorization and an
authenticated account:

```bash
npx --yes eas-cli@18.0.1 build --profile development-device --platform ios
npx --yes eas-cli@18.0.1 build --profile development-device --platform android
```

Run the EAS commands from `apps/mobile` and record only build IDs and statuses.
Never commit credentials, provisioning data, signed URLs, tokens, or environment
values.
