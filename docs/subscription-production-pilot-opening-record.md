# Home office internal Live opening — 1 October 2026

**2 October follow-up:** the owner selected Starter web billing first. Fresh
provider GETs at 02:21:36 UTC confirm both current renewal templates Approved
and exact-contract; actual reminder delivery remains pending. The
[next rollout record](subscription-starter-rollout-next.md) tracks default-off
delivery receipts and remaining customer/monitoring facts. The internal test
remains complete with initiation closed.

The owner's Home office first-term ₹799 internal technical test is complete.
New payment/refund initiation and Live checkout UI are closed; signed intake,
settlement and GET-only recovery remain enabled.
The owner approved the classification, original full-refund/access outcome and
bank debit/credit message and screenshot recording method in this chat. See the
[review authority](subscription-production-pilot-review.md#owner-decision-and-accounting-record).
No customer sale, self-invoice or external accounting clearance is asserted.

**Latest closeout instruction:** the owner supplied the original bank-debit
message, received at 12:00:41 UTC on 1 October, matching the original ₹799 payment
reference. The unchanged screenshot and matching transaction references are
saved privately outside Git with restricted permissions. The owner then asked
to proceed with other pending work without bank refund-credit evidence. That
credit evidence is deferred, not passed or required before technical closeout.
Earlier pending-bank statements below describe their dated observations.

## Reviewed operator application

Implementation remains PR #21 main `71d897a6dfd17b7938129d2b7a3cfbb808531a80`.
Its [28-source implementation manifest](subscription-production-pilot-install-manifest.tsv)
retains SHA-256 `21abf5bd14a46d4feaf6510c92e82280489a9f85883d4c3106f5d6d63d53c494`.
The separately reviewed data-only operator source is
`supabase/migrations/20261001111500_open_home_office_starter_internal_acceptance.sql`,
SHA-256 `ad700825d0ebf6946370003a8b717e7a76dbaebda4d082e4289cea25bf5e9b9e`.
It does not alter functions, constraints, privileges or paid access. It generates
real offer/opening references, selects the recorded owner review and opens only
the selected merchant/organization. Same-source replay cannot reopen contained
flags. The source is separate from the implementation manifest to avoid a
circular approval hash.

Production rollback-only preflight used these actual approved operator values,
checked insertion/scope and same-source replay, then rolled back every row and
switch. Access fingerprints and 554 gym payments remained unchanged. No fake
customer, payment or signed event was inserted.

Eight reviewed Production runtime/UI flags were enabled. Existing Live keys,
merchant/pilot binding and signed intake were retained. Protected audit passed
with zero blockers/eight warnings, including protected values, runtime production
identity, independent database/offer review and absent Turnstile fail-closed.
The 0600 export and 0700 temporary directory were removed. Test and other scope
flags were not enabled.

The exact existing implementation was rebuilt as Production deployment
`dpl_Duze8duP4zeyKTHrQhViGPp4xczu`, READY **11:17:35.977 UTC**. Canonical aliases
automatically point to it. Canonical invalid quote/order/refund inputs and unsigned
intake returned 400; unauthenticated recovery returned 401. These requests created
no financial records and passed the deployed Production-only configuration gate.

The approved Supabase connector applied the operator source to Production
`fwqthstqrkrwtaehefks` at **11:19:50 UTC**, as history
`20261001111950_open_home_office_starter_internal_acceptance`; history 327 → 328.
One immutable offer/opening review selected Starter ₹799/INR, the 30-minute quote,
calendar month from signed capture, and approved 7/3/1-after-09:00 reminder policy
`starter-731-after09-owner-reviewed-20261001-v1`.
Quotes/orders/refunds/settlements/complimentary conversion are open only for the
selected pilot; intake/reconciliation/GET-only financial recovery are enabled.
Renewals, Test, global capabilities and advanced payments remain disabled.

## Actual first capture

The owner UI recorded ₹799, the complimentary conversion choice and reminder
acknowledgement. One provider order opened in Live Razorpay Checkout; the human
completed the real payment. No agent payment method or authentication was entered.

Read-only Production evidence at **11:30–11:32 UTC**:

- One bound Live quote/order, one verified ₹799/INR payment, one Starter grant
  and term. Capture occurred before quote expiry.
- Genuine `payment.captured` intake at 11:25:00.260607 UTC retains its signed
  event time **11:24:59 UTC**. The event remains `held` in the intake ledger;
  this is distinct from the verified payment/grant. The capture route does not
  mark settled capture events reconciled.
- Term start 1 October 11:24:59 UTC, end **1 November 11:24:59 UTC**; PostgreSQL
  calendar-month equality verified. Product access is manual, version **2**,
  with those exact boundaries and one `verified_subscription_payment` audit.
- Both saved reminder schedules are `[7,3,1]`; no send is authorized by this run.
- No refund/review, recovery queue or exception exists. Genuine Live duplicate
  and mixed SaaS/gym delivery evidence remains pending; no replay was fabricated.
- 8 users, 6 accounts, 5 organizations and 554 gym payments remain. Account,
  organization and legal fingerprints are unchanged; access changed only by
  the actual verified capture.

The Live Razorpay dashboard independently shows the original ₹799 payment as
Captured and zero processed refunds. Keep original payment/order/request IDs,
provider evidence and bank screenshots private, outside Git. The original detail shows ₹0 Razorpay fee and ₹0 GST at this observation; bank
debit/credit evidence remains pending. The application independently verifies
the original order/payment by fresh provider GET before creating a refund.
An attempted separate lookup using the write-only Vercel export was rejected
with 401 and made no provider mutation; do not use opaque exports as keys.

## Observation and remaining work

The runtime error scan at 11:29:50 UTC, more than ten minutes after READY, found
no errors. Natural primary ops at 11:23 returned 200, failed 0. The thirty-minute
scan after **11:47:35.977 UTC** also found no runtime errors. The 11:47:34
read-only preservation snapshot retains unchanged tenant/legal fingerprints and
554 gym payments, three real signed events and one payment/grant/refund. Primary
ops at 11:38 and renewals at 11:41 both returned 200/failed 0.

The owner then requested **“Request full ₹799 refund now”**, after seeing the
original captured payment, ₹799, local day-7 policy and access consequence. The
actual request was recorded at 11:39:25 UTC (local day 0, after capture); the
immutable standard-first-week review was inserted at 11:40:01.927601 UTC through
the approved connector. It pins the original payment, full amount, owner and
original offer policy. No backdated request or synthetic approval was used.

At 11:40:32 UTC the signed-in owner-origin request to the existing Live refund
route returned 200/pending and created one durable claim/bound provider refund.
The route freshly GET-verifies original order/payment and zero prior refunds
before its one provider POST. No Razorpay-dashboard refund shortcut was used.
The dashboard then showed the original payment Refunded and full ₹799 refund
Processed, with matching original/refund notes and a provider refund RRN.

The application was still pending at 11:42:11 UTC, with no signed refund delivery
recorded. A same-original-claim reconciliation used the existing route's **bound
GET-only** branch, returned 200/confirmed, and verified processed refund plus
fresh parent-payment full-refunded facts before the access commit. It created no
second provider refund. By 11:44:03 UTC, both genuine signed refund deliveries
were present; exact
event bindings and final state are recorded below. Provider GET/commit evidence
and signed delivery are retained as separate acceptance facts.

Bank debit/credit screenshots remain pending. A processed provider refund is
separate from bank credit. Broader customer and reminder acceptance retain their
separate gates.

At 11:44:03 UTC, the original refund is `processed`, confirmation and renewal-stop
are both **11:43:01.122985 UTC**, and access end equals that confirmation.
Access advanced once more to version **3**, remains manual/expired, and has one
`subscription_full_refund` audit. There remains exactly one payment/grant/refund
and all 554 gym payments. The owner UI visibly reports the payment refunded,
renewal cancelled and access term ended; complimentary access did not return.

At 11:45:11 UTC, the genuine `refund.created` and `refund.processed` events have
signed event time 11:40:38 UTC, received respectively at 11:43:57.396502 and
11:43:59.273988 UTC. Both original payment/order and bound refund identities
match; body digests are present. The three intake events remain `held` by the
capture/refund route's design. The later signed refund deliveries did not create
another refund or access effect: one payment/grant/term/refund/review and one
capture/refund audit remain. This is actual late signed delivery after GET
reconciliation, not a fabricated duplicate test. Genuine same-event redelivery
and mixed gym/SaaS routing remain pending. Natural primary ops at 11:38 returned
200/failed 0.

## Technical closeout with bank-credit evidence deferred

The owner instructed this chat to proceed without bank refund-credit evidence.
That evidence remains deferred, distinct from the privately retained original
bank debit and provider-processed full refund.

The explicit manual `production-health` operator job on source `199c1e1f`
[36868967047](https://github.com/aarkay1805/UsefulDesk/actions/runs/36868967047)
passed at 13:28:48 UTC: **inspected 3, reconciled 3, failed 0**. It used the
existing protected credential via environment, no GitHub token privileges and
aggregate-only output. The canonical route replayed already verified/confirmed
records, then reconciled their original signed intake rows. Reconciliation times
were 13:28:48.092845, .211289 and .269527 UTC for capture, refund.created and
refund.processed. This proves idempotent existing-event reconciliation; it does
not prove a new provider delivery of the same event.

Data-only containment source
`supabase/migrations/20261001132700_close_home_office_internal_acceptance_initiation.sql`,
SHA-256 `9779808b6afd99dd6fa043b5ab96008b41d0ae6bc5d0458e1d51b10754f6dbe3`,
passed actual-scope and same-source rollback-only preflight. The approved
connector then installed it as history
`20261001132841_close_home_office_internal_acceptance_initiation`, history
328 → 329. Quotes, orders, refunds and complimentary conversion are false;
intake and settlements remain true, selected review/offer identities retained,
renewals/Test/capabilities/advanced remain false. No provider or access write
is included. It remains separate from the unchanged 28-source implementation
manifest.

Five Production initiation/UI environment flags were closed, leaving intake,
settlements, refund reconciliation and financial recovery enabled. Recovery-only
audit returned zero blockers/eight warnings; restricted exports were removed
without printing secret values. The existing exact `71d897a6` artifact rebuilt
as `dpl_5YCS5VSmqUBxKaYKcsynzHeeALEA`, READY **13:37:47.820 UTC** and
automatically aliased to `desk.usefulmade.com`. The record branch is not deployed.

Canonical checks at 13:40 UTC: login 200; closed quote/order/refund initiation
404; unauthenticated reconciliation/recovery 401; unsigned webhook 400. These
invalid/unauthenticated probes do not create a financial record.

The owner screen refreshed at 13:45 UTC retains expired access and support,
with Live payment controls absent. Protected operator run
[36871126603](https://github.com/aarkay1805/UsefulDesk/actions/runs/36871126603)
at 13:46:09 UTC then returned **inspected 0, reconciled 0, failed 0**, proving
the retained recovery route is available after containment and the queue is
drained. The ten-minute runtime scan at **13:48:29 UTC** found no errors since
READY. Record the final thirty-minute scan and last provider-status observation
with timestamps in attached draft PR #22's closeout and private evidence,
separate from the historical opening scans above.

Read-only preservation at 13:37:36 UTC retained 8 users, 6 accounts,
5 organizations, 554 gym payments, one original quote/order/payment/grant/refund
and review, three reconciled events, zero recovery queue/exceptions and one
capture/full-refund audit each. Access remains manual version 3, ended at
11:43:01.122985 UTC. The exact post-refund aggregate access fingerprint remains
`1259cac445b3b02acd8395381ff6968b`; account, organization and legal fingerprints
remain the original baseline. All 14 Live private tables retain RLS and browser
SELECT/DML denial. Primary ops 13:23 and renewals 12:41 returned 200/failed 0.

The Live provider webhook logs at 13:36 UTC, extended to the available seven-day
range at 13:41 UTC, show only the three original SaaS
deliveries, each HTTP 200. The original refund.processed event detail has request,
response and headers but no redelivery control. No eligible gym event appears
in this selected log range. Genuine same-event provider redelivery and mixed
gym/SaaS delivery remain pending; no body/signature/event was fabricated and no
new charge is authorized to fill that gap. Provider retries normally follow
non-2xx delivery failures ([Razorpay guidance](https://razorpay.com/docs/webhooks/best-practices/));
the three observed original deliveries succeeded.

Redundant GitHub ops/renewal schedules remain Rajat's SEV-3 exception. At 13:15
UTC their last successful natural runs were 09:22:59 and 07:49:02 UTC; public
health was 07:14:08. All workflows are active, default main is active, Actions
are enabled, the latest actor/commit are current, and no disabled/queued/fork/
archived condition or local workflow defect is established. GitHub's status
reported Actions operational. The manual health pass verifies current login and
operator availability; it cannot clear scheduled freshness. Next action is
inspect the next natural run; escalate under the Production runbook if primary
workers also miss their windows. No messaging worker was manually dispatched.

| Closeout item                            | Status / evidence                                                            | Owner and next action                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Original capture/full refund/access      | Passed; one each, access ended once, original identities preserved           | Rajat; retain private evidence                                            |
| Original signed-event queue              | Passed; three reconciled, failed zero, no additional financial/access effect | Rajat; inspect any later delivery before declaring its outcome            |
| Initiation containment                   | Passed; database/runtime/UI closed, recovery retained                        | Rajat; no reopening under the completed test's authority                  |
| Bank debit / refund credit               | Debit received privately; credit owner-deferred                              | Rajat; append actual credit evidence when supplied                        |
| Provider same-event / mixed gym delivery | Pending; no redelivery control or eligible gym delivery in available logs    | Rajat; review authentic available evidence before broader Live acceptance |
| Redundant GitHub schedule                | SEV-3 pending; active/valid, primary healthy, no established local cause     | Rajat; inspect next natural run and escalate if primary windows miss      |
| Reminder acceptance                      | Current templates Approved/exact at 2 October refresh; delivery pending      | Rajat; select and authorize actual recipient/message before delivery      |

These remaining delivery/operational facts are not falsely closed by a manual
job or provider-processed refund. Wider customer activation remains outside this
internal test. This table is the current review surface; the dated observations
above retain the underlying evidence.
