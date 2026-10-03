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

### Fresh continuation preflight, 3 October

At **07:49:22.925914 UTC (13:19:22 IST)** the same connector read found
Home office and Zirakpur connected, with standard capability, canonical legal
identity and both exact contracts ready. Saved schedules remained unchanged;
the account-local morning window was open. Old Ambala remained unconnected.
The other three status queries again returned no enabled date-matched
membership/service candidates and no stored current-template message groups.
The [continuation evidence](subscription-next-billing-evidence-2026-10-03.json)
records these reads separately from the earlier release observations.

Rajat requested using Justin's details and clarified that the intended message
is about Justin's ₹799 UsefulDesk subscription. This is separate from accepting
either gym reminder contract. The **07:57:48.769565 UTC** read confirmed zero
Old Ambala WhatsApp configuration rows, one existing membership belonging to a
different customer and no purchased services. Justin's SaaS term cannot supply
gym-membership parameters. Rajat then confirmed the actual recipient number;
the connected UsefulMade Home office sender was verified in owner Settings.
That sender has no existing chat to the recipient or saved subscription-specific
template. An exact subscription-status draft is prepared outside Git; template
submission approval remains pending. No message was sent and no delivery is
accepted. No subject, schedule, template or account changed.

### Subscription template submission, 3 October

Rajat approved submitting the prepared SaaS status template by replying
“Proceed” to the exact submission request. The authenticated Home office
workflow submitted `usefuldesk_starter_subscription_status` once at
**08:27:18.656 UTC (13:57:18 IST)**. The provider returned template id
`1388574992987840`; UsefulDesk saved row
`1f038e08-b2c3-40f7-b10d-6e54855e4d3e`. The Utility, `en_US`, POSITIONAL body
and four fictional review examples match the reviewed draft; there are no
headers, footers or buttons. The recipient number was not a review sample.

After one authenticated **Check status** action, the **08:28:05.804377 UTC**
connector read still showed `PENDING`, with no submission error or rejection.
This is successful submission, not template approval or message delivery.
No contact/chat was created and no customer message was sent. After provider
approval and synchronization, recheck the exact contract and current term,
then obtain the separately required one-message approval. Both gym reminder
contracts remain unaccepted by this SaaS workflow.

Rajat subsequently replied **“Approved, you can say”** in the same prepared
message thread. This authorizes one send of the unchanged subscription-status
message to the previously confirmed Justin recipient, from the reviewed
UsefulMade sender. It does not authorize different copy, a different recipient,
an automatic retry, or either gym reminder contract. After another authenticated
status check, the **08:31:16.347421 UTC** connector read still showed `PENDING`.
The sender remained connected; Justin's ₹799 original payment, unsuspended
version-5 access and 2 November 12:24:56 UTC paid end remained unchanged.
Sending is therefore waiting for provider approval and synchronization, not
another human approval of this same message. No send was attempted.

### Confirmed inbound reply and subscription message, 3 October

Rajat reported that Justin sent a message and corrected the earlier saved
recipient identity. The only new inbound “Hi” at **08:52:57 UTC (14:22:57 IST)**
was displayed under Amita Kashyap. The operator held the subscription details
and asked for the correct recipient. Rajat explicitly confirmed **“Yes, the
message that came from this number is correct.”** This resolves the recipient
for the already approved one-message send; it does not rename, delete or change
Amita's original member/contact/account records. Her records were left intact.

Justin's paid end, original ₹799 payment and unsuspended version-5 access were
rechecked unchanged. The existing authenticated Chats composer sent the exact
approved subscription-status text once at **08:57:04.277355 UTC (14:27:04 IST)**,
within the genuine inbound reply window. The saved message is
`f30896ab-b0f5-4a6b-9147-0fd2137578ef` in conversation
`346ed319-3be8-4a7a-982d-e5847838f975`, Home office. At
**08:57:15.318850 UTC**, the connector showed `content_type=text`, `status=sent`,
a provider `wamid` and no provider error. Recipient details, exact rendered
text, raw provider id and screenshots remain in the owner's local receipt.

This was a plain-text reply inside the customer service window; the new
subscription template remained pending in the preflight read. The already
configured support Flow had independently greeted the inbound contact before
the operator send. The recorded single send refers to the approved subscription
update, not that existing automated greeting. No retry, renewal opening or
gym-reminder send occurred. A sent receipt does not establish delivered/read
status, and this SaaS message does not accept either gym reminder contract.
The **08:59:09.070056 UTC** read still showed `sent` with no provider error
and exactly one matching manual subscription update in the conversation.

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
