# Renewal reminders — operator runbook

UsefulDesk has two renewal reminder contracts. Both promote a future purchase,
so both are Meta **Marketing** templates and require a positive recorded
`whatsapp_marketing` opt-in for the recipient:

| Feature            | Exact template           | Category  | Body parameters                                            |
| ------------------ | ------------------------ | --------- | ---------------------------------------------------------- |
| Membership renewal | `gym_membership_renewal` | Marketing | member name, plan name, end date, current renewal price    |
| Service renewal    | `gym_service_renewal`    | Marketing | member name, service name, end date, current renewal price |

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

Meta returning a `wamid` means the request was accepted, not delivered.
Delivery-status webhooks remain authoritative for sent, delivered, read, and
failed outcomes.

## How scheduled sends work

GitHub Actions calls `/api/renewals/cron` hourly at :30. For each enabled
account the route:

1. checks the exact feature contract and connected WhatsApp account;
2. waits until at least 09:00 in the account timezone;
3. finds eligible active recurring memberships or renewable services ending at
   a configured offset;
4. requires the recipient's positive `whatsapp_marketing` consent;
5. claims the `(subject, end_date, days_before)` ledger key before sending;
6. sends at most 200 messages per invocation and releases failed claims so a
   later run can retry.

Membership and service schedules are independently configurable in Settings →
Renewal reminders. Service candidates also require an active catalogue option
and current fixed or trainer-specific rate. A reminder never renews a service
or changes its dates.

Manual member/service **Remind** actions use the same readiness, consent,
localized parameter order, and outbound send boundary as the cron.

Key code: [`cron route`](../src/app/api/renewals/cron/route.ts),
[`contracts`](../src/lib/whatsapp/template-contracts.ts),
[`readiness`](../src/lib/whatsapp/template-readiness.ts), and
[`settings UI`](../src/components/settings/renewal-reminders-settings.tsx).

## Controlled pilot

1. Keep both schedules off.
2. Sync from Meta and inspect the exact category, parameter format, components,
   and status. Do not silently rename, alias, or reclassify a rejected or
   reserved name.
3. Use only a specifically confirmed staff-controlled contact with recorded
   Marketing opt-in after the relevant template is Approved.
4. With separate action-time approval to send, use one manual Remind action.
   Verify the provider id and wait for a delivered/read webhook before testing
   automation.
5. With separate approval to enable automation, use one offset, invoke the cron
   after 09:00 account-local time, then invoke it again to prove dedupe. Disable
   the schedule after evidence is captured.

No template submission, real message, automation enablement, test-record
mutation, or cleanup is authorized by this runbook alone.

## Troubleshooting

| Symptom                                    | Cause / fix                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`                         | `x-cron-secret` does not match the configured shared cron secret.                                                                              |
| `503 cron not configured`                  | Set the secret and redeploy.                                                                                                                   |
| Account skipped                            | Inspect the structured setup note: connection, provider status, category, POSITIONAL format, components, or sync marker may be blocking.       |
| Consent required                           | Record explicit Marketing WhatsApp opt-in with source evidence; lead follow-up or account-update consent does not imply Marketing consent.     |
| Approved but blocked                       | Sync Templates and compare the provider-owned category/components to the exact contract. Do not invent an alias or silently switch categories. |
| `sent: 0` with expiring rows               | Check feature eligibility, account-local offset/date, current service rate, phone, consent, and claim ledger.                                  |
| Provider request accepted but later failed | A `wamid` is not delivery evidence; inspect status webhooks and the exact provider failure.                                                    |

## Ops

- Secret: Vercel and GitHub both use `AUTOMATION_CRON_SECRET`; see
  [automations-and-cron.md](automations-and-cron.md).
- Schedule: `.github/workflows/renewals-cron.yml`, hourly at :30.
- Domain: `desk.usefulmade.com`.

## Historical provider evidence

The retired Utility experiments `gym_renewal_reminder` and
`gym_membership_expiry_notice` remain historical evidence only. The connected
WABA rejected one replacement create as Utility with Meta `100/2388025`, and
Meta may reserve a deleted name for 30 days. Those rows are preserved as generic
custom templates when provider-approved, but they no longer satisfy feature
readiness, onboarding, member actions, or cron selection. The retired
`gym_service_renewal_reminder` name is treated the same way.
