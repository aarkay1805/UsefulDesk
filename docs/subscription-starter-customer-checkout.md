# Starter web customer checkout — closed implementation

**2 October 2026: built, accepted with disposable local/cloud fixtures and
installed closed in Production; customer activation remains pending.** A real buyer
is required for issuance/opening review, not for building or testing this path.
No customer authority or commercial facts are seeded by the migration.

## Independent authority

`20261002080000_starter_customer_checkout_scope.sql` adds private, RLS-enabled
customer reviews and per-organization activation rows. Browsers have no table
access; service has SELECT, no direct DML/TRUNCATE. Only an explicitly reviewed
operator change may insert real evidence or open a scope. New functions are
postgres-owned definers with empty search paths; authority/inventory RPCs are
service-only and private helpers have no ordinary-role execution.

A customer review freezes the exact organization, INR billing branch, merchant,
offer, current owner, release SHA/manifest, authorization, buyer/geography,
issuer/PAN-wide financial-year, tax/document, provider-preflight, backup/recovery
and approved reminder-policy references. References require human inspection;
nonempty strings do not establish tax clearance or an authentic buyer. Reviews
are immutable except one-way revocation. The customer binding cannot change
once its first quote exists. The original Home office internal review,
merchant/listener and late-event recovery remain pinned and unchanged.

Customer quote/order issuance uses per-organization settings projected from
server-owned authority, without rewriting global settings. The customer path
allows only an expired, unsuspended trial, one active INR branch, Starter at
**79900 paise gross**, a **1800-second** quote and a calendar month from the
signed capture event. It preserves the source access version, owner amount
review and 7/3/1-after-09:00 reminder acknowledgement. Active trials, non-INR
branches, complimentary conversion, renewals, upgrades and add-ons are refused.
It does not shorten trials, change currency or normalize legal identities.

The existing web review component has a separate Starter-only mode: no tier
selector or renewal checkout. Owner authorization remains in the HTTP and SQL
boundaries. A public flag cannot create authority, bypass an owner or grant
access. Native Checkout remains outside this implementation.

Provider calls for customers require process-local authority minted from a
service-only lookup of an immutable quote/bound order. The lookup does not accept
a webhook tenant field. Receipt/request/organization/amount/currency in a fresh
provider order GET must match that authority before customer intake. Apparent
SaaS orders without durable authority remain retryable. Provider claims remain
one-POST: a lost response uses GET-only adoption and immutable binding, followed
by a new claim check before returning payable Checkout.

Intake and settlement remain independent of customer initiation. Closing
customer quote/order switches permits a matching in-flight capture to commit;
revoking/changing the reviewed offer/opening/reminder facts holds an uncommitted
capture, retains its exception and grants no access/refund. Existing verified
payment replays retain their outcome even after full refund and never restore
access. Customer first-payment refund initiation has its own closed switch and
exact owner/policy/request-evidence review; original refund history, local-day-7
rules, ambiguous-create recovery and full-refund confirmation are preserved.
Metadata exception review retains an owner, status and next action and cannot
resolve money or release a held capture.

Recovery inventories durable scopes with the original first, checks every batch
against its server-selected organization and retains the existing five-item
limit and leases. Customer delivery receipts keep the original listener identity
while requiring the independently scoped durable SaaS event. Unrelated traffic
never receives customer financial authority.

## Closed release and later review

All four new environment switches default false/unset:

- `USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED`: customer identity resolution and
  recovery support; keep enabled after a separately approved customer order exists.
- `USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED`: customer quote/order initiation;
  additionally requires scope support, Production-only Live configuration,
  intake/settlement and exact database scope/review gates.
- `USEFULDESK_SAAS_LIVE_CUSTOMER_REFUNDS_ENABLED`: independently reviewed customer
  first-payment refund initiation; additionally requires scope and database gates.
- `NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI`: web Starter review/Checkout only.

The existing environment audit rejects these switches in every accepted internal
pilot/intake/recovery phase. It does not authorize a new customer phase. Existing
internal initiation/UI switches, Test, capabilities and renewals stay closed.
The migration seeds no offers, reviews, scopes or switch changes.

Before Production installation, review the exact implementation/source and
preservation evidence, refresh backup readiness and use the approved migration
connector. Deploy with the new switches absent/false. Customer activation is a
**separate** review: select an authentic buyer, settle real geography/issuer/
document facts, refresh trial/roster/access/reminder readiness, record the exact
immutable offer/review and approve that organization and release. Insert its
scope closed first; only a later reviewed update may open it. Feature capability
activation, customer refund opening, actual sends and any real-money action need
their corresponding review; passing synthetic tests supplies none of that evidence.

To contain an opened customer, close its database initiation gates and runtime
checkout/refund/UI switches. Retain its scope/review/quote/order history, the
customer scope support switch, original listener, signed intake, settlement and
GET recovery. Do not rebind the original pilot or revoke evidence merely to test
containment. Held captures have no automatic promotion/refund resolver.

At the earlier release check, Justin's candidate identity was unconfirmed and
the branch used AED. Later on 2 October, Rajat confirmed the handover and selected
Justin's fitness as the real customer candidate. Fresh checks confirm owner
Justin Credible and one active INR branch, Old Ambala. Rajat later confirmed
Justin's consent to end the trial early; an audited operator correction at
10:52:27 UTC records an expired unsuspended trial, version 4. Legacy entity
currency still says AED. This satisfies trial eligibility without opening checkout.
Billing/issuer evidence and customer approval remain pending. See
[Justin's preparation record](subscription-justin-customer-review.md). Candidate
selection alone does not open checkout or alter the trial; the later trial
change has its own explicit owner-consent record.

## Acceptance record

The fresh read-only Production baseline at **07:49:12 UTC** retained one original
quote/order/payment/refund/grant, three original events, 554 gym payments,
zero receipts/queue/exceptions, original binding, intake/settlement enabled and
all initiation/Test/capability gates closed. No Production migration, fixture,
provider POST, redelivery, message or activation occurred.

Local command: `node scripts/verify-starter-live-pilot-opening.mjs
<explicit-disposable-subscription-full-container> --customer`. It replays the
closed customer source twice, runs the existing internal pilot/capability suite
and the customer fixture, then rolls back all Live schema. Acceptance includes
owner/admin/outsider and cross-tenant denial; immutable review/quote/binding;
active-trial/AED refusal; single order claim/GET recovery; exact capture-month,
late-capture/revoked/changed-review and two-owner stale quote-author holds; replay and original post-refund
late-event recovery; customer receipts; separately closed refund claims/history/
recovery; owned exception metadata; preserved original/gym facts and closed gates.
The historical late-capture fixture seeds exact synthetic past quote/order facts
under the fixture operator, with owner JWT for its reminder snapshot. No triggers
are disabled. It is transaction-boundary evidence, not a historical provider event.

Billing Staging `otagotpezshybxkagtwv` installed the closed source through the
approved connector as **20261002081605**, then replayed
customer exception metadata review as **20261002082348** and the final source
including a two-owner stale quote-author capture hold as **20261002083552**. Final source SHA-256:
`cae7b505f06ad741eacd0733b3edbb470f7a55a33d592a243f5747a993c1c70c`.
The exact original-pilot/capability/customer rollback payload SHA-256 is
`4cdfa72beef8acdcb483c8409a5594cf50eb9b0d637023d98a3d9fd88d341261`;
all assertions passed. The **08:36:54 UTC** postcheck found zero users, accounts,
organizations, customer reviews/scopes, quotes/orders/payments/refunds/grants,
receipts, queues and exceptions. Global merchant/pilot/review are unbound and
all Live/Test/capability gates are false. New RLS/grants and definer ownership/
search paths are verified. Runtime/customer activation remains unperformed.

Application verification covers customer gates, forged/cloned/mismatched server
authority, provider-note mismatches, claim-before-POST ordering, GET-only retry,
customer replay/settlement/refund authority, signed webhook scope isolation,
owner HTTP denial and Starter-only web controls. `npm run verify` passed: lint,
TypeScript, **4,340 tests in 529 files**, and the Next.js production build
(137 generated pages). `git diff --check` and changed-file formatting checks
also passed. The implementation PR records these results. The later closed
Production release is recorded in [the Production release record](subscription-starter-customer-production-record.md);
its fresh checks and source manifest do not supply customer commercial authority.

Authentic repeat/mixed gym/SaaS traffic, authorized reminder delivery, actual
customer billing/issuer opening and identified external watchdog setup remain
separate pending dependencies. Exact renewal templates are Approved; that does
not establish delivery. See [current rollout actions](subscription-starter-rollout-next.md).

## Genuine owner review implementation — 2 October

Operator preparation is now distinct from authenticated owner approval. The actual owner
reviews the prepared ₹799 terms, creates an initially closed scope, then a separate
server transaction consumes one-time opening authority. Retries cannot reopen
containment; original Home office initiation, customer refunds, renewals and global
capabilities remain closed. Local/cloud rolled-back acceptance and full verification
passed. Justin’s C01 document disposition and legacy business-default cleanup are
complete. Setup review records missing active plan, without marking setup ready.
Genuine owner checkout approval/reminder acknowledgment and payment remain.
See [Justin’s dated record](subscription-justin-customer-review.md) for fresh backup, provider/recovery evidence and the explicit bounded first-customer
disposition; authentic repeat/mixed delivery and external paging remain wider work.
