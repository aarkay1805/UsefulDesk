# Changelog — what shipped, and why

> **Archaeology.** Read a section only when you need the *reasoning* behind a past decision. The durable **rules** extracted from this work live in `CLAUDE.md`, `docs/ui-patterns.md`, and `docs/gym-domain.md` — those are the sources of truth; this file is the record.
>
> **Append here** when you land a feature: what shipped, where the code lives, what a future session must not re-litigate. Terse.

---

## Unified search and filter toolbars

Data-list toolbars now use one reading order—Search, Filters, Sort, divider, filter chips, then trailing view/scope actions—with All Members as the canonical layout. `ChipGroup` keeps every chip set on one horizontally browsable row: overflow stays clipped with a peeking final chip and contextual previous/next chevrons instead of wrapping. Filter chips use the same compact nested count badge as segmented Expiring/Expired controls; All Members and Payments gained live faceted chip counts, while Leads and both follow-up queues moved their existing counts into the shared treatment. The Leads table/board picker is icon-only, and its current-day quick view is labelled **Today**. Key code: `src/components/ui/badge.tsx`, `src/components/ui/chip.tsx`, `src/components/members/members-table.tsx`, `src/components/members/payments-table.tsx`, `src/components/follow-ups/follow-up-queue-controls.tsx`, and `src/app/(dashboard)/leads/page.tsx`.

---

## Pill-shaped Sort and Filters actions

Page-level Sort and Filters actions now share the fully rounded outlined `Button` pill variant across Leads, Members, follow-up queues, Payments, Inbox, and Broadcast recipients. Active sorts/filters use the account-primary tint, while inactive actions stay neutral; column-header menus remain unchanged. Key code: `src/components/ui/button.tsx`, `src/components/leads/leads-sort.tsx`, and the shared filter components.

---

## Leads quick views

The redundant **First response** tab has been consolidated into **All leads**, where URL-backed counted chips now provide **No follow-up**, **Unassigned**, **Mine**, and **Today** views across the table, board, bulk selection, and CSV export. With no chip selected, the complete lead list is shown. **No follow-up** means a New lead with no currently open follow-up; its filtered PostgREST anti-join deliberately ignores completed tasks. **Unassigned** excludes Lost leads and pending teammate assignments, while **Today** uses the account timezone. Key code: `src/app/(dashboard)/leads/page.tsx` and `src/lib/leads/quick-filters.ts`.

---

## Shared search width

The master `SearchInput` now owns a fixed 240px wrapper width, so Leads, Members, Attendance, follow-up queues, Inbox, member import, and Manage Columns stay aligned without page-level width overrides. Key code: `src/components/ui/search-input.tsx`.

---

## Hover-revealed sidebar scrollbar

The primary sidebar navigation now uses the shared `ScrollArea`: its slim themed scrollbar is rendered only when the navigation overflows and fades in while the rail is hovered, focused, or actively scrolling. The Inbox conversation list keeps the master component's existing always-visible default. Key code: `src/components/ui/scroll-area.tsx` and `src/components/layout/sidebar.tsx`.

---

## Repeating follow-up reminder ringtone

Unread `follow_up_reminder` notifications now drive a dashboard-wide subtle ringtone: one minute of six-second pulses, five minutes silent, repeated for at most one hour after delivery. Reading the notification stops it through the existing realtime `read_at` flow, including from another open tab/device; reopening the app resumes only the current phase of still-unread reminders. Inbox and reminder tones share one gesture-unlocked Web Audio context and use generated sounds with no licensed asset. Key code: `src/hooks/use-follow-up-reminder-ringtone.ts`, `src/lib/notifications/reminder-ringtone.ts`, and `src/lib/notifications/notification-sounds.ts`.

---

## Live Inbox dot and message chime

The sidebar now keeps its Inbox unread dot visible anywhere in the app, including while Inbox itself is active, and plays a short generated two-note chime for each realtime inbound customer message. The sound uses Web Audio rather than a licensed asset and arms after the first pointer or keyboard interaction to respect browser autoplay rules; messages received before that remain visual-only. Key code: `src/hooks/use-total-unread.ts`, `src/lib/notifications/notification-sounds.ts`, and `src/components/layout/sidebar.tsx`.

---

## Attendance member columns

The Attendance register now keeps member identity in the canonical **Name** column and shows the membership plan in a dedicated **Plan** column immediately after it. Plan visit-limit usage remains visible in that Plan cell, and its canonical column menu now provides the same plan-value filter as All members. Key code: `src/components/members/attendance-view.tsx`.

---

## Profile follow-up activity parity

The shared profile timeline now includes standalone follow-ups created from row actions, including tasks with no optional note; note-linked tasks remain attached to their authored note, and all entries sort newest-first. Standalone and note-linked tasks now share one follow-up-first card hierarchy: task and due date, optional note, then created/assigned metadata. The profile section is canonically labelled **Notes & follow-ups** across lead and member surfaces. Key code: `src/components/contacts/contact-notes-thread.tsx` and `src/lib/follow-ups/profile-activity.ts`.

---

## Follow-up outcome constraint repair (migration `20260719220919`)

Lead follow-ups can again be completed with **Contacted** or **Trial booked** in databases that retained migration `036`'s member-only outcome constraint. The idempotent repair migration reasserts the full shared outcome list and the done-requires-outcome invariant; a contract test now keeps the UI choices aligned with the SQL constraint. Key code: `src/lib/memberships/follow-ups.ts`, `src/lib/memberships/follow-ups-outcome-contract.test.ts`, and `supabase/migrations/20260719220919_repair_follow_up_outcome_constraint.sql`.

---

## Manual follow-up creation parity

Lead and member action rows now share one `FollowUpButton` (`ListPlus` + **Follow up**) and one standalone create dialog/copy across All leads, First response, All members, Renewals, Trials, and Inactive. Manual creation is limited to that row dialog and the profile **Notes & follow-ups** composer; bulk Add note is note-only again. Lead creators omit member-only Reason chips and always persist the neutral `other` sentinel, while member creators retain contextual Reason choices. Key code: `src/components/follow-ups/follow-up-button.tsx`, `src/components/follow-ups/follow-up-dialog.tsx`, `src/components/follow-ups/follow-up-fields.tsx`, and `src/components/contacts/contact-notes-thread.tsx`.

---

## Collapsible desktop navigation rail

The primary desktop sidebar can now collapse from 240px to a 64px icon rail without affecting the mobile drawer. Width, labels, badges, and the account footer transition together; compact navigation keeps unread/onboarding indicators and exposes every destination through right-side tooltips. The active state and full account menu remain available in both modes. Key code: `src/components/layout/sidebar.tsx`.

---

## Semantic colour foreground consistency

Coloured product text and icons now resolve through one adaptive foreground token per hue: its `-500` fill primitive blended 45% toward the live page foreground, following the themed-text contrast model and clearing WCAG AA over 10% subtle tints in both modes. `text-destructive` aliases the same red token, subtle primary treatments use `text-primary-text`, and badges/panels no longer pick ad hoc shades. Stored lead-status picker hex values resolve back to the exact semantic Badge variant, so a red lead status and a red fixed status share both foreground and tint primitives; arbitrary custom hex keeps the accessible derived fallback. Tremor's `-500` data-mark palette remains the explicit non-semantic exception. Key code: `src/app/globals.css`, `src/components/ui/badge.tsx`, `src/lib/semantic-colors.ts`, `src/lib/semantic-color-foregrounds.test.ts`.

---

## WhatsApp settings layout

The WhatsApp connection status and embedded-signup flow now use the full settings-panel width. The step-by-step Meta setup guide moved into the Manual setup accordion, where it sits beside the credential form on desktop and stacks below it on smaller screens. The split grid stays padded inside the accordion panel because its animation clips overflow and Card edges are outer rings. Key code: `src/components/settings/whatsapp-config.tsx`.

---

## Lead/member follow-up queue parity

The Leads and Members Follow-ups tabs now share `FollowUpQueueControls`: search, due/owner filters, sorting, live counted due buckets with tooltip definitions, and My work/Team scope behave the same in both contexts. Both tables now also provide persisted column visibility/widths, header sort/filter menus, row and all-matching selection, context-aware bulk completion, inline reassignment, and pagination. Member-only Reason/reminder behavior and lead-only Status/Stage age columns stay contextual. Key code: `src/components/follow-ups/follow-up-queue-controls.tsx`, `src/components/follow-ups/follow-up-filters.tsx`, `src/components/leads/lead-accountability-view.tsx`, and `src/components/members/follow-up-lists.tsx`.

---

## Live lead accountability refresh

Lead edits made in the shared detail sheet now re-fetch the active Follow-ups or First response queue through the same page-level invalidation path as All leads and the board. Follow-up creates, edits, completions, and deletions from the Notes section also notify that path. Key code: `src/app/(dashboard)/leads/page.tsx`, `src/components/leads/lead-accountability-view.tsx`, and `src/components/contacts/contact-detail-content.tsx`.

---

## Follow-up task-cell parity

Lead and member follow-up tables now share `FollowUpTaskSummary` (`src/components/follow-ups/follow-up-task-summary.tsx`): the **Follow-up** column renders the task-type icon, task label, and optional note with one hierarchy. Member rows additionally retain their member-only neutral Reason badge; lead queues remain reason-free.

---

## Search input interaction contract

The shared `SearchInput` (`src/components/ui/search-input.tsx`) is now a controlled semantic search field with contextual accessible names at every call-site, a mobile Search keyboard action, Escape-to-clear, and a trailing clear button that appears only for editable non-empty values and returns focus to the field. Leads, Members, Attendance, accountability queues, Inbox, member import, and Manage Columns all inherit the same behavior.

---

## Sales accountability (migration `20260719080908`)

Leads now has separate **Follow-ups** and **First response** tabs, each with My work / Team scopes. Follow-ups contains only open scheduled work (overdue, due today, or upcoming); First response contains leads still in New and highlights the 24-hour response target plus missing follow-ups. Queue counts live inside the filter chips, their definitions appear after a 1-second hover delay (and immediately on keyboard focus), and Unassigned is a real filter—no persistent summary-card row. The tabbed header uses the canonical bottom divider and 24px content separation. An open lead follow-up is the accountable owner/source of truth. Completing one requires a structured outcome, including contacted and trial booked. Key code: `src/components/leads/lead-accountability-view.tsx`, `src/lib/leads/accountability.ts`, `src/components/follow-ups/complete-follow-up-dialog.tsx`, and `supabase/migrations/20260719080908_sales_accountability.sql`.

---

## Member churn risk (migrations `068`–`069`)

Staff can mark a member as a churn risk from a dedicated profile-rail card below BMI. The flag defaults off, uses the existing agent-write contact RLS, and appears as a Yes/No column in All members (including CSV export). Migration `069` removes the initially shipped churn-risk note field so member context stays in the existing Notes section. Key code: `churn-risk-card.tsx`, `members-table.tsx`, `068_member_churn_risk.sql`, `069_remove_churn_risk_note.sql`.

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
- **Add note** → `BulkAddNoteDialog`. Notes batch-insert and the surface stays note-only; manual follow-ups belong to a person's row action or profile Notes composer.
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

---

## Lead capture: public forms + Meta lead ads (Jul 2026, migration `064`)

Closes Phase 2's last gap — until now a lead could only be *typed in, imported, or waited for*. Two inbound paths, one shared foundation.

**Sequenced deliberately.** Meta needs App Review for `leads_retrieval` + `pages_manage_metadata` (weeks; resubmitting can re-queue the already-approved WhatsApp permissions). Forms have no such gate, so forms ship live and the Meta path sits **dark behind an unset `NEXT_PUBLIC_META_LEADS_CONFIG_ID`** — the card doesn't render until review clears.

**Shared foundation.** `findOrCreateContact` (`src/lib/api/v1/contacts.ts`) gained optional `receivedVia` + `source` on `ContactInput` (not positional args → zero call-site churn; the public API still defaults to `'api'`, guarded by a test). New `addContactTags` — additive, unlike the sibling `setContactTags`, which *replaces* and would wipe a lead's existing tags on a second enquiry.

- **Auto-captured leads land UNASSIGNED and ownership-LOCKED.** `user_id` = `resolveAuditUserId()`; `assigned_to` stays NULL (no round-robin exists, and setting it would fire `notify_lead_assigned` at someone who never agreed to own the lead). The lock is **free**: `050:137` / `052:93` already refuse a transfer when `received_via NOT IN ('manual','import')`, so adding `'form'` inherited it with zero SQL. Assignment still works via the approval-gated `request_lead_assignment`.
- **Both paths always write a `contact_notes` row — on create AND on dedupe.** Without this a repeat enquiry from a known number is *completely invisible*: `findOrCreateContact` returns the existing row, `received_via` still reads `'manual'`, and no automation fires.
- Both fire `new_contact_created` themselves. The trigger existed but was dispatched from exactly one place (the WhatsApp webhook) — nothing fires it for you.
- Goal answer → a **tag**, not a new column (`GOAL_OPTIONS` in `leads/attributes.ts`). Keeps the blast radius at seven tags instead of ~8 files.

**Capture forms** (`/f/<token>`, `src/app/f/`, `src/app/api/lead-forms/`). Bare top-level segment like `/join` — no `proxy.ts` change (`protectedPaths` is a prefix allowlist). Fixed field set, no builder. The submit route is **the product's only unauthenticated write**; defence order is rate-limit → honeypot → Turnstile → validate → write.

- **The form token is PLAINTEXT, on purpose.** `account_invitations` hashes its token because that one grants *membership*, and pays for it by rotating on every copy. A form token grants no read of anything and lives in an Instagram bio, so it must be re-copyable. Revocation = `is_active` / rotate. Don't "fix" this.
- **The honeypot returns 200, never 400** — a distinct status tells a bot which field is the trap.
- **Success body is identical whether the contact was created or deduped**, or the endpoint becomes a free "is this number a lead at that gym?" oracle.
- `lead_capture_submissions` snapshots `consent_text` per row (DPDP needs proof of *what* was agreed, not just that it was) and is `ON DELETE SET NULL` on `contact_id` — deleting a lead must not destroy its consent record. Service-role writes only; no client INSERT policy.
- **Turnstile fails CLOSED in production** when `TURNSTILE_SECRET_KEY` is unset (503). The per-IP limiter is an in-memory Map, per-lambda — on Vercel's fan-out it's a speed bump, **Turnstile is the wall**.

**Meta lead ads** (`src/app/api/meta/leads/`). Leadgen arrives on the **`page`** object, which gets its own callback URL + verify token — it cannot ride the WhatsApp webhook. Needs a **second FBLB config** (the WhatsApp Embedded Signup config is fixed-permission; page scopes can't be bolted on). `loadFbSdk` extracted to `src/lib/meta/fb-sdk.ts` so `FB.init` still runs once.

- **Processes INLINE, not in `after()`** — a deliberate divergence from the WhatsApp webhook. Once you've 200'd, Meta never retries, so a failure afterwards loses the lead *forever*. Work first, let the status code tell the truth: on failure return 500 and Meta retries for up to 36h.
- **Claims each lead in `webhook_events`** (`meta:leadgen:<id>`, the Razorpay `ignoreDuplicates` pattern) and **DELETEs its own claim on failure** — otherwise the retry is deduped away into silence. `064` had to `GRANT DELETE ON webhook_events TO service_role`; `059` granted only SELECT/INSERT/UPDATE. Pass `gateway:'meta'` explicitly — the column defaults to `'razorpay'`.
- **Always long-lived-swap the user token first.** Page tokens inherit the lifetime of the token they came from: from a short-lived one they die in ~1h and ingestion stops *silently*.
- Field mapping (`leads/meta-field-mapping.ts`) is three tiers — key-normalize → alias table → **shape fallback** (looks like an email / a phone). Custom question keys are arbitrary (derived from the question text), so a gym asking in Hindi still gets its leads.
- **Email-only leads are SKIPPED, and counted.** `contacts.phone` is NOT NULL and a phone-less lead is unreachable on the WhatsApp wedge. Settings surfaces "N leads skipped — your Meta form doesn't ask for a phone number", which the gym can actually fix in Ads Manager.

**The phone trap (`normalizeSubmittedPhone`, `leads/capture-form.ts` — used by BOTH paths).** A visitor types 10 local digits; `isValidE164` *happily accepts* a bare `9876543210`, so it stores looking clean and is then un-messageable on WhatsApp forever — silently breaking the whole wedge, on the happy path. So the account's dial code is prefixed unless the input is explicitly international. Watch the guard for `'9198765432'`: a real 10-digit Indian number that merely *starts* with `91` and must not be mistaken for one already carrying the country code.

Verified against live: bare 10-digit → stored `919876543210`; dedupe → 1 contact / 2 submissions / 2 notes / identical response body; honeypot → 0 rows; 6th submit → 429; revoke → `revoked`; Meta handshake fails closed (403); tampered signature → 401; failed ingest → 500 **with the claim rolled back**; pre-claimed redelivery → 200 no-op.

---

## Lead delete — admin-any + agent-owns-their-own (migrations `065`, `066`)

Deleting a lead is gated by the **authored-content ownership rule**, enforced in BOTH layers:
- **owner/admin** → delete any lead (incl. auto-captured + teammates').
- **agent** → only a lead THEY created via a human action — `created_by = self` AND `received_via` is human (NULL/`manual`/`import`). Auto-captured leads (whatsapp/meta/api/automation/form) and other people's leads are off-limits.
- **viewer** → never.

Two predicates in `src/lib/auth/roles.ts`: `canDeleteAnyLead(role)` (admin+, the managerial tier) and the per-lead `canDeleteLead(role, {createdBy, userId, receivedVia})` (imports `isHumanReceived` from `leads/attributes`). NOT a `useCan` action — it's per-lead, so call the predicate directly with the row's facts. `065` first tightened `contacts_delete` RLS agent→admin; `066` is the live policy: `is_account_member(…,'admin') OR (…,'agent' AND created_by = auth.uid() AND received_via IS NULL/IN('manual','import'))`. Member deletion unaffected (SECURITY DEFINER `delete_member` RPC, `056`, bypasses RLS).

- **New affordance:** "Delete lead" destructive button pinned below the scroll area in the shared lead sheet (`contact-detail-content.tsx`) — shows on BOTH the leads page sheet and the inbox contact panel off the one component. Confirm `Dialog`; delete chains `.select('id')`, treats zero rows as failure (RLS-silent-fail gotcha); on success → `onUpdated()` + `onClose()`.
- **Every delete path gated by the same predicate** (no UI-only gate): leads table row-action + board card menu compute `canDeleteLead` per-row (board threads `accountRole` + reuses `currentUserId` through `LeadCardContext`, split out of the agent-level `canEdit` that still gates Edit). `handleDelete`/`handleBulkDelete` now `.select('id')` — bulk reports "N deleted · M skipped (you can only delete leads you created)" since RLS silently filters an agent's mixed selection. Bulk button stays agent+ (`canEdit`); RLS is the real filter.

---

## Reminder-blocker dialog + template presets

Two small UX gaps on the renewal wedge's setup path.

- **Remind button explains itself.** `SendReminderButton` was disabled-with-a-title-tooltip when WhatsApp/template aren't ready — invisible on touch, easy to miss. Now the blocked button stays clickable (dimmed) and opens a dialog with the reason **and a deep-link CTA to the fix** (`/settings?tab=whatsapp` or `?tab=templates`). `ReminderReadiness` gained a `resolution: {label, href} | null` set by the hook; no-phone is a per-member blocker with no CTA. Covers every call site (payments buckets, renewal + trial action lists).
- **Template presets** (`src/lib/whatsapp/template-presets.ts`). Ready-made gym templates that pre-fill the New Template form — renewal reminder (the pinned `gym_renewal_reminder`, name locked so the Remind/cron wiring can't be renamed away), payment receipt, payment due, welcome, class booking (Utility); win-back + festival offer (Marketing, flagged as needing opt-in). Written to pass Meta review (transactional Utility copy, contiguous `{{1}}…` with 1:1 samples → clears `validateTemplatePayload`). Surfaced via a "Start from template" gallery dialog + empty-state CTA in `template-manager.tsx`; picking one drops its copy into the create form to customise + submit.

---

## Data deletion — Meta callback + account erasure (migration `066`)

Closes the App Review gap: Meta requires a Data Deletion Request URL, and there was no data-subject erasure path.

- **Meta Data Deletion Request Callback** — `POST /api/meta/data-deletion` (nodejs runtime). Parses + HMAC-verifies Meta's `signed_request` via `src/lib/meta/signed-request.ts` (signature is over the **encoded** payload segment, not the decoded JSON; rejects non-`HMAC-SHA256`, missing `user_id`, empty secret — colocated test). Fails closed with no `META_APP_SECRET`. Records a `data_deletion_requests` row and returns `{ url, confirmation_code }`. Set this route as the app's "Data Deletion Request URL" in the Meta dashboard.
- **Public status page** — `src/app/data-deletion/page.tsx` (`force-dynamic`, unauthenticated; the confirmation code is the capability). `?code=` → looks the request up with the service role and shows status; no code → deletion instructions (doubles as the "Data Deletion Instructions URL"). Note: FB Login here only grants business assets — we store no FB *profile* keyed by ASID, so a callback usually has no profile PII to erase.
- **Account erasure** — `DELETE /api/account`, owner-only (`canDeleteAccount`, already existed) + exact account-name confirmation in `{ confirm }`. Deleting the `accounts` row cascades every `account_id` FK (all tenant Platform Data incl. encrypted `whatsapp_config` tokens); the two things Postgres FKs don't reach — Supabase Storage media (`account-<id>/` prefix across `chat-media`/`flow-media`/`profile-avatars`) and members' `auth.users` login identities — are purged explicitly (self deleted last). Admin-client delete chains `.select('id')` and treats empty as failure (RLS-silent-write gotcha).
- **`data_deletion_requests` table** (`066`) — audit log for both flows. **No FK to accounts on purpose** (an `ON DELETE CASCADE` would erase the trail the erasure creates). RLS enabled, **zero policies** → service-role-only.
- **UI trigger** — `AccountDangerZone` (`src/components/settings/account-danger-zone.tsx`) renders at the bottom of Settings → Members, **self-gated to owner** via `useCan('delete-account')` (returns null otherwise). Type-the-account-name-to-confirm dialog → `DELETE /api/account` → hard-nav to `/` (proxy bounces the now-unauthenticated session to sign-in).

---

## Get Started onboarding checklist (migration `067`)

PushPress-style setup guide for freshly created gyms: a `/get-started` page + sidebar item showing 6 auto-detected setup steps (connect WhatsApp, approve `gym_renewal_reminder`, first plan, first member, first paid payment, invite staff), a progress bar, and a "recommended next action" hero card deep-linking each step (`/settings?tab=…`, `/members`).

- **State lives in ONE place** — `OnboardingProvider` (`src/hooks/use-onboarding-status.tsx`), mounted in `dashboard-shell.tsx` inside `AuthProvider`. Sidebar badge (`N/6`) and page share the fetch. Pure derivation (step defs, done-rules, recommended-next) is `src/lib/onboarding/steps.ts` + colocated test.
- **Zero cost for mature accounts.** Provider short-circuits (no queries) unless admin+ AND `accounts.onboarding_dismissed_at IS NULL` (`067`, nullable timestamptz; existing 017 `accounts_update` RLS already covers the write — no new policy/predicate). When all 6 steps are detected complete the provider **auto-stamps the column once** (ref-guarded, `.select('id')` RLS-silent-fail check) — the sidebar item disappears forever; `/get-started` stays reachable and shows an all-done card. Explicit "Hide this page" button = same write early.
- **Failed fetches can never auto-dismiss**: `deriveOnboardingSteps` treats null signals (failed roster/invite fetches) as incomplete, so `allDone` is only ever affirmative.
- **Refetch-on-visit without setState-in-effect**: the provider keys its effect on `pathname.startsWith('/get-started')`, so landing on the page (e.g. returning from a completed step) refreshes state — the page itself never bumps a nonce in an effect.
- **New `ui/progress.tsx` master component** (user-approved): determinate track+fill (`bg-muted`/`bg-primary`, progressbar aria). First consumer is the setup guide header.
- Non-admins hitting the URL get a friendly "setup is handled by admins" card (no redirect). Row/tile anatomy copied from `settings-overview.tsx`; done-state = a filled emerald circle (see the card-hover section below — the original brand-tinted icon + outline tick was reworked).

---

## Card interaction states — neutral hover, `--border-hover` (no migration)

Triggered by a real clash: the onboarding step rows tinted their leading icon `bg-primary-soft`/`text-primary` and their done-tick emerald. **`emerald` is a shipped accent theme** — so a gym on that accent saw pending rows and done rows in the same green. Brand and status collapsed into one colour.

- **New token `--border-hover`** (`globals.css`, mapped as `--color-border-hover` → `hover:border-border-hover`). **Mirrors intent per mode, not direction**: darkens on light (`0.922 → 0.87`, ≈gray-200 → gray-300), **lightens on dark** (`0.28 → 0.36`). Darkening on dark would push the edge toward the card fill (`0.18`) and dissolve it — the card would read as *losing* its border on hover. Same logic `--card-2` already uses.
- **Card hover = border only.** The fill no longer moves; `hover:bg-*` is gone from every clickable card. Deliberately **neutral, never accent-tinted** — that's what caused the clash. Rule → `docs/ui-patterns.md`.
- **17 cards / 13 files converged onto one hover**, retiring two competing idioms (`hover:border-primary-soft-2 hover:bg-card-2` and the older `hover:bg-muted/60`).
- **Four hovers never fired.** `flows:375`, `automations:280`, both `appearance-panel` cards: `hover:border-border` while already resting at `border-border` = no-op. `notifications:306` had `hover:border-border/70` — *weaker* on hover. All now respond.
- **`gym-metrics.tsx` `TileLink` was dead too** — its child is a `Card`, whose edge is `ring-1 ring-foreground/10`, **not a border**. `[&>div]:hover:border-primary/50` targeted a border that doesn't exist. Retargeted to `hover:[&>div]:ring-border-hover`; those dashboard tiles have hover feedback for the first time.
- **Onboarding rows**: leading icon → neutral `bg-muted text-foreground` on every step (done or not); trailing done-tick → filled `size-5` emerald circle + white `Check` (`strokeWidth={3}`), replacing the `size-4` `CheckCircle2` outline. `CheckCircle2` still used by the all-done card.
- Selected/active states keep their `primary` tint — only the *unselected* hover went neutral. Untouched on purpose: tag pills, dashed dropzone, icon-circle buttons, table rows, canvas nodes, destructive/red.
- `StepRow` (`get-started-view.tsx`) and the settings status tile (`settings-overview.tsx`) are **byte-identical boxes** — visual twins that must change together.
- Verified: `tsc` + eslint clean, `next build` green, and both utilities confirmed in the emitted CSS (`.hover\:border-border-hover:hover{border-color:var(--border-hover)}`, `…ring-border-hover:hover>div{--tw-ring-color:var(--border-hover)}`).
