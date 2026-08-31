# Agent mobile foundation and WhatsApp inbox

> Status: awaiting user review
> Date: 2026-08-31
> Scope: repository workspace, native application shell, authenticated branch context, and the first customer WhatsApp inbox slice

## Decision

Build a true native UsefulDesk agent application with Expo and React Native in `apps/mobile`, inside the existing UsefulDesk repository. Keep the mature Next.js application at the repository root. The first implementation slice delivers the mobile foundation and a usable customer WhatsApp inbox; it does not attempt full web parity.

HeroUI Native is an implementation dependency behind UsefulDesk-owned native master components. The mobile app reuses product rules, database/RLS boundaries, Supabase Auth, WhatsApp send infrastructure, locale rules, and pure domain code where it is genuinely platform-neutral. It does not import web UI components, DOM code, Next.js modules, or browser Tailwind classes.

Customer WhatsApp is the only chat surface. Internal staff messaging is not part of the product.

## Product outcome

An authorized owner, admin, or agent can install the application, sign in with an existing UsefulDesk identity, select an accessible branch, see the branch's WhatsApp conversations, open a thread, receive new messages in near real time, send permitted replies and templates, and inspect the customer's essential CRM context without returning to the desktop application.

The slice is successful when the mobile inbox is dependable enough for an agent's normal reply workflow. Placeholder tabs and non-functional demonstrations do not count as completion.

## Why this is the first slice

- Customer WhatsApp is explicitly mandatory for the mobile product.
- Authentication, selected-branch RLS, realtime reconciliation, media, notifications, and API authentication are foundations reused by every later mobile feature.
- A vertical inbox slice proves native navigation, server integration, local persistence, and delivery-state behavior without first copying the entire CRM.
- Renewals, collections, attendance, and follow-ups remain separate implementation slices after this foundation is verified.

## Non-goals

- Internal staff chat
- Owner analytics or mobile copies of Business reports
- Member creation, membership checkout, attendance, payment collection, or follow-up management in this slice
- Broadcast creation or automation management
- Account, WhatsApp, plan, catalogue, staff, or payment-gateway configuration
- Offline WhatsApp sending; offline composition is a draft, never a queued provider send
- A member-facing app, kiosk mode, trainer mode, or tablet-first operations
- Moving the web application into `apps/web`
- Sharing React components between web and mobile
- Embedding a UsefulDesk public API key, Supabase service-role key, Meta token, or Razorpay credential in the app

## Repository layout

The existing root remains both the web package and the npm workspace root during this phase:

```text
UsefulDesk/
├── src/                              existing Next.js application
├── public/
├── apps/
│   └── mobile/
│       ├── app/                      Expo Router route declarations
│       ├── src/
│       │   ├── core/                 providers and app lifecycle
│       │   ├── data/                 Supabase, HTTP, local DB, sync
│       │   ├── features/             vertical product slices
│       │   ├── native/               device capability adapters
│       │   └── ui/                   UsefulDesk native masters
│       ├── assets/
│       ├── app.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/                         created only when sharing is real
├── docs/mobile/
├── package.json
└── package-lock.json
```

The root `package.json` gains npm workspaces for `apps/*` and `packages/*` plus explicit mobile scripts. A root install owns the single lockfile. The initial change must not relocate web files, rewrite web imports, or change Vercel's project root.

`apps/mobile/AGENTS.md` may be added with mobile-only rules. It must defer to the root `AGENTS.md` for product, tenancy, authorization, locale, and domain invariants rather than copying them.

## Technology choices

- Current stable Expo SDK supported by the selected HeroUI Native release at implementation time
- React Native with the enabled default New Architecture
- TypeScript strict mode
- Expo Router for file-based stacks, tabs, modals, and deep links
- Expo development builds for native-module testing; Expo Go is not an acceptance environment
- HeroUI Native behind UsefulDesk native master components
- Supabase JS for user-session Auth, RLS reads/writes, Storage, and Realtime
- Expo SecureStore for session persistence
- Expo SQLite for bounded local cache, drafts, and sync metadata
- Expo Notifications for APNs/FCM registration and routing
- Platform camera, media-picker, file, haptics, connectivity, and app-lifecycle adapters through Expo modules where they fit

No additional global state library is required initially. Remote and local repositories own persisted state; React context owns session, selected branch, locale, theme, and connectivity. Introduce another state dependency only for a demonstrated cross-feature need.

## Native application boundaries

### Route layer

Files under `apps/mobile/app` declare navigation and compose screens. They contain no Supabase query construction, message reconciliation, or product mutations.

```text
app/
├── _layout.tsx
├── (auth)/
│   ├── sign-in.tsx
│   └── select-branch.tsx
└── (app)/
    ├── _layout.tsx
    ├── (tabs)/
    │   ├── inbox.tsx
    │   └── account.tsx
    ├── conversation/[conversationId].tsx
    └── contact/[contactId].tsx
```

Only Inbox and the supporting contact summary are functional in this slice. The initial release must not ship dead primary tabs. Until the later slices exist, the root navigation exposes Inbox and Account/More; additional tabs are added only with working content.

### Feature layer

Each feature is a vertical module with its own screens, native components, repositories, models, and tests. The inbox module does not import route files.

```text
src/features/inbox/
├── api/
├── components/
├── models/
├── repository/
├── screens/
├── sync/
└── tests/
```

### UsefulDesk native UI layer

Feature code imports UsefulDesk components from `src/ui`, not `heroui-native` directly. The first master set is deliberately small:

- `Button` and `IconButton`
- `Input` and `SearchInput`
- `UserAvatar`
- `Badge` and `Chip`
- `ListRow`
- `BottomSheet`
- `Dialog`
- `Toast`
- `EmptyState` and `ErrorState`
- `LoadingList`
- `MessageBubble`, `MessageComposer`, and `DeliveryState`

The wrappers own touch size, typography, dynamic type, reduced motion, focus, accessibility labels, disabled/loading behavior, semantic colours, and dark mode. Screen-level code may control layout but not restyle a master component's internal recipe.

Mobile reuses the desktop design language, status vocabulary, chat semantics, and design tokens. It does not reproduce desktop geometry mechanically. Native safe areas, keyboard avoidance, full-screen stacks, bottom sheets, platform back behavior, and 44-48px touch targets take precedence.

## Authentication and selected branch

1. Supabase Auth signs in the existing human user.
2. The refreshable user session is persisted with SecureStore; no long-lived app-specific secret is created.
3. After `getUser()` succeeds, the app loads the profile plus `my_branch_accounts`, following the same fail-closed resolution rules as `loadDashboardAuthBootstrap`.
4. One selected branch ID is stored as non-secret preference data. Every startup revalidates it against current memberships before use.
5. A branch-scoped Supabase client attaches `x-usefuldesk-account-id` to PostgREST requests. Switching branch disposes branch-scoped repositories, realtime channels, cached branch data, and open routes before creating the new context.
6. Archived, unauthorized, malformed, unreadable, or removed branches fail closed. The app never falls through silently to a different branch after an explicit deep link.
7. The UI always displays the current branch in Account/More and in branch-sensitive notification context.

Capabilities remain named predicates from `src/lib/auth/roles.ts` or a platform-neutral extracted package. Mobile call sites do not compare role strings inline. Viewers may read the inbox but do not receive a composer or mutation controls; agent and above use `canSendMessages`.

## Human-session HTTP authentication

The native app must not use `/api/v1` API keys. Those keys authenticate machines, use a service-role client, and are unsafe to distribute in an installed app.

RLS reads and ordinary RLS writes use the mobile Supabase user client directly. Server-owned operations such as WhatsApp send still require Next.js routes because Meta credentials and send orchestration remain server-only.

Add one request-auth adapter for internal human routes:

- Web requests continue using the established Supabase cookie session.
- Native requests send `Authorization: Bearer <Supabase access token>` plus `x-usefuldesk-account-id`.
- The adapter constructs an anon-key Supabase client carrying the user token and selected-branch header, calls `auth.getUser()`, loads exact branch membership, and preserves RLS.
- Existing named capability checks remain the authorization source.
- The adapter never changes an API-key route, never upgrades to service role, and never trusts a user or account ID from the request body.
- Logs, errors, analytics, and crash reports must never include the bearer token.

The first consumer is `POST /api/whatsapp/send`. The implementation should make the authentication adapter reusable by later mobile checkout, payment-link, invoice, and media routes without creating a parallel `/api/mobile/*` copy of every product endpoint.

## Inbox data flow

### Conversation list

The list loads branch-scoped conversations under RLS using the canonical contact/member/tag projection currently represented by `CONVERSATION_SELECT`. The mobile repository owns a platform-neutral equivalent rather than importing a file that pulls in web aliases or types.

The first list supports:

- All, Unread, Members, Leads, Open, Pending, and Closed filters
- Name, phone, and latest-message search
- Contact tag filtering
- Unread count
- Last-message preview and localized relative time
- Pull to refresh
- Empty, initial loading, refresh failure, and offline-cache states

Use a virtualized native list. Cache a bounded normalized snapshot by branch. The cache accelerates startup but never widens authorization; cached rows are deleted on sign-out, membership loss, or branch removal.

### Conversation thread

Opening a conversation loads messages in chronological pages rather than downloading an unbounded history. The screen supports:

- Text, image, video, audio, document, location, and template presentation already supported by the persisted message model
- Reply context
- Reactions through the existing server-owned reaction path, made bearer-session compatible with the same auth adapter
- Sending, sent, delivered, read, and failed states
- Date separators and sender-run spacing
- Jump to latest when the reader is above the bottom threshold
- Customer profile entry point
- Conversation status update under RLS
- Read/unread reset under RLS

The mobile thread retains the desktop inbox invariants: new events do not drag a reader who is inspecting history to the bottom; delivery updates for other conversations do not rebuild the open message list; a missed realtime interval is repaired by foreground/reconnect refresh.

### Composer and 24-hour window

Inside an open WhatsApp customer-service window, agent+ may send free-form text and supported media. When the window is closed, the normal composer and reply action are removed and the bottom action becomes `Send a template`.

A draft is stored locally per branch and conversation. Draft text and staged attachment metadata survive navigation and process restart. A draft is not a sent message and is never transmitted automatically when connectivity returns.

Message sends use an idempotency key added to the authenticated send contract. Optimistic bubbles reconcile by that client key or returned message ID; they are not removed merely because any realtime INSERT arrives. A failed send remains visible with explicit Retry and Remove actions. Retry reuses the same logical idempotency key and cannot create a duplicate provider send.

### Templates

The picker reads only Approved and synced templates available to the selected branch. It preserves the existing template registry, parameter ordering, language, header media, and button parameter contracts. The mobile app submits structured intent; server code renders and validates the authoritative provider request.

### Media

The device picker/camera produces a local staged attachment. The app validates supported type and size before upload, uploads through the account-scoped media helper or a mobile-safe equivalent, displays progress, then calls the canonical send route. An upload that never becomes a send is garbage-collected through an authorized server/storage path. Private invoice-document rules are not part of chat-media upload.

## Realtime and reconciliation

Supabase Realtime is an acceleration path, not the source of truth. The implementation must first prove event delivery on both the profile-default branch and a different authorized selected branch. PostgREST carries `x-usefuldesk-account-id`, while the existing database selection fallback uses the profile branch when request headers are absent; a channel that silently falls back is not accepted as branch-correct.

- One branch-filtered channel observes conversation changes needed by the list.
- One open-thread channel observes messages and reactions filtered to the exact conversation.
- Event reducers are idempotent by database ID and client idempotency key.
- Reconnect, app foreground, notification open, and manual refresh trigger bounded reconciliation reads.
- Background execution is not relied upon for continuous sockets or guaranteed periodic synchronization.
- Branch switch and sign-out synchronously remove channels before clearing the old data context.
- If the selected-branch proof fails, direct database Realtime is disabled for that context. Push-triggered refresh plus a bounded foreground reconciliation interval keeps the app correct until a separately reviewed branch-safe realtime transport exists; the app must not broaden RLS or subscribe to cross-branch rows as a shortcut.

## Local persistence and offline behavior

SQLite stores only bounded operational data:

- Conversation-list snapshot
- Recent message pages for recently opened threads
- Per-conversation drafts
- Sync cursors and last successful reconciliation time
- Failed local upload/send preparation metadata that has not reached Meta

The first slice does not maintain a generic offline mutation outbox. WhatsApp requires live server/provider validation, so Send is unavailable offline while the draft remains editable. Conversation status and read-state changes may be optimistic online but are not queued across an offline session.

Sensitive local retention is minimized. Sign-out removes the selected branch, cached CRM/message data, notification routing data, and drafts after warning the user about unsent drafts. Access and refresh tokens remain in SecureStore rather than SQLite.

## Push notifications and deep links

The app registers one installation record per authenticated device, user, platform, environment, and push token. Registration and revocation are branch-independent user operations; notification generation still checks current branch membership before delivery.

The first slice sends a privacy-minimized notification for a new inbound customer message assigned or visible to the user. The payload carries opaque branch, conversation, and message identifiers; it does not include full message text, phone number, payment data, or auth material. The displayed preview follows the user's notification preference and defaults to a generic `New WhatsApp message` on the lock screen.

Opening a notification:

1. validates the current session;
2. validates branch membership;
3. switches to the referenced authorized branch if necessary;
4. opens the exact conversation;
5. performs a reconciliation read before rendering the message.

Stale, revoked, archived-branch, or unauthorized links fail closed into Inbox with a concise explanation.

## Essential customer context

The first contact screen is intentionally read-mostly. It shows the canonical avatar, name, formatted phone, lead/member classification, tags, assignee, membership plan/expiry/due summary when present, and recent notes/follow-up summary when readable under RLS.

It does not reproduce the desktop's complete editable `ContactDetailContent`. Editing, assignment transfer, note creation, checkout, attendance, and payment actions arrive with their respective mobile slices. A direct phone call may use the native dialer, but the app does not claim that a call occurred until an explicit outcome workflow exists.

## Error and recovery behavior

- Expired access token: attempt the normal Supabase refresh once, then return to sign-in without discarding local drafts.
- Removed branch membership: close realtime, purge that branch's cache, and return to branch selection.
- WhatsApp disconnected: retain read access; remove send actions and explain that an administrator must reconnect on the web.
- Closed customer-service window: replace free-form actions with the template path.
- Network loss: show cached content with an offline banner; preserve drafts; disable Send.
- Realtime loss: show no alarming global error while reads work; reconcile on reconnect and foreground.
- Send rejection: keep the failed bubble and server-provided safe reason; allow deliberate retry where applicable.
- Media upload failure: preserve the local staged attachment for retry and remove any known orphaned remote object when safe.
- Unauthorized/deleted conversation: remove stale cache and return to Inbox without revealing cross-tenant existence.
- Database write returning zero rows: treat as failure, matching the existing RLS blocked-write rule.

## Testing strategy

### Shared and server tests

- Cookie and bearer human-session auth resolve the same user, selected branch, role, and RLS behavior.
- Invalid, expired, wrong-audience, malformed, and cross-branch bearer requests fail closed.
- Public API keys remain isolated from human-session auth.
- WhatsApp send preserves capability, rate-limit, conversation tenancy, template, and provider validation for both transports.
- Idempotency prevents duplicate message rows and provider sends under timeout/retry.

### Mobile unit and component tests

- Branch selection and invalidation
- Capability-gated composer behavior
- Conversation normalization, filtering, and ordering
- Realtime reducer idempotency and optimistic-message reconciliation
- 24-hour-window composer replacement
- Draft persistence and cleanup
- Delivery-state accessibility labels
- Deep-link authorization outcomes

### Device integration tests

- Secure session restore and sign-out cleanup
- Cold-start and foreground notification routing
- iOS keyboard, safe-area, swipe-back, and dynamic type
- Android hardware back, notification channels, and process recreation
- Camera/media permission denial and recovery
- Offline launch, reconnect reconciliation, and failed send retention
- Real-device performance on a large conversation list and long thread

### Acceptance environments

- Development builds on at least one supported iPhone and one representative Android device
- Test Supabase/WhatsApp environment for end-to-end sends
- No real customer send and no Production rollout without explicit authorization

## Delivery decomposition

This design is intentionally implemented through separate plans rather than one app-wide plan.

1. **Workspace and native foundation** — npm workspace, Expo app, environment validation, UsefulDesk provider shell, base native masters, secure auth, selected branch, and signed development builds.
2. **Read-only inbox** — cached conversation list, paginated thread, realtime reconciliation, contact summary, native navigation, and failure states.
3. **Outbound WhatsApp** — bearer human-session route auth, text/template/media send, 24-hour window, idempotency, optimistic reconciliation, reactions, and draft persistence.
4. **Push and release hardening** — installation registry, privacy-minimized notifications, deep links, device testing, telemetry, store configuration, and internal beta.

Each step must leave the app demonstrably usable and tested. Later product slices—Today/follow-ups, People, attendance, renewals and collections, then trainer workflows—receive their own approved specifications and plans.

## Completion criteria for this slice

- `apps/mobile` builds reproducibly from the repository root and does not alter the web deployment root.
- Existing users authenticate without a second identity or embedded secret.
- Branch selection is explicit, revalidated, and attached to every data path.
- Viewer and agent capabilities match web and RLS behavior.
- The list and thread recover from missed realtime events without duplicates or forced scroll jumps.
- Agent+ can send authorized text, templates, and supported media through the canonical WhatsApp send core.
- Closed-window, disconnected, offline, failed, and unauthorized states have explicit recovery behavior.
- Push notifications open the correct authorized conversation without exposing sensitive payload data.
- Sign-out and membership removal purge cached branch data.
- iOS and Android development builds pass the defined device scenarios.
