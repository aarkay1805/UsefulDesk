# First Starter Live acceptance walkthrough

**Current status, 1 October 2026:** the approved internal ₹799 capture/full
refund is complete, access remains ended, and all three original signed events
are reconciled without another financial/access effect. New initiation is closed;
signed intake, settlement and GET-only recovery remain enabled. Bank debit proof
is retained privately; the owner deferred bank-credit proof. Genuine provider
same-event redelivery/mixed gym delivery and independent reminder acceptance
remain pending. See the [current opening record](subscription-production-pilot-opening-record.md)
for actual source/history/runtime evidence. Earlier closed/staging-only
observations below are dated preparation, not current-state claims.

**Procedure; authority supplied separately.** This is the controlled UsefulMade / Home office
internal technical acceptance plan for the first Starter term. No step below
authorizes Production installation, flags, provider changes, money movement or
WhatsApp delivery. The owner must approve the concrete release-specific opening
and the exact payment/refund separately. The earlier intake-only baseline is historical;
the closed opening candidate has passed local/cloud staging checks. See the
[opening review](starter-live-pilot-opening-review.md),
[installation record](subscription-production-install-record.md),
[Live boundary](subscription-live-boundary.md) and
[financial recovery runbook](subscription-financial-recovery-runbook.md).

## Exact acceptance and human review boundaries

Follow the [payment-only opening proposal](subscription-payment-only-opening-proposal.md)
for the owner-selected scope. Exact first-term payment/refund technical acceptance
may proceed independently of Meta approval/current-contract delivery after its
own release, internal accounting and human authorization gates close. Retain
the approved 7/3/1 after-09:00 policy and quote acknowledgement. No reminder send,
broader Starter feature acceptance or customer sale is included.

| Item          | Selected contract                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merchant      | Existing UsefulMade Live `acc_TCJwBqanN9LTrK`                                                                                                                                                                      |
| Organization  | Home office `8826d9aa-03f2-4ad7-ae91-0553052131f8`, one active INR branch                                                                                                                                          |
| Context       | Internal technical acceptance: supplier and selected organization share a proprietor. No self-invoice or claim of a customer sale.                                                                                 |
| Offer         | Starter ₹799 gross / `79900` paise, INR, one calendar month from signed capture-event time, 30-minute quote                                                                                                        |
| Source access | Existing complimentary access, explicitly acknowledged by its owner; preserve its exact mode/version until settlement                                                                                              |
| Refund        | First verified payment, full original ₹799 only; actual request through local day 7 using saved billing timezone; processed full refund ends paid access and stops renewal, without restoring complimentary access |
| Scope         | Web Checkout, first term only. Renewals hard-closed; native Checkout, upgrades/add-ons and global capability activation require separate acceptance.                                                               |

Do not substitute another organization, merchant, amount, trial mode or manual
term if eligibility fails. Nonempty approval references are pointers to evidence,
not proof of provider acceptance or tax/receipt clearance. Prepare the actual
internal-acceptance accounting classification and an unissued technical evidence
record with the owner; ordinary customer
tax/receipt treatment is a separate gate before a genuine customer offer. This
walkthrough makes no tax conclusion.

There are three separate decisions: approve the exact Production candidate and
dark release; approve the real immutable offer/opening review and phase changes;
then approve the controlled payment and subsequently the full-refund request.
Existing intake-only approval covers none of these. A human completes payment
and any provider authentication challenge. Independently selected WhatsApp
recipient/message authorization is also required if delivery acceptance is later
performed; no send is included in this plan.

## 1. Assemble the release packet before asking to open

Rajat owns acceptance and rollback. Name any operator/verifier explicitly. Keep
the private packet's release SHA, migration manifest/source hashes, approved
provider preflight, tax/receipt review, backup recovery point, evidence locations,
exact switches and recovery plan. Refresh evidence from the actual target; do
not rely on historical counts or deployed SHA in another document.

Verify the opening candidate exists on the target only after its separately
authorized installation through the approved migration tool. It inserts no
offer/review and opens no switch. Verify RLS, grants, immutability triggers,
exact-pilot constraints and retained renewal closure. Service-role direct
DML/TRUNCATE is denied; authenticated owners only have named owner RPCs.

Run the [recovery preflight queries](subscription-financial-recovery-runbook.md#read-only-evidence-and-preflight)
and record full organization/access/branch baseline privately. Expected before
opening: exactly one active INR branch, complimentary non-suspended access with
known version, no Test or Live paid obligation/intents/orders/refund reviews,
no seeded offer/opening review, and all money/capability/policy gates at the
approved baseline. A discrepancy blocks opening until individually reviewed.
Record unrelated gym payments/refunds, access fingerprints and both cron jobs
for comparison; this plan does not mutate gym financial data.

Required evidence includes protected Live credential/merchant authentication,
canonical READY deployment/URL, independent key configuration and exact selected
pilot binding; no Test SaaS credentials; provider webhook Enabled at
`https://desk.usefulmade.com/api/subscriptions/live-webhook` with the selected
merchant secret and five approved events. An unsigned request refusal proves
signature enforcement, not genuine signed delivery. Never print or record keys.

Review the actual membership renewal template prerequisite separately: the
canonical `gym_membership_renewal` must be Approved/synced before claiming
feature readiness; historical delivery of an older contract and **In review**
do not pass. Standard Starter reminders are 7/3/1 before expiry after 09:00
account-local. Global capability activation and an authorized real recipient
remain distinct release gates; this money run cannot claim reminder delivery.

## 2. Prove adverse cases on disposable staging

Use the canonical [staging plan](subscription-staging-plan.md) and rollback-only
fixtures. No Live credentials, provider transaction or manufactured Production
event belongs here. The guarded local runner is:

```bash
node scripts/verify-starter-live-pilot-opening.mjs "DISPOSABLE_CONTAINER_NAME"
```

Replace `DISPOSABLE_CONTAINER_NAME` only with the explicitly verified full-schema
container named `supabase_db_usefuldesk-subscription-full-` plus its actual
disposable suffix. The runner refuses an existing installed Live schema, loads migrations
and opening/capability fixture inside `BEGIN/ROLLBACK`, replays the candidate for
idempotency and confirms Live tables did not survive. This is not a command for
the cloud staging or Production database. Cloud staging uses the approved
connector and assembled rollback fixture described in the opening record.

| Scenario                                                         | Expected staging evidence                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Owner/branch/amount/offer mismatch; unchanged-source requirement | Quote/order refuses; no provider effect or paid access                                               |
| Missing reminder acknowledgement or changed policy               | Checkout refuses or captured payment becomes held; no unsupported reminder claim                     |
| Repeated unbound claim; expiry/shutdown during provider I/O      | One saved create claim; later action GET-only recovery; no second POST; stale Checkout refuses       |
| Valid on-time captured event with matching GET facts             | One payment/grant/term, one access-version advance, calendar-month term                              |
| Late capture, changed roster/access/approval                     | Durable `review_required` payment/order; no paid grant; owner exception                              |
| Initiation shutdown before complimentary settlement              | Capture stays recoverable but becomes `review_required`; complimentary access preserved              |
| Failed payment, missing event time, changed digest               | No paid term/grace; missing time held; changed event identity refused                                |
| Timely day-7 refund; day-8 standard request; explicit exception  | Day 7 accepted; day 8 refused; exception requires distinct reason; immutable request evidence        |
| Pending/failed, confirmed full refund, replay                    | Pending/failed preserves paid term; confirmed truncates access once, stops renewal; replay unchanged |
| Shared gym ownership/ambiguous provider facts                    | Proven unrelated delivery acknowledged without SaaS/gym writes; ambiguous ownership retryable        |

Keep synthetic SQL, mocked adapter/receiver and genuine provider Test evidence
distinct. Repository tests prove safety contracts; they do not prove Live delivery,
bank settlement, a customer sale or genuine provider redelivery. Failure/late
capture tests pass here; do not create failures, delay payments or edit signed
events in Live merely to fill a checklist.

## 3. Review/open the exact approved first term

Present the populated private packet and source hashes to the owner. Stop if
authorization, actual preflight, accounting review or backup recovery reference
is missing. Following approval, the operator uses a separately reviewed migration
to insert the real immutable `subscription_live_offer_approvals` and
`subscription_live_pilot_opening_reviews`, select `pilot_opening_review_id` and
approve the exact standard reminder policy before opening the initial-pilot
Live database gates: `standard_reminder_policy_approved=true`, its actual reviewed
`standard_reminder_policy_version`, days `[7,3,1]` and local hour `9` in
`private.subscription_billing_settings`. Keep global `capabilities_enabled=false`
and all Test/advanced/renewal gates closed. The candidate settings guard requires
that policy as well as the selected active review/offer. No application writer exists
for those ledgers; never put placeholders into Production. Preserve approved
customer wording/references; keep sensitive evidence outside Git.

Enable the exact initial-pilot runtime phase from the opening review, deploy the
pinned release and verify the protected exported environment with:

```bash
node scripts/production-env-readiness.mjs --dotenv-stdin --allow-live-starter-pilot < /private/path/production.env
```

This audit does not activate anything. Require READY exact SHA/canonical alias,
matching database phase, renewal false and global capabilities unchanged. Inspect
post-change access/gym/cron baselines before opening the owner screen. If any
check fails, close initiation using the reviewed recovery plan; do not pay.

## 4. Owner review, quote and Checkout

Use the selected owner's authenticated web session. Read the Usefulmade Live
pilot panel and approved ₹799 amount/customer notes. Explicitly acknowledge that
this payment replaces complimentary access, the month ends without renewal, and
a confirmed full refund ends paid access without returning free access.

The UI calls `POST /api/subscriptions/live-quotes` with the selected organization,
billing account, new request UUID, approval UUID, `tier: 'starter'`,
`seenAmountMinor: 79900` and `complimentaryConversionAccepted: true`. It requires
same-origin, owner auth and the pinned pilot. Verify returned immutable quote:
approval/request/org/amount/INR/tier, source complimentary mode/version,
no renewal parent, and `expires_at = owner_reviewed_at + 1800 seconds`.
Replaying the same request must not change its facts or deadline.

Save the one-time standard reminder acknowledgement via implemented owner RPC
`subscription_acknowledge_live_starter_reminders(p_request_id)`. Verify its saved
policy version and 7/3/1 after-09:00 policy match the quote/current approved
settings. The UI performs this step; do not edit the quote directly.

With the human's specific payment authorization, open Checkout once. The UI calls
`POST /api/subscriptions/live-orders` with only `organizationId` and `requestId`.
Verify durable claim/binding, returned `orderId`, ₹799/INR, request/org and Live
key ID against the quote before payment. The server rechecks eligibility after
provider I/O. Checkout callback displays “Payment is being checked.” It creates
no grant and is not a settlement signature path. If response is uncertain, do
not pay again; follow the GET-only recovery runbook with the original UUID.

## 5. Verify the real signed capture and term

Keep provider transaction and webhook delivery evidence private. Require all of:

- Bound provider order GET: exact returned ID, original UUID receipt, both
  UsefulDesk notes, `79900` INR and accepted order status.
- Original payment GET: exact `pay_` ID/order, `79900` INR, `captured=true`,
  `status=captured`, `amount_refunded=0`.
- Genuine provider delivery at the canonical SaaS URL: correct merchant,
  `payment.captured`, signature accepted, event ID/body digest, delivery timestamp
  and valid top-level signed event `created_at` saved as `provider_event_at`.
- One durable payment with `state=verified`; one grant/current term and append-only
  term-history row. Period start equals signed capture-event time; end equals
  that start plus PostgreSQL `interval '1 month'`, not 30 days, Checkout time,
  payment entity creation time or worker processing time.
- Product access changes once to manual, start/end match the grant, version
  advances once, and one `verified_subscription_payment` audit exists. The
  payment stores the billing account's timezone.
- Saved Starter schedules normalize to approved 7/3/1; unattempted custom claims
  are retired. This does not itself enable global capability enforcement or send
  a message. Verify capability effects only under their separately approved gate.

Late signed capture beyond quote expiry must remain held if it occurs naturally;
use its genuine facts, assign an exception owner and stop further payment. Missing
capture time/provider mismatch must not be substituted with a guessed timestamp.
Do not call a stored `review_required` payment a passed paid conversion.

Inspect actual redelivery if the provider supplies it under approved procedure:
same event ID/body digest returns duplicate durable identity; settlement replay
creates no extra payment, term, audit or access version. If no genuine duplicate
delivery occurred, record Live dedupe evidence as pending and retain separate
staging proof. Do not locally sign or manufacture a Live delivery.

The receiver may leave a successfully processed event `held`. After approved
invocation of `POST /api/subscriptions/live-reconcile`, verify counters and durable
result rather than treating `reconciled` as proof of a paid grant. That worker's
five-event scan and limitations are in the recovery runbook.

## 6. Verify shared-merchant routing without another charge

Correlate genuine available gym deliveries/provider facts on the same merchant
with the existing gym acceptance record. A provider-proven unrelated gym order
or a payment with provider-proven null order returns `{received:true, unrelated:true}`
at the SaaS URL and creates no SaaS claim/event/grant/refund or gym write there.
Apparent SaaS notes/UUID receipt with ambiguous ownership stays retryable (503).
SaaS capture/refund must leave gym payment/refund ledgers unchanged.

Use only genuine approved provider delivery/redelivery of an existing eligible
event; historical logs alone may not establish delivery to the newly configured
SaaS URL. If none is available, leave mixed-route Live proof pending; do not
charge a gym member, replay the gym financial processor, or manufacture an event
to prove isolation. Staging routing evidence remains useful but separate.

## 7. Reviewed first-payment refund and access consequence

Before refund, present the exact original payment, full ₹799, original offer's
policy reference, actual request time/evidence and access consequence. Obtain
action-specific owner approval. Record `request_received_at` when the request
actually arrives; it must not precede capture and must not be backdated. Day 0
is the capture local date in the payment's immutable `billing_timezone`; through
local day 7 qualifies, day 8 standard request does not. A prompt controlled
request is acceptable; waiting seven days is unnecessary. The request deadline
does not require refund processing to finish by day 7.

The immutable `subscription_live_refund_reviews` row requires the original verified
payment, owner, organization/merchant, full amount/INR, matching
`approved_policy_reference`, `owner_reviewed_at`, `request_received_at`,
`request_evidence_reference`, and `review_kind='standard_first_week'` with no
exception reason. There is no review-creation UI/API; prepare a separately
reviewed operator insertion through the approved database path. An exceptional
correction requires `exception_review`, its reason and an individual decision.

After the review exists and refund initiation is approved/open, the selected owner
may call existing same-origin `POST /api/subscriptions/live-refunds` with only
`organizationId` and the saved `refundRequestId`. There is no refund button in
the Live review panel; use reviewed authenticated operator tooling. Verify one
durable claim before provider POST, original captured payment and zero prior
refunds. An uncertain response uses the same claim and GET-only lookup; no
replacement UUID or provider-dashboard shortcut.

Pending/failed refund must preserve access end and have no confirmation timestamp.
The claim/review blocks renewal eligibility; it is not a processed refund. Require
exact bound refund ID/receipt/notes/payment/full amount/INR with `status=processed`,
then fresh parent-payment GET `status=refunded`, `amount_refunded=79900` and exact
original order/amount before claiming confirmation. Record genuine signed refund
delivery separately from provider GET/commit evidence; if unavailable, leave that
delivery criterion pending.

Pass the access effect only when `confirmed_at`, grant `refund_confirmed_at` and
`renewal_stopped_at` are set; access end is the earlier of confirmation and original
end; version advances once and one `subscription_full_refund` audit appears.
Owner term RPC reports refunded/stopped; operational paid access ends. Sign-in,
data, branches, support and plan-selection recovery remain. Complimentary access
does not return. No SaaS recurring provider schedule exists to cancel. Any
`later_payment_or_access_change` hold needs manual review and fails automatic
refund/access acceptance. Verify replay makes no extra access effect.

## 8. Stop initiation and sign off the evidence

With approval, move to recovery-only phase: close quote/order/refund/UI and
complimentary conversion gates; preserve intake, settlements and refund
reconciliation, exact merchant/pilot/secrets and compatible release. Verify closed
initiation POSTs return 404, protected reconciliation remains available, audit
passes, and unrelated access/gym ledgers/cron remain at the approved baseline.
This containment step does not undo a provider order or any payment/refund.

| Acceptance result        | Pass criterion                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening and scope        | Real immutable review/offer, exact release/manifest, fresh backup/preflight, owner approval, selected merchant/org/amount only              |
| Capture and term         | Genuine signed capture + matching GET facts + one verified calendar-month term/access change                                                |
| Dedupe / outage / holds  | Staging adverse checks passed; each available genuine Live retry identified; unavailable genuine retry recorded pending                     |
| Shared merchant          | Genuine SaaS/gym routing evidence with no cross-ledger effect, or explicitly pending Live proof                                             |
| Refund                   | Real timely request/review, one provider POST claim, processed full refund/parent GET, genuine delivery evidence, one correct access effect |
| Containment / exceptions | Initiation closed, recovery preserved, every uncertain/pending/held fact has owner/status/next action; no unexplained money                 |

For each row record `passed`, `failed`, or `pending`, private evidence reference,
UTC verifier/time and next owner action. Local/staging passes cannot close a
genuine Live evidence row. HTTP 200, Enabled webhook, payer screenshot, audit pass
or empty held-event queue alone cannot close acceptance. A real first-term pass
does not authorize customer sales, renewal opening, another organization,
capability activation or broader rollout. Follow the recovery runbook for any
exception and the Production runbook for separately approved rollback.
