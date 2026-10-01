# Home office internal Live opening — 1 October 2026

Only the owner's Home office first-term ₹799 internal technical test is open.
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
