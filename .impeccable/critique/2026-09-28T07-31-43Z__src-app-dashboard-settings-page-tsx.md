---
target: Settings menu navigation and nomenclature
total_score: 23
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-09-28T07-31-43Z
slug: src-app-dashboard-settings-page-tsx
---

⚠️ DEGRADED: single-context (sub-agents are only spawned on an explicit user request in this harness; the user asked for a report, not for this skill)

Full report: https://claude.ai/artifact/L8CUzhZEfHQhRfgxxJ1iA3 (Settings Navigation Audit, 28 Sep 2026)

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                     |
| --------- | ------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 3         | Status on some Overview tiles; on phones the app bar only says "Settings"                     |
| 2         | Match System / Real World       | 2         | "Account" = the person; Team card counts staff as "members"; three different "Payments"       |
| 3         | User Control and Freedom        | 3         | URL per section, browser back works, unsaved-changes guard on Automated messages              |
| 4         | Consistency and Standards       | 2         | Sidebar Settings → Overview, profile-menu Settings → WhatsApp; Overview order ≠ rail          |
| 5         | Error Prevention                | 2         | `/settings?tab=payments` links resolve to Overview; guard exists on one panel only            |
| 6         | Recognition Rather Than Recall  | 1         | Phone rail hides 14 of 17 items; misfiled settings (Trainers, Expense categories) need recall |
| 7         | Flexibility and Efficiency      | 2         | Deep links exist; no settings search (GlobalSearch is unmounted)                              |
| 8         | Aesthetic and Minimalist Design | 3         | Clean panels; 17 items under 6 headings is dense; staff see all admin sections                |
| 9         | Error Recovery                  | 3         | ResolvableAction blockers explain and link to the fix                                         |
| 10        | Help and Documentation          | 2         | Good panel descriptions; no "where is X" help                                                 |
| **Total** |                                 | **23/40** | **Acceptable**                                                                                |

## Design Specificity Verdict

LLM assessment: panels follow the product's system (tokens, SettingsPanelHead, plain copy) and read as UsefulDesk. The information architecture does not: groups are generic software buckets ("Account", "Business setup", "Your gym") rather than the owner's renewal loop, and the phone layout is a category-default scrolling pill strip.
Deterministic scan: `detect.mjs` over `src/components/settings` and `src/app/(dashboard)/settings` found 3 advisory findings, all `design-system-font-size` (10px) in `api-keys-settings.tsx`. None relate to navigation. No overlay run (target requires auth; screenshots came from a temporary dev harness, since deleted).

## Priority Issues

- **[P1] Phone rail is a 17-button horizontal strip with hidden headings.** 2,618px strip in a 358px window; headings `hidden … lg:block` (`settings-rail.tsx:91`, `:76`). Fix: grouped vertical hub + tap-in sections with back arrow. Suggested command: /impeccable adapt
- **[P1] Broken deep links.** `/settings?tab=payments` (payment-link-actions.tsx:73, 95; invoice-document-actions.tsx:126) falls back to Overview; invoice setup belongs in Business details. Fix: alias + correct target + a test that all `?tab=` hrefs resolve. Suggested command: /impeccable harden
- **[P1] Two "Settings" doors.** Profile menu Settings → `?tab=whatsapp` (sidebar.tsx:721). Fix: point to /settings. Suggested command: /impeccable clarify
- **[P1] Misfiled settings.** Trainers in Products & services; Expense categories in Payments; reminders in Settings while "Automations" is in the main menu; Add branch only in the sidebar branch menu. Fix: one home per setting + cross-links. Suggested command: /impeccable shape
- **[P2] Overlapping names and incomplete Overview; no search; laptop rail runs past the fold (847px); staff see all admin sections.** Suggested commands: /impeccable clarify, /impeccable distill, /impeccable layout

## Persona Red Flags

**Casey (distracted mobile user):** Opens Settings on a phone, sees Overview · Your profile · Login & se…; has to swipe ~4.4 screens to reach Membership plans with no headings to hint what's next.
**Jordan (first-timer):** Taps "Connect Razorpay" on an invoice and lands on a grid of tiles; taps profile menu "Settings" and lands on WhatsApp; reads "3 members" on the Team card.
**Gym owner at the front desk (project persona):** Wants to add a trainer's PT fee and looks in Team members; wants an expense type and looks in Business › Expenses; wants renewal reminders and opens Automations.

## Minor Observations

- Overview WhatsApp tile uses a plug icon; the rail uses the WhatsApp mark.
- Business details tile says "Gym name, branches, and invoice details" while Branches is a separate item.
- Branches panel footer says "Use the branch menu on the left" (inside the hamburger on phones).
- No notification preferences anywhere; subscriptions PRD plans "Settings → Billing", a name that collides with member billing.

## Questions to Consider

- What if Settings were ordered by the renewal loop (plans → WhatsApp → payments → team) after the gym's identity?
- What if the Overview were the phone navigation itself instead of a partial copy of the rail?
- Should Automations and Automated messages be one feature with one name?
