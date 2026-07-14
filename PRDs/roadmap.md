# Roadmap

> Phased — build step by step, don't over-engineer. The feature filter (in `CLAUDE.md`) governs everything here: does it save the owner time, recover lost leads, collect renewals, or retain members? If not, defer.

## ✅ Phase 1 — the renewal wedge

Membership plans · member records · renewal action lists (expiring / expired / due) · one-tap WhatsApp reminder · manual payment recording · staff assignment · owner tiles.

## ✅ Phase 2 — India-first workflows

Shipped: templated WhatsApp follow-ups · trial tracking · payment-due buckets · manual reconciliation · **UPI AutoPay** · billing periods / invoices · the leads module (CSV import 2.0, ownership transfer, assignment approval, board) · attendance limits.

**Left:**
- **Meta lead-ads capture.** `received_via='meta'` is a **reserved, unwired slot** — the Leads "Received By" column already renders "Auto · Meta", but **no code path creates a contact from a Meta lead ad**. When lead-ads capture is built, set `received_via: 'meta'` on that insert and the column lights up automatically. The same reserved slot exists for `'automation'` (a future "create contact" automation step). See `src/lib/leads/attributes.ts` (`autoReceivedLabel`) and the create-path list in migration `048`'s header.
- Capture forms · booking · consent · lead scoring.

## 🚧 Phase 3 — retention & ops

Built: attendance + plan visit limits / session packs.

Left: at-risk members · dormant recovery (reuse broadcasts) · trainer accountability · owner reporting.

## ⬜ Phase 4 — franchise / multi-branch

`branches` table + `branch_id` + an RLS rework · branch dashboards · centralized member view · branch-scoped roles · standardized reports. Family/household plans slot in here.

## Don't build early

Branded member app · class marketplace · payroll · workout/nutrition tracking · franchise analytics · door access · loyalty.

## Optional / open

- Richer Razorpay `payment.failed` handling — an immediate "auto-pay failed, pay manually" nudge instead of waiting for `subscription.halted` → manual.
- One-click "Connect Razorpay" via OAuth / embedded onboarding, replacing the key-paste settings card (additive swap — the creds surface is already abstracted; plan in `PRDs/upi_autopay.md`).
- Auto-generating / charging *future* invoices (a billing cron — overlaps AutoPay) · persisting the Upcoming projection.
- Account-wide pending-transfers console · lead-transfer auto-expiry cron.
- Leads board **group-by** (pivot on source / assignee instead of status) — has a real drag-semantics decision (dragging would set the grouped dimension: a direct source-write vs the approval-gated `requestLeadAssignment`), so it's a feature, not a pref.
