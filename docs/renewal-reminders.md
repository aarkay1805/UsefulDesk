# Renewal reminders — operator runbook

UsefulDesk has two renewal reminder contracts. Both promote a future purchase,
so both are Meta **Marketing** templates. Their audit category is
`whatsapp_marketing`, but that consent history does not gate sending:

General invoice and overdue-installment collection is a separate, disabled-by-
default Utility lifecycle. It has its own exact contracts and operational
rules in [invoice collection reminders](invoice-collection-reminders.md); do
not substitute a renewal template for a debt reminder.

| Feature            | Exact template           | Category  | Body parameters                                            |
| ------------------ | ------------------------ | --------- | ---------------------------------------------------------- |
| Membership renewal | `gym_membership_renewal` | Marketing | member name, plan name, end date, current renewal price    |
| Service renewal    | `gym_service_renewal`    | Marketing | member name, service name, end date, current renewal price |
| Expired membership | `gym_membership_post_expiry` | Marketing | member name, plan name, end date, current renewal price |
| Expired service | `gym_service_post_expiry` | Marketing | member name, service name, end date, current renewal price |

These categories are intentional. An ending membership or service is an
existing relationship, but asking the member to buy its next term promotes a
future purchase. Neither template is a Utility account update.

## Exact provider contracts

`gym_membership_renewal` body:

> Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price
> of {{4}} will continue your membership. Use the buttons below to respond.

Buttons: `Renew membership`, `Unsubscribe`.

`gym_service_renewal` body:

> Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of
> {{4}} will continue this service. Use the buttons below to respond.

Buttons: `Renew service`, `Unsubscribe`.

`gym_membership_post_expiry` body:

> Hi {{1}}, your {{2}} membership ended on {{3}}. You can renew at the current
> price of {{4}}. Use the buttons below and our team will help.

Buttons: `Renew membership`, `Unsubscribe`.

`gym_service_post_expiry` body:

> Hi {{1}}, your {{2}} service ended on {{3}}. You can renew at the current
> price of {{4}}. Use the buttons below and our team will help.

Buttons: `Renew service`, `Unsubscribe`.

Both use the footer `Tap Unsubscribe to stop promotional messages.` and
POSITIONAL parameters. Dates and money are rendered with the account locale.
The exact payloads live in `src/lib/whatsapp/template-contracts.ts`; do not
restate or edit them at a sender.

## Readiness and provider review

Settings → Templates can create the exact contract and submit it to Meta.
Submission starts review; approval is not guaranteed, Meta may reclassify the
template, and delivery is not guaranteed even after approval.

A feature is ready only after **Sync from Meta** proves that the exact
name/language row is **Approved**, has the expected Marketing category,
POSITIONAL format, exact body/footer/buttons and parameter order, and no pending
provider-component sync marker. A merely submitted or **Pending** row is not
ready. **Rejected**, **Paused**, **Disabled**, reclassified, or drifted rows are
not ready and retain their exact provider state for an operator to inspect.
After a complete provider snapshot, a previously synced row that Meta no longer
returns is retained as **Not on Meta** and disabled. A pagination-capped sync
does not infer absence. If Meta returns the row again, the next complete sync
restores its current provider status and clears the missing marker.

Meta returning a `wamid` means the request was accepted, not delivered.
Delivery-status webhooks remain authoritative for sent, delivered, read, and
failed outcomes.

Settings → Renewal reminders now also shows a read-only **Scheduled reminder
readiness** result for membership, service, and joining-installment workers. It
contains only aggregate eligibility counts and setup reasons: **Off**,
**Blocked**, **Waiting**, **Nothing due**, or **Eligible now**. It never claims a reminder,
opens a conversation, exposes member data, or invokes Meta. A blocked row gives
the first recovery action; an empty cohort is healthy, not an error.

## How scheduled sends work

The database-owned aggregator calls `/api/renewals/cron` hourly at :41 and the
redundant GitHub workflow calls it at :47. For each enabled account the route:

1. checks the exact feature contract and connected WhatsApp account;
2. waits until at least 09:00 in the account timezone;
3. finds eligible active recurring memberships or renewable services ending at
   a configured offset;
4. claims the `(subject, end_date, days_before)` ledger key before sending;
5. sends at most 200 messages per invocation and releases failed claims so a
   later run can retry.

Membership and service schedules are independently configurable in Settings →
Renewal reminders. Service candidates also require an active catalogue option
and current fixed or trainer-specific rate. A reminder never renews a service
or changes its dates.

Manual member/service **Remind** actions use the same readiness, localized
parameter order, and outbound send boundary as the cron. Consent and opt-out
records are retained for audit history but do not block either manual or
scheduled sends.

Key code: [`cron route`](../src/app/api/renewals/cron/route.ts),
[`contracts`](../src/lib/whatsapp/template-contracts.ts),
[`readiness`](../src/lib/whatsapp/template-readiness.ts), and
[`settings UI`](../src/components/settings/renewal-reminders-settings.tsx).

### Post-expiry recovery

The additional lifecycle worker at `/api/reminders/cron` owns the short
post-expiry sequence. Membership and service schedules are independently off by
default, begin only with milestones on or after their own activation date, and
use the shared durable queue at expiry +1, +3, and +7 days. They use the exact
Marketing contracts above—never an invoice/debt contract—and re-read the
subject, current renewal price, current settings generation, latest milestone,
and customer replies immediately before the provider call.

The existing configurable account-local lifecycle send window also governs
post-expiry recovery. Its atomic daily reservation ranks current invoice debt
ahead of retention work, so post-expiry jobs defer rather than double-contacting
or overtaking an active collection chase.

For memberships, only an active, manually collected, renewal-chaseable cycle
whose end date is still in the past is eligible. A renewed/replaced end date,
freeze, cancellation, non-recurring plan, active AutoPay, or reply stops the
job. Services additionally require an active catalogue item/option and a current
rate. Membership and service work share the same account/contact/local-day
reservation, so they cannot double-contact one member on the same local day.

After the accepted day-7 reminder, the worker invokes the service-only
`escalate_post_expiry_reminder` RPC. It creates one branch-owner follow-up only
when none is already open; an existing open task is linked without touching its
author, assignment, note, or promised action. A reply ends escalation. The
queued outcome (`created`, `existing`, owner unavailable, replied, or stopped)
appears in the lifecycle history. Before every escalation attempt, the RPC
locks and rechecks the enabled generation, current subject state, current
AutoPay/service-price eligibility, and replies since account-local expiry
midnight. A failed or owner-unavailable escalation remains retryable from the
accepted/delivered queue row without sending another WhatsApp message; every
other durable outcome is terminal and cannot create a second task.

### Session packs, planned returns, and win-back

The same lifecycle queue also owns four independently disabled retention
settings: session-pack depletion, planned freeze return, membership win-back,
and service win-back. Session-pack remaining is always derived from the current
cycle's `sessions_count - attendance_usage_counts` result; it is never stored.
At two-or-fewer sessions the low reminder is eligible, and at zero the
exhausted reminder supersedes a queued low reminder. Cycle identity includes the
membership start/end dates and the settings generation, so a renewed pack starts
fresh and an unchanged threshold cannot repeat.

A frozen membership can carry only an explicit `planned_return_on` and an
optional branch-valid staff owner. The canonical freeze dialog may set both; a
missing date produces no return reminder and `frozen_at` is never used as a
promise. One day before the recorded return, the exact Utility
`gym_membership_return_reminder` may send inside the account-local lifecycle
window. On the return day the service-only queue RPC creates or reuses one staff
follow-up instead; it never unfreezes the membership, changes dates, or writes a
payment/debit. The RPC locks the lifecycle job and revalidates its enabled
generation, exact membership/contact, local return day, and branch-valid owner;
after a task is completed, replay is terminal and cannot create another task.

Membership and service win-back choose only the latest eligible +14/+30/+60
expiry milestone. They recheck the current cycle, reply history, open
commitment/hold, current service availability/price, settings generation, and
any pending short post-expiry sequence immediately before the provider boundary.
Handled history is scoped to the exact membership/service cycle and end date, and
the newest eligible milestone is selected before that history is consulted, so a
blocked +14 reminder cannot send late once +30 or +60 is current.
Renewal/replacement, cancellation, hold, reply, or the short sequence stops the
campaign. All customer-facing retention work uses the shared daily reservation
and account-local send window; the return-day staff task does not send WhatsApp.
The exact Marketing contracts are `gym_session_pack_low`,
`gym_session_pack_used`, `gym_membership_win_back`, and
`gym_service_win_back`. They must be Approved and synced before an enabled job
can send; none is approved, submitted, or treated as delivery evidence here.

### Collection commitments

An open invoice promise-to-pay, verification hold, or dispute hold is stronger
than an automated collection reminder. The lifecycle worker and the legacy
installment worker re-read that state immediately before provider work, so a
staff commitment cannot race an already-selected send. It is not proof of a
payment or renewal, and a customer reply is never inferred as either.

Promise and payment-link follow-up schedules remain independently disabled
until their exact Utility contracts have been synced as Approved. Payment-link
follow-up begins only from a recorded provider-accepted `gym_payment_link`
send, not link creation, and never creates or replaces a provider link.

### Payment confirmations and failed AutoPay recovery

The same lifecycle worker also consumes committed transaction facts. An
`AFTER INSERT` ledger trigger creates a confirmation job keyed by the exact
`payments.id` while the confirmation setting is enabled; it does not scan or
backfill older payments. The confirmation says a payment renewed membership
only when its idempotency key is the matching durable renewal operation. A
payment-only arrears settlement never claims a new active-until date. Receipts
and retry updates do not reserve the one-per-day chasing slot; terminal
manual-fallback collection does, while all keep the normal queue lease and
pre-provider attempt boundary.

Razorpay retry and terminal recovery enter only through a claimed canonical
signed webhook event bound to the exact mandate/subscription. `pending` sends
the `gym_autopay_retry_update` Utility contract: it explicitly says no manual
payment is needed while Razorpay retries. `halted` may use
`gym_autopay_payment_help` only if the signed provider `current_end` maps to an
exact membership-period invoice that is still collectible, has no
refund/verification/dispute hold, and has no healthy mandate covering the same
membership. It shares the daily collection reservation. A later committed
provider payment supersedes the older failure event. Missing or unbound debt is
visible as a staff-review outcome, never invented or inferred from a latest
invoice.

Both schedules are independently off by default. The exact new Utility
contracts (`gym_payment_confirmation`, `gym_autopay_retry_update`, and
`gym_autopay_payment_help`) must be Approved and synced before any enabled job
can send. Provider acceptance remains distinct from delivery/read status.

## Controlled pilot

1. Keep both schedules off.
2. Sync from Meta and inspect the exact category, parameter format, components,
   and status. Do not silently rename, alias, or reclassify a rejected or
   reserved name.
3. Use only a specifically confirmed staff-controlled contact after the
   relevant template is Approved.
4. With separate action-time approval to send, use one manual Remind action.
   Verify the provider id and wait for a delivered/read webhook before testing
   automation.
5. With separate approval to enable automation, use one offset, invoke the cron
   after 09:00 account-local time, then invoke it again to prove dedupe. Disable
   the schedule after evidence is captured.

No template submission, real message, automation enablement, test-record
mutation, or cleanup is authorized by this runbook alone.

### Missing-template recovery

1. In Settings → Templates, locate the exact feature contract rather than a
   retired or similarly named template.
2. Create or correct the contract using the displayed category, POSITIONAL
   parameters, body, footer, and buttons, then submit it for Meta review.
3. After Meta review, select **Sync from Meta**. The reminder remains blocked
   until the exact row is Approved and the sync reports no component change.
4. Return to Renewal reminders and confirm the feature reads Ready. A provider
   request being accepted is still not delivery evidence; wait for the delivery
   webhook after separately authorized testing.

## Troubleshooting

| Symptom                                    | Cause / fix                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`                         | `x-cron-secret` does not match the configured shared cron secret.                                                                              |
| `503 cron not configured`                  | Set the secret and redeploy.                                                                                                                   |
| Account skipped                            | Inspect the structured setup note: connection, provider status, category, POSITIONAL format, components, or sync marker may be blocking.       |
| Approved but blocked                       | Sync Templates and compare the provider-owned category/components to the exact contract. Do not invent an alias or silently switch categories. |
| Not on Meta                                | The last complete sync did not return this provider-backed row. Re-create it in Meta or delete the retained local record.                      |
| `sent: 0` with expiring rows               | Check Scheduled reminder readiness, account-local offset/date, current service rate, phone, and claim ledger.                                  |
| Provider request accepted but later failed | A `wamid` is not delivery evidence; inspect status webhooks and the exact provider failure.                                                    |

## Ops

- Secret: Vercel and GitHub both use `AUTOMATION_CRON_SECRET`; see
  [automations-and-cron.md](automations-and-cron.md).
- Schedule: database-owned cron hourly at :41; `.github/workflows/renewals-cron.yml`
  hourly at :47.
- Active production cadence: database-owned aggregator at **:41** and the
  redundant GitHub workflow at **:47** every hour. The old :30 wording is
  retired; the worker's account-local 09:00 gate still controls eligibility.
- Domain: `desk.usefulmade.com`.

## Historical provider evidence

The retired Utility experiments `gym_renewal_reminder` and
`gym_membership_expiry_notice` remain historical evidence only. The connected
WABA rejected one replacement create as Utility with Meta `100/2388025`, and
Meta may reserve a deleted name for 30 days. Those rows are preserved as generic
custom templates when provider-approved, but they no longer satisfy feature
readiness, onboarding, member actions, or cron selection. The retired
`gym_service_renewal_reminder` name is treated the same way.
