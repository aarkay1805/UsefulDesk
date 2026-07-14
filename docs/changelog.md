# Changelog — what shipped, and why

> **Archaeology.** Read a section only when you need the *reasoning* behind a past decision. The durable **rules** extracted from this work live in `CLAUDE.md`, `docs/ui-patterns.md`, and `docs/gym-domain.md` — those are the sources of truth; this file is the record.
>
> **Append here** when you land a feature: what shipped, where the code lives, what a future session must not re-litigate. Terse.

---

## Milestone 1 — the renewal wedge (migration `031`) · built

Members = a **top-level nav section** (`/members`) whose home is the Renewals action lists. Contacts stays the raw people+inbox table.

- **Renewals tab** (`renewal-action-lists.tsx`) — two vertically stacked tables (Expiring in 7 days · Expired), borrowing the All-members table look. Each row carries Assign / Renew / Remind.
- **Expired table has a lookback filter** (30d / 3mo / 6mo / All time — client-filtered over the full expired set; default 30d = freshest chase targets).
- Payment-due moved off Renewals onto its own Payments tab.
- Plans managed at Settings → Membership plans.
- Key code: `src/app/(dashboard)/members/page.tsx`, `src/components/members/*`, `src/components/settings/plans-settings.tsx`, `src/lib/memberships/expiry.ts`.

---

## Early Phase-2/3 features (migrations `032`–`038`, `043`–`045`)

- **Attendance** (`032`) — check-in records; later gained plan limits + override (`062`/`063`).
- **Renewal reminder cron** (`033`, `src/app/api/renewals/cron`) — went hourly with a per-account 09:00-local send window in `055`; now filters `collection_mode='manual'` (see auto-pay dunning). Scheduled via GitHub Actions (Vercel Hobby has no sub-daily crons). Details: `docs/renewal-reminders.md`.
- **Payment-due buckets** (`034`) · **trial memberships** (`035`) · **member activity** (`037`) · **account UPI + copy-UPI-link** (`038`).
- **Follow-ups** (`036`, `043`–`045`) — assignable tasks with task types, due-date presets, account-tz reminder slots, and an optional link to the authoring note. **One OPEN task per contact** — cancel a note's open task before deleting the note. Notes live on the lead/contact detail sheet with author avatars, edit-in-place, and drafts.

---

## Leads module (migrations `039`–`042`)

Lead records on top of `contacts`: DB-driven lead status funnel (hex-coloured statuses), source/gender fields, per-account editable lead field options, custom fields with input types + formatting, inline edit actions. Table = draggable/resizable/freezable columns; board = kanban by `lead_status`.

**Sort.** Real `contacts` columns sort server-side via `.order(sortColumn)`. Everything else sorts **client-side** in `fetchContacts`' `clientSort` branch (`ClientSort = custom | person | tags`): pull all filtered lead ids → build a per-lead sort key → order the whole set (`compareCustomValues`: numeric types numerically, else lexical/`localeCompare`; imported dates are ISO so text order = chrono; blanks last) → fetch only the page's rows. Key source per kind — **custom** = the field's `contact_custom_values` value; **person** = the uuid column (`assigned_to`/`created_by`, on `ColumnDef.clientSort`) resolved via `nameById`; **tags** = each lead's alphabetically-first tag name (one account-scoped `contact_tags` read). A column is sortable if `sortColumn || isCustom || clientSort`.

**Per-column value filter.** Every filterable column's three-dot menu carries an Excel-style **Filter** submenu (`DropdownMenuSub` → `DropdownMenuItem`s with an always-visible left checkbox + `closeOnClick={false}`, so multi-select is obvious).
- **Built-in** columns map to a shared `LeadFilters` dimension via `columnFilterConfig` (status→`leadStatus`, source→`source`, gender→`gender`, tags→`tags`, assignee→`assigned`, received_by→`owner`, created_by→`createdBy`) — so the column filter and the global Filters panel are **one source of truth, no drift**.
- **Custom fields** of type text/number/currency (`CUSTOM_FILTER_TYPES`; email/phone/url/date excluded) filter too — distinct stored values load into `customFilterOptions`, selections live in `LeadFilters.customValues`.
- Free-text built-ins (name/phone/email/company/dates) omit the item.
- **Id-based filters** (tags + custom values) resolve to contact-id sets and **intersect** in `resolveContactIdFilter`; `applyLeadFilters`' `idFilter` param does `.in('id', …)`. Used by the table, select-all, and CSV export.

**Bulk actions** (`bulk-*.tsx`) — row multi-select shows a toolbar below the search bar that animates open/closed (`Collapse`; the count is frozen mid-collapse so it can't flash "0").
- **Edit** → `BulkEditDialog`: pick one property (status / assignee / source / gender / company / any custom field), set it, apply to all. (Assign is folded in here as "Assigned to" — no separate Assign button.)
- **Delete** → confirm + `.in('id', ids)`.
- **Add note** → `BulkAddNoteDialog`, reusing the detail sheet's exported `NoteComposerCard`. Notes batch-insert; follow-ups insert per contact honouring one-OPEN-task-per-contact (skips are tallied, not errors).
- **Convert to member** → `BulkConvertDialog`: plan + start date → one `active` membership per lead. Converted leads drop off the list (leads anti-join memberships).
- **Reuse note:** these dialogs' value pickers use `DropdownMenu` + `Badge`/`SourceIcon`/`UserAvatar` in the trigger, not `ui/Select` — its item padding differs. (Its old raw-value-echo reason is gone since the Jul 2026 items-derivation fix.)

---

## Leads CSV import 2.0 (Jul 2026 · `PRDs/import_leads_ux.md`)

`ImportWizard` (`components/contacts/import-wizard.tsx`) is **variant-parameterized**: `variant="contacts"` keeps the original 3-step flow; `variant="leads"` runs 4 steps — Upload → Map columns → **Preview & edit** → Confirm.

Leads additions: lead-field mapping targets (`buildLeadTargets` in `field-mapping.ts`; raw cell text rides on `MappedRow`) · searchable grouped field picker (`ui/combobox.tsx`) · heuristic type detection on inline field-create + per-column `DD/MM` chip for ambiguous date columns (`detectFieldType` / `detectDateOrder`) · an **editable preview grid** rendered with the leads table's own renderers (`import-preview-grid.tsx`; caps at 200 rows *shown*, all imported) · the **Fix values panel** — value-level remapping with row counts, fuzzy auto-match, and a remap log feeding the Confirm receipt + result audit.

Coercion engine = `src/lib/leads/import-coerce.ts` (pure, tested): option/assignee matching, `buildPreviewRows`, `applyValueFix`. **Commit consumes the edited `PreviewRow[]`**, not a mapping re-run. Insert payload extends with `lead_status`/`source`/`gender` and `assigned_to` (a mapped assignee overrides importer-as-owner; updates never null ownership).

**Gotcha:** unknown option values import as slugs and render as muted pills via `humaniseKey` — safe by design.

---

## Import → pending-teammate assignment (migration `049`)

The Fix-values panel can assign leads to a teammate who **doesn't exist yet**: an admin picks "Invite '<name>' as a teammate", which find-or-creates an `account_invitations` row (role `agent`, `full_name` set) — **reusing the invite system, not a parallel pending-staff table**.

Because `contacts.assigned_to` is FK→`auth.users(id)` and a pending invitee has no auth user, the parked assignment lives in **`contacts.pending_invitation_id`** (+ denormalized `pending_assignee_name` so non-admin agents can render it without reading the admin-only invites table). `assigned_to` stays the importer as the **fallback owner** — revoke/expire → the lead degrades to the importer, never ownerless.

Leads render "Invite pending · name" via `PendingAssigneeDisplay`. Resolve a pending owner → real member **inline** (assignee cell), by **filter** ("Assigned to" lists pending invitees, values `pending:<id>`), or in **bulk** — all clear the overlay. On redeem, `redeem_invitation` reassigns the parked leads to the joiner (assign-to-self → the notify trigger's self-guard suppresses the flood).

Copy/rotate a shareable link at Settings → Team → Pending invitations (`POST /api/account/invitations/[id]/link` — tokens are hash-only, so each copy rotates and invalidates the prior link). Sentinel `PENDING_ASSIGNEE_PREFIX` in `import-coerce.ts`.

**Scope:** pending owners are import-created only (not manually assignable from the normal picker) and don't count in round-robin/stats until they join.

---

## Three distinct ownership facts (don't conflate)

| Fact | Column | Rule |
|---|---|---|
| origin **channel** | `received_via` (`048`) | immutable |
| original human **creator** | `created_by` (`051`) | set once at insert, frozen on update by trigger `lock_contact_created_by`; read-only "Created by" column |
| current **owner** ("Received by") | `user_id` | transferable via the `050` flow |
| current **assignee** (delegate) | `assigned_to` | reassignable; approval-gated for non-owners via `052` |

### Lead ownership transfer (migration `050` · `PRDs/lead_ownership_transfer.md`)

**Ownership = the "Received by" human = `contacts.user_id`** — NOT `assigned_to`. Only **human-received** leads (`received_via` NULL/manual/import) are transferable; system-generated captures (whatsapp/meta/api/automation) are locked (RPC + UI both enforce).

- **Managerial (owner/admin):** transfer moves `user_id` instantly; new owner notified.
- **Peer handoff (agent):** transferring a lead they OWN opens an accept-gated request. `user_id` flips only when the target accepts — **never ownerless** (decline/cancel/supersede leave the current owner holding).

One entry RPC `request_lead_transfer` decides instant-vs-pending by role; `respond_lead_transfer` / `cancel_lead_transfer` complete it. All three SECURITY DEFINER; `lead_transfers` is SELECT-only from clients. State machine `pending → accepted/declined/cancelled/superseded`; `uniq_lead_transfer_pending` = one pending per lead.

Because ownership moves via `user_id`, the `notify_lead_assigned` trigger doesn't fire — the RPCs notify the new owner explicitly on admin-instant + admin-force-accept (a self-accept needs none). `notifications.reference_id` drives inline Accept/Decline on `/notifications`.

UI lives on the **Received-by column** (table cell + detail row): owner picker to start a transfer, `TransferPendingDisplay` overlay + Accept/Decline/Withdraw menu while pending, `TransferRequestDialog` for the agent note step. `lead_transfers` is on realtime so the overlay updates live. Predicates: `canReassignLeadsDirectly` (admin) / `canRequestLeadTransfer` (agent+) / `canResolveAnyLeadTransfer` (admin). Client lib `src/lib/leads/transfers.ts`.

### Lead assignment approval (migration `052`)

A SECOND flow on the **"Assigned to" column** (the delegate, distinct from ownership). The owner (`user_id`) or an admin change it **instantly**; **any other agent's change → a request the OWNER must approve** (approver = the owner OR any admin — *not* the target, unlike ownership transfer). Applies to any change including unassign.

Reuses `lead_transfers` via a `kind` column (`'ownership' | 'assignment'`) + `approver_user_id`; `to_user_id` is now nullable (unassign); one pending per `(contact_id, kind)`. RPCs: `request_lead_assignment` / `respond_lead_assignment` / `cancel_lead_assignment`.

Instant + approve paths write `assigned_to`, so the existing `notify_lead_assigned` trigger notifies the new assignee **for free**; the pending request notifies the **owner** (`lead_assignment_request`; 4 new notif types). Bulk assign loops the RPC per lead so agents can't bypass.

**Deferred:** account-wide pending-transfers console, auto-expiry cron.

---

## Leads board parity (Jul 2026)

The board (`leads-board.tsx`) honours the shared **Filters panel** — `fetchBoard` runs `resolveContactIdFilter` + `applyLeadFilters` and is sequence-guarded like the table; the Filters button renders in **both** views. (Sort / Edit columns stay table-only: filters constrain the *data*, those are table *presentation*. Without this a table-set filter kept applying to CSV export while invisible from the board.)

Cards mirror the table row compressed: name + hover-reveal ⋮ menu (View/Edit/Delete — same page handlers as the table row menu) · phone/company · 2 tag pills + "+n" · footer = source glyph + compact created date vs the **owner slot** (assignee `UserAvatar`, or an amber pending chip for an in-flight ownership transfer / assignment approval / pending invite — same precedence as the table cells, so a lead mid-handoff can't look normal on the board; the `lead_transfers` realtime channel bumps `boardNonce` too). Board rows are tag-enriched (`BoardLead = Contact & {tags?}`; one account-scoped `contact_tags` read, no id list in the URL). Whole-board empty state matches the table's.

**Drag perf** is load-bearing and the FLIP animation is deliberately kept — the full render structure + the two traps (context re-render fan-out; optimistic state must not live on the page) are documented in `docs/ui-patterns.md` → Animation → Kanban board.

**Board settings (Tier 1).** A gear shows in board view (fused right of the view picker; opens the shared `ViewSettingsSheet` switched on `view`). Two knobs — the board's peers of the table's page-size/cell-wrap:
- **card density** — `comfortable` shows company + tags + source/date footer; `compact` = name/phone/owner only.
- **sort within column** — `newest`/`oldest`/`name`/`updated` (replacing the hard-coded newest-first; `sortColumnLeads`; reorder animates via the FLIP).

Both persist in the SAME `table_preferences` `'leads'` blob under a `board:{density,sortWithin}` sub-object (no new migration; `useTablePrefs` shallow-merges the default in). The board island bumps `updated_at` optimistically so the `updated` sort reflects a drop instantly.

**Board settings (Tier 2).** `board.collapseEmpty` (Switch): hides 0-count status columns **at rest** but reveals every column **mid-drag** (`collapseEmpty && !activeLeadId`), so an empty stage stays a valid drop target. `handleDragEnd` still validates against `allColumns`; only `displayColumns` is filtered. (Hide-specific-status-columns was skipped — redundant with the Filters panel's status dimension.)

**Deferred (Tier 3):** **group-by** — pivot the board on source / assignee instead of status. A real feature with a drag-semantics decision (dragging would set the grouped dimension: a direct source-write vs the approval-gated `requestLeadAssignment`), not a lightweight pref. Gender is intentionally excluded as a group dimension.

---

## Persisted table views (migration `053`)

The leads table's column state now persists **per-user, per-account** in `table_preferences`. Was a single global `localStorage` key — per-browser, account-agnostic, bled across accounts, no cross-device. New hook `useTablePrefs`; see `docs/ui-patterns.md` → Tables.

---

## Members parity pass (Jul 2026, migration `054`)

The Members module caught up with the leads-era infrastructure.

**All-members table rebuilt** (`members-table.tsx`) — server-paginated (`fetchSeq` guard, `.range()`, `contacts!inner` embed so search hits `contacts.name/phone` server-side; name sort via PostgREST embed-order `contact(name)`). Toolbar **Sort** (reuses `LeadsSort` — it's generic) + **Filters** (`members-filters.tsx`: plan / derived status / fee_status) + **CSV export** of the filtered set. Sort + pageSize persist via `useTablePrefs('members-all')`. Filter definition = pure `applyMemberFilters` (`lib/memberships/filters.ts`, tested) shared by table / select-all-matching / export.

**Bulk actions** (leads `Collapse` toolbar + frozen-count + select-all-matching): bulk WhatsApp remind (confirm dialog; `sendRenewalReminder` extracted from `send-reminder-button.tsx` for single+bulk reuse) · bulk note/follow-up (reuses leads' `BulkAddNoteDialog` — it gained a `noun` prop; selection is a `Map<membershipId, contactId>` because notes key by contact) · bulk record-payment / mark-paid (`bulk-record-payment-dialog.tsx`, per-row inserts + `.select('id')` tallies).

**Member detail gains the real notes thread** via the extracted `ContactNotesThread` (`onFollowUpChanged={refreshAll}` keeps the sheet's follow-up bar in sync). Legacy one-line `memberships.notes` stays as-is.

**Realtime:** `members/page.tsx` subscribes one `member-lists` channel on `memberships`/`payments`/`attendance` (published in `054`) → trailing-debounced `reloadKey` bump; all member tabs refresh live.

**Members CSV import** = a separate lightweight dialog `import-members-csv-dialog.tsx` (Upload → Map → Confirm), deliberately **NOT** a third `ImportWizard` variant — reuse is at the **lib layer** (`parseCsvRaw`, `normalizeKey`/`isUniqueViolation`, `detectDateOrder`) plus a new pure engine `src/lib/memberships/import-commit.ts` (tested: member column targets/auto-map, DMY-first `parseImportDate`, plan resolution, `buildMembershipRow` defaults start=today / end=start+duration / fee=plan price). Commit = find-or-create contact (`received_via:'import'`) then a **per-row** membership insert — `UNIQUE(account_id,contact_id)` → a unique violation means "already a member, skipped"; **a batch insert would die atomically.**

Also in this pass: the "View existing" dedupe link resolves contact→membership (`lib/memberships/lookup.ts`) and opens the detail sheet; person renders route through `UserAvatar`.

**Column machinery** (added later in Jul 2026): the All-members table gained the leads-style per-column header (sort + three-dot menu + resize + persisted layout) via the shared `ColumnHeader`. Drag-reorder + freeze intentionally skipped (~6 fixed columns).

---

## Member detail sheet 3.0 (Jul 2026, migration `056`)

The wide sheet (`data-[side=right]:w-full` + `data-[side=right]:sm:max-w-[min(1200px,calc(100vw-2rem))]` — fills the viewport up to a 1200px cap rather than leaving dead space beside inner scrollbars) gained a jump-nav + BMI rail + full profile/settings.

> **⚠️ Sheet-width gotcha.** `ui/sheet.tsx` sets `data-[side=right]:w-3/4`, and a call-site's bare `w-full` does **not** beat it — tailwind-merge only dedupes utilities of the *same variant*, so an override of a `data-[side=*]:`-prefixed class must carry the same prefix. (The existing `max-w` comment said this; the `width` half was missed and silently pinned every sheet to 75vw.)

**Responsive:** the body is `lg:grid-cols-[minmax(640px,1fr)_310px]` — the 640px floor lives on the **grid track**, and the content column is `min-w-0` (a raw `min-w-[640px]` would also apply on mobile and force the whole sheet to scroll sideways). Below `lg` it stacks single-column with the BMI rail at the bottom; below `sm` the header actions take their own full-width row, and the Billing invoice table drops its Paid/Balance/Cycle columns + stacks the period into a two-line numeric range (every dropped fact is in `InvoiceDetailDialog`, which the row opens).

**Structure:** identity header over a `bg-muted/20` scroll body. A **sticky jump nav** (`ui/tabs.tsx` `variant="line"`, controlled by `activeSection`) scrolls to `#sec-<id>`; a scrollspy `IntersectionObserver` (`root` = the scroll body, `rootMargin: "-56px 0px -60% 0px"`) lights the active tab; each `<Section>` carries `scroll-mt-14`.

Sections: **Membership** (its `⋯` menu carries lifecycle actions — **Change plan** first, then Edit · Freeze/Resume · Cancel/Reactivate) **· Billing** (id `payments` — the invoice table + auto-pay setup; see `docs/gym-domain.md`) **· Notes** (`ContactNotesThread`) **· Attendance** (promoted from the old rail widget to a full section) **· Communication · Personal info · Settings**.

- **Communication** (`member-communication.tsx`) is a **template-send log, deliberately NOT a chat.** Owners talk to members on WhatsApp directly; a full embedded `MessageThread` was built and then **reverted as overkill** — if ever wanted again, the thread is fully host-agnostic and needs only ~150 lines of host glue. It answers "what did the system send, when, did it land": finds the member's conversation by `contact_id`, loads `messages` where `content_type='template'` + `sender_type in (agent,bot)` (newest-first, cap 50), renders Type / Channel / Subject / Status. Type = the reason from `TEMPLATE_REASONS` (`gym_renewal_reminder` → "Renewal reminder"; unknown templates humanise their name) with the send `fmt.dateTime` beneath; Status = a delivery badge (read/delivered/sent/failed → success/info/neutral/danger). Header "Open in Inbox" → `/inbox?c=<id>`. Template sends store `content_text=null`, so Subject comes from the reason map.
- **Personal info** (`member-personal-info.tsx`) — an editable form over the `056` contact columns, one Save. `name` stays a single field; gender reuses `GENDER_OPTIONS`.
- **Settings** (`member-danger-zone.tsx`) — Delete member only (Merge deferred).

**The rail is BMI-only** (`bmi-card.tsx`, `lg:sticky lg:top-16`), replacing the old Follow-up + Visits widgets (follow-ups still live inside the Notes thread). Pure lib `src/lib/bmi/bmi.ts` (`computeBmi` = kg/m², WHO zones, `bmiGaugeFraction`, cm↔ft-in / kg↔lb — tested); hand-built SVG+CSS-transition gauge `bmi-gauge.tsx` (no gauge dependency; honours reduced motion). Height/weight store **metric-canonical** on `contacts.height_cm/weight_kg` (a future Vitals section reuses them); imperial accounts (`locale.measurementSystem`) enter/read ft-in/lb, converted on save. **Standard BMI ignores gender/age** — neither is a BMI input. Missing measurements → an "Add measurements" empty-state (gated `canSendMessages`).

**Delete** = the `delete_member(contact_id)` RPC (SECURITY DEFINER) — re-checks owner/admin **server-side** (stricter than the agent-level `contacts_delete` RLS), purges the `payments` ledger (its FK is SET NULL, not cascade), then deletes the contact (cascading membership/attendance/notes/follow-ups). UI gate = `canDeleteMember` (admin+).

**New `contacts` columns (`056`):** `height_cm, weight_kg, date_of_birth, nickname, address_line1/2, city, state, postal_code, country` (all nullable; reuses the existing `name/phone/email/gender`).

---

## Inbox

### Member/lead segregation (Jul 2026, no migration)

`CONVERSATION_SELECT` (`lib/inbox/conversations.ts`) embeds `memberships(id)` under the contact; `normalizeConversation` flattens it to a derived `Conversation.isMember` (**no new column**). `ConversationItem` renders a `Badge` — `success` "Member" / `neutral` "Lead" — and the filter dropdown gained Members / Leads options (same list-filter path as unread/status).

### Contact panel = the lead detail surface (Jul 2026, no migration)

The inbox's right panel was a **separate, stale fork** of the lead detail sheet: read-only tag badges, a pre-refactor note box that **failed silently** on an RLS block, a hand-rolled avatar, a byte-for-byte copy of `copyPhone`, and an "ACTIVE DEALS" block for the **retired** pipelines feature (`/pipelines` just redirects to `/leads`; the `deals` table survives untouched but nothing reads it).

It now mounts the **same `ContactDetailContent`** the `/leads` sheet does (widened 280px → 360px, `details` collapsed, `chat`+`template` actions dropped). `ContactDetailView` is now a ~50-line Sheet wrapper; the old `contact-sidebar.tsx` body was deleted. Full prop contract: `docs/ui-patterns.md` → Contact / lead detail surface.

The page gained `handleContactUpdated` (re-pulls `activeContact` + bumps `resyncToken`) so an edit in the panel can't leave a stale name in the thread header or conversation list.

**Opened on demand.** The panel starts **closed** — selecting a conversation opens the chat and nothing else. It's revealed by clicking the contact's **avatar** (conversation row → selects that conv AND opens; thread header → opens) or the header's panel toggle, and once open it's **sticky** (follows whichever conversation you select until you close it). Deliberately **not persisted** — it used to default `true` and round-trip through a `wacrm:inbox:contact-panel-open` localStorage key, so a stored `true` would have defeated the new default. That key is gone.

> **⚠️ Why the conversation row is a plain `<div>`.** Making the row avatar clickable forced the row off `<button>` (a button may not nest a button). It is a plain clickable **`<div>`, NOT `role="button"`** — exactly the leads board card's shape: the div's `onClick` is the pointer convenience and the **name is the real `<button>`** carrying the keyboard/AT path. `role="button"` was tried first and is **wrong** — ARIA forbids focusable descendants inside a button, and the nested avatar's `aria-label` got absorbed into the row's accessible name, which read *"Open Mohit's profile Mohit Lead about 1 hour Welcome and…"*.

Both inbox avatars (row + thread header) now route through `UserAvatar` — the thread header's previously rendered a bare initial and ignored `contacts.avatar_url` entirely.

**Mobile (`<lg`):** the same surface opens as an overlay Sheet via `ContactProfileSheet`. Gated in JS on `useMatchMedia`, **not CSS** (a Sheet portals to `<body>`). `useMatchMedia` was promoted out of `flow-editor-shell.tsx` into `src/hooks/use-match-media.ts`.

---

## Billing periods / invoices (Jul 2026, migration `057`)

Recurring members get a real per-cycle invoice trail (Paid/Unpaid/Upcoming) instead of a single mutated membership row. New `membership_periods` table + `membership_period_invoices` view + `lib/memberships/periods.ts`; the member-detail Payments section became a badged, clickable invoice list with an `InvoiceDetailDialog`.

Full pattern (birth trigger, TS lifecycle, reconcile-by-`period_end`, TS-derived status, projected Upcoming) → `docs/gym-domain.md`.

Backfilled current + past-paid cycles from the ledger.

**Still deferred:** auto-generating/charging *future* invoices (a billing cron — overlaps UPI AutoPay) · persisting the Upcoming projection · per-cycle fee history for backfilled rows (their fee = Σ paid).

---

## Payments hardening (Jul 2026, migrations `20260711173414` + `058`)

The ledger became DB-authoritative and tamper-resistant: trigger-derived `fee_status`, validated inserts, idempotent transactional RPCs, append-preserving voids, private receipt bucket, protected financial fields behind a tx-local GUC. Plus a reconciliation UX pass (who recorded each payment, per-method totals, CSV export, Full/Half chips, capped `paid_on`).

Full rules → `docs/gym-domain.md` → Payments ledger.

---

## Notes ownership (migration `046`)

Author-owned edit/delete + admin moderation. The rule (enforce in BOTH RLS and UI, via a `roles.ts` predicate) lives in `CLAUDE.md`.

---

## Motion animation layer (Jul 2026)

`motion/react` + reusable primitives. First call-sites: kanban cards fly between columns (FLIP), the leads bulk toolbar collapses via `Collapse`, the notes list + `/notifications` animate via `MotionList`, dashboard KPI tiles stagger-in + count-up via `AnimatedNumber`. Primitives + the two hard gotchas → `docs/ui-patterns.md`.

Motion+ "AI Kit" (paid dev-tooling) was evaluated and **not adopted** — only the free MIT lib is in use.

---

## Account-level localization (Jul 2026, migration `055`)

The product adapts to each gym's geography end-to-end. The pattern (columns, `src/lib/locale/*`, `useLocale()`, presets-only geography, tz helpers) is a **rule** and lives in `CLAUDE.md`.

Shipped in the same change: signup country picker (preset → `handle_new_user` metadata) · Settings → Localization section (country picker re-applies the preset; live format preview; currency stays shared with Payments & currency — same column) · the renewal cron went **hourly** with a per-account 09:00-local send window + locale-formatted `{{3}}`/`{{4}}` template params (the manual Remind button matches; `REMINDER_SEND_HOUR_LOCAL` in `renewal-reminders.ts`) · follow-up reminder slots resolve in the account tz · payment day-picks stamp via `dateAtNoonInTz` (the noon-UTC anchor was removed) · check-in/summary "today" windows via `dayStartInTz` · `formatCurrency` gained a `locale` grouping param (en-IN → ₹1,00,000) · `formatCustomFieldValue` gained `localeTag` (+ a plain-date UTC-shift fix) · `lib/dates/format.ts` (`formatDay`) was **deleted** — every render goes through `fmt.date` · `loadGymStats(db, today, timeZone)`.

**Deferred:** dashboard chart internals (`lib/dashboard/date-utils.ts` is still browser/server-local + Monday-first — cosmetic, charts only) · phone default-region parsing (placeholders/hints are dynamic, but a bare local number still needs an explicit country code — libphonenumber deferred) · reminder-slot 12h labels are fixed-English · a WhatsApp template's `language` is still the template's own.

---

## WhatsApp Embedded Signup (Jul 2026, no migration · `PRDs/multi_gym_saas_prd.md` §7)

Self-serve WhatsApp connect via Meta's **Facebook Login for Business** popup, replacing token-paste as the default.

Client `components/settings/whatsapp-embedded-signup.tsx` loads the FB JS SDK (`FB.login` with `config_id`, `response_type:'code'`, `sessionInfoVersion:'3'`; a `WA_EMBEDDED_SIGNUP` window-message carries `waba_id`+`phone_number_id`, the login callback carries the auth code) and POSTs both to `/api/whatsapp/embedded-signup`: `exchangeEmbeddedSignupCode` (`meta-api.ts` — code → non-expiring business-integration token) → `verifyPhoneNumber` → `registerPhoneNumber` with a random 6-digit PIN (best-effort; the error is parked on `last_registration_error` like the manual route) → `subscribeWabaToApp` → encrypt + upsert **the same `whatsapp_config` row shape** (no schema change; webhook demux by `phone_number_id` unchanged). Cross-account phone-claim check mirrors `/api/whatsapp/config`.

UI: the ES card is the primary CTA in `whatsapp-config.tsx`; the manual credential form moved into a "Manual setup (advanced)" accordion (default-open only when the ES env vars are absent — the card self-hides then).

Env: `META_APP_ID`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`; app secret reused.

**Gotchas:** the popup only completes for app admins/testers until Meta grants Advanced Access (`whatsapp_business_messaging/management`, `business_management`) · the app domain must be whitelisted in FB Login for Business settings · the FB SDK version is pinned to `META_API_VERSION` (`v21.0`).

---

## UPI AutoPay (Jul 2026, migrations `059`, `060` · `PRDs/upi_autopay.md`)

Razorpay UPI AutoPay / Subscriptions, per-gym credentials, one shared ledger for auto + manual. Verified end-to-end on live data (2 cycles auto-charged, membership rolled, retry a no-op, overpay still blocked in system mode).

Full architecture, the service-role GUC bypass, the webhook account guard, and the dunning fallback → `docs/gym-domain.md` → UPI AutoPay.

---

## Mid-cycle plan change / upgrade (Jul 2026, migration `061`)

Member sheet → Membership `⋯` → Change plan. Pro-rated credit for unused paid days. Verified end-to-end on live data (a ₹999-paid 30d cycle → a ₹3999 plan on day 8: old invoice 266.40 / paid 999 / balance 0, new invoice 3266.40 settled).

Math + RPC contract → `docs/gym-domain.md` → Mid-cycle plan change.

---

## Plan types + pricing options (Jul 2026, migration `062`; `063` = usage RPC + plan-type lock)

PushPress-style plan restructure: `recurring` / `non_recurring` / `session_pack`, each plan selling N billing options (duration × price). Settings → Membership plans rebuilt; canonical `PlanOptionPicker` mounted in member-form / renew / change-plan / import; check-in gained warn-with-override limit enforcement; the renewal cron + Renewals lists + autopay all route through `isRenewalChaseable(plan)`.

Backfill: every plan got one day-unit option mirroring its legacy scalars; memberships + current periods were pointed at it. Verified via a rollback DO-block on live: calendar clamp (Jan 31 → Feb 28 → Mar 28), no-setup-fee renewal, idempotent retry, pack auto-renew rejection.

Full model, `PLAN_COPY`, and the RPC-param gotcha → `docs/gym-domain.md`.
