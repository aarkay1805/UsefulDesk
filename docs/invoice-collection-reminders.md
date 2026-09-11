# Invoice collection reminders — operator runbook

This lifecycle is disabled by default. It adds general invoice collection and
overdue fixed-installment reminders without changing a payment, a membership,
or an AutoPay mandate.

## Eligibility and effective due dates

`invoice_balances` is the financial source of truth. A reminder can proceed
only while the invoice is `open`, has a positive current collectible balance,
and does not require refund review. It rechecks those facts immediately before
the provider call. A partial payment uses its current residual; voided, paid,
negative, and refund-review balances are skipped.

Generic invoices do not store a due-date field. Their account-local `issued_at`
date is therefore the documented **effective due date**. This does not invent a
past due date: when an admin turns collection on, the database stamps an
account-local activation date and generation. Only invoices and fixed
installment plans created from that activation point are considered. A later
enablement gets a new generation, so it cannot backfill old debt.

Joining installment plans keep their authoritative `second_due_on` promise and
queue only their configured overdue milestones. They share the invoice/contact
daily coordination budget, but do not suppress collectible service or
merchandise invoices merely because the member has AutoPay. A live mandate is
membership-scoped while payments are allocated to exact invoice lines, so a
collectible invoice containing that membership line becomes a visible
**AutoPay reconciliation required** hold. The worker never silently suppresses
a mixed invoice or claims its whole residual is mandate-covered; staff must
resolve the allocation first.

## Setup

1. In **Settings → Renewal reminders**, create and sync the exact Utility
   contracts `gym_invoice_due` and `gym_invoice_overdue`.
2. Keep **Invoice collection** off until the templates, WhatsApp connection,
   and staff policy are ready. The toggle stamps the activation boundary; it
   does not send or create a backlog.
3. Choose the due/overdue milestones and inclusive account-local send window
   (default 09:00–19:00), then save. For generic invoices, the issued date is
   the effective due date, so pre-due milestones cannot run without a real
   due-date field; the on-due and overdue choices are the applicable ones.
4. Inspect **Recent invoice reminder activity**. It records blocked and
   provider-accepted outcomes without customer message content. Accepted is
   not delivered/read evidence; delivery webhooks remain authoritative.

The durable table is `lifecycle_reminder_jobs`. Its business key contains the
kind, invoice, subject/cycle, activation generation, and milestone—not the
mutable balance. `claim_lifecycle_reminder_jobs(worker_id, limit)` leases work
atomically; `finish_lifecycle_reminder_job(...)` requires the lease owner and
generation. Before a provider request a job becomes `attempting`; a crash after
that boundary remains visible as ambiguous and is not blindly resent.

## Schedules and recovery

`/api/reminders/cron` is called through the existing `renewals` aggregate and
the redundant GitHub renewal workflow. It uses the same cron secret boundary as
existing renewal workers. A worker failure makes the aggregate return 503 while
the other renewal phases still run.

Migrations `20260910170000_lifecycle_invoice_reminders.sql`,
`20260910171000_invoice_collection_activation_timestamp.sql`,
`20260911001000_repair_lifecycle_reminder_contract.sql`, and
`20260911002000_reminder_blocked_backoff.sql` /
`20260911003000_enforce_reminder_activation_trigger.sql` /
`20260911004000_reminder_lease_and_delivery_repair.sql` /
`20260911005000_reminder_daily_replay_guard.sql` are applied to
the production project. Their disabled defaults, queue RLS policy, service-only
function grants, exact activation timestamp, service-JWT authorization, atomic
daily reservation, recoverable setup backoff, and system-managed activation
fields were read back. Future schema
changes must still use the approved Supabase migration mechanism—never `supabase db push`.

No provider submission, customer message, payment-link creation, payment,
refund, schedule activation, or deployment is authorized by this runbook.

## Staff-recorded promises, holds, and payment-link follow-up

The invoice detail dialog can record one open **Promise to pay** (an exact
amount and account-local date) or one open **Verification hold** / **Dispute
hold** (a reason and a staff next action). These records are authored content:
the author may revise the open terms, while an admin/owner cancels another
person's record through an audit entry. The assignee must be a current member
of the selected branch.

An open promise or hold suppresses generic invoice collection, the legacy
joining-installment path, and payment-link follow-up for that invoice. A
promise snapshots actual paid allocation total at the time it is recorded or
revised. Later payment allocations meet the exact promised amount to fulfil
it; the invoice does not need to be fully settled, while an underpayment leaves
the remaining commitment/debt visible. Replies never count as payment truth.

Both new schedules are off by default. When enabled after exact provider setup,
promise reminders use `gym_payment_promise_reminder` one day before and on the
recorded date. The next account-local day, an unfulfilled promise becomes a
single staff-owned follow-up (or preserves an existing open follow-up) and may
send its one configured reminder. Existing payment links may be followed up at
one and three days only from a persisted provider-accepted WhatsApp send
(`last_sent_at` / provider message id), while the same link is still `created`,
unexpired, and exactly matches the current collectible balance. Link creation is
never a send. An expired link creates a staff action to use the existing
explicit payment-link action; cron never creates a replacement link.

Migrations `20260911010000_invoice_commitment_lifecycle.sql` and
`20260911010100_invoice_commitment_contact_hardening.sql` are additive and
keep both schedules disabled. Their no-send rollback harness is
`supabase/tests/invoice_commitment_lifecycle_rollback.sql`; it must be run only
through the approved migration connection after schema read-back.
