@AGENTS.md

# UsefulDesk — Product Context (India-First Gym CRM)

> Shared context for every session. UsefulDesk is being turned into an **India-first CRM for gyms, boutique studios, and (eventually) franchises**. Market analysis lives in `PRDs/india_gym_crm_pain_points.md`.

## The one thing to understand first

This repo (`wacrm` v0.7.0) **looks** like a generic WhatsApp CRM but is **not primitive** — it's a mature multi-tenant WhatsApp CRM. It already ships best-in-class versions of the exact layer the market wants (WhatsApp send + templates, broadcasts, automations, shared inbox, RBAC, public API). What is genuinely missing is the **gym domain** (members, plans, memberships, renewals, payments, attendance).

So the strategy is **not** "build a CRM." It is: **keep the WhatsApp/comms foundation, add a gym domain layer on top, wire the two together.** The renewal + WhatsApp workflow that wins this market is ~60% already built.

## Market insights (from the PRD)

Indian gyms don't lack CRM features — they lack a *simple, reliable, WhatsApp-first, UPI-aware* layer for the messy exceptions (renewals, collections, follow-ups, lapsed members). They fall back to WhatsApp + Excel + phone + paper. Biggest pains, most urgent first:

1. **Payments / renewals / reconciliation** — manual chasing via WhatsApp/UPI/cash/Sheets. Revenue leakage. Most monetizable.
2. **WhatsApp is the real CRM** — should be the core channel, not an add-on.
3. **Reports aren't actionable** — owners want *action lists* ("who to call today"), not dashboards.
4. Reliability/sync failures · heavy onboarding/too many clicks · weak staff mobile workflows · weak family/multi-location plans.

**The wedge:** *Know who's expiring → remind on WhatsApp → collect on UPI → assign follow-up → track the conversation.* Everything else is secondary until this loop works.

## Product principles (non-negotiable)

Phone-first · WhatsApp-native (not add-on) · renewal-first · **action lists over dashboards** · simple-for-boutiques / controlled-for-franchises · offline-tolerant · payments + reminders in one flow · every exception has an owner + status + next action · don't force a member app early · owner feels in control in 30 seconds.

**Every feature must answer:** does it help the owner save time, recover lost leads, collect renewals, or retain members? If not — defer.

## Architecture (how this codebase works)

- **Stack:** Next.js 16 (App Router; middleware is renamed `proxy` — see `src/proxy.ts`), React 19, TypeScript, Supabase (Postgres + Auth + Storage + RLS), Tailwind v4, Base UI / shadcn primitives (`src/components/ui/`). No zod (validation hand-rolled). Vitest, colocated `*.test.ts` in `src/lib`.
- **No `"use server"` actions.** Backend = `src/app/api/**/route.ts` handlers OR direct Supabase browser-client calls from client components, secured by Postgres RLS.
- **Tenancy:** tenant = `accounts` row; users belong to one via `profiles.account_id`. RBAC `owner > admin > agent > viewer` (`account_role_enum`) enforced by RLS helper `is_account_member(account_id, min_role)`; mirrored in `src/lib/auth/roles.ts` + `useAuth()` (`canEditSettings`, `canSendMessages`). **Copy the RLS pattern from `supabase/migrations/017_account_sharing.sql`.**
- **Migrations:** sequential + idempotent in `supabase/migrations/` (enum in `DO $$ IF NOT EXISTS` block, `CREATE TABLE/INDEX IF NOT EXISTS`, drop-then-create policies, reuse `update_updated_at_column()`). Latest is `031`.
- **Reuse, don't rebuild:** WhatsApp send = `sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`); dashboard send route `POST /api/whatsapp/send` accepts `contact_id` + `message_type:'template'` and **find-or-creates the conversation** (reaches members with no thread). Contact dedupe = `findExistingContact` / `isUniqueViolation` (`src/lib/contacts/dedupe.ts`). Media upload = `uploadAccountMedia('chat-media', file)` (`src/lib/storage/upload-media.ts`). Currency (INR supported) = `formatCurrency` (`src/lib/currency.ts`).
- **Lint gotcha:** repo enforces `react-hooks/set-state-in-effect`. Never call a setState-wrapping function directly in `useEffect`. Load data with an inline `(async () => { … })()` IIFE + a `cancelled` guard; expose manual refetch as a nonce bump. See `src/components/members/*`.

## UI component reusability (non-negotiable)

- **Never hand-roll a UI element that exists in `src/components/ui/`.** Before writing any pill/button/input/dialog markup, check for a primitive there and use it. If no primitive fits, **stop and ask the user**: create a new master component, or use a different existing one? Don't silently roll an inline one-off.
- **Master components are single sources of truth.** A change to a file in `src/components/ui/` changes every usage across the product — **warn the user before editing one** and list what it affects. Restyling a single call-site goes through `className`/variants, never by forking the component.
- **Badges/status pills:** the canonical pill is `Badge` (`src/components/ui/badge.tsx`). Fixed statuses use the tinted variants (`success` / `danger` / `warning` / `info` / `violet` — **fill-only** recipe `bg-{c}/10 text-{c}-400`, matching upstream shadcn `destructive`; no borders on pills). Admin-created **tags always render `variant="neutral"`** (gray fill, full-strength text — never colour-coded in display). DB-driven hex colours (lead statuses) use the `color` prop, which applies the same fill-only recipe inline. Domain wrappers (e.g. `MembershipStatusBadge`, `FeeStatusBadge` in `src/components/members/membership-status-badge.tsx`) map domain state → Badge variant; add wrappers like these rather than repeating variant choices at call-sites. Interactive chips (clickable tag toggles, removable filters) are buttons, not badges — don't force them into `Badge`.

## Roadmap (phased — build step by step, don't over-engineer)

- **Phase 1 — Core CRM foundation (the renewal wedge):** membership plans, member records, renewal action lists (expiring/expired/due), one-tap WhatsApp reminder, manual payment recording, basic staff assignment, simple owner tiles. **← Milestone 1, now built.**
- **Phase 2 — India-first workflows:** templated WhatsApp follow-ups, missed-lead reminders, trial tracking, auto expiry alerts (reuse `automations`), payment-due buckets, manual reconciliation, (later) UPI payment links/AutoPay.
- **Phase 3 — Retention & ops:** at-risk members, attendance/visit tracking, dormant recovery (reuse broadcasts), trainer accountability, owner reporting.
- **Phase 4 — Franchise / multi-branch:** `branches` + `branch_id` + RLS rework, branch dashboards, centralized member view, branch-scoped roles, standardized reports. Family/household plans slot in here.

**Deferred (don't build early):** branded member app, class marketplace, payroll, workout/nutrition tracking, franchise analytics, door access, AI automation, loyalty, UPI AutoPay.

## Gym domain layer (data model)

A **member = a `contacts` row that also has a `memberships` row.** New tables (migration `031_gym_memberships.sql`):

- `membership_plans` — name, price, `duration_days`, `is_active` (soft-archive; a plan in use can't be hard-deleted, FK RESTRICT). Settings-class (admin write).
- `memberships` — one per member (`UNIQUE account_id, contact_id`): `plan_id`, `start_date`, `end_date` (expiry — the hot column), `status` (active/frozen/cancelled/**expired derived at read time**), `fee_amount`, `fee_status` (paid/due), `frozen_at`. Operational (agent write). Renewals mutate in place.
- `payments` — append-only ledger: amount, method (cash/upi/card/bank/other), `paid_at`, `period_start/end`, `screenshot_url/path` (chat-media). Delete = admin-only.

All date math is **IST-first** (`src/lib/memberships/expiry.ts`) — members must not expire a day early/late for a UTC+5:30 owner. "Expired" is derived (no cron needed for M1).

## Current status

**Milestone 1 (renewal wedge) is built and green** (typecheck/lint/tests/build). Members = a **new top-level nav section** (`/members`) whose home is the Renewals action lists; Contacts stays the raw people+inbox table. Plans managed at Settings → Membership plans. Key code: `src/app/(dashboard)/members/page.tsx`, `src/components/members/*`, `src/components/settings/plans-settings.tsx`, `src/lib/memberships/expiry.ts`, migration `031`.

**One-tap reminder depends on** each account having WhatsApp connected + an **approved Meta Utility template `gym_renewal_reminder`** with 4 body params: `{{1}}` name, `{{2}}` plan, `{{3}}` expiry, `{{4}}` fee. Without it the Remind button self-disables with a setup hint; the rest of M1 works without WhatsApp.
