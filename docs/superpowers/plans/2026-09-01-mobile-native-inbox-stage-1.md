# Mobile Native Inbox Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a branch-isolated, realtime, read-only native Inbox on iOS and Android with a paginated conversation list, paginated WhatsApp-style message history, safe unread clearing, and deterministic reconnect recovery.

**Architecture:** Expo Router makes Inbox the authenticated home and pushes a native conversation route. Focused repositories read through the existing branch-aware Supabase client and RLS; focused hooks own list/thread state, AppState resync, and realtime reconciliation. UsefulDesk mobile masters wrap HeroUI Native primitives, while Inbox-specific rows and bubbles remain feature components.

**Tech Stack:** Expo SDK 57, Expo Router 57, React Native 0.86, React 19, TypeScript 6, Supabase JS 2.107, HeroUI Native 1.0.9, Uniwind 1.11, Jest 29, React Native Testing Library 13.

**Spec:** `docs/superpowers/specs/2026-09-01-mobile-native-inbox-chat-design.md`

## Global Constraints

- This plan implements **Stage 1 only**. It creates no composer, send button, template action, media upload, reaction, assignment, status mutation, or customer/provider write.
- Every conversation query includes an explicit selected `account_id` predicate in addition to RLS and the branch-aware request header.
- Message reads are allowed only after the owning conversation has been verified in the selected branch.
- Agent-or-higher may clear the shared unread count with returned-row proof. Viewers perform no mutation.
- Realtime accelerates state; repository refetch after reconnect, foreground, manual refresh, or branch change remains authoritative.
- One idempotent migration adds private, identifier-only Inbox Broadcast triggers and Realtime topic authorization. No new npm dependency, service credential, Meta credential, remote EAS state, or customer send is authorized by this plan.
- All regional dates, times, and phones use the existing `resolveAccountLocale` plus `buildFormatters` source of truth. Do not hand-roll `Intl` at an Inbox call site.
- UI follows `docs/ui-patterns.md`, especially the Inbox chat surface, shared-master, token, accessible-name, Dynamic Type, and no-circular-icon rules.
- Async React effects use an inline async IIFE plus a `cancelled` guard. Manual refresh is a nonce bump, not a direct call to a state-setting effect wrapper.
- All user-facing errors are fixed safe copy. Raw Supabase rows, query text, access tokens, phone/message contents, and provider diagnostics never enter logs or test snapshots.
- Use TDD for every task: establish RED, implement minimally, establish GREEN, then commit only that task's files.
- The verified blank-screen repair is already present as unrelated working-tree work. Before execution, use `superpowers:using-git-worktrees` or first preserve that work in its own commit; every task below stages only its exact file list.

---

## File Structure

### Shared localization bridge

- Modify `src/lib/locale/format.ts` and `src/lib/phone-input.ts` only to replace internal `@/` aliases with relative imports, making the existing pure modules consumable by Metro.
- Create `apps/mobile/src/core/account-formatters.ts` as the mobile adapter that resolves the ready account and returns the existing formatter surface.

### Native UI masters

- Create `apps/mobile/src/ui/search-field.tsx`.
- Create `apps/mobile/src/ui/filter-chip-group.tsx`.
- Create `apps/mobile/src/ui/user-avatar.tsx`.
- Create `apps/mobile/src/ui/async-state.tsx`.
- Modify `apps/mobile/src/ui/index.ts` to export them.

### Inbox domain and data

- Create `apps/mobile/src/features/inbox/inbox-types.ts` for stable native domain contracts.
- Create `apps/mobile/src/features/inbox/inbox-test-fixtures.ts` for deterministic test-only rows and domain factories shared by Inbox suites.
- Create `apps/mobile/src/features/inbox/inbox-normalizers.ts` for runtime row validation and normalization.
- Create `apps/mobile/src/features/inbox/inbox-format.ts` for sender runs, date sections, safe media URLs, and preview labels.
- Create `apps/mobile/src/features/inbox/conversation-repository.ts` for list/search/count/hydrate/read operations.
- Create `apps/mobile/src/features/inbox/message-repository.ts` for verified-conversation message pagination.
- Create `apps/mobile/src/features/inbox/inbox-realtime.ts` for channel setup, status mapping, and cleanup.
- Create `apps/mobile/src/features/inbox/inbox-realtime-provider.tsx` for the single branch-lifetime channel, local event fan-out, and reconnect/foreground resync generation.
- Create `supabase/migrations/20260901090000_mobile_inbox_private_broadcast.sql` for identifier-only database Broadcast triggers and account-topic authorization.
- Create `src/lib/mobile-inbox-realtime-contract.test.ts` for the durable migration security contract.

### Inbox state and screens

- Create `apps/mobile/src/features/inbox/use-conversation-list.ts`.
- Create `apps/mobile/src/features/inbox/components/conversation-row.tsx`.
- Create `apps/mobile/src/features/inbox/screens/inbox-screen.tsx`.
- Create `apps/mobile/src/features/inbox/use-message-thread.ts`.
- Create `apps/mobile/src/features/inbox/components/message-content.tsx`.
- Create `apps/mobile/src/features/inbox/components/message-bubble.tsx`.
- Create `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`.
- Modify `apps/mobile/global.css` for named chat tokens.
- Modify `apps/mobile/app/(app)/index.tsx` to export Inbox instead of Foundation.
- Create `apps/mobile/app/(app)/conversation/[conversationId].tsx`.
- Modify `apps/mobile/app/(app)/_layout.tsx` to register Inbox, Account, and conversation routes.

### Documentation and verification

- Modify `docs/mobile/development-build.md`, `docs/changelog.md`, and `PRDs/roadmap.md` after the Stage 1 acceptance gates pass.

---

### Task 1: Reuse the canonical locale formatter in React Native

**Files:**

- Modify: `src/lib/locale/format.ts`
- Modify: `src/lib/phone-input.ts`
- Create: `apps/mobile/src/core/account-formatters.ts`
- Create: `apps/mobile/src/core/account-formatters.test.ts`
- Test: `src/lib/locale/format.test.ts`

**Interfaces:**

- Consumes: `AccountSummary` from `apps/mobile/src/features/auth/branch-types.ts`.
- Produces: `accountFormatters(account: AccountSummary): LocaleFormatters`.

- [ ] **Step 1: Write the failing mobile formatter test**

```ts
import { accountFormatters } from './account-formatters';

const account = {
  id: 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497',
  name: 'Indiranagar',
  created_at: '2026-08-01T10:00:00.000Z',
  default_currency: 'INR',
  country_code: 'IN',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  date_order: 'DMY',
  time_format: '12h',
  week_start: 1,
  phone_country_code: '+91',
  measurement_system: 'metric',
  onboarding_dismissed_at: null,
  organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
  legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
  branch_status: 'active',
  readiness_state: 'ready',
  setup_reviewed_at: null,
  setup_reviewed_by: null,
} as const;

it('formats Inbox timestamps and phones with the selected account locale', () => {
  const fmt = accountFormatters(account);
  expect(fmt.time('2026-09-01T15:30:00.000Z')).toBe('9:00 pm');
  expect(fmt.date('2026-09-01T15:30:00.000Z')).toBe('1 Sept 2026');
  expect(fmt.phone('9876543210')).toBe('+919876543210');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run mobile:test -- --runTestsByPath src/core/account-formatters.test.ts
```

Expected: FAIL because `account-formatters.ts` does not exist.

- [ ] **Step 3: Make the existing locale modules Metro-consumable and add the adapter**

Change only these imports:

```ts
// src/lib/locale/format.ts
import {
  formatCurrency,
  formatCurrencyExact,
  formatCurrencyShort,
} from '../currency';
import { accountQualifiedPhoneDisplayValue } from '../phone-input';

// src/lib/phone-input.ts
import { COUNTRY_PRESETS } from './locale/config';
import { normalizePhone } from './whatsapp/phone-utils';
```

Create the adapter:

```ts
import {
  resolveAccountLocale,
  type AccountLocale,
} from '../../../../src/lib/locale/config';
import {
  buildFormatters,
  type LocaleFormatters,
} from '../../../../src/lib/locale/format';

import type { AccountSummary } from '../features/auth/branch-types';

export function accountLocale(account: AccountSummary): AccountLocale {
  return resolveAccountLocale(account);
}

export function accountFormatters(account: AccountSummary): LocaleFormatters {
  return buildFormatters(accountLocale(account));
}
```

- [ ] **Step 4: Run mobile and web locale tests and verify GREEN**

Run:

```bash
npm run mobile:test -- --runTestsByPath src/core/account-formatters.test.ts
npm test -- src/lib/locale/format.test.ts src/lib/locale/config.test.ts
npm run mobile:typecheck
```

Expected: all commands exit 0; web formatter output remains unchanged.

- [ ] **Step 5: Commit the locale bridge**

```bash
git add src/lib/locale/format.ts src/lib/phone-input.ts apps/mobile/src/core/account-formatters.ts apps/mobile/src/core/account-formatters.test.ts
git commit -m "refactor: share account formatters with mobile"
```

---

### Task 2: Define and validate the native Inbox domain

**Files:**

- Create: `apps/mobile/src/features/inbox/inbox-types.ts`
- Create: `apps/mobile/src/features/inbox/inbox-normalizers.ts`
- Create: `apps/mobile/src/features/inbox/inbox-normalizers.test.ts`
- Create: `apps/mobile/src/features/inbox/inbox-format.ts`
- Create: `apps/mobile/src/features/inbox/inbox-format.test.ts`
- Create: `apps/mobile/src/features/inbox/inbox-test-fixtures.ts`

**Interfaces:**

- Produces: `InboxConversation`, `InboxMessage`, `ConversationCursor`, `MessageCursor`, `Page<T, C>`, `ThreadDisplayItem`, `parseConversationRows`, `parseMessageRows`, `startsNewRun`, `buildThreadItems`, `safeMediaUrl`, and `messagePreview`.
- Consumed by: repositories, realtime hooks, conversation rows, and message bubbles in later tasks.

Every Inbox test imports deterministic data from `inbox-test-fixtures.ts` rather
than inventing branch ids or incomplete raw rows. Create this file in the same
RED/GREEN cycle:

```ts
import type { InboxConversation, InboxMessage, Page } from './inbox-types';

export const BRANCH_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
export const OTHER_BRANCH_ID = 'ab92ad08-3808-4a3e-8d50-7a5fa2a6a770';
export const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';
export const EMPTY_CONVERSATION_ID = 'dc046770-c5f6-4f2a-98c5-a60786a312b9';
export const OTHER_CONVERSATION_ID = '926c8f7b-b1b9-45da-a65e-3a5511159f87';
export const CONTACT_ID = 'ba8df73d-a33e-4236-a93b-357149bc6ea0';
export const MESSAGE_0_ID = '41a29fc1-6e83-41a0-872a-5ffb0def795f';
export const MESSAGE_1_ID = '94c45d67-692f-4654-8806-668858e84c6b';
export const MESSAGE_2_ID = '16b3b0cf-9ed9-41c5-860d-d11391712e92';
export const MESSAGE_3_ID = '0e6d616f-0b0e-438b-a210-3d05b8075de4';
export const ABSENT_MESSAGE_ID = '2ec92843-fe53-46ac-8751-df6f75e5908a';

export function rawConversation(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: CONVERSATION_ID,
    account_id: BRANCH_ID,
    contact_id: CONTACT_ID,
    status: 'open',
    assigned_agent_id: null,
    last_message_text: 'Your membership expires tomorrow',
    last_message_at: '2026-09-01T08:00:00.000Z',
    unread_count: 3,
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    contact: {
      id: CONTACT_ID,
      name: 'Asha Rao',
      phone: '9876543210',
      avatar_url: null,
      memberships: [{ id: 'd2e4e69f-4c98-4204-b2c6-f746ea672858' }],
    },
    ...overrides,
  };
}

export function conversation(
  overrides: Partial<InboxConversation> = {}
): InboxConversation {
  return {
    id: CONVERSATION_ID,
    accountId: BRANCH_ID,
    contactId: CONTACT_ID,
    status: 'open',
    assignedAgentId: null,
    lastMessageText: 'Your membership expires tomorrow',
    lastMessageAt: '2026-09-01T08:00:00.000Z',
    unreadCount: 3,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    contact: {
      id: CONTACT_ID,
      name: 'Asha Rao',
      phone: '9876543210',
      avatarUrl: null,
    },
    isMember: true,
    ...overrides,
  };
}

export function rawMessage(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: MESSAGE_1_ID,
    conversation_id: CONVERSATION_ID,
    sender_type: 'customer',
    sender_id: null,
    content_type: 'text',
    content_text: 'Hello',
    media_url: null,
    template_name: null,
    message_id: 'wamid.test',
    status: 'delivered',
    provider_error_title: null,
    created_at: '2026-09-01T08:01:00.000Z',
    reply_to_message_id: null,
    interactive_reply_id: null,
    ...overrides,
  };
}

export function message(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: MESSAGE_1_ID,
    conversationId: CONVERSATION_ID,
    senderType: 'customer',
    senderId: null,
    contentType: 'text',
    contentText: 'Hello',
    mediaUrl: null,
    templateName: null,
    providerMessageId: 'wamid.test',
    status: 'delivered',
    providerErrorTitle: null,
    createdAt: '2026-09-01T08:01:00.000Z',
    replyToMessageId: null,
    interactiveReplyId: null,
    ...overrides,
  };
}

export function page<T, C>(
  items: T[],
  nextCursor: C | null = null
): Page<T, C> {
  return { items, nextCursor };
}
```

- [ ] **Step 1: Write failing normalization and presentation tests**

```ts
import { parseConversationRows, parseMessageRows } from './inbox-normalizers';
import { messagePreview, safeMediaUrl, startsNewRun } from './inbox-format';

const accountId = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const conversationId = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';

it('rejects a conversation from another branch', () => {
  expect(() =>
    parseConversationRows(
      [
        {
          id: conversationId,
          account_id: OTHER_BRANCH_ID,
          contact_id: CONTACT_ID,
        },
      ],
      accountId
    )
  ).toThrow('Invalid conversation row');
});

it('normalizes membership presence and nullable previews', () => {
  const rows = parseConversationRows(
    [
      {
        id: conversationId,
        account_id: accountId,
        contact_id: CONTACT_ID,
        status: 'open',
        assigned_agent_id: null,
        last_message_text: null,
        last_message_at: null,
        unread_count: 0,
        created_at: '2026-09-01T08:00:00.000Z',
        updated_at: '2026-09-01T08:00:00.000Z',
        contact: {
          id: CONTACT_ID,
          name: 'Asha Rao',
          phone: '9876543210',
          avatar_url: null,
          memberships: [{ id: 'membership-1' }],
        },
      },
    ],
    accountId
  );
  expect(rows[0]).toMatchObject({ isMember: true, lastMessageText: null });
});

it('rejects a message belonging to another conversation', () => {
  expect(() =>
    parseMessageRows(
      [{ id: MESSAGE_1_ID, conversation_id: OTHER_CONVERSATION_ID }],
      conversationId
    )
  ).toThrow('Invalid message row');
});

it('groups sender runs only inside the ten-minute window', () => {
  const previous = {
    senderType: 'customer',
    createdAt: '2026-09-01T08:00:00.000Z',
  } as const;
  expect(
    startsNewRun(previous, {
      senderType: 'customer',
      createdAt: '2026-09-01T08:09:59.000Z',
    })
  ).toBe(false);
  expect(
    startsNewRun(previous, {
      senderType: 'agent',
      createdAt: '2026-09-01T08:01:00.000Z',
    })
  ).toBe(true);
});

it('allows only HTTPS media and names unsupported content honestly', () => {
  expect(safeMediaUrl('https://cdn.example.com/a.jpg')).toBe(
    'https://cdn.example.com/a.jpg'
  );
  expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
  expect(messagePreview({ contentType: 'document', contentText: null })).toBe(
    'Document'
  );
});

it('inserts localized date separators and restarts sender runs by day', () => {
  const items = buildThreadItems(
    [
      message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T23:59:00.000Z' }),
      message({ id: MESSAGE_2_ID, createdAt: '2026-09-02T00:01:00.000Z' }),
    ],
    (value) => (value.startsWith('2026-09-01') ? '1 Sept 2026' : '2 Sept 2026')
  );
  expect(items.map((item) => item.kind)).toEqual([
    'date',
    'message',
    'date',
    'message',
  ]);
  expect(items[3]).toMatchObject({ kind: 'message', startsRun: true });
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/inbox-normalizers.test.ts src/features/inbox/inbox-format.test.ts
```

Expected: FAIL because the domain files do not exist.

- [ ] **Step 3: Add exact domain contracts and total runtime parsers**

```ts
export type ConversationStatus = 'open' | 'pending' | 'closed';
export type SenderType = 'customer' | 'agent' | 'bot';
export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  | 'interactive';
export type MessageStatus =
  'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface InboxContact {
  id: string;
  name: string | null;
  phone: string;
  avatarUrl: string | null;
}

export interface InboxConversation {
  id: string;
  accountId: string;
  contactId: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  contact: InboxContact;
  isMember: boolean;
}

export interface InboxMessage {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string | null;
  contentType: ContentType;
  contentText: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  providerMessageId: string | null;
  status: MessageStatus;
  providerErrorTitle: string | null;
  createdAt: string;
  replyToMessageId: string | null;
  interactiveReplyId: string | null;
}

export type ConversationCursor =
  | { phase: 'messaged'; lastMessageAt: string; id: string }
  | { phase: 'empty'; createdAt: string; id: string };
export interface MessageCursor {
  createdAt: string;
  id: string;
}
export interface Page<T, C> {
  items: T[];
  nextCursor: C | null;
}
export type ConversationFilter = 'all' | 'unread';
export type ThreadDisplayItem =
  | { kind: 'date'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      message: InboxMessage;
      startsRun: boolean;
    };
```

Implement parsers with explicit `typeof`, UUID, enum, finite-number, ISO timestamp,
embedded-contact, membership-array, selected-account, and selected-conversation
checks. Throw only fixed messages (`Invalid conversation row` and
`Invalid message row`); never stringify the rejected payload.

Implement the presentation helpers:

```ts
export const RUN_BREAK_MS = 10 * 60 * 1000;

export function startsNewRun(
  previous: Pick<InboxMessage, 'senderType' | 'createdAt'> | null,
  current: Pick<InboxMessage, 'senderType' | 'createdAt'>
): boolean {
  if (!previous || previous.senderType !== current.senderType) return true;
  return (
    new Date(current.createdAt).getTime() -
      new Date(previous.createdAt).getTime() >
    RUN_BREAK_MS
  );
}

export function safeMediaUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildThreadItems(
  messages: InboxMessage[],
  formatDate: (value: string) => string
): ThreadDisplayItem[] {
  const items: ThreadDisplayItem[] = [];
  let previous: InboxMessage | null = null;
  let previousDate: string | null = null;
  for (const current of messages) {
    const date = formatDate(current.createdAt);
    const beginsDate = date !== previousDate;
    if (beginsDate) {
      items.push({ kind: 'date', key: `date:${date}`, label: date });
    }
    items.push({
      kind: 'message',
      key: current.id,
      message: current,
      startsRun: beginsDate || startsNewRun(previous, current),
    });
    previous = current;
    previousDate = date;
  }
  return items;
}

export function messagePreview(
  message: Pick<InboxMessage, 'contentType' | 'contentText'>
): string {
  if (message.contentText?.trim()) return message.contentText.trim();
  const labels: Record<ContentType, string> = {
    text: 'Message',
    image: 'Photo',
    document: 'Document',
    audio: 'Audio',
    video: 'Video',
    location: 'Location',
    template: 'Template message',
    interactive: 'Button reply',
  };
  return labels[message.contentType];
}
```

- [ ] **Step 4: Run domain tests and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/inbox-normalizers.test.ts src/features/inbox/inbox-format.test.ts
npm run mobile:typecheck
```

Expected: both suites and typecheck pass.

- [ ] **Step 5: Commit the Inbox domain**

```bash
git add apps/mobile/src/features/inbox/inbox-types.ts apps/mobile/src/features/inbox/inbox-normalizers.ts apps/mobile/src/features/inbox/inbox-normalizers.test.ts apps/mobile/src/features/inbox/inbox-format.ts apps/mobile/src/features/inbox/inbox-format.test.ts apps/mobile/src/features/inbox/inbox-test-fixtures.ts
git commit -m "feat: define mobile inbox domain"
```

---

### Task 3: Add the approved native UI masters

**Files:**

- Create: `apps/mobile/src/ui/search-field.tsx`
- Create: `apps/mobile/src/ui/search-field.test.tsx`
- Create: `apps/mobile/src/ui/filter-chip-group.tsx`
- Create: `apps/mobile/src/ui/filter-chip-group.test.tsx`
- Create: `apps/mobile/src/ui/user-avatar.tsx`
- Create: `apps/mobile/src/ui/user-avatar.test.tsx`
- Create: `apps/mobile/src/ui/async-state.tsx`
- Create: `apps/mobile/src/ui/async-state.test.tsx`
- Modify: `apps/mobile/src/ui/index.ts`

**Interfaces:**

- Produces: `SearchField`, `FilterChipGroup<T>`, `UserAvatar`, `LoadingState`, `EmptyState`, and `ErrorState`.
- Consumed by: Inbox and conversation screens.

- [ ] **Step 1: Write failing master-component tests**

Test these exact contracts with small HeroUI mocks:

```tsx
it('clears a controlled search and returns the empty value', () => {
  const onValueChange = jest.fn();
  render(
    <SearchField
      accessibilityLabel="Search conversations"
      value="Asha"
      onValueChange={onValueChange}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(onValueChange).toHaveBeenCalledWith('');
});

it('announces one selected filter and its unread count', () => {
  const onValueChange = jest.fn();
  render(
    <FilterChipGroup
      accessibilityLabel="Conversation filters"
      options={[
        { label: 'All', value: 'all' },
        { label: 'Unread', value: 'unread', count: 3 },
      ]}
      value="all"
      onValueChange={onValueChange}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Unread, 3' }));
  expect(onValueChange).toHaveBeenCalledWith('unread');
});

it('uses a first-initial fallback with an honest avatar label', () => {
  render(<UserAvatar name="Asha Rao" source={null} size="lg" />);
  expect(screen.getByLabelText('Asha Rao')).toBeTruthy();
  expect(screen.getByText('A')).toBeTruthy();
});

it('exposes recoverable errors as alerts with one retry', () => {
  const retry = jest.fn();
  render(
    <ErrorState
      title="Could not load conversations"
      message="Check your connection and try again."
      onRetry={retry}
    />
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run master tests and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/ui/search-field.test.tsx src/ui/filter-chip-group.test.tsx src/ui/user-avatar.test.tsx src/ui/async-state.test.tsx
```

Expected: FAIL because the master files do not exist.

- [ ] **Step 3: Implement thin UsefulDesk wrappers over HeroUI Native**

Use these public prop contracts:

```ts
export interface SearchFieldProps {
  accessibilityLabel: string;
  value: string;
  onValueChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
}

export interface FilterChipOption<T extends string> {
  label: string;
  value: T;
  count?: number;
}

export interface FilterChipGroupProps<T extends string> {
  accessibilityLabel: string;
  options: readonly FilterChipOption<T>[];
  value: T;
  onValueChange(value: T): void;
}

export interface UserAvatarProps {
  name: string;
  source: string | null;
  size?: 'sm' | 'md' | 'lg';
}
```

Compose HeroUI `SearchField` with `SearchIcon`, `Input`, and `ClearButton`;
set the clear button's accessible name to `Clear search`. Compose each HeroUI
`Chip` as a button with `accessibilityState.selected`; selected uses
`variant="primary"`, unselected uses `variant="tertiary"`, and the group is one
horizontal `ScrollView`. Compose HeroUI `Avatar.Image` only for a safe HTTPS
source and always include `Avatar.Fallback`. Compose HeroUI `Spinner` and
`Alert` for the async states; `ErrorState` uses the existing UsefulDesk Button
for Retry.

Do not expose HeroUI class overrides in the public props. Feature callers may
control only surrounding layout.

- [ ] **Step 4: Export the masters and verify GREEN**

```ts
export {
  AsyncState,
  EmptyState,
  ErrorState,
  LoadingState,
} from './async-state';
export { FilterChipGroup } from './filter-chip-group';
export { SearchField } from './search-field';
export { UserAvatar } from './user-avatar';
```

Run:

```bash
npm run mobile:test -- --runTestsByPath src/ui/search-field.test.tsx src/ui/filter-chip-group.test.tsx src/ui/user-avatar.test.tsx src/ui/async-state.test.tsx
npm run mobile:typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 5: Commit the native masters**

```bash
git add apps/mobile/src/ui
git commit -m "feat: add native inbox ui masters"
```

---

### Task 4: Implement branch-scoped conversation pagination and search

**Files:**

- Create: `apps/mobile/src/features/inbox/conversation-repository.ts`
- Create: `apps/mobile/src/features/inbox/conversation-repository.test.ts`

**Interfaces:**

- Consumes: `InboxConversation`, `ConversationCursor`, `ConversationFilter`, `Page`, `parseConversationRows`, `mobileSupabase`, and `selectedBranchRef`.
- Produces: `ConversationRepository` and `mobileConversationRepository`.

- [ ] **Step 1: Write failing repository contract tests**

Use a query-source fake rather than asserting internal Supabase builder calls:

```ts
const source: ConversationQuerySource = {
  listMessaged: jest.fn(),
  listEmpty: jest.fn(),
  findContactIds: jest.fn(),
  countUnread: jest.fn(),
  findById: jest.fn(),
  clearUnread: jest.fn(),
};

it('never returns a row outside the selected branch', async () => {
  source.listMessaged = jest
    .fn()
    .mockResolvedValue([rawConversation({ account_id: OTHER_BRANCH_ID })]);
  const repository = createConversationRepository(source);
  await expect(
    repository.list({
      accountId: BRANCH_ID,
      filter: 'all',
      search: '',
      cursor: null,
      limit: 20,
    })
  ).rejects.toThrow('Could not load conversations');
});

it('moves from non-null last-message pagination into empty conversations', async () => {
  source.listMessaged = jest
    .fn()
    .mockResolvedValue([
      rawConversation({ last_message_at: '2026-09-01T08:00:00.000Z' }),
    ]);
  source.listEmpty = jest.fn().mockResolvedValue([
    rawConversation({
      id: EMPTY_CONVERSATION_ID,
      last_message_at: null,
    }),
    rawConversation({
      id: '00cdd031-972a-4038-8178-029e6470f722',
      last_message_at: null,
      created_at: '2026-08-31T08:00:00.000Z',
    }),
  ]);
  const page = await createConversationRepository(source).list({
    accountId: BRANCH_ID,
    filter: 'all',
    search: '',
    cursor: null,
    limit: 2,
  });
  expect(page.items.map((item) => item.id)).toEqual([
    CONVERSATION_ID,
    EMPTY_CONVERSATION_ID,
  ]);
  expect(page.nextCursor).toEqual({
    phase: 'empty',
    createdAt: '2026-09-01T08:00:00.000Z',
    id: EMPTY_CONVERSATION_ID,
  });
});

it('sanitizes PostgREST grammar before searching the branch', async () => {
  source.findContactIds = jest.fn().mockResolvedValue([]);
  await createConversationRepository(source).list({
    accountId: BRANCH_ID,
    filter: 'all',
    search: 'Asha,or(id.eq.secret)',
    cursor: null,
    limit: 20,
  });
  expect(source.findContactIds).toHaveBeenCalledWith(
    BRANCH_ID,
    'Asha or id eq secret'
  );
});

it('treats zero returned rows as a failed unread mutation', async () => {
  source.clearUnread = jest.fn().mockResolvedValue([]);
  await expect(
    createConversationRepository(source).markRead(BRANCH_ID, CONVERSATION_ID)
  ).rejects.toThrow('Could not mark this conversation as read');
});

it('returns the exact selected-branch unread count', async () => {
  source.countUnread = jest.fn().mockResolvedValue(7);
  await expect(
    createConversationRepository(source).unreadCount(BRANCH_ID)
  ).resolves.toBe(7);
  expect(source.countUnread).toHaveBeenCalledWith(BRANCH_ID);
});

it('rejects realtime hydration when the row is not in the selected branch', async () => {
  source.findById = jest
    .fn()
    .mockResolvedValue(rawConversation({ account_id: OTHER_BRANCH_ID }));
  await expect(
    createConversationRepository(source).get(BRANCH_ID, CONVERSATION_ID)
  ).rejects.toThrow('Conversation is unavailable');
});
```

- [ ] **Step 2: Run the repository suite and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/conversation-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the repository boundary and safe query source**

```ts
export const CONVERSATION_PAGE_SIZE = 30;

export interface ListConversationsInput {
  accountId: string;
  filter: ConversationFilter;
  search: string;
  cursor: ConversationCursor | null;
  limit?: number;
}

export interface ConversationRepository {
  list(
    input: ListConversationsInput
  ): Promise<Page<InboxConversation, ConversationCursor>>;
  unreadCount(accountId: string): Promise<number>;
  get(accountId: string, conversationId: string): Promise<InboxConversation>;
  markRead(accountId: string, conversationId: string): Promise<void>;
}

export interface ConversationPhaseQuery {
  accountId: string;
  filter: ConversationFilter;
  contactIds: string[];
  previewTerm: string | null;
  cursor: ConversationCursor | null;
  limit: number;
}

export interface ConversationQuerySource {
  listMessaged(input: ConversationPhaseQuery): Promise<unknown[]>;
  listEmpty(input: ConversationPhaseQuery): Promise<unknown[]>;
  findContactIds(accountId: string, term: string): Promise<string[]>;
  countUnread(accountId: string): Promise<number>;
  findById(accountId: string, conversationId: string): Promise<unknown | null>;
  clearUnread(accountId: string, conversationId: string): Promise<unknown[]>;
}

export function createConversationRepository(
  source: ConversationQuerySource
): ConversationRepository;

export function normalizeConversationSearch(value: string): string {
  return value
    .trim()
    .replace(/[,%.()"\\*_:|&]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}
```

The production `SupabaseConversationQuerySource` must apply
`.eq('account_id', accountId)` to contacts and conversations, `.gt('unread_count', 0)`
for the Unread slice, and the normalized search term to contact name/phone plus
conversation preview. `findContactIds` queries only selected-branch contacts
with `.or('name.ilike.<escaped>,phone.ilike.<escaped>')`; phase queries then
use `.or('last_message_text.ilike.<escaped>,contact_id.in.(<validated UUIDs>)')`.
If no contact id matches, query preview only. Never interpolate the raw term.

Before every production source call, require
`selectedBranchRef.get() === accountId`; a mismatch fails closed with the
operation's fixed repository error before Supabase is called. The explicit
query predicate and the branch header therefore name the same branch, while
RLS remains authoritative.

Use a two-phase cursor so nullable `last_message_at`
never breaks keyset ordering:

1. `last_message_at IS NOT NULL`, ordered by `last_message_at DESC, id DESC`.
2. `last_message_at IS NULL`, ordered by `created_at DESC, id DESC`.

Fetch `limit + 1` rows within the active phase to determine `nextCursor`.
When the messaged phase has fewer than the requested limit, fill the remainder
from the empty phase. The cursor is the last **returned** visible item whenever
the source supplied a lookahead row; it is null only when no later row/phase
exists. The selected columns are:

```ts
const CONVERSATION_SELECT = `
  id,
  account_id,
  contact_id,
  status,
  assigned_agent_id,
  last_message_text,
  last_message_at,
  unread_count,
  created_at,
  updated_at,
  contact:contacts!inner(
    id,
    name,
    phone,
    avatar_url,
    memberships(id)
  )
`;
```

Wrap all data-source failures in fixed safe messages. `markRead` executes
`update({ unread_count: 0 }).eq('account_id', accountId).eq('id', conversationId).select('id')`
and requires exactly one returned id. `unreadCount` executes the exact head
count below and treats an error or null count as `Could not load conversations`:

```ts
mobileSupabase
  .from('conversations')
  .select('id', { count: 'exact', head: true })
  .eq('account_id', accountId)
  .gt('unread_count', 0);
```

- [ ] **Step 4: Run repository and type tests and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/conversation-repository.test.ts
npm run mobile:typecheck
```

Expected: repository suite and typecheck pass.

- [ ] **Step 5: Commit the conversation repository**

```bash
git add apps/mobile/src/features/inbox/conversation-repository.ts apps/mobile/src/features/inbox/conversation-repository.test.ts
git commit -m "feat: add mobile conversation repository"
```

---

### Task 5: Implement verified message-history pagination

**Files:**

- Create: `apps/mobile/src/features/inbox/message-repository.ts`
- Create: `apps/mobile/src/features/inbox/message-repository.test.ts`

**Interfaces:**

- Consumes: `InboxMessage`, `MessageCursor`, `Page`, `parseMessageRows`, `mobileSupabase`, and `selectedBranchRef`.
- Produces: `MessageRepository` and `mobileMessageRepository`.

- [ ] **Step 1: Write failing branch-verification and keyset tests**

```ts
it('verifies the conversation in the selected branch before reading messages', async () => {
  const source: MessageQuerySource = {
    conversationExists: jest.fn().mockResolvedValue(false),
    listMessages: jest.fn(),
    findMessage: jest.fn(),
  };
  await expect(
    createMessageRepository(source).list({
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      cursor: null,
      limit: 40,
    })
  ).rejects.toThrow('Conversation is unavailable');
  expect(source.listMessages).not.toHaveBeenCalled();
});

it('returns chronological items and a cursor for the next older page', async () => {
  const source: MessageQuerySource = {
    conversationExists: jest.fn().mockResolvedValue(true),
    listMessages: jest.fn().mockResolvedValue([
      rawMessage({
        id: MESSAGE_3_ID,
        created_at: '2026-09-01T08:03:00.000Z',
      }),
      rawMessage({
        id: MESSAGE_2_ID,
        created_at: '2026-09-01T08:02:00.000Z',
      }),
      rawMessage({
        id: MESSAGE_1_ID,
        created_at: '2026-09-01T08:01:00.000Z',
      }),
    ]),
    findMessage: jest.fn(),
  };
  const page = await createMessageRepository(source).list({
    accountId: BRANCH_ID,
    conversationId: CONVERSATION_ID,
    cursor: null,
    limit: 2,
  });
  expect(page.items.map((item) => item.id)).toEqual([
    MESSAGE_2_ID,
    MESSAGE_3_ID,
  ]);
  expect(page.nextCursor).toEqual({
    createdAt: '2026-09-01T08:02:00.000Z',
    id: MESSAGE_2_ID,
  });
});

it('hydrates one realtime message only after selected-branch proof', async () => {
  const source: MessageQuerySource = {
    conversationExists: jest.fn().mockResolvedValue(true),
    listMessages: jest.fn(),
    findMessage: jest.fn().mockResolvedValue(rawMessage()),
  };
  await expect(
    createMessageRepository(source).get(
      BRANCH_ID,
      CONVERSATION_ID,
      MESSAGE_1_ID
    )
  ).resolves.toMatchObject({ id: MESSAGE_1_ID });
  expect(source.findMessage).toHaveBeenCalledWith({
    accountId: BRANCH_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_1_ID,
  });
});
```

- [ ] **Step 2: Run the message repository test and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/message-repository.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the repository with selected-branch proof**

```ts
export const MESSAGE_PAGE_SIZE = 40;

export interface ListMessagesInput {
  accountId: string;
  conversationId: string;
  cursor: MessageCursor | null;
  limit?: number;
}

export interface MessageRepository {
  list(input: ListMessagesInput): Promise<Page<InboxMessage, MessageCursor>>;
  get(
    accountId: string,
    conversationId: string,
    messageId: string
  ): Promise<InboxMessage>;
}

export interface MessageQuerySource {
  conversationExists(
    accountId: string,
    conversationId: string
  ): Promise<boolean>;
  listMessages(input: {
    accountId: string;
    conversationId: string;
    cursor: MessageCursor | null;
    limit: number;
  }): Promise<unknown[]>;
  findMessage(input: {
    accountId: string;
    conversationId: string;
    messageId: string;
  }): Promise<unknown | null>;
}

export function createMessageRepository(
  source: MessageQuerySource
): MessageRepository;
```

The production source first runs:

```ts
mobileSupabase
  .from('conversations')
  .select('id')
  .eq('account_id', accountId)
  .eq('id', conversationId)
  .maybeSingle();
```

Require `selectedBranchRef.get() === accountId` before every source call;
otherwise return `Conversation is unavailable` without querying Supabase.

Only after a row is returned may it run the message query. Select the exact
database columns below (`message_id` normalizes to `providerMessageId`), filter
by `conversation_id`, order by
`created_at DESC, id DESC`, apply the older-than cursor, and fetch `limit + 1`.
Normalize then reverse the page into chronological order. Errors use only
`Conversation is unavailable` or `Could not load messages`.
`get` repeats conversation proof, selects `MESSAGE_SELECT` by both
`conversation_id` and message `id`, parses exactly one row, and returns
`Message is unavailable` for a missing/mismatched row.

```ts
const MESSAGE_SELECT = `
  id,
  conversation_id,
  sender_type,
  sender_id,
  content_type,
  content_text,
  media_url,
  template_name,
  message_id,
  status,
  provider_error_title,
  created_at,
  reply_to_message_id,
  interactive_reply_id
`;
```

- [ ] **Step 4: Run the focused suite and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/message-repository.test.ts
npm run mobile:typecheck
```

Expected: focused suite and typecheck pass.

- [ ] **Step 5: Commit the message repository**

```bash
git add apps/mobile/src/features/inbox/message-repository.ts apps/mobile/src/features/inbox/message-repository.test.ts
git commit -m "feat: add mobile message repository"
```

---

### Task 6: Add private account Broadcast and a branch-lifetime adapter

**Files:**

- Create: `apps/mobile/src/features/inbox/inbox-realtime.ts`
- Create: `apps/mobile/src/features/inbox/inbox-realtime.test.ts`
- Create: `apps/mobile/src/features/inbox/inbox-realtime-provider.tsx`
- Create: `apps/mobile/src/features/inbox/inbox-realtime-provider.test.tsx`
- Create: `supabase/migrations/20260901090000_mobile_inbox_private_broadcast.sql`
- Create: `src/lib/mobile-inbox-realtime-contract.test.ts`

**Interfaces:**

- Consumes: Supabase private Broadcast, selected account id, account memberships, and the authenticated `mobileSupabase` singleton.
- Produces: `subscribeToInboxRealtime(options): Promise<() => Promise<void>>`, `InboxRealtimeEvent`, `InboxConnectionState`, `InboxRealtimeProvider`, and `useInboxRealtimeFeed`.

- [ ] **Step 1: Write failing subscription and cleanup tests**

Define a minimal fake beside the tests so the contract does not depend on
Supabase's internal channel implementation:

```ts
function fakeRealtimeClient() {
  let statusHandler: ((status: string) => void) | null = null;
  let payloadHandler: ((payload: unknown) => void) | null = null;
  const channel = {
    on: jest.fn(
      (
        _kind: 'broadcast',
        _registration: { event: 'inbox_change' },
        callback: (payload: unknown) => void
      ) => {
        payloadHandler = callback;
        return channel;
      }
    ),
    subscribe: jest.fn((handler: (status: string) => void) => {
      statusHandler = handler;
      return channel;
    }),
  };
  return {
    broadcastOn: channel.on,
    realtime: { setAuth: jest.fn().mockResolvedValue(undefined) },
    channel: jest.fn(() => channel),
    removeChannel: jest.fn().mockResolvedValue('ok'),
    emitStatus(status: string) {
      statusHandler?.(status);
    },
    emit(payload: unknown) {
      payloadHandler?.(payload);
    },
  };
}

function fakeAppStateSource(): InboxAppStateSource & {
  emit(state: AppStateStatus): void;
} {
  let callback: ((state: AppStateStatus) => void) | null = null;
  return {
    currentState: 'active',
    addEventListener: jest.fn((_event, next) => {
      callback = next;
      return { remove: jest.fn(() => (callback = null)) };
    }),
    emit(state) {
      callback?.(state);
    },
  };
}
```

```ts
it('joins one private account topic and accepts only identifier events', async () => {
  const client = fakeRealtimeClient();
  const onEvent = jest.fn();
  await subscribeToInboxRealtime({
    client,
    accountId: BRANCH_ID,
    onEvent,
    onConnectionChange: jest.fn(),
  });
  expect(client.channel).toHaveBeenCalledWith(`account:${BRANCH_ID}`, {
    config: { private: true },
  });
  expect(client.broadcastOn).toHaveBeenCalledWith(
    'broadcast',
    { event: 'inbox_change' },
    expect.any(Function)
  );
  client.emit({
    payload: {
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    },
  });
  expect(onEvent).toHaveBeenCalledWith({
    table: 'messages',
    eventType: 'INSERT',
    accountId: BRANCH_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_1_ID,
  });
  client.emit({
    payload: {
      table: 'messages',
      eventType: 'INSERT',
      accountId: OTHER_BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    },
  });
  expect(onEvent).toHaveBeenCalledTimes(1);
});

it('maps channel errors to disconnected and removes the channel once', async () => {
  const client = fakeRealtimeClient();
  const onConnectionChange = jest.fn();
  const unsubscribe = await subscribeToInboxRealtime({
    client,
    accountId: BRANCH_ID,
    onEvent: jest.fn(),
    onConnectionChange,
  });
  client.emitStatus('CHANNEL_ERROR');
  expect(onConnectionChange).toHaveBeenLastCalledWith('disconnected');
  await unsubscribe();
  await unsubscribe();
  expect(client.removeChannel).toHaveBeenCalledTimes(1);
});

it('owns one channel per branch and emits one shared resync generation', async () => {
  const cleanup = jest.fn().mockResolvedValue(undefined);
  const connectionCallback: {
    current: ((state: InboxConnectionState) => void) | null;
  } = { current: null };
  const subscribe = jest.fn(async (options: SubscribeInboxRealtimeOptions) => {
    connectionCallback.current = options.onConnectionChange;
    return cleanup;
  });
  const appState = fakeAppStateSource();
  const observed: { current: InboxRealtimeFeed | null } = { current: null };
  const Probe = () => {
    observed.current = useInboxRealtimeFeed();
    return null;
  };
  const { rerender, unmount } = render(
    <InboxRealtimeProvider
      accountId={BRANCH_ID}
      appState={appState}
      subscribe={subscribe}
    >
      <Probe />
    </InboxRealtimeProvider>
  );
  await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
  act(() => connectionCallback.current?.('disconnected'));
  act(() => connectionCallback.current?.('connected'));
  await waitFor(() =>
    expect(observed.current?.getSnapshot().resyncGeneration).toBe(1)
  );
  act(() => appState.emit('background'));
  act(() => appState.emit('active'));
  await waitFor(() =>
    expect(observed.current?.getSnapshot().resyncGeneration).toBe(2)
  );
  rerender(
    <InboxRealtimeProvider
      accountId={OTHER_BRANCH_ID}
      appState={appState}
      subscribe={subscribe}
    >
      <Probe />
    </InboxRealtimeProvider>
  );
  await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  unmount();
  await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
});
```

Add the root migration contract test:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260901090000_mobile_inbox_private_broadcast.sql'
  ),
  'utf8'
);

it('authorizes private account topics through real membership', () => {
  expect(migration).toContain('ON realtime.messages');
  expect(migration).toContain('FOR SELECT');
  expect(migration).toContain("realtime.messages.extension = 'broadcast'");
  expect(migration).toContain('private.can_receive_mobile_inbox_topic(');
  expect(migration).toContain("'account:' || membership.account_id::text");
  expect(migration).toContain('membership.user_id = (SELECT auth.uid())');
});

it('broadcasts identifiers from both Inbox tables without message content', () => {
  expect(migration).toContain('PERFORM realtime.send(');
  expect(migration).toContain("'conversationId'");
  expect(migration).toContain("'messageId'");
  expect(migration).toContain('ON public.conversations');
  expect(migration).toContain('ON public.messages');
  expect(migration).not.toContain("'contentText'");
  expect(migration).not.toContain("'content_text'");
  expect(migration).not.toContain("'media_url'");
});
```

- [ ] **Step 2: Run the realtime adapter suite and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/inbox-realtime.test.ts src/features/inbox/inbox-realtime-provider.test.tsx
npm test -- src/lib/mobile-inbox-realtime-contract.test.ts
```

Expected: FAIL because the adapter, provider, migration, and schema-contract
test target do not exist.

- [ ] **Step 3: Implement one authenticated channel with explicit status mapping**

```ts
export type InboxConnectionState = 'connecting' | 'connected' | 'disconnected';

export type InboxRealtimeEvent =
  | {
      table: 'conversations';
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      accountId: string;
      conversationId: string;
      messageId: null;
    }
  | {
      table: 'messages';
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      accountId: string;
      conversationId: string;
      messageId: string;
    };

export interface InboxRealtimeChannel {
  on(
    kind: 'broadcast',
    registration: { event: 'inbox_change' },
    callback: (payload: unknown) => void
  ): InboxRealtimeChannel;
  subscribe(callback: (status: string) => void): InboxRealtimeChannel;
}

export interface InboxRealtimeClient {
  realtime: { setAuth(): Promise<void> };
  channel(
    name: string,
    options: { config: { private: true } }
  ): InboxRealtimeChannel;
  removeChannel(channel: InboxRealtimeChannel): Promise<unknown>;
}

export interface SubscribeInboxRealtimeOptions {
  client?: InboxRealtimeClient;
  accountId: string;
  onEvent(event: InboxRealtimeEvent): void;
  onConnectionChange(state: InboxConnectionState): void;
}

export function subscribeToInboxRealtime(
  options: SubscribeInboxRealtimeOptions
): Promise<() => Promise<void>>;

export interface InboxRealtimeFeed {
  getSnapshot(): {
    connection: InboxConnectionState;
    resyncGeneration: number;
  };
  listen(listener: (event: InboxRealtimeEvent) => void): () => void;
  listenStatus(
    listener: (snapshot: {
      connection: InboxConnectionState;
      resyncGeneration: number;
    }) => void
  ): () => void;
}

export interface InboxAppStateSource {
  currentState: AppStateStatus;
  addEventListener(
    event: 'change',
    callback: (state: AppStateStatus) => void
  ): { remove(): void };
}

export interface InboxRealtimeProviderProps {
  accountId: string;
  children: React.ReactNode;
  appState?: InboxAppStateSource;
  subscribe?: typeof subscribeToInboxRealtime;
}

export function InboxRealtimeProvider(
  props: InboxRealtimeProviderProps
): React.JSX.Element;

export function useInboxRealtimeFeed(): InboxRealtimeFeed;
```

Create the idempotent migration with this exact security shape:

```sql
CREATE OR REPLACE FUNCTION private.can_receive_mobile_inbox_topic(
  target_topic text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND target_topic = 'account:' || membership.account_id::text
  );
$$;

REVOKE ALL ON FUNCTION private.can_receive_mobile_inbox_topic(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_receive_mobile_inbox_topic(text) FROM anon;
GRANT EXECUTE ON FUNCTION private.can_receive_mobile_inbox_topic(text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS mobile_inbox_broadcast_select ON realtime.messages;
CREATE POLICY mobile_inbox_broadcast_select
ON realtime.messages FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND private.can_receive_mobile_inbox_topic((SELECT realtime.topic()))
);

CREATE OR REPLACE FUNCTION private.broadcast_mobile_inbox_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, realtime
AS $$
DECLARE
  row_data jsonb;
  target_account_id uuid;
  target_conversation_id uuid;
  target_message_id uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'conversations' THEN
    target_account_id := (row_data->>'account_id')::uuid;
    target_conversation_id := (row_data->>'id')::uuid;
    target_message_id := NULL;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    target_conversation_id := (row_data->>'conversation_id')::uuid;
    target_message_id := (row_data->>'id')::uuid;
    SELECT conversation.account_id
      INTO target_account_id
      FROM public.conversations AS conversation
      WHERE conversation.id = target_conversation_id;
  ELSE
    RAISE EXCEPTION 'Unsupported mobile Inbox broadcast table';
  END IF;

  IF target_account_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'eventType', TG_OP,
        'accountId', target_account_id,
        'conversationId', target_conversation_id,
        'messageId', target_message_id
      ),
      'inbox_change',
      'account:' || target_account_id::text,
      true
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.broadcast_mobile_inbox_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.broadcast_mobile_inbox_change() FROM anon;
REVOKE ALL ON FUNCTION private.broadcast_mobile_inbox_change() FROM authenticated;

DROP TRIGGER IF EXISTS broadcast_mobile_conversation_change ON public.conversations;
CREATE TRIGGER broadcast_mobile_conversation_change
AFTER INSERT OR UPDATE OR DELETE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();

DROP TRIGGER IF EXISTS broadcast_mobile_message_change ON public.messages;
CREATE TRIGGER broadcast_mobile_message_change
AFTER INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();

DROP TRIGGER IF EXISTS broadcast_mobile_message_delete ON public.messages;
CREATE TRIGGER broadcast_mobile_message_delete
BEFORE DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();
```

The message DELETE trigger is deliberately `BEFORE DELETE`, so its parent
conversation still supplies the account topic during direct or cascading
deletion. The payload contains identifiers only. Apply this migration through
the approved Supabase migration tool—never `supabase db push`—then verify the
policy, function, and three triggers in the remote schema. If no approved
migration tool is available at execution time, stop Task 6 and report that
blocker rather than substituting another deployment path.

Before subscribing, call `await client.realtime.setAuth()` so the current
Supabase session is used for private-channel authorization. Join only
`account:${accountId}` with `{ config: { private: true } }` and one Broadcast
handler for `inbox_change`. Validate the payload envelope, exact table/event,
UUID account/conversation/message ids, equality to selected `accountId`, and
the required null/non-null message id before calling `onEvent`. Invalid payloads
are ignored. Map `SUBSCRIBED` to connected and `CHANNEL_ERROR`, `TIMED_OUT`, or
`CLOSED` to disconnected, and return an idempotent cleanup that awaits
`client.removeChannel(channel)`.

Never log payloads or status error objects. The caller receives only the fixed
connection enum.

`InboxRealtimeProvider` owns event/status listener sets, calls the raw adapter
exactly once per `accountId`, and exposes a feed whose identity is stable only
for that account. Children therefore resubscribe when the account prop changes.
It increments
`resyncGeneration` only after a disconnected-to-connected transition (not the
initial SUBSCRIBED) or a background/inactive-to-active AppState transition.
On branch change or unmount it awaits channel cleanup, removes AppState, clears
the listener Set, resets connection/generation, and ignores late callbacks via
a generation guard. `useInboxRealtimeFeed` throws a fixed developer error when
used outside the provider.

- [ ] **Step 4: Run the realtime suite and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/inbox-realtime.test.ts src/features/inbox/inbox-realtime-provider.test.tsx
npm run mobile:typecheck
npm test -- src/lib/mobile-inbox-realtime-contract.test.ts
```

Expected: suite and typecheck pass.

- [ ] **Step 5: Commit the realtime adapter**

```bash
git add apps/mobile/src/features/inbox/inbox-realtime.ts apps/mobile/src/features/inbox/inbox-realtime.test.ts apps/mobile/src/features/inbox/inbox-realtime-provider.tsx apps/mobile/src/features/inbox/inbox-realtime-provider.test.tsx supabase/migrations/20260901090000_mobile_inbox_private_broadcast.sql src/lib/mobile-inbox-realtime-contract.test.ts
git commit -m "feat: add mobile inbox realtime adapter"
```

---

### Task 7: Build the conversation-list state hook

**Files:**

- Create: `apps/mobile/src/features/inbox/use-conversation-list.ts`
- Create: `apps/mobile/src/features/inbox/use-conversation-list.test.tsx`

**Interfaces:**

- Consumes: `ConversationRepository`, the shared `InboxRealtimeFeed`, account id, and filter/search events.
- Produces: `UseConversationListResult` for the Inbox screen.

- [ ] **Step 1: Write failing hook tests for initial load, stale work, realtime, and resync**

Use this dependency fake in the test file; it represents the provider's local
feed and never creates a Supabase channel:

```tsx
type ConversationPage = Page<InboxConversation, ConversationCursor>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeRealtimeFeed(): InboxRealtimeFeed & {
  eventCleanup: jest.Mock;
  statusCleanup: jest.Mock;
  emit(event: InboxRealtimeEvent): Promise<void>;
  emitStatus(
    connection: InboxConnectionState,
    resyncGeneration: number
  ): Promise<void>;
} {
  const eventListeners = new Set<(event: InboxRealtimeEvent) => void>();
  const statusListeners = new Set<
    (snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']>) => void
  >();
  let snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']> = {
    connection: 'connected',
    resyncGeneration: 0,
  };
  const eventCleanup = jest.fn();
  const statusCleanup = jest.fn();
  return {
    eventCleanup,
    statusCleanup,
    getSnapshot: () => snapshot,
    listen(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
        eventCleanup();
      };
    },
    listenStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
        statusCleanup();
      };
    },
    async emit(event) {
      eventListeners.forEach((listener) => listener(event));
      await Promise.resolve();
    },
    async emitStatus(connection, resyncGeneration) {
      snapshot = { connection, resyncGeneration };
      statusListeners.forEach((listener) => listener(snapshot));
      await Promise.resolve();
    },
  };
}

const BRANCH_A = BRANCH_ID;
const BRANCH_B = OTHER_BRANCH_ID;
const conversationA = conversation({ accountId: BRANCH_A });
const conversationB = conversation({
  id: '0c096d41-c240-4a63-bd04-46f96ba3c810',
  accountId: BRANCH_B,
});
const repository: jest.Mocked<ConversationRepository> = {
  list: jest.fn().mockResolvedValue(page([conversationA])),
  unreadCount: jest.fn().mockResolvedValue(3),
  get: jest.fn().mockResolvedValue(conversationA),
  markRead: jest.fn().mockResolvedValue(undefined),
};
const realtime = fakeRealtimeFeed();

beforeEach(() => {
  repository.list.mockReset().mockResolvedValue(page([conversationA]));
  repository.unreadCount.mockReset().mockResolvedValue(3);
  repository.get.mockReset().mockResolvedValue(conversationA);
  repository.markRead.mockReset().mockResolvedValue(undefined);
  realtime.eventCleanup.mockClear();
  realtime.statusCleanup.mockClear();
});
```

```tsx
it('loads the current branch and ignores a stale response after branch change', async () => {
  const first = deferred<ConversationPage>();
  repository.list
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(page([conversationB]));
  const { result, rerender } = renderHook(
    ({ accountId }) => useConversationList({ accountId, repository, realtime }),
    { initialProps: { accountId: BRANCH_A } }
  );
  rerender({ accountId: BRANCH_B });
  await waitFor(() => expect(result.current.items).toEqual([conversationB]));
  first.resolve(page([conversationA]));
  await act(async () => Promise.resolve());
  expect(result.current.items).toEqual([conversationB]);
});

it('hydrates an unknown message event only inside the active branch', async () => {
  repository.list.mockResolvedValueOnce(page([]));
  const { result } = renderHook(() =>
    useConversationList({ accountId: BRANCH_A, repository, realtime })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => {
    await realtime.emit({
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_A,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    });
  });
  expect(repository.get).toHaveBeenCalledWith(BRANCH_A, CONVERSATION_ID);
});

it('coalesces concurrent hydration for the same unknown conversation', async () => {
  const hydrate = deferred<InboxConversation>();
  repository.list.mockResolvedValueOnce(page([]));
  repository.get.mockReturnValueOnce(hydrate.promise);
  const { result } = renderHook(() =>
    useConversationList({ accountId: BRANCH_A, repository, realtime })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const event: InboxRealtimeEvent = {
    table: 'messages',
    eventType: 'INSERT',
    accountId: BRANCH_A,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_1_ID,
  };
  await act(async () => {
    await Promise.all([realtime.emit(event), realtime.emit(event)]);
  });
  expect(repository.get).toHaveBeenCalledTimes(1);
  hydrate.resolve(conversationA);
});

it('ignores a broadcast carrying another account id', async () => {
  const { result } = renderHook(() =>
    useConversationList({ accountId: BRANCH_A, repository, realtime })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () =>
    realtime.emit({
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_B,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    })
  );
  expect(repository.get).not.toHaveBeenCalled();
});

it('refetches after reconnect and foreground without duplicate listeners', async () => {
  const { result } = renderHook(() =>
    useConversationList({ accountId: BRANCH_A, repository, realtime })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => realtime.emitStatus('disconnected', 0));
  await act(async () => realtime.emitStatus('connected', 1));
  await act(async () => realtime.emitStatus('connected', 2));
  await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(3));
});

it('tears down branch listeners and hides old rows on unmount', async () => {
  const { result, unmount } = renderHook(() =>
    useConversationList({
      accountId: BRANCH_A,
      repository,
      realtime,
    })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  unmount();
  expect(realtime.eventCleanup).toHaveBeenCalledTimes(1);
  expect(realtime.statusCleanup).toHaveBeenCalledTimes(1);
});

it('preserves loaded rows when pagination fails', async () => {
  repository.list
    .mockResolvedValueOnce(
      page([conversationA], {
        phase: 'messaged',
        lastMessageAt: conversationA.lastMessageAt!,
        id: conversationA.id,
      })
    )
    .mockRejectedValueOnce(new Error('Could not load conversations'));
  const { result } = renderHook(() =>
    useConversationList({ accountId: BRANCH_A, repository, realtime })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => result.current.loadMore());
  expect(result.current.items).toEqual([conversationA]);
  expect(result.current.paginationError).toBe(
    'Could not load more conversations'
  );
});
```

- [ ] **Step 2: Run the hook suite and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/use-conversation-list.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook with reducer-like immutable updates**

```ts
export interface UseConversationListResult {
  items: InboxConversation[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  paginationError: string | null;
  connection: InboxConnectionState;
  filter: ConversationFilter;
  search: string;
  unreadCount: number;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  setFilter(value: ConversationFilter): void;
  setSearch(value: string): void;
  refresh(): void;
  loadMore(): void;
}

export interface UseConversationListOptions {
  accountId: string;
  repository?: ConversationRepository;
  realtime: InboxRealtimeFeed;
}

export function useConversationList(
  options: UseConversationListOptions
): UseConversationListResult;
```

Use an inline async IIFE effect keyed by account id, filter, normalized search,
and refresh nonce. Store the account id with loaded state and derive visible
items as `loadedAccountId === accountId ? items : []`, so an old branch is
hidden synchronously without a state-setting effect. Then fetch list and unread
count in parallel. Guard
every completion with `cancelled` plus a monotonically increasing request id.

Keep known conversation ids in a ref updated by an effect. Realtime behavior:

- Reject any local event whose `accountId` differs from the active branch.
- Conversation INSERT/UPDATE and every message event call
  `repository.get(accountId, conversationId)` so relational identity, preview,
  unread, and ordering come from authoritative selected-branch data. Replace a
  known row only when fields changed; insert an unknown row only after hydrate.
- Conversation DELETE removes `conversationId` without another read.
- Store each hydrate promise in `Map<conversationId, Promise<void>>` and delete
  it in `finally`, so concurrent conversation/message events share exactly one
  hydrate.

Initialize connection from `realtime.getSnapshot()`, subscribe once to event
and status listeners, and bump the refresh nonce whenever the provider's
`resyncGeneration` increases. Cleanup removes both local listeners; the provider
alone owns AppState and the Supabase channel.

Pagination appends unique ids only; a refresh replaces the list. Search and
filter event handlers reset the cursor before the effect runs. A load-more
failure leaves `status: 'ready'`, preserves items/cursor, and sets only
`paginationError: 'Could not load more conversations'`; the next `loadMore`
call clears that error before retrying.

- [ ] **Step 4: Run hook tests and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/use-conversation-list.test.tsx
npm run mobile:typecheck
```

Expected: hook suite and typecheck pass.

- [ ] **Step 5: Commit the conversation-list hook**

```bash
git add apps/mobile/src/features/inbox/use-conversation-list.ts apps/mobile/src/features/inbox/use-conversation-list.test.tsx
git commit -m "feat: reconcile mobile conversation list"
```

---

### Task 8: Build the native Inbox list screen

**Files:**

- Create: `apps/mobile/src/features/inbox/components/conversation-row.tsx`
- Create: `apps/mobile/src/features/inbox/components/conversation-row.test.tsx`
- Create: `apps/mobile/src/features/inbox/screens/inbox-screen.tsx`
- Create: `apps/mobile/src/features/inbox/screens/inbox-screen.test.tsx`
- Modify: `apps/mobile/app/(app)/index.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Modify: `apps/mobile/src/features/foundation/account-screen.tsx`
- Create: `apps/mobile/src/features/foundation/account-screen.test.tsx`

**Interfaces:**

- Consumes: `useConversationList`, `useInboxRealtimeFeed`, `accountFormatters`, UI masters, `useReadyAuth`, and Expo Router.
- Produces: the signed-in native Inbox list route.

- [ ] **Step 1: Write failing row and screen tests**

The screen test owns one complete hook-result factory so every state is
explicit and later additions fail typecheck instead of silently disappearing:

```tsx
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockUseConversationList = jest.fn();
const screenRealtime: InboxRealtimeFeed = {
  getSnapshot: () => ({ connection: 'connected', resyncGeneration: 0 }),
  listen: () => () => undefined,
  listenStatus: () => () => undefined,
};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
}));
jest.mock('../use-conversation-list', () => ({
  useConversationList: (...args: unknown[]) => mockUseConversationList(...args),
}));
jest.mock('../inbox-realtime-provider', () => ({
  useInboxRealtimeFeed: () => screenRealtime,
}));

function listResult(
  overrides: Partial<UseConversationListResult> = {}
): UseConversationListResult {
  return {
    items: [conversation()],
    status: 'ready',
    error: null,
    paginationError: null,
    connection: 'connected',
    filter: 'all',
    search: '',
    unreadCount: 3,
    refreshing: false,
    loadingMore: false,
    hasMore: false,
    setFilter: jest.fn(),
    setSearch: jest.fn(),
    refresh: jest.fn(),
    loadMore: jest.fn(),
    ...overrides,
  };
}

const emptyResult = () => listResult({ items: [] });
const errorResult = () =>
  listResult({
    items: [],
    status: 'error',
    error: 'Could not load conversations',
  });
```

```tsx
it('renders a scannable row with formatted identity, preview, time, and unread count', () => {
  render(
    <ConversationRow
      conversation={conversation({ unreadCount: 3 })}
      formattedPhone="+919876543210"
      formattedTime="1:30 pm"
      onPress={jest.fn()}
    />
  );
  expect(screen.getByText('Asha Rao')).toBeTruthy();
  expect(screen.getByText('Your membership expires tomorrow')).toBeTruthy();
  expect(screen.getByText('1:30 pm')).toBeTruthy();
  expect(screen.getByLabelText('3 unread messages')).toBeTruthy();
});

it('opens the selected thread and preserves the active branch in state', () => {
  render(<InboxScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Open chat with Asha Rao' })
  );
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(app)/conversation/[conversationId]',
    params: { conversationId: CONVERSATION_ID },
  });
});

it('shows distinct empty and failed states', () => {
  mockUseConversationList.mockReturnValue(emptyResult());
  const { rerender } = render(<InboxScreen />);
  expect(screen.getByText('No conversations yet')).toBeTruthy();
  mockUseConversationList.mockReturnValue(errorResult());
  rerender(<InboxScreen />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

it('returns to a clean Inbox after a successful branch switch', async () => {
  const accountRouter = { replace: jest.fn() };
  const mockSelectBranch = jest.fn().mockResolvedValue(undefined);
  mockUseRouter.mockReturnValue(accountRouter);
  mockUseReadyAuth.mockReturnValue(
    readyAuthValue({ selectBranch: mockSelectBranch, branches: twoBranches })
  );
  render(<AccountScreen />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Choose Koramangala branch' })
  );
  await waitFor(() =>
    expect(mockSelectBranch).toHaveBeenCalledWith(OTHER_BRANCH_ID)
  );
  expect(accountRouter.replace).toHaveBeenCalledWith('/(app)');
});
```

In `account-screen.test.tsx`, use these explicit fixture helpers (the screen
does not inspect session internals):

```tsx
const mockUseRouter = jest.fn();
const mockUseReadyAuth = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => mockUseRouter() }));
jest.mock('../auth/auth-context', () => ({
  useReadyAuth: () => mockUseReadyAuth(),
}));

function branch(accountId: string, name: string): BranchAccount {
  return {
    account_id: accountId,
    account_name: name,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: 'Useful Fitness',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: 'Useful Fitness Private Limited',
    role: 'admin',
    branch_status: 'active',
    readiness_state: 'ready',
    default_currency: 'INR',
    timezone: 'Asia/Kolkata',
    is_organization_owner: false,
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  };
}

const twoBranches = [
  branch(BRANCH_ID, 'Indiranagar'),
  branch(OTHER_BRANCH_ID, 'Koramangala'),
];

function accountSummary(): AccountSummary {
  return {
    id: BRANCH_ID,
    name: 'Indiranagar',
    created_at: '2026-08-01T10:00:00.000Z',
    default_currency: 'INR',
    country_code: 'IN',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    date_order: 'DMY',
    time_format: '12h',
    week_start: 1,
    phone_country_code: '+91',
    measurement_system: 'metric',
    onboarding_dismissed_at: null,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    branch_status: 'active',
    readiness_state: 'ready',
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  };
}

function readyAuthValue(options: {
  selectBranch: (accountId: string) => Promise<void>;
  branches: BranchAccount[];
}): ReadyAuthContextValue {
  return {
    state: {
      status: 'ready',
      session: {} as Session,
      profile: {
        id: 'cfaef847-2572-4c92-852e-b62c09eecae4',
        full_name: 'Test Agent',
        email: 'agent@example.test',
        avatar_url: null,
        role: null,
        beta_features: [],
        account_id: BRANCH_ID,
        account_role: 'admin',
      },
      branches: options.branches,
      branch: options.branches[0],
      account: accountSummary(),
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    selectBranch: options.selectBranch,
  };
}
```

- [ ] **Step 2: Run the screen suites and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/components/conversation-row.test.tsx src/features/inbox/screens/inbox-screen.test.tsx src/features/foundation/account-screen.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the row and Inbox screen**

`ConversationRow` is one accessible Pressable button, 72px minimum height,
with `UserAvatar`, identity, one-line preview, formatted time, and unread count.
It uses `bg-accent-soft` only for unread emphasis; it does not render raw phone
text when a name exists. Its accessible name is
`Open chat with <display name>, <N unread messages>` when unread and omits the
count when zero.

`InboxScreen` uses one `ScreenSafeAreaView`, one native Stack title (`Inbox`),
an existing `Button variant="ghost" size="sm"` header action named `Account`,
the SearchField, All/Unread FilterChipGroup, a disconnected banner, and a
FlatList. Wire `refreshing`, `onRefresh`, `onEndReached`, stable `keyExtractor`,
`ListEmptyComponent`, and a footer-only pagination retry. The footer renders
`Could not load more conversations` plus a `Retry loading more` Button that
calls `loadMore`; the full-state Retry calls `refresh`. Do not wrap FlatList
inside ScrollView.

Read `const realtime = useInboxRealtimeFeed()` once in the screen and pass it
to `useConversationList`; the hook never reaches around the provider or opens a
channel.

Use `accountFormatters(state.account)` for phone/time. Navigation uses the
typed dynamic route object shown in the test. The Account header action calls
`router.push('/(app)/account')` and contains the visible label `Account`; it is
not a circular icon-only action.

In `AccountScreen`, wrap the existing `auth.selectBranch` callback so it awaits
the successful branch transition and then calls `router.replace('/(app)')`.
The existing `BranchChoices` error path remains authoritative: a rejected
switch stays on Account and does not navigate. This makes the old route tree
unmount before the new branch Inbox loads.

At this task—not later—wrap the protected `index` and `account` Stack in
`InboxRealtimeProvider key={state.branch.account_id}
accountId={state.branch.account_id}` using the guarded layout pattern from Task 11. The key tears down the prior Stack and returns navigation to the clean Inbox
for the new branch. This keeps the newly promoted Inbox runnable and ensures
there is one channel before a conversation route exists.

Replace the route export:

```ts
export { InboxScreen as default } from '../../src/features/inbox/screens/inbox-screen';
```

- [ ] **Step 4: Run screen tests and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/components/conversation-row.test.tsx src/features/inbox/screens/inbox-screen.test.tsx src/features/foundation/account-screen.test.tsx
npm run mobile:typecheck
```

Expected: row, screen, and typecheck pass.

- [ ] **Step 5: Commit the Inbox list screen**

```bash
git add apps/mobile/src/features/inbox/components/conversation-row.tsx apps/mobile/src/features/inbox/components/conversation-row.test.tsx apps/mobile/src/features/inbox/screens/inbox-screen.tsx apps/mobile/src/features/inbox/screens/inbox-screen.test.tsx apps/mobile/src/features/foundation/account-screen.tsx apps/mobile/src/features/foundation/account-screen.test.tsx apps/mobile/app/'(app)'/index.tsx apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat: add native inbox list"
```

---

### Task 9: Build WhatsApp-style message presentation

**Files:**

- Modify: `apps/mobile/global.css`
- Create: `apps/mobile/src/features/inbox/components/message-content.tsx`
- Create: `apps/mobile/src/features/inbox/components/message-content.test.tsx`
- Create: `apps/mobile/src/features/inbox/components/message-bubble.tsx`
- Create: `apps/mobile/src/features/inbox/components/message-bubble.test.tsx`

**Interfaces:**

- Consumes: `InboxMessage`, `safeMediaUrl`, `startsNewRun`, and account-formatted time/date strings.
- Produces: `MessageContent`, `MessageBubble`, and `DeliveryIndicator`.

- [ ] **Step 1: Write failing content and bubble tests**

```tsx
it.each([
  ['template', 'Template'],
  ['interactive', 'Button reply'],
] as const)(
  'marks %s provenance without a filled badge',
  (contentType, marker) => {
    render(
      <MessageBubble
        message={message({ contentType, contentText: 'Hello' })}
        formattedTime="1:30 pm"
        startsRun
      />
    );
    expect(screen.getByText(marker)).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
  }
);

it('announces delivery state independently of color', () => {
  render(
    <MessageBubble
      message={message({ senderType: 'agent', status: 'read' })}
      formattedTime="1:30 pm"
      startsRun
    />
  );
  expect(screen.getByLabelText('Read')).toBeTruthy();
});

it('renders unsafe media as unavailable instead of opening it', () => {
  render(
    <MessageContent
      message={message({ contentType: 'document', mediaUrl: 'file:///secret' })}
    />
  );
  expect(screen.getByText('Document unavailable')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});
```

- [ ] **Step 2: Run presentation tests and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/components/message-content.test.tsx src/features/inbox/components/message-bubble.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Add named chat tokens and content renderers**

Extend `global.css` inside the theme layer:

```css
@theme inline {
  --color-chat-canvas: color-mix(
    in oklab,
    var(--background) 96%,
    var(--foreground) 4%
  );
  --color-chat-bubble-in: var(--surface);
  --color-chat-bubble-out: color-mix(
    in oklab,
    var(--accent) 12%,
    var(--surface) 88%
  );
  --color-chat-meta: color-mix(
    in oklab,
    var(--color-chat-bubble-in) 45%,
    var(--foreground) 55%
  );
  --color-chat-meta-out: color-mix(
    in oklab,
    var(--color-chat-bubble-out) 45%,
    var(--foreground) 55%
  );
  --color-chat-read: color-mix(
    in oklab,
    oklch(0.685 0.169 237.323) 55%,
    var(--foreground) 45%
  );
}
```

`MessageContent` behavior is exact:

- text/template/interactive: render content text or the fixed preview label.
- image with safe HTTPS URL: render Expo Image with an accessible description;
  otherwise `Photo unavailable`.
- video/audio/document/location: render a quiet content label and one Pressable
  `Open <type>` action only when `safeMediaUrl` succeeds; call `Linking.openURL`
  and show a fixed inline failure if it rejects.
- no Stage 1 content action mutates data.

`MessageBubble` uses inbound/outbound alignment, named chat fills, 10px radius,
run-opening tail, 2px within-run gap, 12px between-run gap, foreground body,
derived meta token, template/interactive text marker, and fixed delivery labels:
Sending, Sent, Delivered, Read, Failed. Blue read ticks use the existing sky
semantic recipe through `text-chat-read` and always retain the accessible
label. The literal sky hue appears only in the named token above, never at a
component call site.

- [ ] **Step 4: Run presentation tests and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/components/message-content.test.tsx src/features/inbox/components/message-bubble.test.tsx
npm run mobile:typecheck
```

Expected: presentation suites and typecheck pass.

- [ ] **Step 5: Commit message presentation**

```bash
git add apps/mobile/global.css apps/mobile/src/features/inbox/components/message-content.tsx apps/mobile/src/features/inbox/components/message-content.test.tsx apps/mobile/src/features/inbox/components/message-bubble.tsx apps/mobile/src/features/inbox/components/message-bubble.test.tsx
git commit -m "feat: render native whatsapp history"
```

---

### Task 10: Build thread state, pagination, and realtime reconciliation

**Files:**

- Create: `apps/mobile/src/features/inbox/use-message-thread.ts`
- Create: `apps/mobile/src/features/inbox/use-message-thread.test.tsx`
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/auth/roles.test.ts`

**Interfaces:**

- Consumes: `ConversationRepository`, `MessageRepository`, the shared `InboxRealtimeFeed`, account id, conversation id, and the canonical `canClearConversationUnread` capability.
- Produces: `UseMessageThreadResult` for ConversationScreen.

- [ ] **Step 1: Write failing thread-state tests**

First add the canonical capability test to `src/lib/auth/roles.test.ts`:

```ts
it.each([
  ['owner', true],
  ['admin', true],
  ['agent', true],
  ['viewer', false],
] as const)('canClearConversationUnread(%s) is %s', (role, expected) => {
  expect(canClearConversationUnread(role)).toBe(expected);
});
```

Use these complete defaults in the hook test. The realtime fake uses the same
public `InboxRealtimeFeed` contract, but is defined locally so this test has
no hidden dependency on another test file:

```tsx
const conversations: jest.Mocked<ConversationRepository> = {
  list: jest.fn(),
  unreadCount: jest.fn(),
  get: jest.fn().mockResolvedValue(conversation()),
  markRead: jest.fn().mockResolvedValue(undefined),
};
const messages: jest.Mocked<MessageRepository> = {
  get: jest.fn().mockResolvedValue(message()),
  list: jest
    .fn()
    .mockResolvedValue(
      page([
        message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
        message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
      ])
    ),
};

function fakeThreadRealtimeFeed(): InboxRealtimeFeed & {
  emit(event: InboxRealtimeEvent): Promise<void>;
  emitStatus(
    connection: InboxConnectionState,
    generation: number
  ): Promise<void>;
} {
  const events = new Set<(event: InboxRealtimeEvent) => void>();
  const statuses = new Set<
    (snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']>) => void
  >();
  let snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']> = {
    connection: 'connected',
    resyncGeneration: 0,
  };
  return {
    getSnapshot: () => snapshot,
    listen(listener) {
      events.add(listener);
      return () => events.delete(listener);
    },
    listenStatus(listener) {
      statuses.add(listener);
      return () => statuses.delete(listener);
    },
    async emit(event) {
      events.forEach((listener) => listener(event));
      await Promise.resolve();
    },
    async emitStatus(connection, resyncGeneration) {
      snapshot = { connection, resyncGeneration };
      statuses.forEach((listener) => listener(snapshot));
      await Promise.resolve();
    },
  };
}

const realtime = fakeThreadRealtimeFeed();

function configuredThreadHook(
  overrides: Partial<UseMessageThreadOptions> = {}
): UseMessageThreadResult {
  return useMessageThread({
    accountId: BRANCH_ID,
    conversationId: CONVERSATION_ID,
    role: 'agent',
    conversations,
    messages,
    realtime,
    ...overrides,
  });
}

beforeEach(() => {
  conversations.get.mockReset().mockResolvedValue(conversation());
  conversations.markRead.mockReset().mockResolvedValue(undefined);
  messages.list
    .mockReset()
    .mockResolvedValue(
      page([
        message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
        message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
      ])
    );
  messages.get.mockReset().mockResolvedValue(message());
});
```

```tsx
it('loads the verified conversation and latest chronological message page', async () => {
  const { result } = renderHook(() =>
    useMessageThread({
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      role: 'agent',
      conversations,
      messages,
      realtime,
    })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items.map((item) => item.id)).toEqual([
    MESSAGE_1_ID,
    MESSAGE_2_ID,
  ]);
  expect(conversations.markRead).toHaveBeenCalledWith(
    BRANCH_ID,
    CONVERSATION_ID
  );
});

it('does not clear shared unread state for a viewer', async () => {
  renderHook(() =>
    useMessageThread({
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      role: 'viewer',
      conversations,
      messages,
      realtime,
    })
  );
  await waitFor(() => expect(messages.list).toHaveBeenCalled());
  expect(conversations.markRead).not.toHaveBeenCalled();
});

it('deduplicates inserts and ignores updates for another thread', async () => {
  messages.get.mockResolvedValueOnce(
    message({
      id: MESSAGE_0_ID,
      createdAt: '2026-09-01T08:00:00.000Z',
    })
  );
  const { result } = renderHook(() => configuredThreadHook());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => {
    await realtime.emit({
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_2_ID,
    });
    await realtime.emit({
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_2_ID,
    });
    await realtime.emit({
      table: 'messages',
      eventType: 'UPDATE',
      accountId: BRANCH_ID,
      conversationId: OTHER_CONVERSATION_ID,
      messageId: MESSAGE_3_ID,
    });
    await realtime.emit({
      table: 'messages',
      eventType: 'UPDATE',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: ABSENT_MESSAGE_ID,
    });
    await realtime.emit({
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_0_ID,
    });
  });
  expect(
    result.current.items.filter((item) => item.id === MESSAGE_2_ID)
  ).toHaveLength(1);
  expect(result.current.items.some((item) => item.id === MESSAGE_3_ID)).toBe(
    false
  );
  expect(
    result.current.items.some((item) => item.id === ABSENT_MESSAGE_ID)
  ).toBe(false);
  expect(result.current.items.map((item) => item.id)).toEqual([
    MESSAGE_0_ID,
    MESSAGE_1_ID,
    MESSAGE_2_ID,
  ]);
});

it('hydrates a delivery update only for an existing message id', async () => {
  messages.get.mockResolvedValueOnce(
    message({ id: MESSAGE_2_ID, senderType: 'agent', status: 'read' })
  );
  const { result } = renderHook(() => configuredThreadHook());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () =>
    realtime.emit({
      table: 'messages',
      eventType: 'UPDATE',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_2_ID,
    })
  );
  expect(
    result.current.items.find((item) => item.id === MESSAGE_2_ID)?.status
  ).toBe('read');
});

it('prepends older history without changing the newest-page order', async () => {
  messages.list
    .mockResolvedValueOnce(
      page(
        [
          message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
          message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
        ],
        { createdAt: '2026-09-01T08:01:00.000Z', id: MESSAGE_1_ID }
      )
    )
    .mockResolvedValueOnce(
      page([
        message({ id: MESSAGE_0_ID, createdAt: '2026-09-01T08:00:00.000Z' }),
      ])
    );
  const { result } = renderHook(() => configuredThreadHook());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => result.current.loadOlder());
  expect(result.current.items.map((item) => item.id)).toEqual([
    MESSAGE_0_ID,
    MESSAGE_1_ID,
    MESSAGE_2_ID,
  ]);
});

it('keeps visible history when loading older messages fails', async () => {
  messages.list
    .mockResolvedValueOnce(
      page([message({ id: MESSAGE_1_ID })], {
        createdAt: '2026-09-01T08:01:00.000Z',
        id: MESSAGE_1_ID,
      })
    )
    .mockRejectedValueOnce(new Error('Could not load messages'));
  const { result } = renderHook(() => configuredThreadHook());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => result.current.loadOlder());
  expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_1_ID]);
  expect(result.current.paginationError).toBe('Could not load older messages');
});

it('refetches the open thread when the shared provider requests resync', async () => {
  const { result } = renderHook(() => configuredThreadHook());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => realtime.emitStatus('connected', 1));
  await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
  expect(conversations.get).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the thread hook suite and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/use-message-thread.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement thread state with fixed capability and resync rules**

```ts
export interface UseMessageThreadResult {
  conversation: InboxConversation | null;
  items: InboxMessage[];
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  error: string | null;
  unreadWarning: string | null;
  paginationError: string | null;
  connection: InboxConnectionState;
  refreshing: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  refresh(): void;
  loadOlder(): void;
}

export interface UseMessageThreadOptions {
  accountId: string;
  conversationId: string;
  role: AccountRole;
  conversations?: ConversationRepository;
  messages?: MessageRepository;
  realtime: InboxRealtimeFeed;
}

export function useMessageThread(
  options: UseMessageThreadOptions
): UseMessageThreadResult;
```

In `src/lib/auth/roles.ts`, change its two internal `@/` imports to the
equivalent relative imports so Metro can consume the canonical module, then add:

```ts
/** Agent+ may clear the shared unread count after opening a conversation. */
export function canClearConversationUnread(role: AccountRole): boolean {
  return hasMinRole(role, 'agent');
}
```

The existing `conversations_update` RLS policy already requires
`is_account_member(account_id, 'agent')`, so this UI capability mirrors the
database boundary and requires no migration. Import this predicate and its
`AccountRole` type directly from `../../../../../src/lib/auth/roles` in the
mobile hook; do not compare role strings at the call site.

Load `conversations.get` and the latest message page under one request
generation. Publish the screen only after both succeed. If the verified
conversation is missing, publish `unavailable`; otherwise failures publish the
fixed recoverable error.

For agent-or-higher, call `markRead` after the verified thread is published.
An unread-clear failure does not hide readable history; retain a fixed
`Could not clear unread messages` inline warning and allow refresh to retry.

Reject events for another account or conversation. A message INSERT ignores an
existing id; otherwise it calls
`messages.get(accountId, conversationId, messageId)`, inserts once, and sorts by
`(createdAt, id)` so delayed events cannot corrupt chronology. UPDATE hydrates
and replaces only an existing id; DELETE removes only the matching id. Coalesce
concurrent hydrate work in a per-message promise map. Conversation DELETE
publishes unavailable. Conversation INSERT/UPDATE for this id calls
`conversations.get` and replaces the authoritative conversation header.
When an inbound INSERT arrives while agent-or-higher is actively reading, call
`markRead` once through an in-flight latch.

An increased provider `resyncGeneration` bumps the same refresh nonce for
reconnect and foreground recovery. Cleanup cancels repository completions and
removes both local feed listeners; it never removes the shared channel.
An older-page failure preserves the current history/cursor and sets only
`paginationError: 'Could not load older messages'`; a retry clears it first.

- [ ] **Step 4: Run thread hook tests and verify GREEN**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/use-message-thread.test.tsx
npm run mobile:typecheck
```

Expected: thread hook suite and typecheck pass.

- [ ] **Step 5: Commit the message-thread hook**

```bash
git add apps/mobile/src/features/inbox/use-message-thread.ts apps/mobile/src/features/inbox/use-message-thread.test.tsx src/lib/auth/roles.ts src/lib/auth/roles.test.ts
git commit -m "feat: reconcile native message thread"
```

---

### Task 11: Add the native conversation route and scroll behavior

**Files:**

- Create: `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`
- Create: `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx`
- Create: `apps/mobile/app/(app)/conversation/[conversationId].tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `useLocalSearchParams`, `useInboxRealtimeFeed`, `useMessageThread`, `MessageBubble`, account formatters, and native Stack navigation.
- Produces: the protected typed conversation route.

- [ ] **Step 1: Write failing route-screen tests**

Define the complete screen-state factory in the test file:

```tsx
const mockUseMessageThread = jest.fn();
const screenRealtime: InboxRealtimeFeed = {
  getSnapshot: () => ({ connection: 'connected', resyncGeneration: 0 }),
  listen: () => () => undefined,
  listenStatus: () => () => undefined,
};
jest.mock('../use-message-thread', () => ({
  useMessageThread: (...args: unknown[]) => mockUseMessageThread(...args),
}));
jest.mock('../inbox-realtime-provider', () => ({
  useInboxRealtimeFeed: () => screenRealtime,
}));

function readyThreadResult(
  overrides: Partial<UseMessageThreadResult> = {}
): UseMessageThreadResult {
  return {
    conversation: conversation(),
    items: [
      message({
        id: MESSAGE_1_ID,
        senderType: 'customer',
        contentText: 'Hello',
        createdAt: '2026-09-01T08:01:00.000Z',
      }),
      message({
        id: MESSAGE_2_ID,
        senderType: 'agent',
        contentText: 'How can I help?',
        createdAt: '2026-09-01T08:02:00.000Z',
      }),
    ],
    status: 'ready',
    error: null,
    unreadWarning: null,
    paginationError: null,
    connection: 'connected',
    refreshing: false,
    loadingOlder: false,
    hasOlder: false,
    refresh: jest.fn(),
    loadOlder: jest.fn(),
    ...overrides,
  };
}
```

```tsx
it('renders chronological runs and does not expose a composer', () => {
  mockUseMessageThread.mockReturnValue(readyThreadResult());
  render(<ConversationScreen />);
  expect(screen.getByText('Asha Rao')).toBeTruthy();
  expect(screen.getByText('Hello')).toBeTruthy();
  expect(screen.getByText('How can I help?')).toBeTruthy();
  expect(screen.queryByPlaceholderText(/message/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
});

it('loads older history near the top and preserves the visible anchor', () => {
  const loadOlder = jest.fn();
  mockUseMessageThread.mockReturnValue(
    readyThreadResult({ loadOlder, hasOlder: true })
  );
  render(<ConversationScreen />);
  fireEvent.scroll(screen.getByTestId('message-list'), {
    nativeEvent: {
      contentOffset: { y: 20 },
      contentSize: { height: 1200, width: 390 },
      layoutMeasurement: { height: 700, width: 390 },
    },
  });
  expect(loadOlder).toHaveBeenCalledTimes(1);
});

it('keeps an older reader in place and reveals Jump to latest', () => {
  render(<ConversationScreen />);
  fireEvent.scroll(screen.getByTestId('message-list'), {
    nativeEvent: {
      contentOffset: { y: 100 },
      contentSize: { height: 1600, width: 390 },
      layoutMeasurement: { height: 700, width: 390 },
    },
  });
  expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
});
```

- [ ] **Step 2: Run the screen test and verify RED**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/screens/conversation-screen.test.tsx
```

Expected: FAIL because the screen does not exist.

- [ ] **Step 3: Implement the screen and typed route**

Read and validate `conversationId` as one string UUID before calling the hook.
Read the branch feed with `useInboxRealtimeFeed()` and pass it to the hook.
Use the native Stack header title for the contact display name and the default
native back action. Render one ScreenSafeAreaView with a chat-canvas FlatList.

Build FlatList data with `buildThreadItems(items, fmt.date)`. Pass
`maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` so prepending older
messages preserves the reader. Track distance from bottom on scroll with a ref
and a 120px threshold. New messages call `scrollToEnd` only when that ref says
the reader is already near the bottom. Otherwise show a UsefulDesk Button named
`Jump to latest`.

Use formatter `date` for date separators and `time` for bubble metadata. Render
LoadingState, ErrorState, and an unavailable state that returns to Inbox. Do
not render any editable TextInput, template control, or send action. A
disconnected connection renders the same concise offline banner as Inbox;
`unreadWarning` renders fixed inline copy without hiding history; and
`paginationError` renders `Could not load older messages` plus a
`Retry loading older messages` Button wired to `loadOlder`.

Create the route module:

```ts
export { ConversationScreen as default } from '../../../src/features/inbox/screens/conversation-screen';
```

Register screens:

```tsx
function ProtectedAppStack({ guard }: { guard: boolean }) {
  return (
    <Stack>
      <Stack.Protected guard={guard}>
        <Stack.Screen name="index" options={{ title: 'Inbox' }} />
        <Stack.Screen name="conversation/[conversationId]" />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack.Protected>
    </Stack>
  );
}

if (state.status !== 'ready') return <ProtectedAppStack guard={false} />;

return (
  <InboxRealtimeProvider
    key={state.branch.account_id}
    accountId={state.branch.account_id}
  >
    <ProtectedAppStack guard />
  </InboxRealtimeProvider>
);
```

This provider placement is the sole production caller of
`subscribeToInboxRealtime`; Inbox and conversation hooks call
`useInboxRealtimeFeed()` and add only in-memory listeners.

- [ ] **Step 4: Run route, screen, and full mobile tests**

```bash
npm run mobile:test -- --runTestsByPath src/features/inbox/screens/conversation-screen.test.tsx
npm run mobile:verify
```

Expected: focused screen test passes; all mobile lint, typecheck, and Jest suites
pass with zero failures.

- [ ] **Step 5: Commit the conversation route**

```bash
git add apps/mobile/src/features/inbox/screens/conversation-screen.tsx apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx apps/mobile/app/'(app)'/conversation/'[conversationId]'.tsx apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat: add native conversation history route"
```

---

### Task 12: Verify Stage 1, update durable docs, and perform device acceptance

**Files:**

- Modify: `docs/mobile/development-build.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Review: every Stage 1 file from Tasks 1–11

**Interfaces:**

- Consumes: the complete Stage 1 implementation.
- Produces: verified build evidence, updated product status, and a physical-iPhone acceptance record containing no credentials or customer content.

- [ ] **Step 1: Add the Stage 1 smoke checklist before running it**

Add these exact checklist bullets to `docs/mobile/development-build.md`:

```md
### Native Inbox Stage 1

- Inbox opens as the authenticated home for the selected branch.
- All and Unread, search, pull-to-refresh, and pagination never show another branch.
- Opening a conversation shows chronological history without a composer or send action.
- Scrolling upward loads older history without moving the visible message.
- Incoming messages update the list and open thread once, without forcing an older reader to the bottom.
- Reconnect and foreground resync recover missed events.
- Agent-or-higher clears shared unread state; viewer remains read-only.
- Switching branch clears the old list/thread before the new branch loads.
```

- [ ] **Step 2: Run deterministic verification from the repository root**

```bash
npm run mobile:verify
(cd apps/mobile && npx expo-doctor)
mobile_ios_export="$(mktemp -d /tmp/usefuldesk-inbox-ios.XXXXXX)"
(cd apps/mobile && npx expo export --platform ios --output-dir "$mobile_ios_export")
mobile_android_export="$(mktemp -d /tmp/usefuldesk-inbox-android.XXXXXX)"
(cd apps/mobile && npx expo export --platform android --output-dir "$mobile_android_export")
npm run verify
git diff --check
git status --short
```

Expected:

- Mobile lint/typecheck and every Jest suite pass.
- Expo Doctor reports every check passed.
- Both exports produce bundles and exit 0.
- Root format, lint, typecheck, Vitest, and Next build pass.
- `git diff --check` exits 0.
- No generated `apps/mobile/ios`, `apps/mobile/android`, bundle, secret, or
  `.env.local` file appears in tracked status.

- [ ] **Step 3: Run the physical-iPhone smoke without customer sends**

Start the existing development client and Metro. On the approved test account,
verify every checklist item from Step 1. Use a separate authorized web/test
inbound action to create a realtime event only if the owner has approved that
test contact; otherwise verify realtime by observing an existing test thread
and record the live-inbound item as not exercised. Do not press or expose any
customer send action because Stage 1 must not contain one.

Record only:

```md
- Device: physical iPhone / iOS 26.6
- Stage 1 deterministic checks: pass or fail
- Stage 1 native navigation/history: pass or fail
- Realtime incoming test: pass, fail, or not exercised
- Cross-branch isolation: pass or fail
```

- [ ] **Step 4: Update changelog and roadmap with proven status only**

In `docs/changelog.md`, amend **Secure mobile agent foundation** with the shipped
Stage 1 boundary, key code paths, and the gotcha that selected-branch custom
headers cannot travel over Realtime WebSockets, so the app uses private
identifier-only account Broadcast and always rehydrates through explicit
selected-account repository predicates.

In `PRDs/roadmap.md`, move read-only native Inbox from next to built only if
Steps 2 and 3 pass. Keep Stage 2 text/templates and Stage 3 rich chat pending.
Do not claim realtime device proof if the inbound item was not exercised.

- [ ] **Step 5: Re-run doc-sensitive checks and commit Stage 1 completion**

```bash
npx prettier --check docs/mobile/development-build.md docs/changelog.md PRDs/roadmap.md
git diff --check
git add docs/mobile/development-build.md docs/changelog.md PRDs/roadmap.md
git commit -m "docs: record native inbox stage one"
```

Expected: formatting and diff checks pass; the commit contains only the three
durable documentation files.

---

## Stage 1 Exit Criteria

- Inbox is the authenticated native home.
- Conversation list/search/filter/count pagination is selected-branch-only.
- Conversation history is selected-branch-verified, paginated, chronological,
  localized, and contains no send affordance.
- Realtime duplicates/out-of-order events, reconnect, foreground, sign-out,
  and branch teardown are covered by deterministic tests.
- Private account-topic Broadcast policy/function/triggers are applied and
  verified; payloads contain identifiers only.
- Viewer behavior is read-only; agent-or-higher unread clearing proves a
  returned row.
- All mobile/root checks and iOS/Android exports pass.
- Physical-iPhone navigation/history and cross-branch isolation pass.
- Changelog and roadmap state only what the evidence proves.
