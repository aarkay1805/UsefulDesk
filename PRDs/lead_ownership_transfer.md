# Lead Ownership Transfer — role-gated reassign + peer handoff

> **AMENDMENT (as built).** "Ownership" = the **"Received by" human =
> `contacts.user_id`**, NOT `assigned_to`. `assigned_to` stays a separate
> reassignable "assignment" field, untouched by transfers. `received_via`
> stays the immutable origin channel; **only human-received leads**
> (`received_via` NULL/manual/import) are transferable — system-generated
> captures are locked. The transfer UI lives on the **Received-by column**
> (leads table cell + detail sheet row), not the Assignee cell. Everywhere
> below that says `assigned_to`, read `user_id`. Because ownership moves via
> `user_id`, `notify_lead_assigned` (which watches `assigned_to`) does NOT
> fire, so the RPCs notify the new owner explicitly on admin-instant and
> admin-force-accept. There is no "self-claim an unassigned lead" case
> (`user_id` is always set). Bulk assignment stays as it was (not gated).

> **ADDENDUM — Assignment approval (migration 052, built + live).** A
> SECOND, separate flow governs the **"Assigned to"** delegate
> (`contacts.assigned_to`), NOT ownership. Rule: the lead's OWNER
> (Received-by `user_id`) or an admin change it instantly; **any other
> agent's change becomes a request the OWNER approves** — approver = the
> owner OR any admin, and crucially NOT the target teammate (the opposite
> of ownership transfer, where the target accepts). Covers any change incl.
> unassign. Same `lead_transfers` table via a `kind` discriminator
> (`ownership`/`assignment`) + `approver_user_id`; RPCs
> `request_lead_assignment` / `respond_lead_assignment` /
> `cancel_lead_assignment`; notif types `lead_assignment_*`. UI on the
> Assignee cell (overlay + Approve/Reject/Withdraw) + `/notifications`.

> Status: **BUILT + live.** Migration `050_lead_transfers.sql`.
> Builds on 047 (assigned_to → auth.users, notify_lead_assigned), 049
> (pending-invite overlay), 027 (notifications + realtime), 017 (RLS +
> `is_account_member`), and the `roles.ts` capability-predicate rule.

## 1. Problem & principle

A lead has an owner (`contacts.assigned_to` → `auth.users`) or a human
"received by" agent. Today **any agent can instantly reassign any lead to
anyone** (`contacts_update` RLS = `is_account_member(account_id,'agent')`;
the inline assignee cell does a raw `.update({assigned_to})`). That's fine
for a manager, wrong for a peer — an agent can silently dump leads on a
colleague, or yank a colleague's lead.

Conventional CRM practice is **role-split**:

- **Managerial reassign (instant).** Owner/admin routes any lead to anyone.
  No acceptance — a manager doesn't need permission.
- **Peer handoff (request → accept).** Agent → agent transfer is a *request*
  the receiver must accept. Prevents dumping and yanking.

Non-negotiable from the product principles: **every lead always has an
owner**. A pending transfer never removes the current owner — ownership
flips only on acceptance. No lead ever goes ownerless or into limbo.

## 2. Role matrix

| Action | owner | admin | agent | viewer |
|---|:--:|:--:|:--:|:--:|
| Direct reassign, single lead | ✓ instant | ✓ instant | ✗ | ✗ |
| Bulk reassign (BulkEdit "Assigned to") | ✓ | ✓ | ✗ *(hidden)* | ✗ |
| Self-claim an **unassigned** lead | ✓ | ✓ | ✓ instant | ✗ |
| Request transfer of a lead **they own** | ✓ *(instant)* | ✓ *(instant)* | ✓ **pending** | ✗ |
| Accept / decline a request **targeted at them** | ✓ | ✓ | ✓ | ✗ |
| Force-resolve / cancel **any** pending request | ✓ | ✓ | ✗ | ✗ |
| Cancel **their own** request | ✓ | ✓ | ✓ | ✗ |

Rules that fall out of the matrix:

- Everything routes through **one entry point** — `request_lead_transfer`.
  The RPC decides *instant vs pending* from the caller's role, so the UI
  never branches on role for the write (only for labels/affordances).
- An **agent may only initiate on a lead they currently own** (or claim one
  that is unassigned). Reassigning someone else's lead is admin-only.
- **Bulk reassign is admin/owner only** (managerial by definition). Agents
  do single-lead requests — bulk would spam N acceptance requests.
- **Viewers** are inert: never initiator, target, or resolver.

## 3. Data model — `lead_transfers` (migration 050)

A transfer is a small state machine + audit trail, so it gets its own table
(not overlay columns on `contacts`). Because it's account-readable (unlike
admin-only `account_invitations`), agents can read it directly — **no
denormalized pointer on `contacts` is needed** (avoids the 049 sync-drift
trade-off). The leads list fetches pending transfers in one light query,
exactly like `fetchTags` / `fetchPendingAssignees`.

```sql
CREATE TABLE IF NOT EXISTS lead_transfers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id)  ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
  -- Current owner at request time. SET NULL keeps the audit row if that
  -- teammate is later removed (their leads already fall to NULL via 047).
  from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Proposed new owner. CASCADE: if the target is removed while a request
  -- is still pending, the dangling request disappears cleanly.
  to_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined',
                                   'cancelled','superseded')),
  note         TEXT,                      -- optional message from requester
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- At most ONE pending transfer per lead (a re-request supersedes the old).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_transfer_pending
  ON lead_transfers(contact_id) WHERE status = 'pending';

-- "Requests waiting on me" (the receiver inbox) + the leads-list badge scan.
CREATE INDEX IF NOT EXISTS idx_lead_transfers_incoming
  ON lead_transfers(to_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lead_transfers_account_pending
  ON lead_transfers(account_id) WHERE status = 'pending';
```

### State machine

```
            request_lead_transfer (agent, owns lead)
   ┌───────────────► pending ───────────────┐
   │                   │  │  │               │
   │  accept (target/  │  │  │ cancel        │ admin direct-reassign
   │  admin)           │  │  │ (requester/   │ or new request on
   │                   │  │  │  admin)       │ same lead
   ▼                   ▼  ▼  ▼               ▼
 accepted          declined  cancelled   superseded
 (assigned_to      (owner    (owner       (owner unchanged;
  := to_user)       unchanged) unchanged)   old row auto-closed)
```

Terminal states are immutable. `resolved_at` / `resolved_by` stamped on exit
from `pending`.

## 4. Mutations — SECURITY DEFINER RPCs

All writes go through definer functions (owner `postgres`, `GRANT EXECUTE …
TO authenticated`). **No client INSERT/UPDATE/DELETE grant on the table** —
same posture as `notifications` and `redeem_invitation`. This centralizes
the role rules and the state machine server-side; RLS on the table is
SELECT-only.

### `request_lead_transfer(p_contact_id uuid, p_to_user uuid, p_note text)`
Returns `TEXT` status (`'accepted'` = instant, `'pending'` = handshake).

Logic:
1. `v_uid := auth.uid()`; must be non-null. Resolve `v_account_id` from the
   contact; caller must be `is_account_member(v_account_id,'agent')`.
2. Validate target: `p_to_user` is a real member of `v_account_id`
   (`profiles` row), not the current owner, not the caller-as-current-owner
   no-op, not a viewer.
3. Load `v_owner := contacts.assigned_to`, `v_pending_invite :=
   contacts.pending_invitation_id`.
   - If `v_pending_invite IS NOT NULL` (lead parked on a not-yet-joined
     invitee) → **admins only**; on assign, also clear the 049 overlay
     (`pending_invitation_id / pending_assignee_name := NULL`).
4. **Instant path** — `is_account_member(v_account_id,'admin')` OR
   (`v_owner IS NULL` and caller is claiming: `p_to_user = v_uid`):
   - `UPDATE contacts SET assigned_to = p_to_user, pending_* = NULL …`.
   - Supersede any existing pending row for this contact.
   - Insert a `lead_transfers` row `status='accepted', resolved_at=now(),
     resolved_by=v_uid` (audit).
   - Return `'accepted'`. *(The `notify_lead_assigned` trigger fires; if the
     admin assigned to someone else it notifies them — desired. If self-claim,
     the self-guard suppresses.)*
5. **Pending path** — caller is an agent transferring a lead **they own**
   (`v_owner = v_uid`; else raise `42501 'Only the current owner or an admin
   can transfer this lead.'`):
   - Supersede any existing pending row for this contact
     (`status='superseded'`).
   - Insert `status='pending'`, `from_user_id=v_owner`, `to_user_id=p_to_user`,
     `requested_by=v_uid`, `note=p_note`.
   - Insert a `lead_transfer_request` notification for `p_to_user`
     (`reference_id := <new transfer id>`) — see §5.
   - Return `'pending'`. **`contacts.assigned_to` is untouched.**

### `respond_lead_transfer(p_transfer_id uuid, p_accept boolean)`
1. Load transfer `FOR UPDATE`; must be `status='pending'`.
2. Caller must be `to_user_id` **OR** `is_account_member(account_id,'admin')`
   (force-resolve). Else `42501`.
3. **Accept** → `UPDATE contacts SET assigned_to = to_user_id, pending_* =
   NULL WHERE id = contact_id`; set transfer `accepted / resolved_*`; notify
   `requested_by` **and** `from_user_id` with `lead_transfer_accepted`.
   *(The contacts trigger fires `notify_lead_assigned` to the new owner; when
   the acceptor is the target, `auth.uid() = assigned_to` → self-guard
   suppresses the duplicate. An admin force-accept DOES notify the new
   owner — correct.)*
4. **Decline** → transfer `declined / resolved_*`; notify `requested_by`
   with `lead_transfer_declined`. Ownership unchanged.

### `cancel_lead_transfer(p_transfer_id uuid)`
Caller = `requested_by` OR account admin. Pending → `cancelled`. Optionally
notify `to_user_id` (`lead_transfer_cancelled`). Ownership unchanged.

> **Concurrency:** the `FOR UPDATE` lock + the `uniq_lead_transfer_pending`
> partial index make "two people resolve at once" and "two requests race on
> one lead" safe — the loser gets a clean `23505` / "already resolved".

## 5. Notifications

Extend the `notifications.type` CHECK (currently
`conversation_assigned | lead_assigned | follow_up_reminder`, set in 047):

```sql
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned','lead_assigned','follow_up_reminder',
                  'lead_transfer_request','lead_transfer_accepted',
                  'lead_transfer_declined','lead_transfer_cancelled'));

-- Generic pointer so a notification can deep-link to its subject (here, the
-- transfer id for the inline Accept/Decline buttons). Nullable, no FK (keeps
-- notifications decoupled from every subject table).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id UUID;
```

- `lead_transfer_request` → recipient `to_user`, `contact_id` set,
  `reference_id = transfer.id`, `actor_user_id = requested_by`. This is the
  actionable one (Accept/Decline).
- `lead_transfer_accepted` / `_declined` / `_cancelled` → informational, to
  the requester (and prior owner on accept).

Add the new types to `Notification['type']` in `src/types/index.ts` and an
icon per type in the notifications page `TYPE_ICON` map.

`lead_transfers` joins `supabase_realtime` (like `notifications` in 027) so
the incoming-request badge and the leads-list overlay update live.

## 6. RLS (table is SELECT-only from clients)

```sql
ALTER TABLE lead_transfers ENABLE ROW LEVEL SECURITY;
-- Account-scoped read, matching contacts_select. Enough for the leads badge,
-- the receiver inbox, and the audit view. All writes go through the RPCs.
DROP POLICY IF EXISTS lead_transfers_select ON lead_transfers;
CREATE POLICY lead_transfers_select ON lead_transfers FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy → definer RPCs only (revoke table writes).
REVOKE INSERT, UPDATE, DELETE ON lead_transfers FROM authenticated;
```

## 7. `roles.ts` predicates (+ tests)

Per the capability rule — one predicate per "who can do X", mirrored by the
RPC role checks; no inline role compares at call sites.

```ts
/** Owner / admin: reassign any lead instantly + bulk reassign (managerial). */
export function canReassignLeadsDirectly(role: AccountRole) {
  return hasMinRole(role, "admin");
}
/** Owner / admin / agent: initiate a transfer (agents get the accept-gate). */
export function canRequestLeadTransfer(role: AccountRole) {
  return hasMinRole(role, "agent");
}
/** Owner / admin: force-accept/decline or cancel ANY pending transfer. */
export function canResolveAnyLeadTransfer(role: AccountRole) {
  return hasMinRole(role, "admin");
}
```

Add matching cases to `roles.test.ts`. (Accepting a request *targeted at you*
is identity-based, not a role predicate — gated in the RPC by `to_user_id`.)

## 8. UI states

Thin client wrappers in a new `src/lib/leads/transfers.ts`
(`requestLeadTransfer`, `respondLeadTransfer`, `cancelLeadTransfer`,
`fetchPendingTransfers(accountId)`) call the RPCs; pure status/label helpers
are unit-tested there.

### 8.1 Initiating — leads table assignee cell / detail sheet
The assignee cell (`edit.kind === 'assignee'`, `page.tsx`) stops doing a raw
`.update`. On picking a member it calls `requestLeadTransfer(contactId,
toUser)` and reacts to the returned status:

- **admin/owner** → returns `'accepted'`; cell flips owner immediately; toast
  *"Reassigned to Priya."* (unchanged feel).
- **agent, owns the lead**, picks someone else → open
  `TransferRequestDialog` (new) — target avatar + optional note + confirm.
  On confirm → `'pending'`; cell keeps the current owner and shows a
  `TransferPendingDisplay` overlay (new renderer in
  `lead-cell-renderers.tsx`, mirrors `PendingAssigneeDisplay`): current owner
  chip + `→ Rahul · pending` in `Badge variant="warning"`.
- **agent, unassigned lead**, picks self → `'accepted'` instant self-claim.
- **agent, doesn't own the lead** → the picker options are disabled with a
  hint *"Only the owner or an admin can reassign."* (gate via
  `canRequestLeadTransfer` + ownership check; never UI-only — the RPC also
  enforces).

### 8.2 Receiving — the target teammate
- **Notifications page** (`/notifications`): a `lead_transfer_request` row
  renders inline **Accept** / **Decline** buttons (uses `reference_id`).
  Accept/Decline → `respondLeadTransfer`; on success the row collapses to a
  resolved state; if the RPC says it's no longer pending (resolved elsewhere)
  → toast *"Already resolved."* and refresh.
- **Leads list**: a lead whose pending transfer targets *me* shows
  Accept/Decline in the assignee-cell menu too (so I can act in context).

### 8.3 Resolution / feedback
- **Accepted** → owner flips to target; `lead_transfers` realtime clears the
  overlay on every open leads list; requester + prior owner get an
  informational notification.
- **Declined / cancelled** → overlay clears; owner unchanged; requester
  notified.
- **Superseded** (admin direct-reassign or a fresh request on the same lead)
  → old request silently closes; overlay reflects the newest state.

### 8.4 Admin oversight (MVP → later)
- MVP: admins see the pending overlay on any lead and can force Accept/Decline
  from the cell menu, or direct-reassign (which supersedes).
- Later (optional): **Settings → Team → Pending transfers** table listing all
  in-flight requests (from → to, age, actions) — reuses `fetchPendingTransfers`
  account-wide. Deferred; not required for the loop to work.

### 8.5 Bulk
`BulkEditDialog` "Assigned to" becomes **admin/owner-only** (gate the option
with `canReassignLeadsDirectly`; it already routes to a bulk `.update`). Keep
that path instant for managers; agents no longer see the bulk assignee option.

## 9. Edge cases (decided)

- **Never ownerless** — pending never clears `assigned_to`; only accept flips
  it. Decline/cancel/supersede leave the owner intact.
- **One pending per lead** — enforced by `uniq_lead_transfer_pending`; a new
  request supersedes the prior (RPC closes old first).
- **Target removed while pending** — `to_user_id ON DELETE CASCADE` drops the
  dangling request; overlay clears.
- **Prior owner removed** — `from_user_id ON DELETE SET NULL`; the lead's
  `assigned_to` already fell to NULL via 047; an accepted transfer still
  assigns fine.
- **Pending-invite lead** (`pending_invitation_id` set, no real owner) —
  transferable by **admins only**; on assign, clear the 049 overlay too.
  Agents can't (there's no real owner they hold).
- **Self-transfer** (`to == from`) → rejected in the RPC.
- **Contact deleted** → transfers `ON DELETE CASCADE`.
- **Notification for a resolved transfer** — Accept/Decline just fails soft
  ("already resolved") via the `FOR UPDATE` + status guard.
- **Board view** — a pending-transfer badge can ride on the kanban card;
  MVP may skip it (table + notifications cover the loop).

## 10. File map (implementation)

| Area | File |
|---|---|
| Migration | `supabase/migrations/050_lead_transfers.sql` (table, indexes, RLS, 3 RPCs, notif type + `reference_id`, realtime) |
| Roles | `src/lib/auth/roles.ts` (+ `roles.test.ts`) — 3 predicates |
| Client lib | `src/lib/leads/transfers.ts` (+ `.test.ts`) — RPC wrappers + `fetchPendingTransfers` + status/label helpers |
| Renderers | `src/components/leads/lead-cell-renderers.tsx` — `TransferPendingDisplay` (+ menu actions) |
| Dialog | `src/components/leads/transfer-request-dialog.tsx` (new) — agent confirm + note |
| Leads page | `src/app/(dashboard)/leads/page.tsx` — assignee cell → RPC + role gate; pending-transfer fetch + overlay; accept/decline in cell menu; refetch on resolve; bulk assignee gated admin-only |
| Detail sheet | `src/components/contacts/contact-detail-view.tsx` — same role-gated assignee row + pending state |
| Notifications | `src/app/(dashboard)/notifications/page.tsx` — inline Accept/Decline for `lead_transfer_request`; new `TYPE_ICON`s |
| Types | `src/types/index.ts` — `LeadTransfer`, extend `Notification['type']`, add `reference_id` |
| Docs | `CLAUDE.md` — feature + gotchas (self-guard dedupe, one-pending index, admin-only bulk) |

## 11. Test plan

- **`roles.test.ts`** — the 3 predicates across all 4 roles.
- **`transfers.test.ts`** — pure status/label helpers (badge text, can-act).
- **RPC (manual / SQL)** — instant path (admin), pending path (agent owns),
  agent-not-owner reject, self-transfer reject, unique-pending supersede,
  accept flips owner + suppresses dup notification, decline keeps owner,
  target-removed cascade, pending-invite admin-only.
- **Runtime (two accounts)** — agent A requests → B sees notification +
  overlay → B accepts → owner flips on A's list via realtime → A notified.
  Repeat for decline, cancel, and admin force-resolve.

## 12. Rollout

1. Land `050` via Supabase MCP `apply_migration`; verify with `pg_policies`,
   `pg_proc` (RPC bodies), and `\d lead_transfers`.
2. Ship roles predicates + client lib + UI behind the existing role gates
   (no flag needed — behavior only changes the reassign affordance).
3. Manual QA the two-account loop; then normal-mode commit split:
   (a) migration + roles + lib, (b) leads/detail/notifications UI, (c) docs.

## 13. Out of scope (defer)

- Account-wide "Pending transfers" admin console (§8.4) — after the loop.
- Auto-expiry of stale pending requests (a cron nudge) — add only if requests
  pile up; the manual cancel/force-resolve covers it for now.
- Transferring **membership** ownership (members, not leads) — separate.
- Round-robin / load-based auto-transfer — Phase 2+ automation.
