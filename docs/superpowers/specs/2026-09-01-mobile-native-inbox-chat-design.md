# Native mobile Inbox and staged proper chat

**Date:** 2026-09-01  
**Status:** Approved in conversation; awaiting review of this written specification

## Context

The UsefulDesk Agent Expo app has a verified physical-iPhone foundation:
SecureStore-backed Supabase authentication, branch resolution, fail-closed
branch switching, and a protected native account surface. The next product
boundary is the WhatsApp Inbox.

The web Inbox already owns the authoritative data and provider behavior:
branch-scoped conversations and messages, Supabase Realtime reconciliation,
WhatsApp session-window rules, templates, media, replies, reactions, and the
server-only Meta send core. The mobile app must reuse those services without
embedding the web UI, copying secrets, or weakening branch isolation.

The approved direction is a staged proper-chat build using native Expo UI,
direct RLS-protected Supabase reads and realtime events, and the existing
server-side WhatsApp send service for customer-facing mutations.

## Goals

- Make Inbox the useful, phone-first home of the signed-in agent app.
- Preserve the selected account as the sole operational branch for every read,
  subscription, mutation, and deep link.
- Deliver a familiar WhatsApp-style conversation list and thread using native
  navigation, lists, keyboard behavior, and accessibility.
- Reach proper two-way chat in stages: live reading first, text/templates
  second, rich conversation behavior third.
- Reuse the existing server-only send core and WhatsApp policy instead of
  implementing provider behavior in the client.
- Recover deterministically from missed realtime events, backgrounding,
  expired sessions, branch changes, and interrupted requests.
- Keep all server, service-role, Meta, signing, and private API credentials out
  of the installed app.

## Non-goals

- A WebView or embedded copy of the Next.js Inbox.
- A unified cross-branch Inbox. One account remains one isolated branch and one
  WhatsApp Inbox.
- Sending from an offline queue. Customer sends require an explicit connected
  attempt; failed attempts remain visible for deliberate retry.
- Contact editing, assignment, conversation-status editing, AI drafting,
  broadcast creation, payments, or other CRM mutations in the initial stages.
- Replacing the web Inbox or forcing web and native components to share a
  rendering implementation.
- Shipping push-notification credentials or creating remote EAS state without
  a separate authorized release step.

## Approved architecture

### Native presentation

Expo Router owns two primary authenticated routes:

- Inbox list: the signed-in home route.
- Conversation thread: a pushed route keyed by conversation id.

Account remains reachable from the Inbox header. The current foundation status
surface may remain as diagnostic content under Account while Inbox becomes the
default operational surface. No bottom-tab system is introduced for one
primary workflow; later mobile modules can justify navigation expansion when
they exist.

The mobile feature lives under `apps/mobile/src/features/inbox/`, separated
into domain models, repositories, realtime coordination, screens, and
conversation components. Generic native controls live under
`apps/mobile/src/ui/` and are exported through its existing index.

### UsefulDesk native masters

HeroUI Native is already installed and backs the existing Button and TextField.
New UsefulDesk-owned masters compose its stable primitives rather than exposing
vendor components directly at feature call sites:

- Search field from HeroUI Native SearchField/Input.
- Filter chips and unread counters from HeroUI Native Chip.
- Contact avatar from HeroUI Native Avatar.
- Loading and recoverable feedback from HeroUI Native Spinner and Alert.
- Composer field from HeroUI Native TextArea/Input.
- A new icon-button master from HeroUI Native Button for header and composer
  actions; the existing text Button need not change.
- Shared loading, empty, and error-state composition with consistent retry
  behavior and accessible announcements.

React Native supplies FlatList, View, Text, KeyboardAvoidingView, Pressable
layout where semantics require it, AppState, and native scrolling. Expo Image
continues to provide native media loading. No additional UI dependency is
required. Stage 3 may add focused Expo platform modules for picking media,
recording audio, or receiving notifications; those are native capabilities,
not a second component system, and each requires current-documentation review
before implementation.

Conversation rows, message bubbles, run grouping, bubble tails, delivery
metadata, quote presentation, and realtime/composer orchestration remain
Inbox-domain components. They follow `docs/ui-patterns.md`: WhatsApp fidelity
for chat rhythm and interaction, UsefulDesk geometry and accessibility for
controls, semantic chat tokens rather than raw call-site colors, derived meta
contrast, blue read ticks, and no circular one-off icon buttons.

### Reads and tenancy

The existing `mobileSupabase` client remains the only database client. Its
branch-aware fetch attaches the selected `x-usefuldesk-account-id` header, and
Postgres RLS remains authoritative. Every conversation query also filters
explicitly by the selected account id; membership in another branch must never
make that branch's row eligible for the current mobile state.

The Inbox repository provides narrow operations:

- Fetch a keyset-paginated conversation page ordered by
  `last_message_at DESC, id DESC`, including contact identity and membership
  presence needed for list presentation.
- Search the current branch across contact name/phone and message preview. A
  branch-scoped contact lookup resolves matching contact ids before the
  conversation query; search never silently limits itself to already-loaded
  rows.
- Fetch an exact unread conversation count and All/Unread list slices.
- Fetch a keyset-paginated message page for one readable conversation ordered
  by `created_at DESC, id DESC`, then normalize it into chronological display
  order.
- Hydrate one conversation with its contact after a realtime payload that
  cannot contain relational joins.
- Clear the shared unread count with returned-row proof when an agent-or-higher
  opens the thread. Viewers do not perform this mutation.

Every destructive or updating database operation chains a returned id and
treats an empty result as failure. A branch change cancels in-flight reads,
removes channels, clears prior-branch entities, returns navigation to the Inbox
list, and only then loads the new branch.

### Lists and history

The conversation list uses FlatList pagination and pull-to-refresh. Initial
filters are All and Unread; search spans the branch. Status, Member/Lead, and
tag filters remain later parity work rather than crowding the first mobile
toolbar.

The thread loads the newest page first and prepends older chronological pages
as the reader scrolls upward. FlatList preserves the visible anchor while
older rows are inserted. It pins to the newest message only when the reader is
already near the bottom. Otherwise a Jump to latest action appears. New
messages never drag a reader away from older history.

Stage 1 renders every persisted content type safely: text, template, image,
video, audio, document, location, and interactive reply. A content type whose
rich renderer is not yet shipped receives an honest, accessible summary and
open/download action where safe; it is never silently omitted.

### Realtime and resynchronization

One branch-lifetime channel listens to conversation changes filtered by
`account_id`. Message rows have no account id, so message events rely on the
existing message RLS path through their conversation and are then reconciled
only into known or successfully hydrated **current-branch** conversations.
Hydration includes an explicit selected-account predicate, so an event from a
different branch the same user can access is ignored. The open thread accepts
message updates only for ids it contains.

Stable ids are the reconciliation key. Insert handlers ignore duplicates;
updates return the previous collection unchanged when the target is absent.
Out-of-order conversation/message events trigger at most one in-flight hydrate
per conversation id. A new conversation is not shown as an anonymous permanent
row: its relational contact data is hydrated before it settles.

Realtime is an acceleration layer, not the source of truth. A disconnected to
connected transition, AppState background to active transition, manual pull to
refresh, and branch change all run repository refetches. These paths share one
resync mechanism and sequence guard so stale responses cannot overwrite a
newer branch or conversation.

## Staged delivery

### Stage 1 — live native Inbox

Stage 1 ships the native list and thread without customer-send actions.

It includes:

- Inbox as the authenticated home route and Account access from its header.
- Paginated All/Unread conversation list, exact unread count, search,
  pull-to-refresh, and loading/empty/error states.
- Full thread navigation, paginated history, date separators, sender runs,
  inbound/outbound bubbles, timestamps, template/interactive markers, and
  delivery indicators.
- Safe presentation for all existing message content types.
- Branch conversation and message realtime reconciliation.
- Foreground and reconnect resync plus a visible offline/disconnected state.
- Agent-or-higher shared unread clearing on open; viewers remain fully
  read-only.
- Account switching that tears down and clears the old branch before loading
  the new one.

Stage 1 contains no composer and cannot contact a customer.

### Stage 2 — two-way text and templates

Stage 2 adds the first customer-facing mutations.

Inside an open 24-hour WhatsApp customer-service window, an agent-or-higher
gets a native text composer. A local optimistic message appears immediately
with a stable temporary id and `sending` status. The API result and realtime
insert reconcile into that one row by the returned persisted id and provider
message id; neither may create a duplicate. Delivery and read updates patch the
existing row. A failed optimistic row stays in the thread with Retry, and its
draft is retained.

When the 24-hour window is closed, the composer is omitted rather than
disabled. The bottom action offers only approved, synced templates. The native
template picker requests the branch's approved templates, collects the exact
header/body/button parameters required by the existing contract, and sends
through the same server endpoint. Missing WhatsApp connection, insufficient
role, missing approved contract, or provider readiness is shown as one
actionable blocker rather than a dead control.

Viewers never receive customer-send controls. The mobile app does not infer
authorization from role strings at call sites; a named mobile capability
mirrors `canSendMessages`, and the server plus RLS remain authoritative.

### Stage 3 — rich conversation parity

Stage 3 adds:

- Image, video, document, and audio selection, validation, upload progress,
  captions, preview, cancellation, and explicit failed-upload recovery.
- Account-scoped media uploads using the existing storage boundary; no signed
  or private credential is persisted as a public URL.
- Quoted replies using `reply_to_message_id` and the established reply marker.
- Reactions with optimistic reconciliation and the existing conversation RLS.
- Draft and staged-attachment preservation across app backgrounding without an
  automatic send queue.
- Push-notification registration, server-side device-token storage, and deep
  links that revalidate authentication and branch membership before opening a
  conversation.

Push notification delivery is a separately authorized release operation
because it introduces device credentials, native configuration, remote build
state, and server delivery work. Stage 3 implementation may prepare interfaces
without creating that external state.

## First-party mobile authentication for sends

The current `/api/whatsapp/send` route authenticates the Next.js browser cookie
session. The approved extension lets the same route accept a first-party native
Supabase bearer session without accepting public API keys.

A shared request-auth helper behaves as follows:

1. If a bearer Authorization header is present, require the Bearer scheme and
   validate the access token server-side with Supabase.
2. Build an RLS-scoped Supabase user client carrying that token and the explicit
   branch header.
3. Resolve the caller, selected account membership, account lifecycle, and
   role independently of client claims.
4. Enforce the named `canSendMessages` capability and reject archived or
   unauthorized branches.
5. If no Authorization header is present, preserve the existing browser-cookie
   authentication path unchanged.

The route retains the existing per-user rate limit, conversation/account
lookup, parameter validation, Meta transport, persistence, flow-pause behavior,
and response shape. It does not accept a UsefulDesk public API key, service-role
key, Meta token, or user/role/account claim from the request body.

The mobile send client obtains the current access token immediately before the
request and attaches the selected branch header. A `401` triggers one Supabase
session refresh and one retry. A second `401` returns the app to secure auth
recovery. A `403` never retries as another branch. A `429` or provider/server
failure retains the draft and optimistic failed row for explicit retry.

## Failure behavior

- Initial list/thread failure shows a recoverable full-state error with Retry;
  an empty result has distinct first-use copy.
- Pagination failure preserves already-loaded content and exposes an inline
  retry without replacing the screen.
- Realtime disconnection preserves visible data, shows a concise connection
  state, and refetches after reconnection.
- A removed, archived, or unauthorized branch fails closed through the existing
  auth/bootstrap recovery rather than showing stale Inbox data.
- A missing conversation returns to the list with a concise unavailable state;
  it does not remain as an empty thread.
- Send validation errors keep the draft editable. Provider and network failures
  keep a failed bubble with Retry. The client never reports success before the
  server returns a persisted message id.
- Media and download errors never expose storage credentials or raw provider
  diagnostics. User-facing errors use safe application copy.
- Branch changes and sign-out cancel subscriptions and in-flight work before
  removing local entities.

## Security and privacy invariants

- Selected branch id is explicit on every API write and branch-aware Supabase
  request; server membership and database RLS revalidate it.
- Conversation ids, contact ids, user ids, roles, and account ids supplied by
  the client are identifiers, never authorization evidence.
- Mobile code contains only the approved public Supabase URL/key, public API
  base URL, and app environment.
- Logs, tests, screenshots, and documentation never contain real access tokens,
  customer message content, private media URLs, or provider credentials.
- Viewers remain read-only. Agent-or-higher customer sends are checked in both
  the UI capability and server boundary.
- The 24-hour free-form window and approved template contract are enforced by
  the existing server/provider path, not only by mobile presentation.
- No background or offline customer send occurs without a fresh explicit user
  action.

## Testing and acceptance gates

### Domain and repository tests

- Conversation/message normalization, keyset ordering, search composition,
  sender runs, date grouping, delivery presentation, session-window rules, and
  optimistic/realtime deduplication.
- Paginated reads, exact unread counts, branch isolation, returned-row update
  proof, stale-response sequence guards, and safe error mapping.

### Realtime tests

- Duplicate and out-of-order inserts, updates for absent/open/unrelated
  messages, one-hydrate-per-conversation behavior, disconnect/reconnect,
  AppState foreground resync, branch teardown, and sign-out teardown.

### Native component and screen tests

- Shared master accessibility and state contracts.
- List and thread loading, empty, error, pagination, search, filters, unread,
  large-history anchor preservation, jump-to-latest, and content-type fallbacks.
- Composer permissions, open/closed session behavior, optimistic success,
  failure/retry, template blockers, keyboard reachability, Dynamic Type, and
  reduced motion.

### Server tests

- Existing cookie behavior remains unchanged.
- Missing/malformed/invalid/expired bearer tokens return `401`.
- Valid bearer plus unauthorized, archived, invalid, or mismatched branch
  returns `403` without provider work.
- Viewer bearer is denied; agent-or-higher is permitted subject to rate,
  connection, conversation, and provider rules.
- Rate limiting remains user-scoped and the send core executes once per
  accepted request.

### Build and device gates

Each stage must pass mobile lint, typecheck, all Jest suites, Expo Doctor, iOS
and Android bundle exports, root verification, and `git diff --check`.

Physical-iPhone smoke covers sign-in/session restore, branch switch teardown,
list/history pagination, background/foreground resync, realtime incoming
messages, keyboard reachability, and connection loss. Customer-send smoke uses
only a test WhatsApp contact explicitly approved by the owner; implementation
and automated tests never send a real customer message.

## Rollout order

Each stage is independently reviewable and releasable. Stage 1 must be stable on
the physical iPhone before Stage 2 customer sends are enabled. Stage 2 text and
template behavior must be proven against an approved test contact before rich
media or notification work begins. Stage 3 media/replies/reactions can ship
before push notifications; push remains behind its separate credential,
server-delivery, native-build, and release authorization checkpoint.
