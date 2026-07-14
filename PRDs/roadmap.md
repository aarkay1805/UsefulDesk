# Roadmap

> Phased — build step by step, don't over-engineer. The feature filter (in `CLAUDE.md`) governs everything here: does it save the owner time, recover lost leads, collect renewals, or retain members? If not, defer.

## ✅ Phase 1 — the renewal wedge

Membership plans · member records · renewal action lists (expiring / expired / due) · one-tap WhatsApp reminder · manual payment recording · staff assignment · owner tiles.

## ✅ Phase 2 — India-first workflows

Shipped: templated WhatsApp follow-ups · trial tracking · payment-due buckets · manual reconciliation · **UPI AutoPay** · billing periods / invoices · the leads module (CSV import 2.0, ownership transfer, assignment approval, board) · attendance limits · **lead capture — public forms + Meta lead ads** (migration `064`; consent captured + audited per submission).

**Left:**
- **Meta lead ads: waiting on Meta App Review** (`leads_retrieval` + `pages_manage_metadata` — needs Business Verification). The code is built and tested; the Settings card stays hidden while `NEXT_PUBLIC_META_LEADS_CONFIG_ID` is unset. **Set that env var once review clears — that's the whole launch.**
- Booking · lead scoring.
- `received_via='automation'` remains a **reserved, unwired slot** (a future "create contact" automation step) — set it on that insert and the Leads "Received By" column lights up automatically. See `src/lib/leads/attributes.ts` (`autoReceivedLabel`).

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
