# Mobile Push Notifications and Chat Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one durable, tenant-safe Expo push notification per eligible native installation for newly persisted inbound WhatsApp messages, with permission recovery, safe notification routing, and correct active-branch web sounds.

**Architecture:** Supabase owns recipient derivation, delivery-time revalidation, leasing, and settlement in a service-only outbox. Next.js route handlers authenticate device registration independently of branch selection and a single server-only dispatcher turns claimed deliveries into Expo tickets and receipts; the webhook performs a bounded immediate drain and the existing operations cron recovers remaining work. The Expo app keeps native APIs behind adapters, coordinates permission/token lifecycle from authenticated ready state, and routes opaque notification payloads only after branch revalidation and an RLS-backed conversation read.

**Tech Stack:** PostgreSQL/Supabase RLS and security-definer functions, Next.js 16.3 App Router route handlers, `@supabase/supabase-js` 2.107, Expo SDK 57/React Native 0.86, `expo-notifications`, `expo-application`, `expo-secure-store`, Expo Router, Vitest, Jest.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-push-notifications-design.md`

## Global Constraints

- Preserve all pre-existing uncommitted user changes; inspect and stage feature hunks explicitly, especially `PRDs/roadmap.md`, `docs/changelog.md`, `apps/mobile/app/_layout.tsx`, and `apps/mobile/jest.setup.ts`.
- Follow strict red-green-refactor TDD and run the named focused test after every test or implementation step.
- Use Context7 documentation for Expo Notifications and Supabase APIs, and read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before editing route handlers.
- Install native packages only with `npx expo install` from `apps/mobile`; never create a nested lockfile or generated `ios`/`android` tree.
- Do not use `supabase db push`. Apply the migration only through the approved Supabase migration tool, then verify schema, policies, grants, and advisors; otherwise record it as unapplied.
- The data payload contains only schema version, account/branch ID, conversation ID, persisted message ID, and delivery ID. Logs and provider diagnostics contain no Expo token, title/body, contact name, phone, message copy, credentials, or serialized database row.
- Use the platform default sound once. Do not add a custom audio asset, repeating chat alarm, preference categories, Web Push, or direct APNs/FCM integration.
- Missing EAS project ID, simulator limits, offline registration, denied permission, and Expo unavailability are recoverable notification states and never authentication failures.
- Browser roles cannot list installation tokens or access delivery rows; only authenticated service routes mutate installations and only service-role callers execute enqueue/claim/settlement functions.
- Update both `docs/changelog.md` and `PRDs/roadmap.md`; claim remote device delivery only if physical iOS and Android acceptance actually passes with valid EAS/APNs/FCM credentials.

---

### Task 1: Durable push schema, recipient derivation, leases, and settlement

**Files:**

- Create: `supabase/migrations/20260903120000_mobile_push_notifications.sql`
- Create: `src/lib/push/push-schema-contract.test.ts`
- Create: `src/lib/push/push-recipient-contract.test.ts`
- Create: `src/lib/push/push-lease-contract.test.ts`

**Interfaces:**

- Produces: `push_installations`, `push_deliveries`, and service-role-only RPCs `enqueue_inbound_push_deliveries(p_message_id uuid)`, `claim_push_deliveries(p_worker_id uuid, p_limit integer, p_lease_seconds integer)`, `settle_push_delivery(p_delivery_id uuid, p_worker_id uuid, p_outcome text, p_ticket_id text default null, p_error_code text default null, p_next_attempt_at timestamptz default null)`, and `claim_push_receipts(p_worker_id uuid, p_limit integer, p_lease_seconds integer)`.
- Produces: trigger `private.enforce_push_installation_user()` that binds an active token move to one authenticated/service-owned installation and rejects mismatched client identity where `auth.uid()` is present.
- Consumes: `public.messages`, `public.conversations`, `public.contacts`, `public.accounts`, `public.account_memberships`, `public.account_role_enum`, and `public.update_updated_at_column()`.

- [ ] **Step 1: Write failing schema and grant contract tests**

  Assert the migration creates the two tables; checks platform/environment/state/data schema; makes `(environment, expo_push_token)` active-token ownership unique and `(message_id, installation_id)` idempotent; enables RLS; revokes browser access; grants service access; attaches update triggers; and defines every RPC as `SECURITY DEFINER SET search_path = ''` with explicit client-role revokes.

  ```ts
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.push_installations/);
  expect(sql).toMatch(/UNIQUE \(message_id, installation_id\)/);
  expect(sql).toMatch(
    /ALTER TABLE public\.push_deliveries ENABLE ROW LEVEL SECURITY/
  );
  expect(sql).toMatch(
    /REVOKE ALL ON public\.push_deliveries\s+FROM PUBLIC, anon, authenticated/
  );
  expect(sql).toMatch(
    /CREATE OR REPLACE FUNCTION public\.enqueue_inbound_push_deliveries[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/
  );
  ```

- [ ] **Step 2: Run the schema contract and verify red**

  Run: `npm test -- src/lib/push/push-schema-contract.test.ts`

  Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement tables, indexes, RLS, and installation invariants**

  Use UUID primary keys, bounded operational metadata (`app_version`, `device_model`, `os_version`), `last_seen_at`, `revoked_at`, timestamps, a partial unique index for active token/environment ownership, service-only grants, and idempotent drop/create trigger definitions. Store `payload` as constrained JSONB and keep presentation copy in separate `title`/`body` columns.

  ```sql
  ALTER TABLE public.push_installations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.push_installations FROM PUBLIC, anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_installations TO service_role;

  CREATE UNIQUE INDEX IF NOT EXISTS push_installations_active_token_environment_idx
    ON public.push_installations (environment, expo_push_token)
    WHERE revoked_at IS NULL;
  ```

- [ ] **Step 4: Run the schema contract and make it green**

  Run: `npm test -- src/lib/push/push-schema-contract.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing recipient/idempotency contract tests**

  Assert enqueue accepts only a persisted customer message; uses the conversation assignment when present; otherwise selects active `owner`, `admin`, and `agent` memberships for that account; excludes viewers and revoked installations; inserts once per message/installation; derives the title from the contact; maps media-only bodies to `Photo`, `Video`, `Audio`, `Document`, `Location`, or `New WhatsApp message`; and generates only opaque payload fields.

  ```ts
  expect(sql).toMatch(
    /conversation\.assigned_agent_id IS NOT NULL[\s\S]*?membership\.user_id = conversation\.assigned_agent_id/
  );
  expect(sql).toMatch(/membership\.role IN \('owner', 'admin', 'agent'\)/);
  expect(sql).toMatch(/installation\.revoked_at IS NULL/);
  expect(sql).toMatch(/ON CONFLICT \(message_id, installation_id\) DO NOTHING/);
  expect(sql).not.toMatch(
    /jsonb_build_object\([\s\S]*?(phone|expo_push_token|content_text)/
  );
  ```

- [ ] **Step 6: Run recipient contracts and verify red**

  Run: `npm test -- src/lib/push/push-recipient-contract.test.ts`

  Expected: FAIL until the enqueue function is defined.

- [ ] **Step 7: Implement atomic enqueue and delivery-time eligibility**

  Implement the enqueue SQL as one derived `INSERT ... SELECT` from message through conversation/contact, memberships, and active installations. In each claim function rejoin the installation, conversation, account, and current membership/assignment before leasing; atomically mark no-longer-eligible rows `cancelled`; reclaim expired `sending` leases; increment attempts only when work is claimed; and use `FOR UPDATE SKIP LOCKED` with a bounded limit.

  ```sql
  CASE
    WHEN message.content_text IS NOT NULL AND btrim(message.content_text) <> ''
      THEN message.content_text
    WHEN message.content_type = 'image' THEN 'Photo'
    WHEN message.content_type = 'video' THEN 'Video'
    WHEN message.content_type = 'audio' THEN 'Audio'
    WHEN message.content_type = 'document' THEN 'Document'
    WHEN message.content_type = 'location' THEN 'Location'
    ELSE 'New WhatsApp message'
  END
  ```

- [ ] **Step 8: Write and run failing lease/settlement contracts**

  Assert bounded claims, unique worker leases, expired-lease recovery, assignment/membership cancellation, ticket vs receipt states, attempt limits, sanitized bounded error fields, permanent token retirement, and lease-owner compare-and-set settlement.

  Run: `npm test -- src/lib/push/push-lease-contract.test.ts`

  Expected: FAIL until settlement and receipt claim logic is complete.

- [ ] **Step 9: Implement lease-owner settlement and token retirement**

  Accept only enumerated outcomes (`ticketed`, `delivered`, `retry`, `failed`, `cancelled`); clear the lease on settlement; require matching delivery and worker IDs; set bounded `next_attempt_at`; save only ticket IDs/error codes; and revoke the target installation plus fail its outstanding nonterminal deliveries for permanent token outcomes.

- [ ] **Step 10: Run all migration contracts and commit**

  Run: `npm test -- src/lib/push/push-schema-contract.test.ts src/lib/push/push-recipient-contract.test.ts src/lib/push/push-lease-contract.test.ts`

  Expected: PASS.

  ```bash
  git add supabase/migrations/20260903120000_mobile_push_notifications.sql src/lib/push/push-*-contract.test.ts
  git commit -m "feat: add durable mobile push outbox"
  ```

### Task 2: Branch-independent bearer auth and installation API

**Files:**

- Create: `src/lib/auth/mobile-user-access.ts`
- Create: `src/lib/auth/mobile-user-access.test.ts`
- Create: `src/lib/push/installation-store.ts`
- Create: `src/lib/push/installation-store.test.ts`
- Create: `src/app/api/mobile/push/installation/route.ts`
- Create: `src/app/api/mobile/push/installation/route.test.ts`

**Interfaces:**

- Produces: `createMobileUserAccess(deps).requireMobileUser(request): Promise<{ userId: string; accessToken: string }>` using exact `Bearer <token>` parsing and `auth.getUser(accessToken)` without a branch header.
- Produces: `parseInstallationInput(unknown): InstallationInput` with `installationId`, `expoPushToken`, `platform`, `environment`, optional `appVersion`, `deviceModel`, and `osVersion`.
- Produces: `upsertPushInstallation(admin, userId, input)` and `revokePushInstallation(admin, userId, installationId)`; neither result contains a token.
- Consumes: Task 1 `push_installations`, `supabaseAdmin()`, Web `Request`/`Response`, and current Next.js route-handler conventions.

- [ ] **Step 1: Write failing bearer-auth tests**

  Cover missing, lowercase, bare, whitespace-padded, malformed, expired, and valid bearer values. Assert no selected-branch header is read and `auth.getUser` receives the raw validated token.

- [ ] **Step 2: Run bearer tests and verify red**

  Run: `npm test -- src/lib/auth/mobile-user-access.test.ts`

  Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement the minimal user auth resolver**

  Reuse the strict bearer grammar from `mobile-operational-access.ts`, inject the Supabase factory for tests, and return only the server-confirmed user ID plus access token.

  ```ts
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get('authorization') ?? ''
  );
  if (!match) throw new UnauthorizedError();
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(match[1]);
  if (error || !user) throw new UnauthorizedError();
  return { userId: user.id, accessToken: match[1] };
  ```

- [ ] **Step 4: Run bearer tests and make them green**

  Run: `npm test -- src/lib/auth/mobile-user-access.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing store and route tests**

  Cover UUID/token/platform/environment validation, bounded metadata, unknown keys, valid registration, heartbeat on repeated registration, moving an active token to the authenticated installation/user, cross-user installation mutation, token replacement retirement, idempotent revoke, service errors, and responses/logs that never expose a stored or submitted token.

  ```ts
  expect(await response.json()).toEqual({
    installationId,
    status: 'registered',
  });
  expect(JSON.stringify(await response.json())).not.toContain(
    'ExponentPushToken'
  );
  expect(revoke).toHaveBeenCalledWith(
    expect.anything(),
    authenticatedUserId,
    installationId
  );
  ```

- [ ] **Step 6: Run route tests and verify red**

  Run: `npm test -- src/lib/push/installation-store.test.ts src/app/api/mobile/push/installation/route.test.ts`

  Expected: FAIL because store and route do not exist.

- [ ] **Step 7: Implement PUT and DELETE**

  PUT validates JSON, authenticates first, and uses a service-role transaction/RPC-safe upsert that sets `user_id` from auth only, refreshes `last_seen_at`, and revokes any superseded token. DELETE accepts only `{ installationId }`, scopes by authenticated user plus installation ID, chains `.select('installation_id')`, treats no row as already revoked, and returns `{ installationId, status: 'revoked' }`.

- [ ] **Step 8: Run focused tests and commit**

  Run: `npm test -- src/lib/auth/mobile-user-access.test.ts src/lib/push/installation-store.test.ts src/app/api/mobile/push/installation/route.test.ts`

  Expected: PASS.

  ```bash
  git add src/lib/auth/mobile-user-access* src/lib/push/installation-store* src/app/api/mobile/push/installation
  git commit -m "feat: register mobile push installations"
  ```

### Task 3: Server-only Expo ticket and receipt dispatcher

**Files:**

- Create: `src/lib/push/expo-protocol.ts`
- Create: `src/lib/push/expo-protocol.test.ts`
- Create: `src/lib/push/dispatcher.ts`
- Create: `src/lib/push/dispatcher.test.ts`
- Create: `src/lib/push/admin-client.ts`

**Interfaces:**

- Produces: `PushDrainCounts = { claimed; ticketed; delivered; retried; failed; cancelled; installationsRetired }`.
- Produces: `createExpoPushTransport({ fetch, random, now }).send(messages)` and `.receipts(ticketIds)` with chunks of at most 100.
- Produces: `drainPushDeliveries({ admin, transport, workerId?, claimLimit? }): Promise<PushDrainCounts>` which processes receipt claims before new sends.
- Consumes: Task 1 RPCs and claimed rows containing delivery ID, lease owner, token, title, body, payload, attempt count, and ticket ID.

- [ ] **Step 1: Write failing protocol classification tests**

  Cover 100-item chunking; provider `429`/`5xx`/network failure; malformed JSON; partial ticket success/error; receipt success, unavailable/delayed receipt, transient errors, `DeviceNotRegistered`, invalid credentials, and bounded exponential backoff with injected jitter.

  ```ts
  expect(backoffMs({ attempt: 1, random: () => 0 })).toBe(30_000);
  expect(
    classifyExpoError({ details: { error: 'DeviceNotRegistered' } })
  ).toEqual({ kind: 'permanent_token', code: 'DeviceNotRegistered' });
  ```

- [ ] **Step 2: Run protocol tests and verify red**

  Run: `npm test -- src/lib/push/expo-protocol.test.ts`

  Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement transport and pure classification**

  POST ticket chunks to `https://exp.host/--/api/v2/push/send`, POST receipt ID chunks to `https://exp.host/--/api/v2/push/getReceipts`, set a bounded timeout, request default sound and Android `channelId: 'messages'`, and return indexed sanitized outcomes without logging request bodies.

  ```ts
  const request = {
    to: row.expoPushToken,
    title: row.title,
    body: row.body,
    sound: 'default' as const,
    channelId: 'messages',
    data: row.payload,
  };
  ```

- [ ] **Step 4: Run protocol tests and make them green**

  Run: `npm test -- src/lib/push/expo-protocol.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing dispatcher tests**

  Mock claim and settlement RPCs. Verify receipts run before tickets, ticket success remains `ticketed`, receipt success becomes `delivered`, delayed receipt remains ticketed/retry-safe, transient errors retry at capped attempts, permanent token errors fail and retire, ineligible claims count as cancelled, lease-owner IDs are passed to every settlement, and concurrent partial failures do not abort unrelated items.

- [ ] **Step 6: Run dispatcher tests and verify red**

  Run: `npm test -- src/lib/push/dispatcher.test.ts`

  Expected: FAIL because `drainPushDeliveries` does not exist.

- [ ] **Step 7: Implement the dispatcher and safe diagnostics**

  Use one random UUID per drain as lease owner; settle each item independently; cap attempts and provider error codes; aggregate counts only; and expose a sanitizer that converts unknown errors to allowlisted classifications without including tokens, request payloads, names, or body text.

- [ ] **Step 8: Add explicit log-safety assertions**

  Spy on `console` while injecting a token, contact name, message body, phone number, and provider failure. Assert none appears in any call and that the aggregate code does.

- [ ] **Step 9: Run dispatcher tests and commit**

  Run: `npm test -- src/lib/push/expo-protocol.test.ts src/lib/push/dispatcher.test.ts`

  Expected: PASS.

  ```bash
  git add src/lib/push/expo-protocol* src/lib/push/dispatcher* src/lib/push/admin-client.ts
  git commit -m "feat: dispatch Expo push tickets and receipts"
  ```

### Task 4: Webhook enqueue and operations-cron recovery

**Files:**

- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Modify: `src/app/api/whatsapp/webhook/route.test.ts`
- Create: `src/app/api/push/cron/route.ts`
- Create: `src/app/api/push/cron/route.test.ts`
- Modify: `src/app/api/database-cron/route.ts`
- Modify: `src/app/api/database-cron/route.test.ts`
- Modify: `.github/workflows/ops-crons.yml`
- Modify: `docs/automations-and-cron.md`

**Interfaces:**

- Consumes: Task 1 `enqueue_inbound_push_deliveries` and Task 3 `drainPushDeliveries`.
- Produces: `GET /api/push/cron` using `cronSecretConfigured()` and `isAuthorizedCronRequest()` and returning only `PushDrainCounts`.
- Produces: webhook `enqueueInboundPush(messageId)` called only after durable insert and `bump_conversation_on_inbound` completion, plus a bounded best-effort drain started only after the enclosing WhatsApp receipt is marked processed.

- [ ] **Step 1: Extend webhook tests to fail on missing enqueue boundary**

  Assert duplicate message upserts never enqueue; new inbound rows enqueue exactly once with the inserted internal ID; enqueue occurs after unread/conversation bump; enqueue failure is logged safely and does not reject the receipt; immediate drain begins only after `complete_whatsapp_webhook_receipt` succeeds; and push latency/failure cannot repeat message persistence, hold the receipt lease, or reject the customer webhook.

- [ ] **Step 2: Run webhook tests and verify red**

  Run: `npm test -- src/app/api/whatsapp/webhook/route.test.ts`

  Expected: FAIL on missing push RPC/drain calls.

- [ ] **Step 3: Implement post-persistence enqueue and bounded drain**

  Capture `insertedRows[0].id`, keep the duplicate early return unchanged, call enqueue after the conversation bump, and catch/log only a sanitized push code. After each `complete_whatsapp_webhook_receipt` succeeds, mark the receipt processed first and then start one bounded `drainPushDeliveries({ claimLimit: 20 })`; catch its failure outside `processWebhook` so provider work cannot change receipt outcome.

- [ ] **Step 4: Run webhook tests and make them green**

  Run: `npm test -- src/app/api/whatsapp/webhook/route.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing cron and aggregator tests**

  Assert missing config is `503`, bad auth is `401`, success returns aggregate counts only, dispatcher failure is `503` with a generic error, `/api/push/cron` is in the ops aggregator, and the ops dispatch count increments from seven to eight.

- [ ] **Step 6: Run cron tests and verify red**

  Run: `npm test -- src/app/api/push/cron/route.test.ts src/app/api/database-cron/route.test.ts`

  Expected: FAIL because the route/path does not exist.

- [ ] **Step 7: Implement cron route and both scheduler paths**

  Add `/api/push/cron` to `OPS_PATHS` and `.github/workflows/ops-crons.yml`, preserving `if: always()` isolation. Update the runbook table, endpoint count, scheduler lists, curl verification, and Pro example.

- [ ] **Step 8: Run focused tests and commit**

  Run: `npm test -- src/app/api/whatsapp/webhook/route.test.ts src/app/api/push/cron/route.test.ts src/app/api/database-cron/route.test.ts src/lib/cron/database-scheduler-contract.test.ts`

  Expected: PASS.

  ```bash
  git add src/app/api/whatsapp/webhook/route.ts src/app/api/whatsapp/webhook/route.test.ts src/app/api/push/cron src/app/api/database-cron .github/workflows/ops-crons.yml docs/automations-and-cron.md
  git commit -m "feat: enqueue and recover inbound push delivery"
  ```

### Task 5: Expo native adapter and notification lifecycle coordinator

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/.env.example`
- Modify: `apps/mobile/src/core/env.ts`
- Modify: `apps/mobile/src/core/env.test.ts`
- Create: `apps/mobile/src/native/notifications.ts`
- Create: `apps/mobile/src/native/notifications.test.ts`
- Create: `apps/mobile/src/features/notifications/notification-types.ts`
- Create: `apps/mobile/src/features/notifications/installation-storage.ts`
- Create: `apps/mobile/src/features/notifications/installation-storage.test.ts`
- Create: `apps/mobile/src/features/notifications/push-client.ts`
- Create: `apps/mobile/src/features/notifications/push-client.test.ts`
- Create: `apps/mobile/src/features/notifications/notification-coordinator.ts`
- Create: `apps/mobile/src/features/notifications/notification-coordinator.test.ts`

**Interfaces:**

- Produces: `NativeNotifications` adapter for channel setup, permission read/request, project-aware Expo token acquisition, token/listener subscriptions, app settings, and foreground handler setup.
- Produces: `NotificationState = 'checking' | 'requestable' | 'denied' | 'enabled' | 'unavailable' | 'retry_needed'` plus `canRequest`, `message`, and recovery action metadata.
- Produces: `createNotificationCoordinator(deps)` with `start(readyAuth)`, `refresh(readyAuth)`, `requestPermission(readyAuth)`, `revoke(accessToken)`, `subscribe(listener)`, and `stop()`.
- Consumes: Task 2 installation endpoint, SecureStore installation UUID/explanation flag, access token, Expo `projectId`, and app environment mapped to `development | preview | production`.

- [ ] **Step 1: Install SDK-compatible dependencies**

  From `apps/mobile`, run: `npx expo install expo-notifications expo-application`

  Expected: Expo chooses SDK 57-compatible versions and updates only the root lockfile/workspace manifests.

- [ ] **Step 2: Write failing adapter/storage/client tests**

  Cover stable installation UUID creation, explanation flag persistence, Android `messages` channel before permission request, default sound/high importance/vibration, foreground banner/list/sound handling, EAS project ID resolution, simulator/device unavailability, exact bearer PUT/DELETE requests, one refresh retry supplied by the caller, token replacement registration, abort/teardown, and no token logging.

- [ ] **Step 3: Run native foundation tests and verify red**

  Run: `npm run mobile:test -- src/native/notifications.test.ts src/features/notifications/installation-storage.test.ts src/features/notifications/push-client.test.ts`

  Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement config, adapter, storage, and client**

  Add the `expo-notifications` config plugin without custom sounds, expose no private credentials, extend the public app environment parser to accept `preview` while retaining `test` for Jest, map only `development | preview | production` to registration requests, derive `projectId` from `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId`, use `Crypto.randomUUID()`/validated UUID persistence, and send only installation fields plus public operational metadata.

  ```ts
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  ```

- [ ] **Step 5: Run native foundation tests and make them green**

  Run: `npm run mobile:test -- src/native/notifications.test.ts src/features/notifications/installation-storage.test.ts src/features/notifications/push-client.test.ts`

  Expected: PASS.

- [ ] **Step 6: Write failing coordinator tests**

  Cover first-ready explanation state, channel-before-request ordering, denial without repeated prompt, `canAskAgain`, enabled registration, foreground permission/token refresh, offline `retry_needed`, token rollover, missing project ID, simulator limits, provider error recovery, sign-out revoke before teardown, listener removal, and no auth-state failure on notification errors.

- [ ] **Step 7: Run coordinator tests and verify red**

  Run: `npm run mobile:test -- src/features/notifications/notification-coordinator.test.ts`

  Expected: FAIL because the coordinator does not exist.

- [ ] **Step 8: Implement coordinator state machine**

  Serialize refresh operations, ignore stale completions after user/branch/session generation changes, create the channel before permission work, register only on a physical device with granted/provisional permission and a project ID, store retry-needed locally, subscribe to native token rollover, refresh on app foreground, revoke the current installation before sign-out, and make `stop()` remove every listener.

- [ ] **Step 9: Run coordinator suite and commit**

  Run: `npm run mobile:test -- src/native/notifications.test.ts src/features/notifications/installation-storage.test.ts src/features/notifications/push-client.test.ts src/features/notifications/notification-coordinator.test.ts`

  Expected: PASS.

  ```bash
  git add package.json package-lock.json apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/.env.example apps/mobile/src/core/env.ts apps/mobile/src/core/env.test.ts apps/mobile/src/native apps/mobile/src/features/notifications
  git commit -m "feat(mobile): coordinate push registration"
  ```

### Task 6: Branch-safe notification response routing

**Files:**

- Create: `apps/mobile/src/features/notifications/notification-routing.ts`
- Create: `apps/mobile/src/features/notifications/notification-routing.test.ts`
- Create: `apps/mobile/src/features/notifications/notification-router.tsx`
- Create: `apps/mobile/src/features/notifications/notification-router.test.tsx`
- Modify: `apps/mobile/src/features/inbox/conversation-repository.ts`
- Modify: `apps/mobile/src/features/inbox/conversation-repository.test.ts`

**Interfaces:**

- Produces: `parsePushDestination(data): { version: 1; accountId; conversationId; messageId; deliveryId } | null` using strict UUIDs and exact keys.
- Produces: `createNotificationResponseRouter(deps)` with `enqueue(response)`, `reconcile(authState)`, and `stop()`; it keeps at most one pending destination and deduplicates one delivery ID.
- Consumes: `AuthContextValue.state`, `selectBranch(accountId)`, fresh `branches`, `ConversationRepository.get(accountId, conversationId)`, Expo Router `replace('/(app)')` and `push({ pathname: '/(app)/conversation/[conversationId]', params: { conversationId } })`.

- [ ] **Step 1: Write failing payload and routing tests**

  Cover foreground/background listener responses and cold-start last response; malformed/additional/legacy payloads; auth wait; one pending destination replacement; same-branch route; branch switch through `selectBranch`; wait for ready state naming that branch; archived/removed branch; RLS-denied/deleted/cross-tenant conversation; bounded reconciliation; exact destination; duplicate response; listener cleanup; and fail-closed Inbox feedback.

- [ ] **Step 2: Run routing tests and verify red**

  Run: `npm run mobile:test -- src/features/notifications/notification-routing.test.ts src/features/notifications/notification-router.test.tsx`

  Expected: FAIL because routing modules do not exist.

- [ ] **Step 3: Implement strict parsing and reconciliation**

  Reject any object whose sorted keys are not exactly `version`, `accountId`, `conversationId`, `messageId`, `deliveryId`; use branch objects freshly present in ready auth state; call `selectBranch` rather than mutating selected branch storage; and call the repository only after the selected ready branch matches the payload account.

- [ ] **Step 4: Add bounded repository reconciliation**

  Keep `ConversationRepository.get` as the RLS-backed read, add an injected timeout/abort boundary in the router, and normalize every unreadable result to one concise recovery message without revealing tenant or contact details.

- [ ] **Step 5: Run routing and repository tests and commit**

  Run: `npm run mobile:test -- src/features/notifications/notification-routing.test.ts src/features/notifications/notification-router.test.tsx src/features/inbox/conversation-repository.test.ts`

  Expected: PASS.

  ```bash
  git add apps/mobile/src/features/notifications/notification-routing* apps/mobile/src/features/notifications/notification-router* apps/mobile/src/features/inbox/conversation-repository*
  git commit -m "feat(mobile): route notification taps safely"
  ```

### Task 7: Permission onboarding, Account recovery, and auth lifecycle integration

**Files:**

- Create: `apps/mobile/src/features/notifications/notifications-context.tsx`
- Create: `apps/mobile/src/features/notifications/notifications-context.test.tsx`
- Create: `apps/mobile/src/features/notifications/notification-permission-prompt.ts`
- Create: `apps/mobile/src/features/notifications/notification-permission-prompt.test.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/src/features/foundation/account-screen.tsx`
- Modify: `apps/mobile/src/features/foundation/account-screen.test.tsx`
- Modify: `apps/mobile/src/features/auth/auth-context.tsx`
- Modify: `apps/mobile/src/features/auth/auth-context.test.tsx`
- Modify: `apps/mobile/jest.setup.ts`

**Interfaces:**

- Produces: `NotificationsProvider`/`useNotifications()` exposing notification state, `requestPermission()`, and `openSettings()`.
- Produces: one-time explanation through an injected React Native system alert and Account status/action UI using existing mobile `Button` and text/layout primitives only.
- Consumes: Tasks 5–6 coordinator/router, ready auth state, `AppState`, and auth sign-out lifecycle.

- [ ] **Step 1: Write failing provider and prompt tests**

  Verify no prompt before valid ready auth, one explanation after first ready branch, Continue requests permission, Not now records explanation without requesting, decline never blocks Inbox, provider refreshes on foreground/session-token change, and unmount/auth teardown removes listeners.

- [ ] **Step 2: Write failing Account and sign-out tests**

  Verify Account shows the current state and exactly one relevant action: `Enable notifications` while requestable, `Open settings` after denial/system restriction, no action when enabled, and graceful unavailable/retry copy. Verify `auth.signOut()` awaits notification revocation before remote/local credential teardown where possible, continues secure local teardown after revoke failure, and never leaves sign-out stuck.

- [ ] **Step 3: Run integration tests and verify red**

  Run: `npm run mobile:test -- src/features/notifications/notifications-context.test.tsx src/features/notifications/notification-permission-prompt.test.ts src/features/foundation/account-screen.test.tsx src/features/auth/auth-context.test.tsx`

  Expected: FAIL on missing provider/UI/revocation hooks.

- [ ] **Step 4: Integrate provider, prompt, and response router at root**

  Preserve the user's existing `StatusBar` changes in `app/_layout.tsx`. Mount notification coordination inside `AuthProvider` so it sees ready state but outside protected routes so cold-start responses can wait safely. Present the concise explanation with React Native's system `Alert.alert` behind the injected prompt adapter; `Not now` records the local one-time flag and `Continue` records it before the coordinator requests system permission. Do not add a custom modal or new mobile master.

- [ ] **Step 5: Add Account recovery controls**

  Add a Notifications section beside Branch using existing `Button`, text, and layout recipes. Do not add a one-off switch or status badge. Keep state-specific copy concise and action names exact.

- [ ] **Step 6: Wire pre-sign-out revoke**

  Extend the injected auth action lifecycle with `beforeCredentialTeardown(accessToken)` (or inject a notifications lifecycle dependency into `AuthProvider`) so revoke is attempted while the access token is valid, is bounded, and its failure is swallowed after recording retry-safe state; retain all existing generation barriers and local purge behavior.

- [ ] **Step 7: Run integration tests and commit only feature hunks**

  Run: `npm run mobile:test -- src/features/notifications src/features/foundation/account-screen.test.tsx src/features/auth/auth-context.test.tsx src/core/mobile-app-providers.test.tsx`

  Expected: PASS.

  Stage `apps/mobile/app/_layout.tsx` and `apps/mobile/jest.setup.ts` with `git add -p`, excluding pre-existing visual-refresh hunks.

  ```bash
  git add apps/mobile/src/features/notifications/notifications-context* apps/mobile/src/features/notifications/notification-permission-prompt* apps/mobile/src/features/foundation/account-screen* apps/mobile/src/features/auth/auth-context*
  git add -p apps/mobile/app/_layout.tsx apps/mobile/jest.setup.ts
  git commit -m "feat(mobile): add notification permission recovery"
  ```

### Task 8: Active-branch correctness and browser audio resilience

**Files:**

- Modify: `src/hooks/use-follow-up-reminder-ringtone.ts`
- Create: `src/hooks/use-follow-up-reminder-ringtone.test.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.test.tsx`
- Modify: `src/lib/notifications/notification-sounds.ts`
- Create: `src/lib/notifications/notification-sounds.test.ts`
- Modify: `src/hooks/use-total-unread.ts`
- Create: `src/hooks/use-total-unread.test.tsx`

**Interfaces:**

- Changes: `useFollowUpReminderRingtone(accountId: string | null, enabled?: boolean)`; hydration and Realtime require matching `account_id`, and branch changes clear timers/reminders/oscillators before subscribing to the next account.
- Keeps: `playInboxMessageTone`, `playFollowUpReminderTone`, `stopFollowUpReminderTone`, and `unlockNotificationAudio` return/failure semantics non-blocking.
- Consumes: `useAuth().accountId` in `DashboardShellInner` and existing `useTotalUnread({ sound: true })` account-scoped realtime.

- [ ] **Step 1: Write failing branch-scoping hook tests**

  Mock Supabase and fake timers. Assert hydration includes `.eq('account_id', accountId)`; Realtime uses `filter: account_id=eq.<id>`; mismatched queued events are ignored defensively; branch change removes the old channel, clears tracked reminders, stops sound, and creates a new scoped channel; DELETE/UPDATE stop behavior remains correct.

- [ ] **Step 2: Run hook tests and verify red**

  Run: `npm test -- src/hooks/use-follow-up-reminder-ringtone.test.tsx src/app/'(dashboard)'/dashboard-shell.test.tsx`

  Expected: FAIL because the hook accepts only `enabled` and is unscoped.

- [ ] **Step 3: Implement active-account scoping**

  Pass `accountId` from `useAuth`, include it in effect dependencies, add the account predicate to hydration and channel filter, include `account_id` in selected/event row types, reject mismatches before touching the reminder map, and retain cleanup order: cancel → clear timer → clear map → stop tone → remove channel.

- [ ] **Step 4: Write failing Web Audio edge tests**

  Cover missing `AudioContext`, constructor failure, locked context, suspended-context resume without late playback, a later pulse after resume, oscillator cleanup, repeated stop calls, and thrown `stop()`/`disconnect()` behavior. Add Inbox chime tests proving account-filtered customer inserts play once while agent/other-account events never play and audio failure does not block unread state.

- [ ] **Step 5: Run audio tests and verify red**

  Run: `npm test -- src/lib/notifications/notification-sounds.test.ts src/hooks/use-total-unread.test.tsx`

  Expected: FAIL on the uncovered edge behavior/account insert filter.

- [ ] **Step 6: Harden sound helpers and Inbox event scope**

  Keep sound functions boolean/nonthrowing, discard the current pulse while resuming, clean gain/oscillator nodes even when stop throws, and add `filter: account_id=eq.${accountId}` to the message insert subscription plus a defensive account check when message rows carry `account_id`. Never let sound exceptions prevent conversation/badge processing.

- [ ] **Step 7: Run all web sound tests and commit**

  Run: `npm test -- src/lib/notifications/reminder-ringtone.test.ts src/lib/notifications/notification-sounds.test.ts src/hooks/use-follow-up-reminder-ringtone.test.tsx src/hooks/use-total-unread.test.tsx src/app/'(dashboard)'/dashboard-shell.test.tsx`

  Expected: PASS.

  ```bash
  git add src/hooks/use-follow-up-reminder-ringtone* src/hooks/use-total-unread* src/lib/notifications/notification-sounds* src/app/'(dashboard)'/dashboard-shell*
  git commit -m "fix: scope notification sounds to the active branch"
  ```

### Task 9: Migration application, documentation, and full verification

**Files:**

- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Modify if verification discovers a feature defect: only files already owned by Tasks 1–8

**Interfaces:**

- Consumes: all previous tasks and the approved Supabase migration tool.
- Produces: verified local feature, applied/verified remote migration when the connected UsefulDesk project is unambiguous, and an explicit release-gate record for EAS/APNs/FCM and physical-device delivery.

- [ ] **Step 1: Run focused feature suites together**

  Run: `npm test -- src/lib/push src/lib/auth/mobile-user-access.test.ts src/app/api/mobile/push/installation/route.test.ts src/app/api/push/cron/route.test.ts src/app/api/whatsapp/webhook/route.test.ts src/app/api/database-cron/route.test.ts src/hooks/use-follow-up-reminder-ringtone.test.tsx src/hooks/use-total-unread.test.tsx src/lib/notifications/notification-sounds.test.ts`

  Run: `npm run mobile:test -- src/native/notifications.test.ts src/features/notifications src/features/foundation/account-screen.test.tsx src/features/auth/auth-context.test.tsx src/features/inbox/conversation-repository.test.ts`

  Expected: PASS.

- [ ] **Step 2: Apply and verify the migration through the approved connector**

  List connected Supabase projects and match UsefulDesk using existing repository configuration. If exactly one project is confirmed, call the migration tool with name `mobile_push_notifications` and the exact SQL file, then list migrations/tables and execute read-only catalog checks for columns, constraints, RLS, policies, indexes, function owner/security/search path, and grants. Run security and performance advisors. If the project is missing or ambiguous, do not apply and record `unapplied` in the handoff.

- [ ] **Step 3: Update changelog and roadmap without overwriting user edits**

  Add a terse changelog entry naming the migration, registration route, dispatcher/cron, webhook boundary, mobile coordinator/routing/Account recovery, and web sound fixes. In the roadmap replace “Push notifications … deferred” with the shipped automated/local-build status only after gates pass, and state remote iOS/Android delivery as verified or explicitly pending. Use `git add -p` for both dirty files.

- [ ] **Step 4: Run mobile verification**

  Run from the repository root:

  ```bash
  npm run lint --workspace @usefuldesk/mobile
  npm run typecheck --workspace @usefuldesk/mobile
  npm test --workspace @usefuldesk/mobile -- --runInBand
  npx expo-doctor apps/mobile
  npx expo export --platform ios --output-dir /tmp/usefuldesk-push-ios
  npx expo export --platform android --output-dir /tmp/usefuldesk-push-android
  ```

  Expected: all locally supported commands pass; export output remains outside the repository.

- [ ] **Step 5: Run root verification**

  ```bash
  npm run format:check
  npm run lint
  npm run typecheck
  npm test
  npm run build
  git diff --check
  ```

  Expected: all commands pass, or pre-existing failures are isolated with evidence and no feature regression.

- [ ] **Step 6: Review secrets, PII, and staged ownership**

  Run:

  ```bash
  rg -n "console\.(log|info|warn|error)|expoPushToken|content_text|phone|access_token|service_role" src/lib/push src/app/api/push src/app/api/mobile/push apps/mobile/src/features/notifications
  git diff --cached --name-only
  git diff --cached --check
  git status --short
  ```

  Inspect every match and ensure logs include only delivery IDs, aggregate counts, and allowlisted error codes. Confirm no unrelated `.impeccable` output, native generated tree, visual-refresh change, or user-owned file hunk is staged.

- [ ] **Step 7: Commit docs and any verified final fixes**

  ```bash
  git add -p docs/changelog.md PRDs/roadmap.md
  git commit -m "docs: record mobile push notification rollout"
  ```

- [ ] **Step 8: Record external device gates**

  If EAS project ID and valid APNs/FCM credentials are available, use one test WhatsApp contact to verify allow/deny, foreground/background/terminated delivery, one default system sound, Focus/silent precedence, tap routing, branch switch, sign-out revocation, and token refresh on physical iOS and Android development builds. If unavailable, report the exact missing gates and do not claim release-ready remote delivery.
