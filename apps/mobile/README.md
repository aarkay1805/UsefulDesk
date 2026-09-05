# UsefulDesk Agent

UsefulDesk Agent is the phone-first mobile workspace for gym staff. This Expo app lives in the UsefulDesk monorepo and shares the product's Supabase tenant model while keeping mobile authentication and selected-branch state local to the device. Its Stage 2 Inbox supports branch-scoped realtime history, viewer-safe read-only access, service-window text, and Approved positional templates.

## Develop locally

From the repository root:

```bash
npm install
npm run mobile:routes
npm run mobile:start
```

Use an iOS or Android development build. Native secure session storage is part of the authentication contract, so this app is not developed or validated in Expo Go.

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and provide the public mobile configuration before starting. Never place a Supabase secret or service-role key in an `EXPO_PUBLIC_*` variable.

## Verify changes

From the repository root:

```bash
npm run mobile:verify
```

For native setup, development-build creation, and simulator commands, see [the mobile development-build guide](../../docs/mobile/development-build.md).

For standalone internal tester builds and release acceptance, see [the internal testing runbook](../../docs/mobile/internal-testing.md).
