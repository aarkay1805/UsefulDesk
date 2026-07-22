# Roadmap

> Phased — build step by step, don't over-engineer. The feature filter (in `CLAUDE.md`) governs everything here: does it save the owner time, recover lost leads, collect renewals, or retain members? If not, defer.

## ✅ Phase 1 — the renewal wedge

Membership plans · member records · renewal action lists (expiring / expired / due) · one-tap WhatsApp reminder · manual payment recording · staff assignment · owner tiles.

## ✅ Phase 2 — India-first workflows

Shipped: templated WhatsApp follow-ups · a responsive full-width WhatsApp connection flow with the manual Meta setup guide nested beside its credential form · trial tracking · payment-due buckets · manual reconciliation · **UPI AutoPay** · billing periods / invoices · **a hardened member-profile membership and billing flow with cycle-safe edits, confirmed lifecycle actions, balance-aware renewals and payments, invoice-return navigation, exact AutoPay pricing, and responsive mobile actions** · **a focused split-layout lead conversion with a shared 18px semibold large-dialog title hierarchy, inline-editable personal information including Birthday and account-configured Gender, full-width guttered active editors, profile photo and localized measurements beside consistently labelled and spacious plan/payment decisions, responsive height up to 96vh capped at 900px, overlap-safe matching checkbox sections with roomy revealed controls, and auditable one-time amount/percentage discounts that never recur, defaulting to a percentage-first segmented choice with shared 10%/20%/30% quick-input chips and percentage discounts constrained to greater than zero and at most 100% across field, submit, and database validation** · the leads module (CSV import 2.0, ownership transfer, assignment approval, board, **a compact lead follow-up queue plus counted quick views for missing follow-ups, unassigned work, personal assignments, and today's intake; no chip means all leads**) · **a single-action four-step Members CSV import with shared table/import field registry, intelligent vendor-header mapping, editable preview, profile/custom-field migration, and ledger-correct partial or full payments** · attendance limits · **lead capture — public forms + Meta lead ads** (migration `064`; consent captured + audited per submission) · a shared accessible 240px search-field master with clear and Escape behavior across data surfaces · shared pill-shaped Sort and Filters actions with an active primary tint across data surfaces · a homogeneous Search → Filters → Sort → counted-chip toolbar order across member, lead, follow-up, and payment data lists, with single-row chevron-browsable chip overflow and compact icon-only table/board view controls · adaptive WCAG-AA semantic colour foreground tokens shared by badges, chips, alerts, icons, and destructive actions · a collapsible desktop navigation rail with hover-revealed overflow scrollbar, live Inbox unread state, a generated new-message chime, and repeating unread follow-up reminder ringtones · **feature-parity lead/member follow-up queues** with shared search, filters, sorting, counted due buckets, owner scope, table controls, bulk completion, and inline reassignment; member Reason/reminders and lead Status/Stage age stay contextual · **manual follow-up creation parity** with one shared row trigger/dialog, **Notes & follow-ups** as the profile creation path, lead Reason choices removed, standalone tasks visible in the profile even without notes, and one follow-up-first card hierarchy for standalone and note-linked tasks · **repaired lead completion outcomes** so Contacted and Trial booked are enforced consistently by the UI and database.

**Left:**

- **Meta lead ads: waiting on Meta App Review** (`leads_retrieval` + `pages_manage_metadata` — needs Business Verification). The code is built and tested; the Settings card stays hidden while `NEXT_PUBLIC_META_LEADS_CONFIG_ID` is unset. **Set that env var once review clears — that's the whole launch.**
- Booking · lead scoring.
- `received_via='automation'` remains a **reserved, unwired slot** (a future "create contact" automation step) — set it on that insert and the Leads "Received By" column lights up automatically. See `src/lib/leads/attributes.ts` (`autoReceivedLabel`).

## 🚧 Phase 3 — retention & ops

Built: attendance + plan visit limits / session packs, with separate Name and Plan register columns and All-members-parity Plan header filtering · **account-wide immutable Member IDs with quick front-desk ID check-in and future multi-branch/biometric-safe identity** · a persisted freezable Name column in All Members · at-risk members via churn-risk flags · dormant recovery through Renewals · full owner reporting.

Left: trainer accountability.

## ⬜ Phase 4 — franchise / multi-branch

`branches` table + `branch_id` + an RLS rework · branch dashboards · centralized member view · branch-scoped roles · standardized reports. Family/household plans slot in here.

## Don't build early

Branded member app · class marketplace · payroll · workout/nutrition tracking · franchise analytics · door access · loyalty.

## Optional / open

- Richer Razorpay `payment.failed` handling — an immediate "auto-pay failed, pay manually" nudge instead of waiting for `subscription.halted` → manual.
- One-click "Connect Razorpay" via OAuth / embedded onboarding, replacing the key-paste settings card (additive swap — the creds surface is already abstracted; plan in `PRDs/upi_autopay.md`).
- Auto-generating / charging _future_ invoices (a billing cron — overlaps AutoPay) · persisting the Upcoming projection.
- Account-wide pending-transfers console · lead-transfer auto-expiry cron.
- Leads board **group-by** (pivot on source / assignee instead of status) — has a real drag-semantics decision (dragging would set the grouped dimension: a direct source-write vs the approval-gated `requestLeadAssignment`), so it's a feature, not a pref.
