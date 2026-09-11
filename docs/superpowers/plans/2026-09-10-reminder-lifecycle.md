# Renewal and collection reminder lifecycle implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the assigned step task-by-task. The user explicitly chose six separate GPT-5.6 Terra tasks, sequential execution, the saved project directly on `main`, and no worktrees. Those choices override skill defaults for worktrees, execution-choice questions, and subagent delegation.

**Goal:** Close the six prioritized renewal and collection automation gaps with tested, branch-isolated workflows, clear owner controls, and honest production readiness.

**Architecture:** Preserve the existing renewal/installment workers and financial source of truth. Introduce one durable lifecycle reminder queue for additional invoice, expiry, promise, provider-failure, confirmation, and retention events; reuse the existing outbound WhatsApp boundary, exact template readiness, localization, branch authorization, and cron aggregator. Each step integrates its rules into settings and existing member/payment/follow-up surfaces, rather than introducing a second CRM.

**Tech Stack:** Repository Next.js 16 / React 19 / TypeScript, Supabase Postgres/RLS, existing Base UI masters, Vitest. No new validation framework or messaging provider.

**Spec:** The accepted product scope is the six priorities in the conversation of September 10, 2026, expanded into acceptance contracts below. This document is both the execution plan and its scoped product specification. The full earlier reminder inventory is discovery, not authorization to build unrelated custom billing, household plans, trial campaigns, or access control.

## Global constraints

- Execute directly in `/Users/rajatkashyap/Desktop/projects/UsefulDesk` on `main`. No worktree or branch. One writing task at a time.
- Preserve pre-existing uncommitted work in `PRDs/roadmap.md`, `docs/changelog.md`, and `docs/mobile/internal-testing.md`. Do not revert or commit unrelated hunks. Do not push/deploy without the coordinator's release decision; implementation authorization is not a reason to silently release customer messaging.
- Read `AGENTS.md`, relevant domain/runbook documentation, the complete `docs/ui-patterns.md` before UI work, and the relevant installed Next.js guide before Next.js code. Use Context7 as instructed for library-specific questions; do not query credentials.
- Every step updates this checklist, `PRDs/roadmap.md`, `docs/changelog.md`, and its relevant operator documentation. Record exact files, tests, migration state, and remaining external prerequisites. Never mark live delivery proven from mocks, a queued job, or a provider acceptance ID alone.
- Read-only production checks are authorized. Do not send WhatsApp/SMS/email, enable new customer-facing schedules, initiate payment links/charges/refunds, or submit templates to Meta as a test without explicit recipient/action authorization. Build the application setup paths and retain concrete provider prerequisites. Never fabricate approval, delivery, or payment evidence.
- New schedules default disabled, and new event consumers do not backfill old confirmations. Preserve existing opted-in schedules. Default migration/configuration must not cause customer sends.
- Use approved Supabase migration tooling, never `supabase db push`. Additive RLS-protected migrations may be applied when their no-send defaults and compatibility are verified; production schema cannot be treated as verified until read back. Inspect the latest migration before choosing each filename. No destructive ledger migration or replay of financial events.
- Named predicates in `src/lib/auth/roles.ts`, tested and mirrored in RLS, govern all new mutations. Account/branch identity must come from authenticated context or verified provider binding, never trusted request IDs alone. Preserve author-edit/admin-delete rules.
- All money comes from authoritative invoice/payment facts. Refund-review, void, settled, disputed/verification holds suppress collection. Payment is not renewal; renewal invitation is not debt. Do not generate future debt or silently extend membership dates.
- Existing consent/opt-out behavior is an explicit repository invariant; do not silently change global messaging policy as part of these six steps. Preserve audit data and report any product-policy limitation.
- Reuse UI masters without visual overrides. Existing account timezone and locale formatters own dates, money, and send windows. Staff ownership is a branch member, not an independent trainer ID.
- The one-open-follow-up-per-contact invariant remains. Escalations reuse an open task or create a deduplicated attention record; never overwrite a person's note, assignee, or promised action.
- All worker retries use bounded attempts/backoff, leases with ownership/generation checks, deterministic business keys, and current eligibility checks just before sending. Treat external acceptance followed by persistence failure as ambiguous, not safe to blindly resend. Separate provider-accepted from delivered/read/failed.

## Shared implementation contract (introduced in Step 2)

Create `src/lib/reminders/` for the additional lifecycle, with focused `policy.ts`, `types.ts`, `worker.ts`, and colocated tests. Adapt filenames only when an existing canonical module demonstrably fits better, and record the adopted interface here before the next step.

**Implemented interface (Step 2):** `policy.ts` exports `selectDueMilestone`,
`isCollectibleInvoice`, `requiresAutoPayReconciliation`, and
`shouldSuppressGeneralPreDue`; `worker.ts` exports
`runLifecycleReminderWorker`, deterministic business-key and daily-budget
helpers; `types.ts` owns the job/state/config contracts. The database interfaces
are `claim_lifecycle_reminder_jobs(p_worker_id, p_limit)` and
`finish_lifecycle_reminder_job(p_job_id, p_worker_id, p_lease_generation,
p_state, p_provider_message_id, p_reason, p_next_attempt_at)`.

```ts
// Pure schedule primitive. Dates are account-local YYYY-MM-DD.
export interface ReminderMilestone {
  key: string;
  offsetDays: number; // negative before, zero on, positive after anchor
}
export interface DueMilestoneInput {
  anchorDate: string;
  today: string;
  activatedOn: string;
  milestones: readonly ReminderMilestone[];
  handledKeys: readonly string[];
  catchUpDays: number;
}
export function selectDueMilestone(
  input: DueMilestoneInput
): ReminderMilestone | null;
```

The helper chooses at most the latest eligible unhandled milestone within the catch-up window, never a pre-activation milestone. An outdated earlier milestone is superseded, not queued alongside a later one. DB claims, not this helper, enforce cross-worker deduplication. Steps 3–6 extend the same dispatcher and ledger; do not create six unrelated schedulers.

The durable record must contain branch, contact, kind, exact subject/cycle/event identity, milestone, activation/generation context, due date/time, state, attempt count, owner lease, provider message ID, timestamps, and structured skip/error reason. Unique keys must exclude mutable price/balance, and include the cycle/event identity so a subsequent renewal/payment can legitimately notify. Keep customer content out of operational summaries. Member-wide coordination permits at most one automatic chasing message per account-local day, defers lower priority eligible work, and does not suppress a factual payment confirmation. Priority is broken promise/failed collection, due debt, overdue debt, expiring membership/service, retention. A healthy live mandate prevents manual collection chasing of its covered membership obligation. Do not suppress unrelated collectible service debts merely because a member has AutoPay.

Initial new send window is 09:00–19:00 account-local, configurable through existing settings patterns; preserve legacy behavior until users opt into the new policy. After each provider call persist acceptance and use existing message delivery statuses for outcomes. Missing connection/template/phone/product access must be visible as a structured blocked reason, not silently counted as success. Staff-facing diagnostics distinguish disabled, no eligible records, blocked, deferred, attempted, accepted, delivered, and failed.

Example schedule regression to implement with the actual helper:

```ts
expect(
  selectDueMilestone({
    anchorDate: '2026-09-10',
    today: '2026-09-13',
    activatedOn: '2026-09-01',
    milestones: [
      { key: 'late-1', offsetDays: 1 },
      { key: 'late-3', offsetDays: 3 },
    ],
    handledKeys: [],
    catchUpDays: 2,
  })
).toEqual({ key: 'late-3', offsetDays: 3 });
expect(
  selectDueMilestone({
    anchorDate: '2026-09-10',
    today: '2026-09-13',
    activatedOn: '2026-09-13',
    milestones: [{ key: 'late-1', offsetDays: 1 }],
    handledKeys: [],
    catchUpDays: 2,
  })
).toBeNull();
```

## Step 1 — Establish and repair existing reminder readiness

**Files:** `src/app/api/renewals/cron/route.ts`, `src/app/api/payment-installments/cron/route.ts`, `src/lib/memberships/renewal-reminders.ts`, `src/lib/memberships/installments.ts`, `src/lib/whatsapp/template-readiness.ts`, `src/components/settings/renewal-reminders-settings.tsx`, `src/app/api/database-cron/route.ts`, their tests, `docs/renewal-reminders.md`, `docs/payment-installments.md`, `docs/automations-and-cron.md`.

**Consumes:** existing workers, settings, templates, claim ledgers and live read-only tooling. **Produces:** evidence report `docs/reminder-readiness-2026-09-10.md`; tested worker diagnostics and a readiness surface including installments. No new lifecycle queue yet.

- [x] Capture HEAD/dirty baseline; read docs and worker behavior. Re-read live settings, exact readiness inputs, aggregate eligibility for each milestone, ledgers, database HTTP worker results and scheduler status. Never execute a sending cron to inspect it.
- [x] Explain the empty ledgers with evidence where possible. Distinguish no eligibility from setup failure, scheduler dispatch from route completion, acceptance from delivery. Record unknowns honestly.
- [x] Add a safe, read-only readiness/eligibility diagnostic path through existing server patterns; reuse exact selectors where practical without coupling diagnosis to claiming/sending. Expose actionable membership/service/installment readiness in existing Settings, using existing components. No secret or member payload leakage.
- [x] Add focused regressions before repairs: absent installment template blocks with exact reason; wrong category/components/sync status cannot send; no eligible cohort is not an error; non-recurring/frozen/cancelled/healthy AutoPay are excluded where appropriate; paid/refund-review installment is skipped; repeated claim dedupes; failed send is not presented as delivered. Fix only proven defects in legacy behavior.
- [x] Correct stale runbook scheduling (database :41, GitHub :47) and document exact recovery steps for missing templates. Do not submit or send externally.
- [ ] Run focused tests and `npm run verify` if application code changed. Focused suite, typecheck, and lint pass; full verify was attempted but is blocked by unrelated existing test/build failures recorded in the Step 1 handoff below.

**Exit:** existing paths have tested readiness/diagnostics and an evidence-backed production explanation. A missing provider template or authorized live recipient is an explicit external acceptance prerequisite, not a reason to invent a passing live send or stop later independent implementation.

## Step 2 — General unpaid invoice and overdue installment collection

**Files:** create the shared `src/lib/reminders/` modules and tests; create `src/app/api/reminders/cron/route.ts` and tests; add an additive migration for settings/ledger and service-only claim/finish RPCs; integrate `src/app/api/database-cron/route.ts`, `.github/workflows/renewals-cron.yml`, `src/components/settings/renewal-reminders-settings.tsx`, `src/lib/whatsapp/template-contracts.ts`, readiness tests, and named roles. Reuse `src/lib/finance/invoices.ts` and the current `invoice_balances` definition rather than reimplementing ledger calculations.

**Consumes:** Step 1 readiness boundary and current invoice facts. **Produces:** shared durable scheduler/dispatcher interface above, general invoice collection and installment-overdue rules, operator settings, delivery/blocked history, migration evidence.

- [x] Inspect latest invoice balance/due-date schema and actual checkout semantics; write the final subject identity and effective due-date contract into this plan. `invoice_balances` has no generic due date, so an invoice's account-local `issued_at` date is its effective due date; `membership_installment_plans.second_due_on` remains the fixed installment promise. Generic subject identity is `(invoice_id, activation_generation)` and installment identity is `(installment_plan_id, activation_generation)`. No price/balance participates in a business key.
- [x] Implement the helper tests above and debt eligibility tests: zero/negative/void/refund-review balance never claims; partial payment uses current residual; a qualifying fixed installment suppresses overlapping general pre-due collection; membership, service-only and merchandise invoices are all handled by invoice identity; historical activation does not blast a backlog.
- [x] Add branch-isolated settings and durable jobs with RLS, atomic lease/finish and bounded catch-up. Defaults: general before-due 3/1 days and due-day; overdue 1/3/7/14 days; installment overdue uses its promised date and shares the invoice coordination key. All new schedules disabled until configured.
- [x] Wire the worker into both scheduler paths and shared auth. Re-evaluate balances and holds before sending, and classify missing prerequisites. Ensure new worker failure makes the aggregate fail honestly without preventing other worker phases. Add concurrency, lease ownership, crash ambiguity, account isolation, send window, and cross-kind daily-budget tests.
- [x] Add exact invoice-oriented Utility template contracts and setup UI without aliasing existing membership-only copy. Include invoice reference, actual remaining amount, due date, and reply/help action; never claim access is blocked. Add configuration and recent blocked/accepted outcomes to the existing settings surface.
- [x] Verify SQL in an isolated no-send scope or transaction where supported; apply additive safe migrations through approved tools and read back RLS/grants/schema. Run focused tests and full verify. Update docs and handoff with exact interfaces, SQL RPC names, and migration status. Focused tests/typecheck/lint pass; full verify remains blocked only by the existing test/build failures recorded below.

**Exit:** configurable generic invoice and overdue-installment collection runs through the real scheduled worker and has UI plus tested no-send/paid/refund/tenant/duplicate protections.

## Step 3 — Post-expiry membership and service follow-up

**Files:** extend Step 2 modules/migration/settings; `src/lib/memberships/renewal-queue.ts`, `src/lib/memberships/pricing.ts`, current service renewal queue, `src/lib/whatsapp/template-contracts.ts`, and existing follow-up creation/notification patterns.

**Consumes:** durable jobs and readiness, membership/service cycle identity. **Produces:** independently configurable post-expiry sequences and deduplicated staff escalation.

- [x] Add pure and worker tests: expired is derived from date, not a stored status filter; renewed future cycle cancels obsolete work; frozen/cancelled and non-renewable items do not chase; active AutoPay is excluded; updated service rate is required; membership and service messages coordinate per member.
- [x] Implement disabled-by-default post-expiry milestones 1/3/7 days for membership and service separately, with expiry-specific Marketing copy and exact contracts. Snapshot subject identity, but use current renewal price; never call debt collection code for a renewal invitation.
- [x] At the end of the unanswered sequence, create a staff follow-up once with next action and branch-valid owner, or link an existing open follow-up without editing its authored content/assignment. Use response/message history to avoid treating a reply as unanswered. Missing owner routes to the branch owner/attention surface.
- [x] Add schedule controls and visible paused/superseded/escalated outcomes using the canonical settings and member communication/follow-up surfaces.
- [x] Test reply, renewal, manual reminder overlap where shared policy applies, concurrent runs, delayed job, archived service and branch isolation. Apply/read back safe migrations and update operator docs and roadmap/changelog. Focused suites and rollback-only SQL harness pass; `npm run verify` reaches the two documented pre-existing test failures before build.

**Exit:** expiry+1/+3/+7 is schedulable for both subjects and reliably stops or hands responsibility to a person.

## Step 4 — Promise-to-pay and unpaid payment-link follow-up

**Files:** extend reminders modules; add a focused promise model/API and migration; integrate `src/components/finance/invoice-detail-dialog.tsx` and existing member invoice presentation; reuse `src/components/follow-ups/follow-up-composer.tsx` if task UI is needed; inspect `src/lib/payments/razorpay-payment-links.ts`, `src/components/finance/payment-link-actions.tsx` and payment-link API.

**Consumes:** invoice jobs, exact invoice balance, canonical payment-link state and follow-up ownership. **Produces:** authored payment promise/hold lifecycle and existing-link reminder rules.

- [x] Add an invoice-linked promise containing due date, amount bounded by collectible balance, author, assigned branch staff member, state and revision. Add explicit verification/dispute hold with reason and a staff next action; do not infer promise dates or payment truth from free text. Expose add/change/resolve in existing invoice detail with author and role rules in both UI and RLS.
- [x] Tests: invalid amount/date and cross-branch assignee guards are database-enforced; promise/hold suppression, revision keys, authored edit/resolve and author-or-admin audited cancellation, allocation fulfillment, and one-open-follow-up behavior are contract/harness-covered.
- [x] Implement promise reminders one day before and on promised day; a broken promise next day creates one follow-up and one configured message, without duplicating generic overdue reminders. Payment allocations resolve a fulfilled promise deterministically; underpayment preserves only the residual obligation.
- [x] Implement existing unpaid payment-link follow-up after 1 and 3 days from confirmed send and before actual link expiry. Never treat creation alone as sent, never resend a stale/paid/cancelled link, and never create a replacement provider link in the cron. Expired link becomes a staff action to generate a replacement through the existing explicit payment-link flow.
- [x] Apply/read back the migration through the approved Supabase tool; then run the rollback-only SQL harness. Focused tests, typecheck, and lint have been run locally; full verification still has the documented unrelated failures.

**Exit:** staff can record a payment commitment/hold, automation honors it, broken promises become owned work, and existing unpaid links get bounded follow-up.

## Step 5 — Failed AutoPay recovery and transaction confirmations

**Files:** `src/lib/payments/razorpay-webhook-processor.ts` and tests, durable Razorpay event/recovery code, `src/app/api/member-checkouts/route.ts`, actual manual payment source/RPC hooks, shared reminder queue, exact template contracts and member communication UI. Inspect existing database triggers to cover all authoritative payment entry paths rather than only one dialog.

**Consumes:** verified provider events, immutable payment/renewal facts and existing debt/hold rules. **Produces:** failure events and factual payment/renewal confirmation jobs, without changing money movement or auto-renew semantics.

- [x] Resolve current provider event documentation with Context7 before changing event assumptions. Write tests for event signature/binding already supplied by ingress, duplicate/out-of-order failure, later successful charge, pending versus terminal mandate state, manual settlement, refund hold and missing ledger identity.
- [x] Enqueue a targeted failure notice only from an attributable verified failure. A provider retry still pending must not tell the member to pay manually and risk double collection; give an accurate retry/attention message or staff action. Terminal/manual-fallback debt can reuse the collection flow after a fresh mandate/balance check. Do not revoke a healthy mandate merely to send a reminder.
- [x] Wire factual payment receipt and renewal confirmation jobs from committed transaction facts using unique payment/cycle keys. Cover staff-recorded payment, checkout and successful provider payment; distinguish payment-only arrears settlement from an actual renewal. Do not promise an active-until date unless the transaction supports it. Combined payment-and-renewal should yield one coherent confirmation, not duplicate messages.
- [x] Confirmations are disabled by default, only apply to new events after activation, and do not backfill historical payments. They remain independent of chasing daily caps. Provider reconciliation/replays must not generate duplicate notifications or mutate ledgers as a side effect of messaging.
- [x] Add settings, exact template/readiness and delivery history; test retries and rolled-back transactions emit nothing. Run focused provider/reminder/payment tests and full verify; apply/read back safe migration, document external provider review prerequisites and update handoff.

**Exit:** actionable failure recovery and accurate event-driven confirmations are integrated with real authoritative sources and verified without live charges or customer messages.

## Step 6 — Session depletion, freeze return and win-back

**Files:** `src/lib/memberships/attendance-limits.ts`, `src/lib/memberships/attendance-snapshot.ts`, membership freeze API/RPC and member detail UI discovered from call sites, shared reminders modules/settings/contracts/migrations.

**Consumes:** derived session usage and current membership cycle, explicitly recorded planned return date, expired renewal eligibility. **Produces:** retention reminder rules using the same queue and policy.

- [x] Add session-pack tests: current-cycle derived count, at two sessions remaining, zero remaining, override attendance, renewed pack resetting identity, no stored usage counter, and no repeat when count stays at/below threshold.
- [x] Implement disabled-by-default low-session and exhausted-pack reminders keyed per cycle/threshold. A zero threshold supersedes low-session work if both become due. No hard check-in block or invented service-session accounting.
- [x] Inspect freeze model; if no planned return date exists, add an optional explicit planned return date and staff owner through the canonical freeze flow, with RLS and localized DatePicker. Never derive a promised return from `frozen_at`. Remind one day before planned return and create staff follow-up on return day; do not automatically unfreeze, debit or change membership dates.
- [x] Add disabled-by-default membership/service win-back at expiry+14/+30/+60, stopping on renewed/replaced/cancelled subject, response, or active commitment/hold. Same campaign cannot overlap the short expiry sequence. Keep truthful Marketing copy without invented offers/discounts; expire the campaign after its last milestone.
- [x] Test low/zero and concurrent jobs, cross-kind budget, freeze date edited/cancelled, resumed membership, replied/renewed win-back suppression, localization and branch isolation. Integrate settings/history, apply and verify safe schema, run full `npm run verify` and UI verification with synthetic/no-send fixtures.
- [x] Final audit across all six steps: every kind reachable from a real source, every new schedule defaults off, cron includes all kinds, held/settled/renewed stops work, provider status is honest, no ledger edits from reminders, roles/RLS verified, docs match implementation. Record per-step implementation, schema, provider readiness, deployment and live-delivery states separately.

**Exit:** all three retention use cases have usable settings, actual eligibility, durable delivery and staff follow-up; the integrated six-step implementation passes verification. External provider activation/delivery prerequisites remain clearly named rather than misreported as shipped sends.

## Execution handoffs

The coordinator creates one GPT-5.6 Terra task per numbered step, using the saved UsefulDesk project with local execution. Create the next only after reviewing the previous handoff. Each task may refine its detailed SQL/internal types against the current repository, but must preserve this product contract, record its public interface changes here, and finish all authorized independent work even when live-message acceptance needs outside input.

| Step | Task ID        | Implementation                                                             | Schema                 | Provider/live acceptance                                                                                   |
| ---- | -------------- | -------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | 01a08c57-6aef-7a10-abdc-383dce7dc760 | Complete — focused verification passed; full verify has unrelated blockers | Existing; no migration | No live send/delivery; missing installment template and authorized recipient remain external prerequisites |
| 2    | 01a08c79-b850-7c92-a065-38723564c48d | Implementation complete; focused verification passed; full verify attempted with two documented pre-existing failures | Both Step 2 additive migrations applied to production and read back | New schedules off; no template approval, send, or delivery evidence |
| 3    | 01a08cc3-8523-7dd3-b191-197603666530 | Implementation complete; focused verification passed; full verify attempted | `20260911006000`, `07000`, `08000`, and `09000` post-expiry migrations applied/read back in production | New schedules off; no template approval, send, or delivery evidence |
| 4 | 01a08cef-c07e-7da0-8938-74b5676c87b5 | Implementation and focused local verification complete; migrations applied/read back; full verify reaches the two existing member-detail contract failures before build | `20260911010000` and `20260911010100` applied/read back | New schedules off; no template approval, send, link creation, charge, or delivery evidence |
| 5 | 01a08d38-fa97-7592-b0af-30a8cf253b6c | Implementation complete; 51 focused tests and rollback harness pass; full verify reaches two unrelated existing member-detail failures before build | `20260911010200`–`10800` applied/read back | New schedules off; no template approval, send, charge, refund, or delivery evidence |
| 6    | 01a08c2e-701d-70c1-a402-3ce0b75a1100 | Implementation complete; full test suite passed; build blocked only by environment port policy | `20260911010900`–`11100` applied/read back | New schedules off; no template approval, send, provider operation, payment, deployment, or delivery evidence |

### Step 1 handoff — 2026-09-10

- Added `GET /api/reminders/readiness` and the Settings readiness surface; both
  are read-only and return aggregate/no-PII diagnostic states only.
- Production audit evidence is in
  [`reminder-readiness-2026-09-10.md`](../../reminder-readiness-2026-09-10.md):
  all three ledgers and current eligible cohorts are zero, membership/service
  templates are ready, installment template is missing, and the latest
  database-owned renewal aggregate completed both workers successfully.
- No migration was created or applied. No provider template submission, send,
  payment operation, schedule change, deployment, or live-delivery test ran.
- Focused Vitest suite: 4 files / 22 tests passed; `npm run typecheck` and
  `npm run lint` passed (lint retains three pre-existing warnings). `npm run
  verify` could not finish because existing
  `member-detail-template-action.test.tsx` cannot find `Custom notice` and
  `razorpay-membership-lifecycle-contract.test.ts` cannot find its expected
  member-detail source marker. A prior standalone `next build` also panicked
  when Turbopack was denied an OS process-port bind while processing existing
  `react-easy-crop.css`.

### Step 2 handoff — 2026-09-10

- Added the opt-in invoice-collection settings and durable
  `lifecycle_reminder_jobs` queue with service-only claim/finish RPCs. The
  worker preserves the pre-provider `attempting` boundary so an interrupted
  request is visible as ambiguous rather than resent.
- Generic invoices use account-local `issued_at` as their truthful effective
  due date because the source view has no generic due-date field. Fixed joining
  installments retain `second_due_on`. Active AutoPay is membership-scoped,
  so a current matching invoice line becomes a reconciliation hold rather than
  silently suppressing a whole invoice.
- Applied and read back additive migrations
  `20260910170000_lifecycle_invoice_reminders.sql` and
  `20260910171000_invoice_collection_activation_timestamp.sql` in production:
  settings defaults are disabled, queue SELECT is account-member scoped, claim
  / finish execution is service-role scoped, and activation has an exact
  timestamp. No existing setting was enabled and no historical debt was
  backfilled.
- Focused Vitest: 8 files / 37 tests passed; typecheck passed; lint passed with
  three existing warnings. Full verification still stops at the two pre-existing
  failures recorded in the Step 1 handoff (`Custom notice` and the missing
  Razorpay member-detail source marker). A standalone build still cannot bind
  Turbopack's process port in this environment while processing existing
  `react-easy-crop.css`.

### Step 2 repair handoff — 2026-09-11

- Review found that the original SECURITY DEFINER RPCs incorrectly compared
  `current_user` with `service_role`; forward-only migrations now use the
  request JWT `auth.role()` and require lease owner, generation, and unexpired
  lease. No-send service-role-claim and finish calls against the empty
  production queue succeeded; the same finish call without the JWT claim was
  rejected.
- Repair migrations add separate provider-attempt counting, recovery backoff
  for setup blocks, an atomic account/contact/local-day reservation, visible
  ambiguous lease expiry, and existing-message delivery reconciliation. A
  later priority job is considered before reservation; an accepted chase never
  permits a second chase that day.
- Fixed 60/40 plans own every general invoice milestone for their invoice, so
  issued-at debt cannot call the second payment overdue before `second_due_on`.
  An active mandate is membership-scoped rather than invoice-line proof: a
  matching collectible membership line blocks as reconciliation-required,
  including mixed invoices, rather than silently suppressing balance.
- The activation trigger now runs for every settings update, and SQL check
  constraints validate direct milestone writes, so a client cannot move the
  no-backfill boundary or silently supply invalid offsets.
- Focused repair verification: 8 files / 38 tests pass, including the mocked
  queue-to-send path and RPC/migration contract tests; typecheck and diff check
  pass. Lint has only the three unrelated existing leads-page warnings.
- Second repair: stale queued/deferred milestones are checked against the
  latest eligible configured event before reservation and again at the send
  boundary; expired or superseded jobs are skipped without a provider call.
  Per-job faults no longer abort a claimed batch. Delivery `failed` is recorded
  as an authoritative terminal outcome and cannot be reclaimed for a duplicate
  send. A rollback-only production SQL harness exercised synthetic claim,
  reservation, finish, stale-generation, lease-expiry, and activation-tamper
  paths, then rolled all rows back. A separate rollback proof verifies that a
  prior-day reservation for the same job returns `lost`, not a stale send-day
  authorization.

### Step 3 handoff — 2026-09-11

- Extended the shared `runLifecycleReminderWorker` (no second scheduler) with
  `membership_post_expiry` and `service_post_expiry` jobs. Their subject-cycle
  identity is `(membership_id, end_date, activation_generation)` or
  `(member_service_id, end_date, activation_generation)`; `invoice_id` is
  intentionally nullable and the business key uses the explicit cycle identity.
- New settings are independently disabled and activation-managed:
  `membership_post_expiry_*` and `service_post_expiry_*`. The worker queues only
  cycles whose current expiry milestone is on or after their own activation
  date, chooses the latest unhandled +1/+3/+7 milestone, then rechecks current subject date/state,
  AutoPay, service price, reply history, settings generation, current milestone,
  and current price at `beforeSend`.
- Customer replies are read through an explicit account/contact-scoped
  conversation lookup, then its message ID—no embedded PostgREST alias filter.
  The lower bound is local expiry midnight via `dayStartInTz`; a live no-output
  Supabase JS-client read of both queries succeeded.
- Exact new Marketing contracts are `gym_membership_post_expiry` and
  `gym_service_post_expiry`. No invoice collection template/code is reused for a
  renewal invitation. Daily member coordination remains the existing queue RPC.
- `escalate_post_expiry_reminder(UUID)` is service-role-only and creates a
  branch-owner `follow_ups` record only when none is open; it returns existing,
  replied, or owner-unavailable without modifying authored content/assignment.
  Its durable outcome is visible on the job, and accepted/delivered day-7 jobs
  retry only this escalation—not the provider request.
- Applied and read back `20260911006000_post_expiry_reminder_lifecycle.sql`,
  `20260911007000_prioritize_debt_over_post_expiry.sql`, and
  `20260911008000_harden_post_expiry_activation_guard.sql`, and
  `20260911009000_revalidate_post_expiry_escalations.sql` in production. New
  defaults are off (zero enabled post-expiry schedules), debt has priority over
  retention work, queue subject/escalation columns exist, activation fields are
  system-managed, and the escalation function is SECURITY DEFINER with execute
  only for `service_role`; it locks and revalidates current settings, cycle, and
  replies before creating a follow-up. The no-send rollback harness calls the
  RPC under a transaction-local service JWT and is
  `supabase/tests/post_expiry_reminder_lifecycle_rollback.sql`.
- Focused Vitest: 10 files / 47 tests passed. `npm run verify` reran lint and
  typecheck successfully (with three existing leads-page warnings), then stops
  at the two documented existing test failures before build: `Custom notice` in
  `member-detail-template-action.test.tsx` and the missing Razorpay member-detail
  source marker.
  No template submission, setting activation, customer send, payment action,
  deployment, or live delivery occurred.

### Step 4 handoff — 2026-09-11

- Added `20260911010000_invoice_commitment_lifecycle.sql`, forward-only
  `20260911010100_invoice_commitment_contact_hardening.sql`, and the rollback-only harness at
  `supabase/tests/invoice_commitment_lifecycle_rollback.sql`. It adds durable,
  audited promise/verification/dispute commitments, author-revisioned edits and
  resolution, author-or-admin cancellation, service-only payment-allocation reconciliation, and
  disabled-by-default promise/link settings with activation generations.
- Added `GET`, `POST`, `PATCH`, and `DELETE`
  `/api/invoices/[invoiceId]/commitments` plus the invoice-detail commitment
  surface. Named capability predicates retain author-only editing/resolution
  and author-or-admin cancellation; the SECURITY DEFINER RPCs mirror those rules.
- The shared lifecycle worker now schedules promise reminders from the promise
  date and payment-link follow-ups from a persisted successful WhatsApp send.
  It rechecks current balance, commitment/link revision and status, settings
  generation, local send windows, and open holds before sending. Expired links
  create or reuse an owner follow-up through a service RPC; they never create a
  replacement provider link. Legacy installment and generic invoice sends also
  recheck open commitments/holds.
- The exact new Utility contract is `gym_payment_promise_reminder`; it is
  registered but has not been submitted, approved, sent, charged, or delivered.
  Both new schedules remain disabled pending the migration and operator setup.
- Approved-connector application/read-back verified disabled defaults, required
  functions/grants, and zero enabled schedules. The rollback harness exercised
  authenticated author create/edit/resolve plus service reconciliation, then
  rolled back all synthetic data.
- Focused verification passed, including worker,
  migration-contract, authorization, template, settings, WhatsApp-send, and
  installment-cron coverage; `npm run typecheck`, `npm run lint` (three
  existing leads-page warnings), and `git diff --check` passed. The full suite
  still has only the two pre-existing failures documented above (`Custom
  notice` and the missing Razorpay member-detail marker), so build did not run.

### Step 5 handoff — 2026-09-11

- `20260911010200_autopay_recovery_and_payment_confirmations.sql` and its
  forward-only `20260911010300_repair_payment_confirmation_trigger.sql`, plus
  `20260911010400_supersede_autopay_recovery_on_manual_settlement.sql`, and
  `20260911010500_harden_autopay_recovery_event_kind.sql`,
  `20260911010600_bind_confirmations_and_autopay_cycles.sql`,
  `20260911010700_confirm_renewal_operation_identity.sql`, and
  `20260911010800_confirm_new_ledger_rows_after_activation.sql`, are
  applied/read back in production. Both new settings default disabled and zero
  rows are enabled. The repair was required after the rollback harness caught
  an unassigned PL/pgSQL record for a payment-only event; no transaction
  committed while detecting it.
- Confirmations originate only in an `AFTER INSERT` trigger on the immutable
  payment ledger, with `(payment_id, activation_generation)` identity. As an
  `AFTER INSERT` source, it never scans or backfills historic ledger rows when
  enabled. The trigger covers manual
  settlement, checkout, payment-link settlement, and captured provider charge
  paths without altering money movement. It carries explicit `renewed` and
  period-end facts only when the payment idempotency key matches the durable
  `renew` operation, so arrears settlement does not claim a renewed membership;
  one same-transaction payment+renewal becomes one message.
- Razorpay `subscription.pending` and `subscription.halted` now call the
  service-only `enqueue_razorpay_autopay_recovery` only after canonical signed
  webhook claim/binding. Pending produces a no-manual-payment retry update;
  terminal recovery needs the provider-signed `current_end` mapped to the exact
  period invoice, collectible balance, no hold/refund review, and no healthy
  mandate. A later committed mandate payment supersedes the failure event.
  Receipts and pending status stay cap-exempt, while terminal manual fallback
  takes the same daily chasing reservation as collection work.
- Exact Utility contracts are `gym_payment_confirmation`,
  `gym_autopay_retry_update`, and `gym_autopay_payment_help`; none has been
  submitted, approved, synced, sent, charged, refunded, or delivered. Settings
  and member communication history expose readiness and outcome state.
- `supabase/tests/autopay_recovery_and_payment_confirmations_rollback.sql`
  passes through the approved connector: a rolled-back authoritative payment
  insert enqueues its exact confirmation, and an authenticated JWT cannot call
  the provider-only recovery RPC. The final hardening migration prevents a
  privileged caller from relabelling a canonical retry as terminal work (or
  the reverse). The rollback harness also proves a genuine renewal transaction
  creates one exact combined confirmation. Focused suite: 10 files / 51 tests
  passed; `npm run typecheck`
  passed and lint has only three existing leads-page warnings. `npm run verify`
  reaches the two unrelated existing member-detail failures before build: the
  `Custom notice` test and the Razorpay member-detail source marker.

### Step 6 handoff — 2026-09-11

- Added `20260911010900_retention_reminder_lifecycle.sql` and forward hardening
  migrations `20260911011000` / `20260911011100`, applied and read back through
  the approved connector. They add four independently disabled
  retention settings and activation generations, explicit
  `memberships.planned_return_on` / branch-valid `planned_return_owner_id`, the
  five lifecycle kinds, and a locked service-only
  `create_freeze_return_follow_up(UUID)` RPC. The RPC locks and revalidates the
  current setting generation, exact membership/contact/owner, and local due day,
  then records terminal escalation for a completed-task replay. The rollback-only harness at
  `supabase/tests/retention_reminder_lifecycle_rollback.sql` verifies the
  fields, service-only grant, direct-freeze state transition, created-task
  replay, edited return dates, disabled schedules, and rolls all synthetic work
  back. Production read-back confirms zero enabled Step 6
  settings and canonical `is_account_member(..., 'agent')` membership RLS.
- `retention-worker.ts` derives session usage through
  `attendance_usage_counts` for the current membership cycle; distinct cycle and
  threshold business keys prevent repeat sends, while zero skips a stale low
  job. Freeze work requires an explicit unchanged planned date: the preceding
  day is an exact-window customer reminder and the return-day path creates or
  reuses an owned staff follow-up with no WhatsApp, unfreeze, date, ledger, or
  payment mutation. Membership/service win-back chooses a bounded latest
  +14/+30/+60 milestone before filtering exact cycle/end-date handled history,
  so an obsolete queued +14 cannot send when +30/+60 is current. It avoids a
  queued short expiry sequence and rechecks reply/current-cycle/replacement/
  hold/current-rate/activation/settings/window/daily-budget truth at the
  provider boundary, refreshing dynamic template parameters immediately before
  the provider request.
- Registered exact, truthful contracts `gym_session_pack_low`,
  `gym_session_pack_used`, `gym_membership_return_reminder`,
  `gym_membership_win_back`, and `gym_service_win_back`. They are registered
  setup requirements only: none was submitted, approved, synced, sent, or used
  as delivery evidence. Settings controls and the canonical freeze confirmation
  use existing Card/Switch/Badge and localized DatePicker patterns; the
  planned-return owner is the freezing staff user.
- The Step 5 transaction-event boundary now fails closed when final settings,
  payment, invoice, or AutoPay reads are unavailable; those jobs requeue before
  `markProviderAttempt`, and an absent invoice-linked payment confirmation is
  never treated as safe. The stale member-template fixture and Razorpay contract
  expectations were corrected to the current, verified behavior. `npm run
  verify` now passes lint (three existing leads warnings), typecheck, and all
  447 Vitest files / 3,320 tests. Its only failure is the environment's denied
  Turbopack helper-port bind while processing the existing
  `react-easy-crop.css`, before build output can be produced; the direct build
  error was preserved rather than masked.
- Final six-step audit: Steps 1–6 have real queue sources and all new schedules
  are disabled by default; `/api/reminders/cron` claims all lifecycle kinds and
  scheduler paths already call it. Current debt/hold/payment/renewal/reply and
  lifecycle checks suppress obsolete work before provider calls. Reminder code
  does not mutate ledger, membership dates, frozen state, charges, or refunds.
  Schema/RLS/grants are applied/read back; provider readiness remains exact
  Approved/synced contracts; application deployment and real delivery remain
  unproven and were not attempted.

### Coordinator closeout — 2026-09-11

All six Terra tasks completed sequentially on `main`, without worktrees. The coordinator reviewed each handoff and requested corrections before acceptance. Final independent regression run: five files / 24 tests passed; `git diff --check` passed. The integrated executor run passed 447 files / 3,320 tests, typecheck and lint (three existing warnings). Coordinator independently reproduced the production build failure: Turbopack cannot bind its helper port while processing existing `react-easy-crop.css` (`Operation not permitted`). Production build, deployment and live delivery are therefore not verified. Changes remain uncommitted in the shared working directory. New schedules remain disabled; exact approved/synced provider contracts and release verification are prerequisites to activation. The coordination heartbeat is paused because all independent implementation and review work is complete.
