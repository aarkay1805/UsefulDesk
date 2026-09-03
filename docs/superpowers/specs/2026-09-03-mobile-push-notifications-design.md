# Mobile Push Notifications and Chat Sound Design

**Date:** 2026-09-03  
**Status:** Approved  
**Scope:** UsefulDesk Agent native Inbox push delivery, notification routing,
system sounds, and active-branch correctness for existing web notification
sounds.

## Decision

Use Expo Push Service for native iOS and Android message notifications. Persist
device installations and push-delivery work in Supabase, enqueue only after an
inbound WhatsApp message is durably inserted, attempt delivery immediately for
low latency, and retry from the existing operations cron for durability.

The first release uses the normal platform notification sound. It does not ship
a custom audio asset or implement an alarm-style repeating ringtone for chat
messages.

## Product behavior

### Recipients

- If a conversation has an assigned agent, notify only that user.
- If a conversation is unassigned, notify every active `owner`, `admin`, and
  `agent` member of the conversation's branch.
- Do not notify viewers, removed members, or users whose device installation is
  revoked.
- Deliver independently to every active installation owned by an eligible
  recipient.

Recipient eligibility is resolved at enqueue time and revalidated at delivery
time. A later assignment or membership change therefore cannot leak a queued
message to a user who is no longer eligible.

### Notification content

The title contains the contact's display name. The body contains the full text
of a professional inbound message, as explicitly approved for this release.
Media-only messages use a stable localized-neutral label: `Photo`, `Video`,
`Audio`, `Document`, `Location`, or `New WhatsApp message` for an unknown type.

The data payload contains only opaque identifiers and routing metadata:

- schema version;
- branch/account ID;
- conversation ID;
- persisted message ID; and
- delivery ID.

It contains no access token, provider credential, API key, phone number,
payment data, or serialized database row.

### Sound and foreground behavior

- Android uses a high-importance `messages` notification channel with the
  platform default sound and vibration behavior.
- iOS uses the platform default notification sound.
- Foreground notifications remain visible and play the system sound.
- Background and terminated delivery is owned by the operating system.
- Device silent mode, Focus/Do Not Disturb, notification permission, and
  per-channel settings always win.
- A chat notification sounds once. It does not repeat like an incoming phone
  call.

### Permission experience

After the first authenticated session reaches a valid selected branch, the app
shows a one-time explanation and then requests the system notification
permission. Declining does not block Inbox use or cause repeated prompts.

Account shows the current notification state and one relevant action:

- `Enable notifications` when the system still permits an in-app request; or
- `Open settings` after denial or when the platform requires settings.

The explanatory prompt state is installation-local. Permission and token state
remain system-authoritative and are refreshed whenever the app foregrounds.

## Architecture

### Database

Add two focused tables in the next sortable migration.

`push_installations` represents one installed app instance:

- stable installation UUID generated and stored in SecureStore;
- owning `user_id`;
- platform (`ios` or `android`);
- environment (`development`, `preview`, or `production`);
- Expo push token;
- optional app version and device metadata limited to operational fields;
- `last_seen_at`, `revoked_at`, and timestamps.

The active token is unique within an environment. Registration may move a token
to the authenticated installation/user, but it never trusts a user ID supplied
by the client. Clients cannot list raw tokens. Registration, heartbeat, and
revocation happen through authenticated API routes backed by service-role
writes; database triggers still enforce user consistency where applicable.

`push_deliveries` is the durable outbox and receipt ledger:

- account, conversation, message, recipient user, and installation IDs;
- presentation title/body plus versioned opaque data payload;
- state (`pending`, `sending`, `ticketed`, `delivered`, `retry`, `failed`, or
  `cancelled`);
- attempt count, next-attempt time, lease owner/expiry, Expo ticket ID;
- sanitized provider error classification and timestamps.

A unique `(message_id, installation_id)` constraint makes Meta webhook replay
and dispatcher retry idempotent. Foreign keys preserve tenant ownership.
Browser roles receive no direct delivery-table access.

Use security-definer RPCs for three atomic operations:

1. enqueue eligible deliveries for one newly inserted inbound message;
2. claim a bounded due batch with a lease; and
3. settle ticket/receipt outcomes only for the current lease owner.

The enqueue RPC derives the contact, conversation, assignment, memberships,
and installations in the database. Service code does not assemble an
authorization-sensitive recipient list from untrusted inputs.

### Registration API

Add a branch-independent mobile bearer-auth resolver that validates the
Supabase access token with `auth.getUser()` but does not require a selected
branch. Registration is a user/device operation, while notification generation
remains branch-authorized.

`PUT /api/mobile/push/installation` validates the installation UUID, Expo token,
platform, environment, and bounded metadata, then upserts the authenticated
user's installation. `DELETE` revokes that exact authenticated installation and
is idempotent. Neither response returns another installation or a stored token.

Sign-out attempts remote revocation before local credentials are destroyed.
Local secure teardown proceeds even if the network call fails; the server-side
delivery eligibility check and Expo token retirement remain the safety net.

### Enqueue and dispatch

The WhatsApp webhook calls the enqueue RPC only after the inbound `messages`
upsert returns a newly inserted internal ID and after the conversation unread
state is updated. Duplicate Meta deliveries exit before this boundary.

Enqueue failure is recorded and logged but does not roll back or reject the
customer's WhatsApp message. The webhook starts a bounded best-effort drain
after enqueue. Provider latency or failure must not prevent the durable receipt
from completing; remaining work stays in the outbox.

Add `/api/push/cron` to the existing operations dispatch group. Both immediate
and cron drains use one server-only Expo client module. The module:

- claims a bounded leased batch;
- sends Expo requests in provider-supported chunks;
- classifies request, ticket, and receipt errors;
- retries transient failures with capped exponential backoff and jitter;
- retires installations on permanent device/token errors;
- records only sanitized diagnostics; and
- never logs tokens or message bodies.

Ticket success is not final delivery. Ticket IDs remain `ticketed` until a
later drain requests Expo receipts. Receipt success becomes `delivered`;
permanent receipt failure becomes `failed` and may revoke the installation;
transient receipt failure becomes `retry`.

### Mobile lifecycle

Create a native notification boundary under `apps/mobile/src/native` and a
feature coordinator under `apps/mobile/src/features/notifications`. Expo APIs
stay behind injected adapters so Jest does not require a device runtime.

The coordinator:

- creates/loads the SecureStore installation ID;
- configures the Android channel before requesting permission;
- requests permission only through the approved one-time experience;
- obtains the Expo token using the EAS project ID;
- registers and refreshes the installation using the current access token;
- responds to native token rollover;
- refreshes permission/registration state on foreground;
- revokes before sign-out where possible; and
- removes listeners during auth teardown.

Missing EAS project ID, simulator limitations, offline registration, denied
permission, and provider unavailability are recoverable notification states,
not authentication failures.

### Notification opening and deep links

One routing coordinator handles foreground taps, background taps, and the last
notification response on cold start. It validates the versioned payload before
acting and queues at most one pending destination while authentication is not
ready.

For an accepted destination it:

1. requires a current authenticated session;
2. finds the referenced branch in the freshly validated branch list;
3. switches branch through the existing `selectBranch` path when necessary;
4. waits until the ready state names that exact branch;
5. performs a bounded RLS-backed conversation reconciliation; and
6. navigates to the exact conversation only when it remains readable.

Malformed, stale, archived-branch, removed-membership, deleted-conversation, or
cross-tenant payloads fail closed to Inbox with concise recovery feedback. A
notification never bypasses branch selection or relies on its displayed
contact/message copy for authorization.

## Existing web sounds

The web Inbox chime remains an in-page Realtime cue, not a push notification.
It continues to require an open dashboard and one user gesture before Web Audio
can run.

Fix the follow-up reminder ringtone so both its hydration query and Realtime
events are scoped to the active `accountId`. Clear tracked reminders on branch
change. Add focused tests for branch filtering, event handling, audio-context
unavailability, suspended-context recovery, and stop behavior. Do not make web
audio failures block notification badges or Inbox data.

## Failure handling and observability

- Permission denial: keep Inbox functional and surface the Account recovery
  action.
- Offline token registration: retain a local retry-needed state and retry on
  foreground/session refresh.
- Token rollover: register the replacement and retire the superseded token.
- Membership/assignment change: delivery-time database validation cancels an
  ineligible delivery.
- Duplicate webhook or cron overlap: unique keys plus leased claims make the
  operation idempotent.
- Expo rate limit or `5xx`: retry with backoff.
- Invalid Expo token or `DeviceNotRegistered`: revoke installation and fail its
  outstanding work permanently.
- Stale lease: a later worker may reclaim it after expiry.
- Unexpected provider response: sanitize, retain bounded diagnostic context,
  and retry only when classification is safe.

Cron responses expose aggregate counts only: claimed, ticketed, delivered,
retried, failed, cancelled, and installations retired. Logs exclude tokens,
message bodies, contact names, and phone numbers.

## Testing and acceptance

### Automated tests

- Migration/schema contracts: tables, indexes, constraints, RLS, grants,
  recipient selection, leases, idempotency, and permanent-token retirement.
- Registration routes: missing/malformed/expired bearer, cross-user mutation,
  valid upsert, heartbeat, idempotent revoke, and secret-safe responses.
- Enqueue: assigned-only, unassigned agent-or-higher fan-out, viewer exclusion,
  revoked-installation exclusion, duplicate message suppression, and changed
  membership/assignment cancellation.
- Expo client: chunking, transient request failures, partial ticket errors,
  receipt success, receipt delay, permanent token errors, bounded retry, and
  log sanitization.
- WhatsApp webhook: enqueue occurs once after durable inbound insertion and a
  push failure cannot reject or duplicate the message.
- Native coordinator: permission states, Android channel ordering, project-ID
  absence, token refresh, sign-out revoke, foreground refresh, listener
  cleanup, and offline recovery.
- Routing: foreground/background/cold-start responses, malformed payloads,
  auth wait, authorized branch switch, removed membership, deleted
  conversation, and reconciliation-before-navigation.
- Web audio: active-branch scoping and browser audio edge cases.

### Build and device gates

- Mobile lint, TypeScript, all Jest suites, Expo Doctor, and iOS/Android bundle
  exports.
- Root formatting, lint, TypeScript, Vitest suites, and production build.
- `git diff --check` and focused secret/PII log review.
- Physical iPhone and Android development-build tests for allow/deny,
  foreground, background, terminated, tap routing, branch switch, sign-out,
  system sound, Focus/silent behavior, and token refresh.
- A test WhatsApp contact sends the only acceptance messages. No automated test
  sends a real customer message.

Real-device remote push acceptance requires an EAS project ID and valid
APNs/FCM credentials. Code and local builds may complete without those secrets,
but the feature is not release-ready until both platforms pass the physical
delivery matrix.

## Documentation and rollout

On completion, update `docs/changelog.md` and `PRDs/roadmap.md` in the same
change. Mark push as shipped only after automated gates pass; record remote
iOS/Android delivery as verified or explicitly pending. Keep the notification
feature behind release/build credential readiness rather than silently
claiming delivery when EAS/APNs/FCM is unavailable.

## Explicit non-goals

- Custom UsefulDesk sound assets.
- Repeating alarm-style chat ringtones.
- Marketing, renewal, payment, or broadcast push campaigns.
- Web Push/service-worker notifications.
- Notification preference categories or per-contact mute controls.
- Persisting full notification history in the native app.
- Direct APNs or FCM server integration.
