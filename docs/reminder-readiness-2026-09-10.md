# Reminder readiness evidence — 2026-09-10

Scope: Step 1 of the renewal and collection reminder lifecycle. This was a
read-only production audit of Supabase project `fwqthstqrkrwtaehefks`; no cron
endpoint, provider API, template submission, payment link, payment, or message
was invoked.

## Production evidence

- One configured reminder-settings row is enabled for membership `[1,3]` and
  service `[1,3,7]` days before expiry.
- WhatsApp configuration reports two connected accounts. Exact Approved,
  POSITIONAL Marketing rows exist for `gym_membership_renewal` (two accounts)
  and `gym_service_renewal` (one account), with no sync-required marker.
- No `gym_installment_reminder` row exists. This is a real setup blocker for
  the Utility installment worker, not a delivery failure.
- All three ledgers (`renewal_reminders_sent`, `service_renewal_reminders_sent`,
  and `installment_reminders_sent`) are empty. At the audit instant, exact
  aggregate eligible cohorts were membership `0`, service `0`, installment
  `0`; there are no installment plans. The empty ledgers therefore have a
  positive no-work explanation and do not by themselves indicate scheduler or
  provider failure.
- `usefuldesk-renewals-cron` is active at `41 * * * *`; the redundant GitHub
  workflow is configured for minute `47`. The three latest database runs before
  the audit succeeded. The latest renewal HTTP aggregate at 16:41 UTC returned
  200, dispatched both workers, had `failed: 0`, considered one renewal
  account, and reported zero sends/failures; the installment worker correctly
  returned `no installment reminders due`.

## What this proves—and does not

It proves current scheduler dispatch and application route completion for an
empty cohort, plus membership/service template readiness. It does not prove a
real provider acceptance, delivery, read receipt, failed-delivery webhook, or
installment worker send. A `wamid` would prove provider acceptance only;
delivery-status webhooks remain the source for delivered/read/failed.

## Recovery and external prerequisite

To make the installment path eligible for a separately authorized live test,
an operator must create/submit the exact `gym_installment_reminder` Utility
POSITIONAL contract, wait for Meta approval, and run Sync from Meta. Then a
staff-controlled recipient and separate approval for an actual message are
required. This report authorizes neither action.

## Implementation state

Step 1 adds `GET /api/reminders/readiness`, a settings-authorized no-PII
diagnostic that reuses current candidate conditions without claiming/sending.
It reports date-matched candidates separately from those currently sendable,
missing a phone, deferred by the local send window, or already claimed/sent.
Settings renders membership, service, and installment states as Off, Blocked,
Waiting, Nothing due, or Eligible now. The installment path continues to use
the authoritative open, positive, non-refund-review invoice balance; it does
not introduce a blanket membership-status or AutoPay suppression for a possibly
combined historical invoice. Worker responses count provider `accepted`
separately; they do not present that as delivered.

Schema state: no migration was created or applied in Step 1.
