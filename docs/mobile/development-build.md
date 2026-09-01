# Mobile development builds

This runbook verifies the UsefulDesk Agent native foundation. It covers the
development client, authentication, secure session restoration, and
branch-scoped access. The next product boundary is a read-only Inbox; this
foundation does not ship Inbox data or any customer/provider mutation.

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

## Deterministic checks

From the repository root, use non-secret synthetic `EXPO_PUBLIC_*` values for
bundle-only checks when approved local values are unavailable:

```bash
npm run mobile:verify
(cd apps/mobile && npx expo-doctor)
(cd apps/mobile && npx expo export --platform ios --output-dir "$(mktemp -d)/usefuldesk-ios-export")
(cd apps/mobile && npx expo export --platform android --output-dir "$(mktemp -d)/usefuldesk-android-export")
npm run verify
git diff --check
```

Never print or persist real environment values in test output.

## Remote EAS checkpoint — separate authorization required

`apps/mobile/eas.json` provides an iOS simulator profile and an internal device
profile. EAS CLI is intentionally not installed in the repository; use the
exact Node 20-compatible version on demand. This version-only check does not
log in or create external state:

```bash
npx --yes eas-cli@18.0.1 --version
```

The following commands create external EAS project/build state, require an
authenticated Expo account, and may request Apple or Google credentials. Do
not run either command without separate explicit owner authorization:

```bash
npx --yes eas-cli@18.0.1 build --profile development-simulator --platform ios
npx --yes eas-cli@18.0.1 build --profile development-device --platform android
```

When authorized later, run them from `apps/mobile` and record only build IDs and
statuses. Never commit credentials, provisioning data, signed URLs, or tokens.
