# Subscription financial recovery runbook

**Prepared procedure; no new Production authority.** Production is currently
intake-only. Use this procedure after a separately approved first-term opening
or to investigate existing evidence read-only. It does not authorize a charge,
refund, switch change, deployment, event replay, access correction, or message.
Rajat Kashyap owns the incident and approves consequential recovery actions;
an explicitly delegated operator may act within that recorded approval. Follow
the [Production runbook](production-runbook.md) for severity, deployment and
backup recovery, and the [opening review](starter-live-pilot-opening-review.md)
for the exact release and database gate. The [Live boundary](subscription-live-boundary.md)
describes the money and access invariants.

## Scope and containment

This covers Usefulmade SaaS billing on Live merchant `acc_TCJwBqanN9LTrK`,
selected Home office organization `8826d9aa-03f2-4ad7-ae91-0553052131f8`.
Gym-member payments, refunds, Payment Links and mandates use separate ledgers
and OAuth paths. Do not use their controls to repair a SaaS charge, even though
the merchant is shared. Preserve the existing gym webhook and credentials.

Start one private incident record before intervention. Record UTC discovery,
deployment ID/SHA, schema/manifest hash, exact merchant/pilot, current switch
phase, observed effect and owner. Capture redacted server/database/provider
evidence before log retention expires. Full financial IDs, raw webhook bodies,
credentials, tax identifiers and customer material stay in the approved private
evidence store; repository notes contain references and outcomes only.

| Phase                              | Runtime switches                                                                                                                                                             | Database state and consequence                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake-only baseline               | Only `USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED=true`; all money, reconciliation and Live UI flags false/unset                                                             | `webhook_intake_enabled=true`; other Live switches false; no offer/opening review. Signed bound evidence can be held, but access/refunds do not settle.                                                                                                                                                                 |
| Separately reviewed initial pilot  | Intake, quotes, orders, refunds, settlements, refund reconciliation and both Live UI flags literal `true`                                                                    | Exact selected active offer/opening review; approved reminder policy true with a real version, days `[7,3,1]` and local hour `9`; `quotes_enabled`, `orders_enabled`, `refunds_enabled`, `complimentary_conversion_enabled`, `settlements_enabled`, intake true. Renewals remain false; global capabilities remain off. |
| Recovery after stopping initiation | Intake, `USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED` and `USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED` literal `true`; quote/order/refund and both UI flags false/unset | Preserve merchant/pilot/review identities, intake and settlements. Close quotes, orders, refunds and complimentary conversion; renewals stay false. Bound evidence remains recoverable.                                                                                                                                 |

Runtime quote/order/refund names are `USEFULDESK_SAAS_LIVE_QUOTES_ENABLED`,
`USEFULDESK_SAAS_LIVE_ORDERS_ENABLED`, `USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED`;
UI names are `NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI` and
`NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI`. There is no separate database refund
reconciliation boolean: the runtime gate controls that worker; its database
lookups retain the exact merchant/pilot binding.

With owner approval, stop database initiation first in one reviewed operator
change, then close runtime initiation/UI and deploy the reviewed recovery
release. Preserve signed intake, Live secrets and GET reconciliation. A provider
request already in flight can complete; closing switches is not a cancellation
of an issued provider order. Revoking the selected offer or opening review also
closes database initiation through the candidate trigger, but does not change
runtime flags or undo money. Do not revoke evidence merely to test containment.

**Recovery does not guarantee a paid grant.** Closing complimentary conversion
causes a subsequently settled first conversion capture to be durably held as
`review_required`, while existing complimentary access remains. Offer revocation,
late capture, changed access/roster or reminder policy can also hold a capture.
An already verified term is not removed by shutting initiation. The opening
fixture explicitly tests shutdown capture as a hold; no implemented resolver
promotes that payment later.

Audit a secure exported environment without printing it:

```bash
node scripts/production-env-readiness.mjs --dotenv-stdin --allow-live-recovery-only < /private/path/production.env
```

The path is a placeholder for a restricted temporary export. Remove it through
the approved secret-handling procedure afterward. Audit modes check configuration,
never authorize activation; protected redacted values remain unverified. For the
other phases use `--allow-live-intake-only` or `--allow-live-starter-pilot`, one
mode at a time. These commands inspect local input and do not set flags.

## Read-only evidence and preflight

Run on the verified target through the approved read-only database connector.
The opening-review query applies only after the candidate schema is installed;
check its existence first. Save restricted results under the incident reference.

```sql
BEGIN READ ONLY;
SELECT clock_timestamp() AS observed_at,
       to_regclass('private.subscription_live_pilot_opening_reviews') AS opening_schema;
SELECT provider_mode, merchant_id, pilot_organization_id,
       webhook_intake_enabled, quotes_enabled, orders_enabled, refunds_enabled,
       settlements_enabled, complimentary_conversion_enabled, renewals_enabled
FROM private.subscription_live_settings WHERE singleton;
SELECT capabilities_enabled, standard_reminder_policy_approved,
       standard_reminder_policy_version, standard_reminder_days_before,
       standard_reminder_hour_local
FROM private.subscription_billing_settings WHERE singleton;
SELECT state, count(*) FROM private.subscription_live_orders GROUP BY state;
SELECT state, count(*) FROM private.subscription_live_payments GROUP BY state;
SELECT state, count(*) FROM private.subscription_live_refunds GROUP BY state;
SELECT event_type, state, count(*), min(received_at) AS oldest
FROM private.subscription_live_webhook_events GROUP BY event_type, state;
SELECT count(*) AS gym_payments FROM public.payments;
SELECT jobname, active, schedule FROM cron.job
WHERE jobname IN ('usefuldesk-ops-cron','usefuldesk-renewals-cron');
ROLLBACK;
```

For each affected `request_id`, correlate its quote, order, payment, grant, term
history, refund review/claim and event rows. Inspect original source access
mode/version, owner acknowledgement, approval references, quote deadline,
capture-event time, billing timezone, access start/end/version and audit entries.
Use bound parameters or an approved private query, not identifiers copied into
shared logs. Inventory all claims without provider IDs, not just held events.
If opening schema exists, verify selected `pilot_opening_review_id`, its active
review/offer, release/manifest and evidence references separately. Verify current
function grants, RLS and immutability triggers against installed migrations;
the candidate denies direct service-role DML and TRUNCATE on Live tables.

Before any provider lookup, confirm the protected Live key resolves the selected
merchant, Production runtime and pilot; Test credentials must be absent. Use
the server-only adapter or approved secret-blind operator tooling. Never put a
Basic credential or cron secret in a command line, evidence note or browser.
GET facts prove current provider state, not a signed capture event or a bank
settlement into the proprietor's account.

## Uncertain order POST: GET, then immutable binding

`prepareLiveCheckout` saves `subscription_claim_live_order` before calling
`createLiveOrder`. The initial action is `create`; a saved unbound claim returns
`recovery`. A timeout, non-2xx, malformed response or failed local bind does not
authorize another POST, another receipt or another quote to bypass the claim.

1. Record the original request UUID, quote amount, organization and merchant
   from durable evidence. Do not infer them from the payer screenshot.
2. Use implemented `recoverLiveOrder`: **GET**
   `/v1/orders?receipt=<original-request-uuid>&count=2`. It requires provider
   `count=1` and exactly one item. Zero/multiple results remain an owned exception;
   no result is not proof that the POST had no effect.
3. Verify an `order_` ID, exact UUID receipt, amount `79900`, INR, accepted order
   state `created|attempted|paid`, and both notes:
   `usefuldesk_organization_id=<selected-org>` and
   `usefuldesk_request_id=<original-request-uuid>`. For an already bound order,
   `fetchLiveOrder` uses **GET** `/v1/orders/<bound-order-id>` and also rejects a
   changed returned ID. Archive the restricted GET evidence and verifier.
4. After action-specific approval, a trusted service operator may invoke existing
   `subscription_bind_live_order` with `p_request_id`, `p_provider_order_id`,
   `p_provider_merchant_id`, `p_pilot_organization_id`. This RPC can bind the saved
   claim while initiation is closed; it rejects replacing an existing provider
   ID and rejects a `review_required` order. It does **not** call Razorpay:
   provider verification must precede it. Inspect its returned exact identities.
5. If a genuine delivery previously returned 503 before the bind, use an actual
   provider retry/redelivery under the separately approved provider procedure.
   Such an unbound delivery was not acknowledged/durably queued. Do not fabricate
   a signed body or create a database webhook row. Without signed capture time,
   provider GET alone cannot grant a term.

`POST /api/subscriptions/live-orders` returns 404 with initiation flags closed,
even for recovery. There is no separate unbound-order operator HTTP API. Do not
reopen the charge gates merely to get a convenient retry. Approved protected
service execution of the existing bind RPC is required; if unavailable, keep the
claim open and escalate the execution gap.

## Uncertain refund POST and terminal effects

Only a saved immutable owner-reviewed full first-payment refund is eligible.
Its policy must match the original offer. The original verified payment and
review precede `subscription_claim_live_refund`; that claim precedes the sole
`createLiveFullRefund` POST. The adapter freshly checks the captured original
order/payment, zero `amount_refunded`, and zero existing refunds before POST.

1. Record refund request UUID, original quote/order/payment, amount, policy,
   actual `request_received_at` and evidence reference. A standard request uses
   the payment's saved billing timezone: capture local date is day 0; local date
   differences 0–7 qualify, day 8 does not. Processing may happen later. An
   `exception_review` requires its own reason and reviewed decision; do not
   backdate or replace immutable request evidence.
2. For an unbound claim use `recoverLiveFullRefund`: **GET**
   `/v1/payments/<original-payment-id>/refunds?count=2`. It requires exactly one
   result, whose `rfnd_` ID, parent payment, full amount, INR, receipt and both
   notes match the original refund UUID/organization. Zero, multiple, partial,
   foreign-receipt or foreign-note results remain exceptions. The adapter has
   no pagination-based search or automatic second-POST path.
3. For a bound refund use `fetchLiveRefund`: **GET**
   `/v1/payments/<original-payment-id>/refunds/<bound-refund-id>`, including exact
   returned-ID verification. Valid observed statuses are `pending|failed|processed`.
4. With approval, bind the GET-verified result through existing service-only
   `subscription_observe_live_refund`: `p_refund_request_id`,
   `p_provider_payment_id`, `p_provider_refund_id`, `p_provider_merchant_id`,
   `p_amount_minor`, `p_currency`, `p_status`. It preserves the original binding
   and existing `processed`/`review_required` states; a previously failed provider
   observation may become pending or processed after fresh GET verification. It
   does not call the provider or end access.
5. A processed status is insufficient alone. `fetchSettledLiveFullRefund` also
   GETs the parent payment and requires exact original ID/order/amount/INR,
   `status=refunded`, and `amount_refunded=79900`. `reconcileLiveRefund` performs
   these GETs then invokes `subscription_commit_live_full_refund`. Do not call
   the commit using dashboard status alone.

| Durable refund outcome                                   | Access/renewal result                                                                                                                                                        | Operator action                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claimed/unbound, pending or failed                       | Paid access retains its original end; no confirmed refund timestamp. A review/claim already prevents renewal eligibility, although `renewal_stopped_at` is not yet set.      | Keep original UUID and named owner; monitor provider completion; do not create a replacement refund.                                                                           |
| Processed, parent full refund verified, commit confirmed | Grant gets `refund_confirmed_at` and `renewal_stopped_at`; access end becomes the earlier of old end and confirmation, version increases once, one access audit is appended. | Verify owner term/access snapshot and supported expired-access recovery. No complimentary restoration, sign-in/data/branch deletion or provider recurring cancellation occurs. |
| `review_required` / `later_payment_or_access_change`     | Provider refund evidence remains durable, but automatic access truncation is withheld.                                                                                       | Escalate an individual access/accounting decision; retries retain the hold.                                                                                                    |

The Live refunds API has no review-creation method/UI. The candidate makes
refund-review insertion an explicitly reviewed operator database operation.
There is no application import path for an external/manual/partial refund and
no resolver for a held refund/payment. A direct provider-dashboard refund without
the saved exact receipt/notes cannot be silently adopted. Never disable triggers,
rewrite payment/refund states, delete a claim or modify access to impersonate
normal settlement. Any exceptional correction needs a separately reviewed plan
and authorized implementation; record its remaining risk.

## Bound held-event reconciliation

After approved recovery-phase activation, **POST**
`/api/subscriptions/live-reconcile` with a securely supplied `x-cron-secret` or
`Authorization: Bearer` using existing `AUTOMATION_CRON_SECRET`/`CRON_SECRET`.
It accepts no per-event or refund payload. Use protected tooling that keeps the
secret out of command arguments/output. Record HTTP status and only the counters
`inspected`, `reconciled`, `failed`.

The route selects up to five held events per call, oldest first, scoped to this
merchant/pilot. It uses `subscription_list_live_held_events`, then the capture
or refund helper, and `subscription_mark_live_event_reconciled`. HTTP 503 means
one or more failed; successful events may still have completed. Re-query before
an approved repeat. HTTP 200 with `inspected=0` does not prove zero unbound claims,
zero missing-time captures or zero pending refunds.

Capture recovery requires a genuine stored `payment.captured` event with
`provider_event_at`, the bound reviewed order, fresh matching provider GET facts
and no prior refund. Replays reuse `verified|review_required`; they do not create
another month. Missing capture time stays held and is omitted from this scan.
`payment.failed` is completed by the receiver without a grant or grace.

The receiver saves valid SaaS event identity/digest before acknowledgment.
Successful capture/refund processing can leave the event `held` until this
bounded worker marks it; event state alone is not financial status.
`reconciled` can mean a durable review hold or a pending/failed refund observation,
not successful payment or completed refund. An identical event ID must retain
its digest and facts. Changed digest is an exception, never an overwrite.

**No general pending-refund scan is implemented.** Once `refund.created` is
reconciled while pending, this endpoint does not poll that table row unless a
later delivery remains held. Missing later signed delivery requires genuine
provider retry or separately approved protected execution of existing
`reconcileLiveRefund` after binding; there is no per-refund operator HTTP route.
Do not describe the endpoint as automatic discovery of all missing obligations.

## Owned exception register and closeout

Keep the register private; every unresolved fact has one owner and next action.

| Field                         | Required evidence                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Reference / discovery / phase | Stable incident/exception reference, UTC discovery, release/schema and switches                                                      |
| Exact obligation              | Original quote/refund UUID; private provider IDs; merchant/org; amount/currency; whether POST was attempted                          |
| Status                        | `investigating`, `waiting_provider`, `waiting_owner`, `recovery_approved`, `resolved`; separately preserve actual DB/provider status |
| Money/access facts            | Provider GET time/result, signed event ID/digest/time if present, current grant/access/version, discrepancy                          |
| Owner / next action / due     | Rajat or explicit delegate, exact GET/review/bind/reconcile step, next review timestamp                                              |
| Resolution                    | Approved action reference, returned identities/counters, before/after evidence, residual risk and verifier                           |

Open rows include uncertain POST, multiple/zero lookup results, unbound IDs,
missing signed capture/time, payment/refund hold, pending/failed refund, changed
event digest, ambiguous shared-merchant routing and provider/local disagreement.
A hold reason is returned by the SQL capture commit but is not persisted as a
payment column or exposed by `settleCapturedLivePayment`; preserve any available
redacted incident evidence, otherwise record the reason as unknown/inferred.
Do not assert a diagnosis merely from `review_required`.

Close only when the exact financial obligation and access effect are explained,
all relevant immutable identities match, outstanding work has an explicit owner,
and unrelated gym ledgers, existing access and cron state match the baseline.
Capture completion evidence privately; record any genuine delivery/retry that
was unavailable as pending, not simulated success.

## Rollback limits

Application rollback cannot reverse a provider POST, refund, issued order,
captured money or immutable access audit. A database restore can erase evidence
of money that still exists at Razorpay and cause duplicate work; never use it as
a financial undo. Follow the approved disposable restore drill before a separately
authorized data restore. Retain the closed candidate schema and compatible
recovery code while obligations remain. Do not roll back to the historical
intake-only release if it cannot perform the needed reconciliation.

Disable the SaaS provider webhook/intake only after every in-flight obligation
is resolved or an explicit alternative recovery plan is approved. The historical
[intake-only rollback](subscription-live-intake-proposal.md#rollback-before-any-money-exists)
applies before money exists, not after opening. Schema rollback is forward-only
unless separately reviewed; never `supabase db push`. Ending a run with new
initiation closed is containment, not proof that all money has reconciled.
