# Agent Mobile Workspace and Native Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible Expo mobile workspace that authenticates existing UsefulDesk users, securely persists their session, resolves an authorized branch, and reaches a protected native foundation screen on iOS and Android without moving or regressing the web application.

**Architecture:** Keep the Next.js web package at the repository root and add `apps/mobile` as an npm workspace. The mobile app owns its routes and native UI, uses one Supabase user client with SecureStore-backed Auth and a branch-aware fetch adapter, and keeps HeroUI Native behind UsefulDesk-owned provider and component boundaries. This plan stops at a working authenticated foundation; inbox data, WhatsApp sends, SQLite caching, and push notifications have separate plans under the approved design.

**Tech Stack:** npm 11 workspaces, Expo 57.0.18, React Native 0.86.3, React 19.2.3, TypeScript 6.0, Expo Router 57, HeroUI Native 1.0.9, Uniwind 1.11.0, Supabase JS 2.107.0, Expo SecureStore, Jest/jest-expo, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-31-agent-mobile-foundation-inbox-design.md`

## Global Constraints

- Keep the existing Next.js application, Vercel project root, root `src/`, and root scripts operational; do not move the web app into `apps/web`.
- Use one repository-level `package-lock.json`; do not commit `apps/mobile/package-lock.json`, `apps/mobile/.git`, generated `ios/`, or generated `android/` in this plan.
- Pin the initial native compatibility set to Expo `~57.0.18`, React Native `0.86.3`, React `19.2.3`, HeroUI Native `1.0.9`, and Uniwind `1.11.0`; upgrades require a separate verified change.
- Feature code imports UsefulDesk native masters, never `heroui-native` directly. Only `apps/mobile/src/core/mobile-app-providers.tsx` and `apps/mobile/src/ui/*` may import HeroUI Native.
- Existing root `AGENTS.md` remains canonical. `apps/mobile/AGENTS.md` may add mobile-only rules but must not duplicate shared tenancy, authorization, locale, or gym-domain rules.
- The installed app contains only the public Supabase URL, anon key, and UsefulDesk API base URL. Never embed a service-role key, UsefulDesk public API key, Meta token, Razorpay credential, or other server secret.
- Supabase Auth sessions persist through SecureStore. SQLite is deferred until the read-only inbox plan.
- Every branch-scoped PostgREST request carries `x-usefuldesk-account-id`; a stored branch preference is revalidated against `my_branch_accounts` at every startup.
- Archived, malformed, removed, and unauthorized branches fail closed. Explicit invalid branch state must never silently fall back to another branch.
- Support existing email/password and Google identities. Signup, password recovery, and invitation redemption continue on the web in this plan.
- The foundation build exposes no internal staff chat, customer message send, payment, attendance, or other provider mutation.
- Do not create dead product tabs. The foundation has auth routes plus one protected branch-status screen and Account; the Inbox tab arrives with working inbox data in the next plan.
- Run root web verification and mobile verification before completion. Update `docs/changelog.md` and `PRDs/roadmap.md` only after the foundation is implemented and verified.

---

### Task 1: Create the npm workspace and minimal Expo application

**Files:**

- Create: `scripts/mobile-workspace-contract.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.mjs`
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/eslint.config.js`
- Create: `apps/mobile/app.json` (temporary; Task 2 replaces it with `app.config.ts`)
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/assets/**` from the Expo SDK 57 default template
- Create: `apps/mobile/.gitignore`

**Interfaces:**

- Produces: npm workspace `@usefuldesk/mobile` with root scripts `mobile:start`, `mobile:ios`, `mobile:android`, `mobile:test`, `mobile:typecheck`, and `mobile:verify`.
- Produces: Expo Router entry point `apps/mobile/app/_layout.tsx` and temporary root screen.
- Consumes: Node `>=20.18.1`, npm `11.9.0`, and the existing root lockfile.

- [ ] **Step 1: Write the failing workspace contract test**

  Create `scripts/mobile-workspace-contract.test.mjs`:

  ```js
  import { readFileSync } from 'node:fs';
  import { describe, expect, it } from 'vitest';

  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

  describe('mobile npm workspace', () => {
    it('keeps web at root and registers the Expo app as a workspace', () => {
      const root = readJson('package.json');
      const mobile = readJson('apps/mobile/package.json');

      expect(root.workspaces).toEqual(['apps/*', 'packages/*']);
      expect(root.scripts['mobile:start']).toBe(
        'npm run start --workspace @usefuldesk/mobile'
      );
      expect(root.scripts['mobile:verify']).toBe(
        'npm run verify --workspace @usefuldesk/mobile'
      );
      expect(root.scripts['mobile:test']).toBe(
        'npm run test --workspace @usefuldesk/mobile --'
      );
      expect(root.scripts.dev).toBe('next dev');
      expect(mobile.name).toBe('@usefuldesk/mobile');
      expect(mobile.main).toBe('expo-router/entry');
      expect(mobile.dependencies.expo).toBe('~57.0.18');
      expect(mobile.dependencies.react).toBe('19.2.3');
      expect(mobile.dependencies['react-native']).toBe('0.86.3');
    });
  });
  ```

- [ ] **Step 2: Run the contract and confirm RED**

  Run:

  ```bash
  npm test -- --run scripts/mobile-workspace-contract.test.mjs
  ```

  Expected: FAIL because `apps/mobile/package.json` does not exist.

- [ ] **Step 3: Register the root workspaces and scripts**

  Add this root-level field after `private`:

  ```json
  "workspaces": ["apps/*", "packages/*"]
  ```

  Add these root scripts without changing the existing web scripts:

  ```json
  "mobile:start": "npm run start --workspace @usefuldesk/mobile",
  "mobile:ios": "npm run ios --workspace @usefuldesk/mobile",
  "mobile:android": "npm run android --workspace @usefuldesk/mobile",
  "mobile:test": "npm run test --workspace @usefuldesk/mobile --",
  "mobile:typecheck": "npm run typecheck --workspace @usefuldesk/mobile",
  "mobile:verify": "npm run verify --workspace @usefuldesk/mobile"
  ```

- [ ] **Step 4: Scaffold Expo without installing or generating agent files**

  Run:

  ```bash
  npx create-expo-app@latest apps/mobile --template default@sdk-57 --no-install --no-agents-md --yes
  ```

  Confirm the generated app pins Expo `~57.0.18`, React `19.2.3`, and React Native `0.86.3`. If the generator created `apps/mobile/.git`, remove only that newly generated nested Git directory. Remove the sample `src/app`, `src/components`, `src/constants`, `src/hooks`, `scripts/reset-project.js`, and tutorial assets; create root `app/_layout.tsx` and `app/index.tsx` instead.

  Set `apps/mobile/package.json` to:

  ```json
  {
    "name": "@usefuldesk/mobile",
    "version": "0.1.0",
    "private": true,
    "main": "expo-router/entry",
    "scripts": {
      "start": "expo start --dev-client",
      "ios": "expo start --dev-client --ios",
      "android": "expo start --dev-client --android",
      "lint": "expo lint",
      "typecheck": "tsc --noEmit",
      "test": "jest --runInBand",
      "test:watch": "jest --watch",
      "verify": "npm run lint && npm run typecheck && npm test"
    }
  }
  ```

  Preserve the SDK 57 dependencies from the generated package while applying the name, version, and scripts above.

  Add `apps/mobile` to the root `tsconfig.json` `exclude` array and `apps/mobile/**` to the root ESLint `globalIgnores`. The web and native projects have separate module resolution, platform globals, and lint plugins; root `npm run typecheck`/`lint` remain web checks, while `npm run mobile:verify` owns native checks.

- [ ] **Step 5: Add the minimal route shell**

  `apps/mobile/app/_layout.tsx`:

  ```tsx
  import { Stack } from 'expo-router';

  export default function RootLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
  }
  ```

  `apps/mobile/app/index.tsx`:

  ```tsx
  import { Text, View } from 'react-native';

  export default function FoundationScreen() {
    return (
      <View accessibilityLabel="UsefulDesk Agent foundation">
        <Text>UsefulDesk Agent</Text>
      </View>
    );
  }
  ```

- [ ] **Step 6: Install once from the repository root**

  Run:

  ```bash
  npm install
  ```

  Verify there is one repository `package-lock.json` and no nested lockfile.

- [ ] **Step 7: Run the workspace contract and Expo typecheck**

  Run:

  ```bash
  npm test -- --run scripts/mobile-workspace-contract.test.mjs
  npm run mobile:typecheck
  ```

  Expected: PASS; the web `dev` script is unchanged and the mobile route compiles.

- [ ] **Step 8: Commit the workspace scaffold**

  ```bash
  git add package.json package-lock.json tsconfig.json eslint.config.mjs scripts/mobile-workspace-contract.test.mjs apps/mobile
  git commit -m "feat: add Expo mobile workspace"
  ```

---

### Task 2: Add the mobile test harness, environment contract, and app identity

**Files:**

- Create: `apps/mobile/jest.config.js`
- Create: `apps/mobile/jest.setup.ts`
- Create: `apps/mobile/src/core/env.ts`
- Create: `apps/mobile/src/core/env.test.ts`
- Create: `apps/mobile/.env.example`
- Create: `apps/mobile/app.config.ts`
- Delete: `apps/mobile/app.json`
- Create: `apps/mobile/AGENTS.md`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `readMobileEnvironment(source): MobileEnvironment`.
- Produces: public runtime contract `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`, and `EXPO_PUBLIC_APP_ENV`.
- Produces: stable app scheme `usefuldesk-agent`, iOS bundle ID `com.usefulmade.usefuldesk.agent`, and Android package `com.usefulmade.usefuldesk.agent`.

- [ ] **Step 1: Install the supported mobile test stack**

  From `apps/mobile`, run:

  ```bash
  npx expo install jest-expo jest @types/jest @testing-library/react-native --dev
  npx expo install expo-secure-store
  ```

  Add `test`, `test:watch`, and `verify` scripts exactly as declared in Task 1 if the scaffold merge did not retain them.

- [ ] **Step 2: Configure Jest**

  `apps/mobile/jest.config.js`:

  ```js
  module.exports = {
    preset: 'jest-expo',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
    transformIgnorePatterns: [
      'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|expo-router|@react-navigation/.*|react-native-svg|heroui-native|uniwind)',
    ],
  };
  ```

  `apps/mobile/jest.setup.ts`:

  ```ts
  import 'react-native-gesture-handler/jestSetup';
  ```

- [ ] **Step 3: Write failing environment tests**

  `apps/mobile/src/core/env.test.ts`:

  ```ts
  import { readMobileEnvironment } from './env';

  const valid = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    EXPO_PUBLIC_API_BASE_URL: 'https://desk.example.com',
    EXPO_PUBLIC_APP_ENV: 'test',
  };

  describe('readMobileEnvironment', () => {
    it('returns a validated public environment', () => {
      expect(readMobileEnvironment(valid)).toEqual({
        supabaseUrl: valid.EXPO_PUBLIC_SUPABASE_URL,
        supabaseAnonKey: valid.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        apiBaseUrl: valid.EXPO_PUBLIC_API_BASE_URL,
        appEnvironment: 'test',
      });
    });

    it.each([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_API_BASE_URL',
    ])('rejects a missing %s', (key) => {
      expect(() => readMobileEnvironment({ ...valid, [key]: '' })).toThrow(key);
    });

    it('rejects a non-HTTPS production API URL', () => {
      expect(() =>
        readMobileEnvironment({
          ...valid,
          EXPO_PUBLIC_APP_ENV: 'production',
          EXPO_PUBLIC_API_BASE_URL: 'http://desk.example.com',
        })
      ).toThrow('HTTPS');
    });
  });
  ```

- [ ] **Step 4: Run the environment test and confirm RED**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/core/env.test.ts
  ```

  Expected: FAIL because `env.ts` does not exist.

- [ ] **Step 5: Implement the environment reader**

  `apps/mobile/src/core/env.ts`:

  ```ts
  export type AppEnvironment = 'development' | 'test' | 'production';

  export interface MobileEnvironment {
    supabaseUrl: string;
    supabaseAnonKey: string;
    apiBaseUrl: string;
    appEnvironment: AppEnvironment;
  }

  type EnvironmentSource = Record<string, string | undefined>;

  const required = (source: EnvironmentSource, key: string) => {
    const value = source[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };

  export function readMobileEnvironment(
    source: EnvironmentSource = process.env
  ): MobileEnvironment {
    const appEnvironment = required(
      source,
      'EXPO_PUBLIC_APP_ENV'
    ) as AppEnvironment;
    if (!['development', 'test', 'production'].includes(appEnvironment)) {
      throw new Error('Invalid EXPO_PUBLIC_APP_ENV');
    }

    const apiBaseUrl = required(source, 'EXPO_PUBLIC_API_BASE_URL');
    if (appEnvironment === 'production' && !apiBaseUrl.startsWith('https://')) {
      throw new Error('Production API URL must use HTTPS');
    }

    return {
      supabaseUrl: required(source, 'EXPO_PUBLIC_SUPABASE_URL'),
      supabaseAnonKey: required(source, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
      apiBaseUrl,
      appEnvironment,
    };
  }

  export const mobileEnvironment = readMobileEnvironment();
  ```

- [ ] **Step 6: Add public environment examples and app configuration**

  `apps/mobile/.env.example`:

  ```dotenv
  EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=copy-the-project-anon-key
  EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
  EXPO_PUBLIC_APP_ENV=development
  ```

  Replace `app.json` with `app.config.ts` using:

  ```ts
  import type { ExpoConfig } from 'expo/config';

  const config: ExpoConfig = {
    name: 'UsefulDesk Agent',
    slug: 'usefuldesk-agent',
    scheme: 'usefuldesk-agent',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: { bundleIdentifier: 'com.usefulmade.usefuldesk.agent' },
    android: {
      package: 'com.usefulmade.usefuldesk.agent',
      predictiveBackGestureEnabled: true,
    },
    plugins: ['expo-router', 'expo-secure-store'],
    experiments: { typedRoutes: true, reactCompiler: true },
  };

  export default config;
  ```

  `apps/mobile/AGENTS.md` must state only the mobile-specific boundaries from Global Constraints and explicitly defer all shared rules to `../../AGENTS.md`.

- [ ] **Step 7: Run environment tests and config inspection**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/core/env.test.ts
  (cd apps/mobile && npx expo config --type public)
  ```

  Expected: tests PASS; config reports the exact scheme and bundle/package identifiers without exposing secrets.

- [ ] **Step 8: Commit environment and test foundation**

  ```bash
  git add apps/mobile package.json package-lock.json
  git commit -m "test: add mobile environment contract"
  ```

---

### Task 3: Install HeroUI Native and add UsefulDesk provider/UI boundaries

**Files:**

- Create: `apps/mobile/metro.config.js`
- Create: `apps/mobile/global.css`
- Create: `apps/mobile/src/uniwind.d.ts`
- Create: `apps/mobile/src/core/mobile-app-providers.tsx`
- Create: `apps/mobile/src/core/mobile-app-providers.test.tsx`
- Create: `apps/mobile/src/ui/button.tsx`
- Create: `apps/mobile/src/ui/button.test.tsx`
- Create: `apps/mobile/src/ui/text-field.tsx`
- Create: `apps/mobile/src/ui/index.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `MobileAppProviders`, `HERO_UI_CONFIG`, `Button`, and `TextField`.
- Consumes: HeroUI Native only inside the provider and `src/ui` boundary.
- `Button` props: HeroUI Button props plus `loading?: boolean`; loading sets `isDisabled`, `accessibilityState.busy`, and replaces the label with a native activity indicator.

- [ ] **Step 1: Install the exact HeroUI Native compatibility set**

  From `apps/mobile`, run:

  ```bash
  npm install heroui-native@1.0.9 uniwind@1.11.0 tailwindcss@^4.3.2 tailwind-merge@^3.6.0 tailwind-variants@^3.2.2 @gorhom/bottom-sheet@^5.2.14
  npx expo install expo-blur react-native-svg react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-screens react-native-worklets
  ```

- [ ] **Step 2: Configure Metro and Uniwind**

  `apps/mobile/metro.config.js`:

  ```js
  const { getDefaultConfig } = require('expo/metro-config');
  const {
    wrapWithReanimatedMetroConfig,
  } = require('react-native-reanimated/metro-config');
  const { withUniwindConfig } = require('uniwind/metro');

  const config = getDefaultConfig(__dirname);

  module.exports = withUniwindConfig(wrapWithReanimatedMetroConfig(config), {
    cssEntryFile: './global.css',
    dtsFile: './src/uniwind.d.ts',
  });
  ```

  `apps/mobile/global.css`:

  ```css
  @import 'tailwindcss';
  @import 'uniwind';
  @import 'heroui-native/styles';

  @layer theme {
    :root {
      --radius: 0.625rem;
    }
  }
  ```

- [ ] **Step 3: Write failing provider and Button tests**

  Test that `HERO_UI_CONFIG.textProps.allowFontScaling` is `true`, `maxFontSizeMultiplier` is `1.5`, and at most three toasts are visible. Mock `heroui-native` in `button.test.tsx`, render `Button loading`, and assert `accessibilityState={{ disabled: true, busy: true }}` plus the absence of the normal label.

- [ ] **Step 4: Run the focused UI tests and confirm RED**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/core/mobile-app-providers.test.tsx src/ui/button.test.tsx
  ```

  Expected: FAIL because the provider and UsefulDesk masters do not exist.

- [ ] **Step 5: Implement the provider**

  `apps/mobile/src/core/mobile-app-providers.tsx` exports this stable config and provider:

  ```tsx
  import type { PropsWithChildren } from 'react';
  import { I18nManager } from 'react-native';
  import { GestureHandlerRootView } from 'react-native-gesture-handler';
  import { HeroUINativeProvider, type HeroUINativeConfig } from 'heroui-native';

  export const HERO_UI_CONFIG: HeroUINativeConfig = {
    textProps: { allowFontScaling: true, maxFontSizeMultiplier: 1.5 },
    textInputProps: { allowFontScaling: true, maxFontSizeMultiplier: 1.5 },
    isRTL: I18nManager.isRTL,
    toast: {
      defaultProps: { placement: 'top', variant: 'default' },
      maxVisibleToasts: 3,
    },
  };

  export function MobileAppProviders({ children }: PropsWithChildren) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <HeroUINativeProvider config={HERO_UI_CONFIG}>
          {children}
        </HeroUINativeProvider>
      </GestureHandlerRootView>
    );
  }
  ```

- [ ] **Step 6: Implement the first UsefulDesk masters**

  Wrap HeroUI `Button`, `TextField`, `Label`, `Input`, and `FieldError`. Keep HeroUI variants and geometry internal. `Button` must map `disabled || loading` to `isDisabled`, set `accessibilityState`, and render `ActivityIndicator` during loading. `TextField` takes `label`, `error`, and native `InputProps`; it always renders a visible `Label` and renders `FieldError` only when invalid.

  `apps/mobile/src/ui/button.tsx` follows this boundary:

  ```tsx
  import type { ComponentProps, ReactNode } from 'react';
  import { ActivityIndicator } from 'react-native';
  import { Button as HeroButton } from 'heroui-native';

  type ButtonProps = Omit<
    ComponentProps<typeof HeroButton>,
    'children' | 'isDisabled'
  > & {
    children: ReactNode;
    disabled?: boolean;
    loading?: boolean;
  };

  export function Button({
    children,
    disabled = false,
    loading = false,
    ...props
  }: ButtonProps) {
    const isDisabled = disabled || loading;
    return (
      <HeroButton
        {...props}
        isDisabled={isDisabled}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
      >
        {loading ? (
          <ActivityIndicator accessibilityLabel="Working" />
        ) : (
          <HeroButton.Label>{children}</HeroButton.Label>
        )}
      </HeroButton>
    );
  }
  ```

  `apps/mobile/src/ui/text-field.tsx` follows the same owned boundary:

  ```tsx
  import type { ComponentProps } from 'react';
  import {
    FieldError,
    Input,
    Label,
    TextField as HeroTextField,
  } from 'heroui-native';

  type TextFieldProps = ComponentProps<typeof Input> & {
    label: string;
    error?: string | null;
  };

  export function TextField({ label, error, ...inputProps }: TextFieldProps) {
    return (
      <HeroTextField isInvalid={Boolean(error)}>
        <Label>{label}</Label>
        <Input {...inputProps} />
        {error ? <FieldError>{error}</FieldError> : null}
      </HeroTextField>
    );
  }
  ```

- [ ] **Step 7: Mount the providers at the app root**

  Import `../global.css` once from `app/_layout.tsx`, wrap `Stack` in `MobileAppProviders`, and call `WebBrowser.maybeCompleteAuthSession()` at module scope in preparation for Task 6.

- [ ] **Step 8: Run focused UI verification**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/core/mobile-app-providers.test.tsx src/ui/button.test.tsx
  npm run mobile:typecheck
  ```

  Expected: PASS with no direct HeroUI imports outside `src/core/mobile-app-providers.tsx` and `src/ui`.

- [ ] **Step 9: Commit the native UI foundation**

  ```bash
  git add apps/mobile package-lock.json
  git commit -m "feat: add mobile UI provider foundation"
  ```

---

### Task 4: Add SecureStore-backed Supabase Auth and branch-aware requests

**Files:**

- Create: `apps/mobile/src/data/secure-session-storage.ts`
- Create: `apps/mobile/src/data/secure-session-storage.test.ts`
- Create: `apps/mobile/src/data/branch-aware-fetch.ts`
- Create: `apps/mobile/src/data/branch-aware-fetch.test.ts`
- Create: `apps/mobile/src/data/supabase.ts`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `createSecureSessionStorage(adapter): SupportedStorage`.
- Produces: `createBranchAwareFetch(baseFetch, getBranchId): typeof fetch`.
- Produces: singleton `mobileSupabase` and mutable `selectedBranchRef` with `get(): string | null` and `set(id: string | null): void`.
- Consumes: validated `mobileEnvironment` from Task 2.

- [ ] **Step 1: Install Supabase and native storage dependencies**

  From `apps/mobile`, run:

  ```bash
  npm install @supabase/supabase-js@2.107.0 react-native-url-polyfill
  ```

- [ ] **Step 2: Write failing storage tests**

  Use an in-memory fake with async `getItemAsync`, `setItemAsync`, and `deleteItemAsync`. Assert that `createSecureSessionStorage` delegates `getItem`, `setItem`, and `removeItem` exactly and never enumerates or logs values.

- [ ] **Step 3: Write failing branch-aware fetch tests**

  Provide a capturing fake fetch and assert:

  ```ts
  expect(captured.headers.get('x-usefuldesk-account-id')).toBe(branchId);
  ```

  Also assert the header is omitted when no branch is selected and that Authorization headers supplied by either an input `Request` or `init.headers` are preserved.

- [ ] **Step 4: Run the data tests and confirm RED**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/data/secure-session-storage.test.ts src/data/branch-aware-fetch.test.ts
  ```

  Expected: FAIL because both modules are missing.

- [ ] **Step 5: Implement secure session storage and branch-aware fetch**

  The storage adapter must implement Supabase's `SupportedStorage` shape using SecureStore. The fetch adapter must clone request headers, attach the selected UUID only when present, and call the provided base fetch without changing the body, method, or auth header.

  ```ts
  import type { SupportedStorage } from '@supabase/supabase-js';

  interface SecureStoreAdapter {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
  }

  export function createSecureSessionStorage(
    adapter: SecureStoreAdapter
  ): SupportedStorage {
    return {
      getItem: (key) => adapter.getItemAsync(key),
      setItem: (key, value) => adapter.setItemAsync(key, value),
      removeItem: (key) => adapter.deleteItemAsync(key),
    };
  }
  ```

  ```ts
  export function createBranchAwareFetch(
    baseFetch: typeof fetch,
    getBranchId: () => string | null
  ): typeof fetch {
    return async (input, init = {}) => {
      const headers = new Headers(
        input instanceof Request ? input.headers : undefined
      );
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
      const branchId = getBranchId();
      if (branchId) headers.set('x-usefuldesk-account-id', branchId);
      return baseFetch(input, { ...init, headers });
    };
  }
  ```

- [ ] **Step 6: Create the singleton mobile Supabase client**

  Import `react-native-url-polyfill/auto` first. Create one mutable selected-branch reference, one SecureStore storage adapter, and one Supabase client:

  ```ts
  createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      fetch: createBranchAwareFetch(fetch, () => selectedBranchRef.get()),
    },
  });
  ```

  Do not create a second client per screen or render.

- [ ] **Step 7: Run focused data tests and typecheck**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/data/secure-session-storage.test.ts src/data/branch-aware-fetch.test.ts
  npm run mobile:typecheck
  ```

  Expected: PASS.

- [ ] **Step 8: Commit the authenticated data client**

  ```bash
  git add apps/mobile package-lock.json
  git commit -m "feat: add secure mobile Supabase client"
  ```

---

### Task 5: Resolve and persist an authorized selected branch

**Files:**

- Create: `apps/mobile/src/features/auth/branch-types.ts`
- Create: `apps/mobile/src/features/auth/resolve-branch.ts`
- Create: `apps/mobile/src/features/auth/resolve-branch.test.ts`
- Create: `apps/mobile/src/features/auth/branch-preference.ts`
- Create: `apps/mobile/src/features/auth/bootstrap-repository.ts`
- Create: `apps/mobile/src/features/auth/bootstrap-repository.test.ts`

**Interfaces:**

- Produces: `resolveSelectedBranch({ branches, profileBranchId, requestedBranchId }): BranchResolution`.
- Produces: `loadMobileBootstrap(source, userId, requestedBranchId): Promise<MobileBootstrap>`.
- Produces: `branchPreference.get()`, `.set(id)`, and `.clear()` using the exact SecureStore key `usefuldesk.mobile.selected-branch`.
- Consumes: `mobileSupabase`, `selectedBranchRef`, `profiles`, `my_branch_accounts`, and `accounts` under user RLS.

- [ ] **Step 1: Define exact branch types**

  Mirror the fields used by `src/lib/auth/dashboard-bootstrap.ts` for `BranchAccount`, including account/organization/legal-entity IDs, names, role, branch status, readiness, currency, timezone, organization ownership, and setup metadata. Define discriminated outcomes:

  ```ts
  type BranchResolution =
    | { status: 'ready'; branch: BranchAccount }
    | { status: 'choose'; branches: BranchAccount[] }
    | { status: 'blocked'; reason: string; branches: BranchAccount[] };

  type MobileBootstrap =
    | {
        status: 'ready';
        profile: MobileProfile;
        branches: BranchAccount[];
        branch: BranchAccount;
        account: AccountSummary;
      }
    | {
        status: 'choose';
        profile: MobileProfile;
        branches: BranchAccount[];
      }
    | {
        status: 'blocked';
        profile: MobileProfile | null;
        branches: BranchAccount[];
        reason: string;
      };
  ```

  Use these exact shared shapes in `branch-types.ts` so the native bootstrap cannot drift from the web account contract:

  ```ts
  export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer';

  export interface MobileProfile {
    id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
    role: string | null;
    beta_features: string[];
    account_id: string | null;
    account_role: AccountRole | null;
  }

  export interface BranchAccount {
    account_id: string;
    account_name: string;
    organization_id: string;
    organization_name: string;
    legal_entity_id: string;
    legal_entity_name: string;
    role: AccountRole;
    branch_status: 'active' | 'read_only' | 'archived';
    readiness_state: 'setup' | 'ready' | 'attention';
    default_currency: string;
    timezone: string;
    is_organization_owner: boolean;
    setup_reviewed_at: string | null;
    setup_reviewed_by: string | null;
  }

  export interface AccountSummary {
    id: string;
    name: string;
    created_at: string;
    default_currency: string;
    country_code: string | null;
    locale: string | null;
    timezone: string | null;
    date_order: string | null;
    time_format: string | null;
    week_start: number | null;
    phone_country_code: string | null;
    measurement_system: string | null;
    onboarding_dismissed_at: string | null;
    organization_id: string;
    legal_entity_id: string;
    branch_status: 'active' | 'read_only' | 'archived';
    readiness_state: 'setup' | 'ready' | 'attention';
    setup_reviewed_at: string | null;
    setup_reviewed_by: string | null;
  }
  ```

- [ ] **Step 2: Write failing branch-resolution tests**

  Cover:

  - valid requested active branch wins;
  - invalid requested UUID is blocked;
  - requested branch outside memberships is blocked;
  - archived requested branch is blocked;
  - no request with one active profile branch resolves ready;
  - no usable default with multiple active branches returns choose;
  - zero active branches returns blocked.

- [ ] **Step 3: Run resolver tests and confirm RED**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/features/auth/resolve-branch.test.ts
  ```

  Expected: FAIL because the resolver is missing.

- [ ] **Step 4: Implement the pure resolver**

  Validate UUID shape, filter archived branches from operational choices, preserve all readable branches in blocked/choose context, and never substitute another branch after an explicit invalid or unauthorized request.

  ```ts
  export function resolveSelectedBranch({
    branches,
    profileBranchId,
    requestedBranchId,
  }: ResolveBranchInput): BranchResolution {
    const available = branches.filter(
      (branch) => branch.branch_status !== 'archived'
    );

    if (requestedBranchId !== null) {
      if (!isBranchAccountId(requestedBranchId)) {
        return { status: 'blocked', reason: 'Invalid branch.', branches };
      }
      const requested = branches.find(
        (branch) => branch.account_id === requestedBranchId
      );
      if (!requested) {
        return {
          status: 'blocked',
          reason: 'You do not have access to this branch.',
          branches,
        };
      }
      if (requested.branch_status === 'archived') {
        return {
          status: 'blocked',
          reason: 'This branch is archived.',
          branches,
        };
      }
      return { status: 'ready', branch: requested };
    }

    const profileBranch = available.find(
      (branch) => branch.account_id === profileBranchId
    );
    if (profileBranch) return { status: 'ready', branch: profileBranch };
    if (available.length === 1) {
      return { status: 'ready', branch: available[0] };
    }
    if (available.length > 1) {
      return { status: 'choose', branches: available };
    }
    return {
      status: 'blocked',
      reason: 'No active branch access.',
      branches,
    };
  }
  ```

- [ ] **Step 5: Write failing bootstrap repository tests**

  Use a fake `BootstrapSource` with methods `getProfile(userId)`, `getBranches()`, and `getAccount(accountId)`. Assert the repository runs profile and branch reads together, calls `getAccount` only after a ready resolution, and returns blocked rather than loading another account after explicit failure.

- [ ] **Step 6: Implement the Supabase bootstrap adapter**

  The real source performs:

  ```ts
  Promise.all([
    supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.rpc('my_branch_accounts'),
  ]);
  ```

  Set `selectedBranchRef` to `null` before the profile/membership reads so a restored preference can never scope its own revalidation. After resolution, set the ref before loading the exact `accounts` row so selected-account RLS applies. On failure, reset the ref to `null`. Persist only a successfully resolved branch ID.

- [ ] **Step 7: Run auth repository tests and typecheck**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/features/auth/resolve-branch.test.ts src/features/auth/bootstrap-repository.test.ts
  npm run mobile:typecheck
  ```

  Expected: PASS.

- [ ] **Step 8: Commit branch bootstrap**

  ```bash
  git add apps/mobile/src/features/auth
  git commit -m "feat: add mobile branch bootstrap"
  ```

---

### Task 6: Add existing-user password and Google authentication

**Files:**

- Create: `apps/mobile/src/features/auth/auth-service.ts`
- Create: `apps/mobile/src/features/auth/auth-service.test.ts`
- Create: `apps/mobile/src/features/auth/google-callback.ts`
- Create: `apps/mobile/src/features/auth/google-callback.test.ts`
- Create: `apps/mobile/src/features/auth/auth-context.tsx`
- Create: `apps/mobile/src/features/auth/auth-context.test.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**

- Produces: `signInWithPassword(email, password)`, `signInWithGoogle()`, and `signOut()`.
- Produces: `AuthProvider` and `useAuth()` with states `booting`, `signed_out`, `choose_branch`, `ready`, and `blocked`, plus `selectBranch(accountId): Promise<void>`.
- Consumes: `mobileSupabase`, `loadMobileBootstrap`, `branchPreference`, Expo Linking, and Expo WebBrowser.

- [ ] **Step 1: Write failing auth-service tests**

  With a fake Supabase auth adapter, assert trimmed lowercase email is passed to `signInWithPassword`, auth errors are returned as safe display messages, and sign-out clears the selected branch ref and preference after Supabase sign-out.

- [ ] **Step 2: Write failing Google callback tests**

  Test `authorizationCodeFromCallback(url)` with a valid `usefuldesk-agent://auth/callback?code=...`, missing code, OAuth error query, and unrelated scheme. The parser returns either `{ status: 'code'; code }` or `{ status: 'error'; message }`; it never accepts tokens from the URL fragment.

- [ ] **Step 3: Run auth tests and confirm RED**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/features/auth/auth-service.test.ts src/features/auth/google-callback.test.ts
  ```

  Expected: FAIL because the service and parser do not exist.

- [ ] **Step 4: Implement password and Google sign-in**

  Password uses `mobileSupabase.auth.signInWithPassword`. Google uses PKCE:

  ```ts
  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await mobileSupabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  ```

  Accept only a successful callback URL with an authorization code, then call `mobileSupabase.auth.exchangeCodeForSession(code)`. Cancellation returns a neutral result rather than an error toast. Never log callback URLs or codes.

- [ ] **Step 5: Write failing AuthProvider state tests**

  Fake the session and bootstrap services. Cover cold start with no session, restored ready session, multiple branches requiring selection, blocked membership, token refresh preserving the selected branch, and sign-out returning to `signed_out` while clearing branch state.

- [ ] **Step 6: Implement AuthProvider**

  On mount, call `auth.getSession()`, subscribe to `onAuthStateChange`, then call `auth.getUser()` before bootstrap. Treat local session presence as a loading hint only; authoritative user validation gates ready state. Serialize bootstrap requests so refresh events cannot race a branch switch.

  Model provider state as a discriminated union rather than parallel booleans:

  ```ts
  type AuthState =
    | { status: 'booting' }
    | { status: 'signed_out'; error?: string }
    | {
        status: 'choose_branch';
        profile: MobileProfile;
        branches: BranchAccount[];
        reason?: string;
      }
    | {
        status: 'ready';
        session: Session;
        profile: MobileProfile;
        branches: BranchAccount[];
        branch: BranchAccount;
        account: AccountSummary;
      }
    | {
        status: 'blocked';
        profile: MobileProfile | null;
        branches: BranchAccount[];
        reason: string;
      };
  ```

- [ ] **Step 7: Mount AuthProvider and run tests**

  Place `AuthProvider` inside `MobileAppProviders` in the root layout. Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/features/auth/auth-service.test.ts src/features/auth/google-callback.test.ts src/features/auth/auth-context.test.tsx
  npm run mobile:typecheck
  ```

  Expected: PASS.

- [ ] **Step 8: Commit mobile authentication**

  ```bash
  git add apps/mobile
  git commit -m "feat: add mobile user authentication"
  ```

---

### Task 7: Add protected native routes and branch selection UX

**Files:**

- Create: `apps/mobile/src/features/auth/entry-route.ts`
- Create: `apps/mobile/src/features/auth/entry-route.test.ts`
- Create: `apps/mobile/src/features/auth/screens/sign-in-screen.tsx`
- Create: `apps/mobile/src/features/auth/screens/sign-in-screen.test.tsx`
- Create: `apps/mobile/src/features/auth/screens/select-branch-screen.tsx`
- Create: `apps/mobile/src/features/auth/screens/select-branch-screen.test.tsx`
- Create: `apps/mobile/src/features/foundation/foundation-screen.tsx`
- Create: `apps/mobile/src/features/foundation/account-screen.tsx`
- Replace: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/app/(auth)/_layout.tsx`
- Create: `apps/mobile/app/(auth)/sign-in.tsx`
- Create: `apps/mobile/app/(auth)/select-branch.tsx`
- Create: `apps/mobile/app/(app)/_layout.tsx`
- Create: `apps/mobile/app/(app)/index.tsx`
- Create: `apps/mobile/app/(app)/account.tsx`

**Interfaces:**

- Produces: `entryRouteForAuthState(state): '/(auth)/sign-in' | '/(auth)/select-branch' | '/(app)'`.
- `entryRouteForAuthState` returns `null` while state is `booting`, leaving the native splash mounted.
- Consumes: `useAuth`, UsefulDesk `Button`/`TextField`, and Expo Router.
- Produces: one protected branch-status screen showing current branch name, role, readiness state, environment, Account navigation, branch switch, and sign out.

- [ ] **Step 1: Write failing route-state tests**

  Assert `signed_out` routes to sign-in, `choose_branch` routes to selection, `ready` routes to the protected app, and `blocked` routes to selection with the blocking explanation. `booting` returns no route so the splash remains visible.

- [ ] **Step 2: Write failing sign-in and branch-screen tests**

  Assert the password form has labelled Email and Password fields, disables repeated submit while loading, invokes Google sign-in, and exposes no signup form. Assert branch rows display branch and organization names, omit archived branches from selection, and call `selectBranch(accountId)` exactly once.

- [ ] **Step 3: Run screen tests and confirm RED**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/features/auth/entry-route.test.ts src/features/auth/screens/sign-in-screen.test.tsx src/features/auth/screens/select-branch-screen.test.tsx
  ```

  Expected: FAIL because routes and screens do not exist.

- [ ] **Step 4: Implement auth screens with native behavior**

  Use `KeyboardAvoidingView`, `SafeAreaView`, `ScrollView`, UsefulDesk masters, `textContentType`, `autoComplete`, `keyboardType="email-address"`, `autoCapitalize="none"`, and password visibility appropriate to native inputs. Keep network errors beside the form and preserve typed values after failure.

- [ ] **Step 5: Implement protected route groups**

  Call `SplashScreen.preventAutoHideAsync()` at module scope in the root layout. The root index reads auth state, keeps the splash mounted while booting, hides it after the first resolved state, and then returns a declarative `Redirect`:

  ```tsx
  export default function IndexRoute() {
    const { state } = useAuth();
    const href = entryRouteForAuthState(state);

    useEffect(() => {
      if (href) void SplashScreen.hideAsync();
    }, [href]);

    return href ? <Redirect href={href} /> : null;
  }
  ```

  `(app)/_layout.tsx` uses `Stack.Protected guard={state.status === 'ready'}` and redirects any later session loss. Do not duplicate auth checks inside every screen.

- [ ] **Step 6: Implement the functional foundation and Account screens**

  The protected landing screen renders the selected branch, role, readiness state, and a clear statement that the native connection is ready. Account provides branch switching and sign out. These are functional diagnostic surfaces for the foundation build, not placeholder product tabs.

- [ ] **Step 7: Run route, screen, and accessibility tests**

  Run:

  ```bash
  npm run mobile:test -- --runTestsByPath src/features/auth/entry-route.test.ts src/features/auth/screens/sign-in-screen.test.tsx src/features/auth/screens/select-branch-screen.test.tsx
  npm run mobile:verify
  ```

  Expected: PASS; controls are addressable by role/label rather than test IDs alone.

- [ ] **Step 8: Commit protected navigation**

  ```bash
  git add apps/mobile
  git commit -m "feat: add protected mobile foundation routes"
  ```

---

### Task 8: Configure development builds, verify both projects, and document the foundation

**Files:**

- Create: `apps/mobile/eas.json`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`
- Modify: `apps/mobile/.gitignore`
- Create: `docs/mobile/development-build.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**

- Produces: local development-client commands plus EAS `development-simulator` and `development-device` profiles.
- Produces: verified mobile foundation runbook without credentials.
- Consumes: an authenticated Expo account only at the explicit remote-build checkpoint.

- [ ] **Step 1: Install the development client and EAS CLI dependency**

  From `apps/mobile`, run:

  ```bash
  npx expo install expo-dev-client
  npm install --save-dev eas-cli
  ```

- [ ] **Step 2: Configure development profiles**

  `apps/mobile/eas.json`:

  ```json
  {
    "cli": { "version": ">= 18.0.0" },
    "build": {
      "development-simulator": {
        "developmentClient": true,
        "distribution": "internal",
        "ios": { "simulator": true }
      },
      "development-device": {
        "developmentClient": true,
        "distribution": "internal"
      }
    }
  }
  ```

  Add `.expo/`, `ios/`, `android/`, and local build artifacts to `apps/mobile/.gitignore`; do not ignore source, tests, `app.config.ts`, or `eas.json`.

- [ ] **Step 3: Write the development-build runbook**

  Document:

  - copying `.env.example` to ignored `.env.local` and sourcing the existing public Supabase values without printing them;
  - `npm run mobile:start`;
  - local `npx expo run:ios` / `npx expo run:android` behavior and generated-directory policy;
  - EAS simulator/device commands;
  - password and Google sign-in smoke cases;
  - branch selection, non-default branch, archived branch, token refresh, and sign-out cache checks;
  - iOS swipe/keyboard/dynamic-type and Android back/process-recreation checks;
  - the rule that no customer message or financial provider mutation is authorized by this foundation test.

- [ ] **Step 4: Run deterministic local verification**

  Run:

  ```bash
  npm run mobile:verify
  (cd apps/mobile && npx expo-doctor)
  (cd apps/mobile && npx expo export --platform ios --output-dir "$(mktemp -d)/usefuldesk-ios-export")
  (cd apps/mobile && npx expo export --platform android --output-dir "$(mktemp -d)/usefuldesk-android-export")
  npm run verify
  git diff --check
  ```

  Expected: mobile tests/lint/types pass, Expo doctor reports no incompatible packages, both bundles export, and the existing web verification remains green.

- [ ] **Step 5: Run a local development-build smoke test**

  On macOS with Xcode, run `(cd apps/mobile && npx expo run:ios)`; on an Android host/device, run `(cd apps/mobile && npx expo run:android)`. Verify cold sign-in, restored session, branch selection, branch switch, Google callback, sign out, and relaunch. Generated native folders remain ignored.

- [ ] **Step 6: Stop for explicit authorization before a remote EAS build**

  A remote build creates external project/build state and may request Apple/Google credentials. Ask the owner before running either command:

  ```bash
  (cd apps/mobile && npx eas build --profile development-simulator --platform ios)
  (cd apps/mobile && npx eas build --profile development-device --platform android)
  ```

  If authorized, record only build IDs/statuses in the handoff; never record credentials or signed URLs in the repository.

- [ ] **Step 7: Update shipped-status documentation**

  Add a terse changelog entry naming `apps/mobile`, the secure Supabase/branch foundation, and the fact that Inbox implementation is next. In `PRDs/roadmap.md`, add the mobile agent foundation to the appropriate Built section without marking the WhatsApp inbox or later mobile workflows shipped.

- [ ] **Step 8: Commit the verified foundation**

  ```bash
  git add apps/mobile docs/mobile/development-build.md docs/changelog.md PRDs/roadmap.md package.json package-lock.json
  git commit -m "docs: verify mobile native foundation"
  ```

- [ ] **Step 9: Final acceptance check**

  Run `git status --short` and require a clean worktree. Report the exact mobile and web verification results, devices/simulators exercised, any skipped remote-build checkpoint, and the next approved plan boundary: read-only Inbox.
