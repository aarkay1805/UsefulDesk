# Starter standard renewal reminders — delivery acceptance

3 October 2026. Implementation and read-only Production preflight are separate
from sending and confirmed delivery. Rajat owns the remaining acceptance.
Justin's WhatsApp connection and delivery remain explicitly deferred.
The repairs are deployed in `c9da8c47`; the [closed release receipt](subscription-coordinated-release-execution-2026-10-03.md)
records successful natural workers, which do not establish genuine reminder delivery.

## Scope and repairs

Starter keeps the approved 7/3/1-day schedule before expiry, eligible after
09:00 in the branch's account timezone. This change neither enables a schedule
nor changes subscription capability, paid access, trial or branch controls.
The membership worker retains manual collection, recurring/legacy plan rules
and current-cycle checks; trials do not receive a membership renewal quote or
an inapplicable manual Remind action.

Both exact contracts stay Marketing, `en_US`, POSITIONAL, with the affirmative
**Help me renew** button and no header/footer:

- `gym_membership_renewal`: member name, plan name, expiry, current renewal
  price, canonical legal business name.
- `gym_service_renewal`: member name, service name, expiry, current renewal
  price, canonical legal business name.

The registry and provider payloads remain exclusively in
`src/lib/whatsapp/template-contracts.ts`. Retired names, an Approved status
without matching contents, and incomplete provider synchronization do not
satisfy readiness. Consent records remain audit history rather than send gates.

Repairs are in the existing membership reminder, pricing and readiness code:

- A bound membership uses its selected option's current active price, excluding
  the joining fee. Missing, archived or mismatched bound options block the
  quote rather than substitute the historical fee. Legacy memberships with no
  option retain their agreed fee. Manual Remind reloads the same branch/member
  before building parameters; cron rechecks the price before its provider boundary.
- Manual and scheduled readiness include the canonical legal business identity.
  Missing/unreadable identity points staff to Business details or retry guidance.
- The admin-only readiness route checks standard-reminder product access and
  includes unavailable current prices in its blocked candidates.
- Service readiness matches `claim_service_renewal_reminders`: only an explicit
  `failed` row with no provider attempt is retryable. Claim age never makes
  `claimed`, `attempting`, `ambiguous`, accepted or retired work sendable.

Manual sends still use `/api/whatsapp/send` and
`sendMessageToConversation`. Automated sends keep the existing
`engineSendTemplate` / `runLegacyReminderDelivery` boundary. No generic send
path, higher-tier feature, schema migration or provider payload is added.

## Observed Production state

The approved Supabase connector read Production `fwqthstqrkrwtaehefks` at
**2 October 2026, 20:01:09.292878 UTC** (**3 October, 01:31:09 IST**).
The read-only runner is `scripts/whatsapp-renewal-delivery-status.sql`.

| Branch      | Standard capability | WhatsApp / legal name               | Exact membership / service templates | Saved schedules                        |
| ----------- | ------------------- | ----------------------------------- | ------------------------------------ | -------------------------------------- |
| Home office | Allowed             | Present                             | Both ready                           | Membership off; service on; both 7/3/1 |
| Zirakpur    | Allowed             | Present                             | Both ready                           | Membership on; service off; both 7/3/1 |
| Old Ambala  | Allowed             | WhatsApp absent; legal name present | Both unavailable                     | No saved schedule                      |

These are dated observations, not standing authority or a future health report.
Separate queries found no date-matched enabled membership/service candidates
and no stored messages for either current renewal template. The local morning
send window was closed. No cron, message, template edit/submission/sync, account
change, financial action or customer activation was performed.

## Local validation

The final full suite passes **4,431 tests across 539 files**. A focused run
passes 121 tests across 10 files, including readiness, current-price reloads,
before/after 09:00 gating, retained service claims, template contracts, locale
formatting and product access. Lint, typecheck and the production build pass.
Each of the four read-only status queries also ran through the approved
Production connector. Independent review ran 67 tests across seven files and
then 15 tests across three files for the trial-action follow-up; both passed.
The reviewer found no outstanding Critical, Important or Minor issue.

Local fixtures prove application behavior; they cannot establish provider
delivery or customer acceptance.

## Remaining genuine acceptance

1. Rajat identifies a specifically authorized connected branch and a real
   staff-controlled recipient. Home office and Zirakpur are observed candidates;
   neither is selected automatically. Identify membership or service and its
   actual contact/subject so name, expiry and current price are real. Do not use
   Justin or create an invented membership merely to complete this step.
2. Read current connection/capability/legal identity and the exact Approved/synced
   template again. Prepare the fully rendered message, template/language/button,
   sender branch, recipient, expiry and price for review. Missing actual recipient
   facts mean a concrete message cannot yet be prepared.
3. Obtain explicit approval for that exact one-message send. Use the existing
   authenticated manual path. Save approval attribution/time, exact parameters
   and rendered content, returned UsefulDesk message id and provider `wamid`.
   A provider id proves acceptance only. If an outcome is unknown, inspect it;
   never repeat the send automatically.
4. Retain a genuine `delivered`/`read` webhook/status tied to that same message
   id, or the genuine provider failure and next action. Do not manufacture a
   webhook, fixture or delivery row. Wait for this evidence before declaring
   delivery accepted.
5. Automated schedule acceptance, if requested, separately needs approval for
   its exact branch/cohort and a run after 09:00 account-local time. Run only the
   bounded intended cohort, recheck dedupe, and restore the reviewed saved
   preference. The global renewal cron is send-capable across enabled branches;
   it must not be invoked merely as a health check or one-recipient test.

Membership and service provider delivery remain unproven until each intended
contract has its own genuine evidence. A successful send of one does not accept
the other. App deployment remains a release dependency; this packet grants no
standing customer message or automation activation permission.
