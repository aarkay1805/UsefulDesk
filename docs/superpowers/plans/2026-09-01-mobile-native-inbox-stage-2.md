# Native Mobile Inbox Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized mobile agents send safe outbound text and approved WhatsApp templates from a native, phone-first conversation composer while preserving tenant isolation and reconciling optimistic, API, and realtime message identities into one row.

**Architecture:** Extend `POST /api/whatsapp/send` with a first-party bearer-auth path that independently validates the Supabase access token, explicit branch, membership, role capability, and account lifecycle before reusing the existing send core. On mobile, keep transport, template readiness, optimistic reconciliation, and native presentation in focused units; the conversation screen composes those units without introducing an offline queue or Stage 3 chat features.

**Tech Stack:** Next.js 16 route handlers, Supabase Auth/Postgres/RLS, TypeScript, Expo 57, React Native 0.86, React 19, HeroUI Native masters, Jest/React Native Testing Library, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-mobile-native-inbox-chat-design.md`

## Global Constraints

- Work only in the dedicated mobile worktree and branch `feature/mobile-native-inbox-stage-1`; Stage 1 is the required base.
- Preserve cookie authentication for existing web callers of `POST /api/whatsapp/send`; bearer authentication is an additive first-party mobile path.
- A bearer request must use exactly `Authorization: Bearer <access-token>` and `x-usefuldesk-account-id: <selected-account-id>`; malformed or missing bearer credentials fail closed.
- Bearer authorization independently resolves the authenticated user, selected account, active membership, role, and active account lifecycle before any send; `canSendMessages` remains the named `agent+` capability.
- Every database read and realtime subscription remains explicitly account-scoped; a 403 never triggers a different-branch retry.
- The mobile send transport obtains the current access token at send time, retries once after one Supabase session refresh on 401, and securely signs out after a second 401.
- Text sends are available only to `agent+` roles while the latest customer message is inside the WhatsApp 24-hour service window.
- Outside the 24-hour window, omit free-form text input and show only the template action; viewers see no send controls.
- Template sends use only branch-owned, Approved, provider-synced templates and collect the exact positional `body`, `headerText`, and indexed `buttonParams` required by the existing template contract.
- Missing permission, local template data, WhatsApp connection, template contract, or provider readiness resolves to one actionable blocker with priority: permission, missing local data, contract/sync, provider/connection.
- Optimistic text messages have stable temporary IDs and `sending` status. API success and realtime INSERT reconcile by persisted message ID and provider WhatsApp ID in either arrival order, leaving exactly one row.
- Failed optimistic sends remain visible with `failed` status and Retry; the draft is retained. There is no background or offline send queue.
- Realtime delivery/read updates patch the reconciled row rather than append a message.
- Stage 3 remains deferred: media, quoted replies and `reply_to_message_id` UI, reactions, push notifications, and advanced message actions are out of scope.
- Native feature code imports HeroUI only through masters in `apps/mobile/src/ui/`; no service credentials enter the mobile bundle.
- New controls meet the repository craft floor: 44pt minimum hit targets, keyboard reachability, Dynamic Type-safe labels, visible focus/disabled/loading state, and no circular send/template icon controls.
- Do not add Zod, migrations, or dependencies. Use `getErrorMessage` for route-facing unknown errors where applicable.
- Completion updates both `docs/changelog.md` and `PRDs/roadmap.md`, then proves automated gates and an approved-contact physical-iPhone send.

## File Structure

- `src/lib/auth/mobile-operational-access.ts`: validates a mobile bearer request and returns the same operational account shape the send route needs.
- `src/app/api/whatsapp/send/route.ts`: selects cookie or bearer auth, preserves validation/rate/send behavior, and returns the existing response shape.
- `apps/mobile/src/features/inbox/send-message-client.ts`: authenticated branch-aware send transport, typed outcomes, one refresh retry, and secure recovery callback.
- `apps/mobile/src/features/inbox/template-repository.ts`: branch-scoped template/config reads and exact send-time variable descriptors.
- `apps/mobile/src/features/inbox/outbound-message-state.ts`: pure optimistic identity reconciliation and failure transitions.
- `apps/mobile/src/features/inbox/use-message-thread.ts`: owns optimistic message commands and applies API/realtime events through the pure state helpers.
- `apps/mobile/src/ui/composer-field.tsx` and `apps/mobile/src/ui/icon-button.tsx`: native masters for multiline composition and non-circular symbol actions.
- `apps/mobile/src/features/inbox/components/conversation-composer.tsx`: free-form draft/send/retry presentation.
- `apps/mobile/src/features/inbox/components/template-picker.tsx`: native approved-template choice, variable form, preview, blocker, and submit presentation.
- `apps/mobile/src/features/inbox/conversation-actions.ts`: pure role/window/readiness action-state resolution.
- `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`: integrates the action state, composer, template picker, keyboard avoidance, and list-follow behavior.

---

### Task 1: First-party mobile bearer authorization for WhatsApp send

**Files:**

- Create: `src/lib/auth/mobile-operational-access.ts`
- Create: `src/lib/auth/mobile-operational-access.test.ts`
- Modify: `src/app/api/whatsapp/send/route.ts`
- Modify: `src/app/api/whatsapp/send/route.test.ts`

**Interfaces:**

- Consumes: `canSendMessages(role: AccountRole): boolean`, public Supabase URL/anon key, `NextRequest.headers`, and the existing `requireOperationalAccess()` cookie path.
- Produces: `requireSendOperationalAccess(request: NextRequest): Promise<AccountContext>` where `AccountContext` is the existing exported `{ supabase, userId, accountId, role, account }` shape consumed by the send route; `mobile-operational-access.ts` also exports a dependency-injected factory for unit tests.
- Preserves: JSON success `{ success: true, message_id: string, whatsapp_message_id: string | null }`; existing validation and error status behavior for cookie callers.

- [ ] **Step 1: Write failing bearer-auth unit tests**

  Cover exact scheme parsing, missing branch header, invalid `auth.getUser(token)`, inactive account, absent/inactive membership, `viewer`, and an authorized `agent`. Assert every denied path returns before send-core access and that the authorized client carries both `Authorization` and `x-usefuldesk-account-id` into RLS reads.

  ```ts
  it('authorizes only an active agent in the explicit selected branch', async () => {
    const access = await requireMobileOperationalAccess(
      request({
        authorization: 'Bearer access-token',
        accountId: ACCOUNT_ID,
      })
    );
    expect(access.userId).toBe(USER_ID);
    expect(access.accountId).toBe(ACCOUNT_ID);
    expect(access.role).toBe('agent');
  });
  ```

- [ ] **Step 2: Run the auth test and verify RED**

  Run: `npm test -- src/lib/auth/mobile-operational-access.test.ts`

  Expected: FAIL because `mobile-operational-access.ts` and its exported helper do not exist.

- [ ] **Step 3: Implement minimal bearer validation**

  Parse the header with a single exact bearer match, call `auth.getUser(accessToken)` for online validation, create an RLS client whose global headers include the same bearer token and selected branch, query the profile/membership/account independently, enforce active lifecycle and `canSendMessages`, and throw the same typed authorization errors the route already maps. Never trust token metadata for account or role.

  ```ts
  export async function requireSendOperationalAccess(
    request: NextRequest
  ): Promise<AccountContext> {
    const authorization = request.headers.get('authorization');
    if (authorization === null) return requireOperationalAccess();
    return requireMobileOperationalAccess(request);
  }
  ```

- [ ] **Step 4: Write failing route integration tests**

  Add cases proving cookie requests still call `requireOperationalAccess`, valid bearer requests call the new resolver, malformed bearer never falls back to cookies, rate limiting uses the validated user ID, and the unchanged send core receives the same conversation/type/text/template arguments and response mapping.

- [ ] **Step 5: Run the route tests and verify RED**

  Run: `npm test -- src/app/api/whatsapp/send/route.test.ts`

  Expected: FAIL because the route does not select bearer authorization.

- [ ] **Step 6: Wire the resolver into the existing route**

  Pass `request` to `requireSendOperationalAccess`, keep `checkRateLimit('send:' + userId)` after authorization, and leave body validation, account-scoped conversation lookup, `sendMessageToConversation`, and JSON response shape unchanged.

- [ ] **Step 7: Run focused tests and typecheck**

  Run: `npm test -- src/lib/auth/mobile-operational-access.test.ts src/app/api/whatsapp/send/route.test.ts && npm run typecheck`

  Expected: both suites PASS with pristine output and typecheck exits 0.

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/auth/mobile-operational-access.ts src/lib/auth/mobile-operational-access.test.ts src/app/api/whatsapp/send/route.ts src/app/api/whatsapp/send/route.test.ts
  git commit -m "feat(api): authorize native WhatsApp sends"
  ```

---

### Task 2: Authenticated mobile send transport with one refresh retry

**Files:**

- Create: `apps/mobile/src/features/inbox/send-message-client.ts`
- Create: `apps/mobile/src/features/inbox/send-message-client.test.ts`
- Modify: `apps/mobile/src/features/auth/auth-context.tsx`
- Modify: `apps/mobile/src/features/auth/auth-context.test.tsx`

**Interfaces:**

- Consumes: `mobileEnvironment.apiBaseUrl`, `mobileSupabase.auth.getSession()`, `mobileSupabase.auth.refreshSession()`, selected branch ID, and the existing secure `AuthContextValue.signOut()`.
- Produces: `sendConversationMessage(input: MobileSendInput, dependencies?: MobileSendDependencies): Promise<MobileSendResult>` with text and template input variants; `MobileSendResult = { messageId: string; whatsappMessageId: string | null }`; typed `MobileSendError` categories `unauthorized | forbidden | rate_limited | provider | network | invalid_response`.
- Produces: `AuthContextValue.recoverUnauthorizedSession(): Promise<void>` delegating to the existing secure sign-out state machine and safe under duplicate calls.

- [ ] **Step 1: Write failing transport tests**

  Cover current-token acquisition at call time, exact bearer and branch headers, text and template payload shapes, success decoding, non-JSON/malformed success rejection, 403 without refresh, 429 classification, provider/network failure, 401 then successful refresh/retry with the new token, and second 401 invoking secure recovery exactly once.

  ```ts
  await sendConversationMessage(
    {
      kind: 'text',
      accountId: ACCOUNT_ID,
      conversationId: CONVERSATION_ID,
      text: 'I can help with your renewal.',
    },
    dependencies
  );
  expect(fetch).toHaveBeenLastCalledWith(
    `${API_BASE}/api/whatsapp/send`,
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer fresh-token',
        'x-usefuldesk-account-id': ACCOUNT_ID,
      }),
    })
  );
  ```

- [ ] **Step 2: Run the client test and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/send-message-client.test.ts`

  Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the minimal transport**

  Define discriminated inputs:

  ```ts
  type MobileSendInput =
    | { kind: 'text'; accountId: string; conversationId: string; text: string }
    | {
        kind: 'template';
        accountId: string;
        conversationId: string;
        templateName: string;
        templateLanguage: string;
        templateParams: string[];
        templateMessageParams: {
          body: string[];
          headerText?: string;
          buttonParams?: Record<number, string>;
        };
      };
  ```

  Build the existing route body keys (`conversation_id`, `message_type`, `text` or template fields), trim text, throw before fetch for an empty draft/session/branch, refresh only on the first 401, and call `recoverUnauthorizedSession` after the second.

- [ ] **Step 4: Add failing auth-context recovery tests**

  Assert `recoverUnauthorizedSession()` enters the current secure sign-out flow, coalesces concurrent calls through existing guards, and never publishes a stale ready state after cleanup.

- [ ] **Step 5: Run auth-context tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/auth/auth-context.test.tsx`

  Expected: FAIL because the context method is absent.

- [ ] **Step 6: Expose secure unauthorized recovery**

  Add the context method as a semantic alias of the existing guarded secure sign-out callback; do not add a second cleanup implementation.

- [ ] **Step 7: Run focused tests and mobile typecheck**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/send-message-client.test.ts src/features/auth/auth-context.test.tsx && npm --prefix apps/mobile run typecheck`

  Expected: both suites PASS and typecheck exits 0.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/mobile/src/features/inbox/send-message-client.ts apps/mobile/src/features/inbox/send-message-client.test.ts apps/mobile/src/features/auth/auth-context.tsx apps/mobile/src/features/auth/auth-context.test.tsx
  git commit -m "feat(mobile): add authenticated send transport"
  ```

---

### Task 3: Branch-scoped session and template readiness data

**Files:**

- Create: `apps/mobile/src/features/inbox/template-repository.ts`
- Create: `apps/mobile/src/features/inbox/template-repository.test.ts`
- Modify: `apps/mobile/src/features/inbox/message-repository.ts`
- Modify: `apps/mobile/src/features/inbox/message-repository.test.ts`
- Modify: `apps/mobile/src/features/inbox/inbox-types.ts`

**Interfaces:**

- Produces: `getLatestCustomerMessageAt(accountId, conversationId): Promise<string | null>` after proving the conversation belongs to `accountId`.
- Produces: `listSendableTemplates(accountId): Promise<NativeTemplate[]>` and `getWhatsAppConnectionReadiness(accountId): Promise<ConnectionReadiness>` using the branch-aware Supabase client.
- Produces: `templateFields(template: NativeTemplate): TemplateField[]`, where fields are ordered body variables, optional text-header `{{1}}`, and indexed dynamic URL/COPY_CODE button values; send-time output maps to `{ body, headerText?, buttonParams? }`.
- `NativeTemplate` contains only UI/send fields: `id`, `name`, `language`, `category`, `bodyText`, `headerType`, `headerContent`, `headerMediaUrl`, `buttons`, and provider readiness timestamps/status.

- [ ] **Step 1: Write failing session-window repository tests**

  Assert the repository first proves the branch conversation, then queries the newest `direction = 'inbound'` message with explicit `account_id` and `conversation_id`, returning its ISO timestamp or null. Assert cross-branch/unavailable conversations fail closed.

- [ ] **Step 2: Run the message repository test and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/message-repository.test.ts`

  Expected: FAIL because `getLatestCustomerMessageAt` is absent.

- [ ] **Step 3: Implement the latest-customer query**

  Use `.eq('account_id', accountId).eq('conversation_id', conversationId).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle()` only after the existing conversation proof.

- [ ] **Step 4: Write failing template repository tests**

  Cover explicit account filters, Approved/provider-synced filtering, stable name ordering, malformed row rejection, connection absent/disconnected/connected states, static templates requiring zero fields, positional body variables ordered numerically, text header variable, dynamic URL button indexed by template position, and COPY_CODE default/override behavior consistent with `template-send-builder.ts`.

- [ ] **Step 5: Run the template tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/template-repository.test.ts`

  Expected: FAIL because the repository and field descriptor logic do not exist.

- [ ] **Step 6: Implement strict normalizers and descriptors**

  Query only `account_id = accountId`, `status = 'APPROVED'`, `provider_missing_since IS NULL`, and `provider_components_sync_required_at IS NULL`. Reject non-positional rows that cannot satisfy the existing contract. Extract `{{N}}` indices locally with a small pure helper and return descriptors such as:

  ```ts
  type TemplateField =
    | { kind: 'body'; variable: number; label: `Body variable ${number}` }
    | { kind: 'header'; variable: 1; label: 'Header variable' }
    | {
        kind: 'button';
        buttonIndex: number;
        label: string;
        defaultValue?: string;
      };
  ```

- [ ] **Step 7: Run focused tests and mobile typecheck**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/message-repository.test.ts src/features/inbox/template-repository.test.ts && npm --prefix apps/mobile run typecheck`

  Expected: both suites PASS and typecheck exits 0.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/mobile/src/features/inbox/template-repository.ts apps/mobile/src/features/inbox/template-repository.test.ts apps/mobile/src/features/inbox/message-repository.ts apps/mobile/src/features/inbox/message-repository.test.ts apps/mobile/src/features/inbox/inbox-types.ts
  git commit -m "feat(mobile): load send readiness data"
  ```

---

### Task 4: Optimistic outbound identity reconciliation

**Files:**

- Create: `apps/mobile/src/features/inbox/outbound-message-state.ts`
- Create: `apps/mobile/src/features/inbox/outbound-message-state.test.ts`
- Modify: `apps/mobile/src/features/inbox/use-message-thread.ts`
- Modify: `apps/mobile/src/features/inbox/use-message-thread.test.tsx`

**Interfaces:**

- Consumes: `sendConversationMessage`, realtime `INSERT`/`UPDATE` events, current authenticated user/branch, and Stage 1 `InboxMessage`.
- Produces pure functions `appendOptimisticText`, `applySendAcknowledgement`, `applyRealtimeMessage`, and `markOptimisticFailed` operating on `OutboundThreadState` with aliases for `temporaryId`, persisted `messageId`, and `whatsappMessageId`.
- Extends `UseMessageThreadResult` with `sendText(draft: string): Promise<SendAttemptResult>` and `retryText(temporaryId: string): Promise<SendAttemptResult>`; `SendAttemptResult` includes `temporaryId` and `status: 'sent' | 'failed'`.

- [ ] **Step 1: Write failing pure reducer tests**

  Cover optimistic append, API-before-realtime, realtime-before-API, duplicate realtime INSERT, persisted-ID match, provider-ID match, later delivery/read UPDATE, failure retention, retry reusing the same temporary row, and unrelated inbound insert. Every ordering must assert one logical outbound row.

  ```ts
  expect(
    reconcile([
      optimistic('temp-1'),
      realtime(persisted('db-1', 'wamid-1')),
      acknowledgement('temp-1', 'db-1', 'wamid-1'),
    ]).messages.filter((item) => item.direction === 'outbound')
  ).toHaveLength(1);
  ```

- [ ] **Step 2: Run reducer tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/outbound-message-state.test.ts`

  Expected: FAIL because the state module is absent.

- [ ] **Step 3: Implement the minimal pure state machine**

  Keep alias maps immutable, choose the persisted UUID as canonical once known while retaining the UI key/temporary alias, prefer the highest delivery status, and never discard a failed row until it reconciles or the thread reloads authoritatively.

- [ ] **Step 4: Write failing hook command tests**

  Assert `sendText` appends immediately, calls transport once, reconciles acknowledgement, marks failure without deleting the row, preserves caller-owned draft on failure, Retry changes failed to sending and reuses one row, branch/feed generation changes prevent stale completions from publishing, and realtime races use the pure state helpers.

- [ ] **Step 5: Run hook tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/use-message-thread.test.tsx`

  Expected: FAIL because send/retry commands are absent.

- [ ] **Step 6: Integrate the state machine into the hook**

  Generate `temp:<uuid>` IDs through an injectable factory, capture branch/feed generation before awaits, route all outbound API/realtime transitions through the pure helpers, and leave existing initial load/pagination/resync behavior intact.

- [ ] **Step 7: Run focused tests and mobile typecheck**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/outbound-message-state.test.ts src/features/inbox/use-message-thread.test.tsx && npm --prefix apps/mobile run typecheck`

  Expected: both suites PASS and typecheck exits 0.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/mobile/src/features/inbox/outbound-message-state.ts apps/mobile/src/features/inbox/outbound-message-state.test.ts apps/mobile/src/features/inbox/use-message-thread.ts apps/mobile/src/features/inbox/use-message-thread.test.tsx
  git commit -m "feat(mobile): reconcile optimistic outbound messages"
  ```

---

### Task 5: Native composer masters

**Files:**

- Create: `apps/mobile/src/ui/composer-field.tsx`
- Create: `apps/mobile/src/ui/composer-field.test.tsx`
- Create: `apps/mobile/src/ui/icon-button.tsx`
- Create: `apps/mobile/src/ui/icon-button.test.tsx`
- Modify: `apps/mobile/src/ui/index.ts`

**Interfaces:**

- Produces: `ComposerField` wrapping HeroUI `Input` with multiline React Native text-input props, controlled value, 44pt minimum height, capped growth, return-key/newline behavior, disabled state, label/error semantics, and ref forwarding.
- Produces: `IconButton` wrapping the native master `Button` plus `expo-symbols`, with non-circular geometry, required `accessibilityLabel`, `isDisabled`, `isLoading`, and at least 44pt hit target.

- [ ] **Step 1: Write failing master tests**

  Assert controlled multiline editing, forwarded focus ref, readable error association, disabled edit suppression, Dynamic Type-compatible text props, non-circular geometry, accessible button label, symbol rendering, loading announcement, and repeat-press prevention.

- [ ] **Step 2: Run master tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/ui/composer-field.test.tsx src/ui/icon-button.test.tsx`

  Expected: FAIL because both masters are absent.

- [ ] **Step 3: Implement the masters only in `src/ui`**

  Import `Input` from `heroui-native` only in `composer-field.tsx`; build `IconButton` on the existing local `Button` and `SymbolView`. Use token classes from the native theme and a rounded-rectangle send control rather than a floating circle.

- [ ] **Step 4: Export the masters**

  Add named exports to `apps/mobile/src/ui/index.ts`; do not change existing master behavior or call sites.

- [ ] **Step 5: Run UI tests and mobile typecheck**

  Run: `npm --prefix apps/mobile test -- --runInBand src/ui && npm --prefix apps/mobile run typecheck`

  Expected: UI suites PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/mobile/src/ui/composer-field.tsx apps/mobile/src/ui/composer-field.test.tsx apps/mobile/src/ui/icon-button.tsx apps/mobile/src/ui/icon-button.test.tsx apps/mobile/src/ui/index.ts
  git commit -m "feat(mobile): add native composer masters"
  ```

---

### Task 6: Conversation action state and free-form composer

**Files:**

- Create: `apps/mobile/src/features/inbox/conversation-actions.ts`
- Create: `apps/mobile/src/features/inbox/conversation-actions.test.ts`
- Create: `apps/mobile/src/features/inbox/components/conversation-composer.tsx`
- Create: `apps/mobile/src/features/inbox/components/conversation-composer.test.tsx`

**Interfaces:**

- Consumes: account role, current account-local time, latest inbound timestamp, template readiness, connection readiness, `sendText`, `retryText`, and Task 5 masters.
- Produces: `resolveConversationActions(input): ConversationActionState` with variants `viewer`, `open_text`, `closed_template`, and `blocked`, plus one prioritized `ActionBlocker`.
- Produces: `ConversationComposer` controlled locally with `onSend(text)` and `onRetry(temporaryId)`; clears draft only on `sent`, retains and focuses it on `failed`, and exposes pending/disabled/accessibility states.

- [ ] **Step 1: Write failing action-state tests**

  Cover viewer omission, no inbound customer message, exactly-inside/exactly-outside the 24-hour boundary, open text regardless of template availability, closed window with sendable template, and blocker priority across permission/local/contract/provider conditions.

- [ ] **Step 2: Run action-state tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/conversation-actions.test.ts`

  Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement the pure resolver**

  Compute the service window with instants, never a formatted date; role capability mirrors `canSendMessages` (`owner`, `admin`, `agent`). Return no action state that exposes free-form text to a viewer or outside the window.

- [ ] **Step 4: Write failing composer tests**

  Assert trimmed nonempty submit, one in-flight send, draft cleared only on success, draft retained on network/provider/429 failure, inline actionable failure plus Retry, retry pending state, keyboard submit behavior, multiline newline behavior, and 44pt controls.

- [ ] **Step 5: Run composer tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/components/conversation-composer.test.tsx`

  Expected: FAIL because the component is absent.

- [ ] **Step 6: Implement the composer**

  Use `ComposerField` and `IconButton`; keep draft ownership in the component, render failure adjacent to the composer, and surface `Retry` only for the matching failed optimistic row. Do not add attachment, microphone, emoji, quote, or media controls.

- [ ] **Step 7: Run focused tests and mobile typecheck**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/conversation-actions.test.ts src/features/inbox/components/conversation-composer.test.tsx && npm --prefix apps/mobile run typecheck`

  Expected: both suites PASS and typecheck exits 0.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/mobile/src/features/inbox/conversation-actions.ts apps/mobile/src/features/inbox/conversation-actions.test.ts apps/mobile/src/features/inbox/components/conversation-composer.tsx apps/mobile/src/features/inbox/components/conversation-composer.test.tsx
  git commit -m "feat(mobile): add conversation text composer"
  ```

---

### Task 7: Approved-template picker and exact positional values

**Files:**

- Create: `apps/mobile/src/features/inbox/components/template-picker.tsx`
- Create: `apps/mobile/src/features/inbox/components/template-picker.test.tsx`

**Interfaces:**

- Consumes: `NativeTemplate`, `TemplateField`, `templateFields`, `sendConversationMessage({ kind: 'template', ... })`, and Task 5 masters.
- Produces: `TemplatePicker` props `{ accountId, conversationId, templates, blocker, onClose, onSent }`; sends exact `template_params` body values and structured `template_message_params` with optional header and indexed buttons.

- [ ] **Step 1: Write failing picker tests**

  Assert no send UI for a blocker, one actionable blocker message, Approved template list, static preview, stable field order, body/header/button validation, COPY_CODE default, dynamic URL value, exact payload keys, pending repeat prevention, success dismissal, and failure retaining all entered values.

  ```ts
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'template',
      templateName: 'gym_membership_renewal',
      templateParams: ['Rajat', '30 Sep'],
      templateMessageParams: {
        body: ['Rajat', '30 Sep'],
        headerText: 'September renewal',
        buttonParams: { 0: 'member-42' },
      },
    })
  );
  ```

- [ ] **Step 2: Run picker tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/components/template-picker.test.tsx`

  Expected: FAIL because the picker is absent.

- [ ] **Step 3: Implement the native picker**

  Use React Native `Modal` with safe-area padding, explicit close, keyboard avoidance, selectable template rows, UsefulDesk fields/buttons, preview, and a single send action. Never accept media overrides in Stage 2.

- [ ] **Step 4: Run picker tests and mobile typecheck**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/components/template-picker.test.tsx && npm --prefix apps/mobile run typecheck`

  Expected: suite PASS and typecheck exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/mobile/src/features/inbox/components/template-picker.tsx apps/mobile/src/features/inbox/components/template-picker.test.tsx
  git commit -m "feat(mobile): add approved template picker"
  ```

---

### Task 8: Integrate outbound actions into the native conversation screen

**Files:**

- Modify: `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`
- Modify: `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx`
- Modify: `apps/mobile/src/features/inbox/use-message-thread.ts`
- Modify: `apps/mobile/src/features/inbox/use-message-thread.test.tsx`

**Interfaces:**

- Consumes: Tasks 2–7 interfaces.
- Produces: complete Stage 2 conversation surface: viewer read-only, open-window text composer, closed-window template action, prioritized blocker, optimistic/retry behavior, and keyboard-safe list/composer layout.

- [ ] **Step 1: Write failing screen integration tests**

  Cover role/window matrix, load of latest customer timestamp/readiness, viewer omission, closed amber action bar containing only `Send a template`, open composer send, optimistic scroll-follow only when already near bottom, failed-row Retry, template picker open/send/close, branch change stale-load suppression, and keyboard avoidance without obscuring the newest message.

- [ ] **Step 2: Run screen and hook tests and verify RED**

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/screens/conversation-screen.test.tsx src/features/inbox/use-message-thread.test.tsx`

  Expected: FAIL because the screen has no outbound action integration.

- [ ] **Step 3: Integrate data and actions**

  Load the latest customer timestamp, templates, and connection readiness under the same account/feed generation as the thread. Resolve one action state and render exactly one of: nothing, `ConversationComposer`, closed-window `Send a template`, or actionable blocker. Route text commands through the hook and template commands through the send client.

- [ ] **Step 4: Add keyboard-safe native composition**

  Wrap the message list/action footer in `KeyboardAvoidingView` with iOS behavior and safe-area-aware padding. Preserve Stage 1 pagination and near-bottom behavior; a newly appended optimistic row follows only if `stickToBottomRef.current` was true.

- [ ] **Step 5: Run the complete mobile test/type/lint gates**

  Run: `npm --prefix apps/mobile test -- --runInBand && npm --prefix apps/mobile run typecheck && npm --prefix apps/mobile run lint`

  Expected: all suites PASS, typecheck/lint exit 0, and output has no React act warnings or unhandled rejections.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/mobile/src/features/inbox/screens/conversation-screen.tsx apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx apps/mobile/src/features/inbox/use-message-thread.ts apps/mobile/src/features/inbox/use-message-thread.test.tsx
  git commit -m "feat(mobile): ship native outbound conversation actions"
  ```

---

### Task 9: Documentation, repository gates, and physical-iPhone acceptance

**Files:**

- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Create: `docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md`

**Interfaces:**

- Consumes: the completed Stage 2 implementation and existing repository verification scripts.
- Produces: durable shipped-state documentation and a reproducible acceptance report with command/device evidence; no production API or UI interfaces.

- [ ] **Step 1: Update shipped documentation**

  Add a terse changelog entry naming bearer auth, mobile transport, optimistic reconciliation, native text/template composer, code locations, and the gotcha that quoted replies/media remain Stage 3. Move Stage 2 from pending to Built/Shipped in the roadmap, retain Stage 3 as deferred, and update mobile test counts only from observed output.

- [ ] **Step 2: Run repository verification**

  Run these exact deterministic commands from the repository root and record commands, versions, pass counts, warnings, and temporary artifact path in the acceptance report; do not claim a gate that was not run:

  ```bash
  npm test -- src/lib/auth/mobile-operational-access.test.ts src/app/api/whatsapp/send/route.test.ts
  npm run mobile:verify
  (cd apps/mobile && npx expo-doctor)
  stage2_ios_export="$(mktemp -d /tmp/usefuldesk-stage2-ios.XXXXXX)"
  (cd apps/mobile && npx expo export --platform ios --output-dir "$stage2_ios_export")
  npm run verify
  git diff --check
  ```

- [ ] **Step 3: Run Impeccable native finish inspection**

  Capture screenshots into `.impeccable/review/` for at least: viewer read-only, agent open-window composer, sending, failed+Retry, closed-window template-only bar, template variable form, and successful reconciled outbound row. Review hierarchy, safe areas, 44pt targets, Dynamic Type, keyboard reachability, dark/light appearance, and the join between list and composer; fix only concrete Stage 2 regressions through a reviewed task fix round.

- [ ] **Step 4: Verify on a physical iPhone with an approved test contact**

  On the connected physical iPhone, select two permitted branches and prove branch isolation. With an approved test contact, send one free-form message inside the 24-hour window and one Approved/synced template outside it. Record temporary UI state, persisted/provider ID reconciliation without duplication, delivered/read patch if the provider returns it, failure/Retry using a safe induced network interruption, viewer omission, keyboard behavior, and screenshots. Do not send to a real customer or unapproved contact.

- [ ] **Step 5: Re-run affected gates after any visual/device fix**

  Run focused tests for changed code followed by complete mobile test/type/lint and the relevant root send-route/auth suites. Append final clean evidence to the acceptance report.

- [ ] **Step 6: Commit**

  ```bash
  git add docs/changelog.md PRDs/roadmap.md docs/superpowers/reports/2026-09-01-mobile-native-inbox-stage-2-acceptance.md
  git commit -m "docs: record mobile inbox stage 2 acceptance"
  ```
