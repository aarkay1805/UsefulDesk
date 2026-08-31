# UsefulDesk Agent

UsefulDesk Agent is the phone-first mobile workspace for gym staff. This Expo app lives in the UsefulDesk monorepo and shares the product's Supabase tenant model while keeping mobile authentication and selected-branch state local to the device.

## Develop locally

From the repository root:

```bash
npm install
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
