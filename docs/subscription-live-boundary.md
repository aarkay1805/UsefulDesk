# Usefulmade Live SaaS billing draft

**Status (30 September 2026): PR #19 default-off release deployed, billing schema installed
with every gate off; Live configuration uninstalled.** This is a reviewable initial-term, expiry-only renewal
and first-full-refund boundary, not a payable offer or billing activation. Gym
Razorpay OAuth, webhooks, mandates and member ledgers remain separate.
PR #17 merged at `a1a0ddab7432e0204cfdc027f042b9c87b01115e`; hosted
CI and CodeQL passed and canonical Production was READY at
`dpl_AZtfZQ2qs1TiLhTBt6JdeoZN2vtM` on 29 September. The last read-only database audit found
no SaaS billing schema or configured Live SaaS path.
The owner has since requested reuse of the existing activated UsefulMade
merchant. The `acc_` identity can be shared technically, while direct SaaS
key configuration, webhook handling, order identity and billing records stay
independent of gym OAuth. This does not require a second Razorpay API key pair;
Razorpay describes keys as universal across approved websites/apps.

The 30 September recheck confirms PR #18 merged at
`fbc8a9ddfddede1c4ea48dc9a77ea1a2ee6f0ac4`, green CI/CodeQL/Vercel checks,
and successful GitHub Production deployment `6751236716` for that SHA.
Focused Live subscription tests pass 60/60; all three rollback-only full-schema
suites pass with twelve draft migrations and leave no Live schema installed.
At that initial release check, Production had zero private subscription/billing
tables. At the later
30 September check, Razorpay confirms `desk.usefulmade.com` successfully
verified. The owner authorized Live key generation and completed SMS
verification; the key pair was saved privately with 0600 permissions and
authenticated a read-only Orders API request (200). No provider order,
payment, refund or access activation occurred. The independent SaaS webhook
configuration is prepared privately; it is not installed or enabled.

The unchanged owner-review component also passed an isolated synthetic Chrome
browser check on 30 September using actual shared controls/styles at desktop
and 320/390 px phone widths. Mocked RPC/Checkout responses covered offer,
conversion, reminder gating, held/expired payment, cancellation/refund and renewal
states. This does not establish authenticated full-app or real provider/refund
acceptance; see the [Test record](subscription-test-acceptance.md).

The 30 September follow-up also passed four real local Auth/API/RLS and
mocked-worker Starter checks, plus actual signed-in reminder settings at desktop
and 390 px. Standard off/on persisted, custom schedules were refused, reviewed
downgrades normalized 7/3/1, and workers respected local 09:00, dedupe, missed
days and access revocation before send. Fixtures and switches were restored.
This closes local web/worker acceptance, not real WhatsApp delivery, final native
capability activation, operational staging or Live acceptance. The isolated
10:17 UTC Production export passed with zero blockers/three warnings and no
SaaS billing configuration. The owner subsequently verified the canonical URL
and 64-hex encryption-key format from their original secure source, closing B-05
by attestation while export redaction warnings remain. Follow
the [ordered rollout sequence](production-readiness.md#starter-rollout-sequence)
before any activation.

The subsequent [cloud staging acceptance](subscription-staging-plan.md) passed
six authenticated API/isolation/worker checks, rollback billing/capability SQL
and staging-backed desktop/390 px settings checks. After a fresh encrypted
backup, the [26-source dark installation](subscription-production-install-record.md)
completed in Production. Existing tenant/legal/access fingerprints and settings,
554 gym payments and both active cron jobs were unchanged. All 24 private billing
tables deny browser access and every gate is off. The subsequent owner-approved
Production-only Live credential transfer and merchant/pilot binding completed;
billing records/offer approvals remain empty. The closed redeployment is READY,
the audit has zero blockers, four Live POSTs return 404 and Production health
passed. The subsequent owner-approved intake-only activation is complete on
exact main `5920fa78`: the provider webhook is Enabled with the five approved
events and a configured secret, unsigned intake returns 400, and money
endpoints remain 404. Every other gate stays closed; actual signed delivery
and genuine Live acceptance remain pending. See the installation record.

## Boundaries

- `src/lib/subscriptions/live-provider.ts` uses only the Usefulmade Live key,
  secret, webhook secret and pinned `acc_` merchant. Reuse of the existing
  merchant requires independent SaaS credential configuration and exact event routing. It refuses non-Production
  runtimes and any Test SaaS credential. Only the key ID may be returned to
  Checkout. Provider GETs verify exact order receipt, organization notes, INR
  paise and captured/refunded facts.
- `20260929170000`–`20260930010000` create private Live records with explicit
  `provider_mode='live'`, merchant, organization and pilot links. RLS grants no
  anon/authenticated writes; service-only RPCs check the JWT role. The Live
  order claim is durable before POST and every uncertain create becomes
  GET-only exact-receipt recovery. A signed webhook is durably held before
  acknowledgment. Duplicate event IDs require the same body digest.
- The initial settlement locks the organization, verifies the immutable
  reviewed quote and order, checks the expired trial or selected pilot's
  acknowledged complimentary-to-paid Starter path and branch roster, then
  grants one monthly term or persists a captured payment as `review_required`.
  The paid month and quote expiry use the signed `payment.captured` event time,
  stored separately from processing time. Missing event time stays held.
  This is the provider's capture **event** time, not a separately documented
  capture instant: the [Razorpay payment entity](https://razorpay.com/docs/api/payments/entity/)
  defines `created_at` as payment creation. The proposed
  `calendar_month_from_capture_event` term was approved for the narrow first
  Starter pilot on 29 September. This does not establish a separately attested
  provider capture instant.
  Starter requires the owner's one-time reminder acknowledgment before Checkout;
  the grant transaction normalizes schedules and retires unattempted custom
  claims. A changed or unapproved reminder policy holds captured funds for
  review. Test and Live grants cannot coexist. The shared named
  capability predicate recognizes a Live grant for RLS and web/native
  snapshots when the separate capability switch is eventually enabled. Its
  activation trigger checks Live Starter schedules and unsent custom claims.
- Owner-initiated renewal is Starter-only and expiry-only, as approved on
  29 September. A new 30-minute quote freezes the exact previous request,
  paid-through date and access version. The existing order adapter retains its
  one-POST claim and GET-only recovery. The shared signed-capture settlement RPC
  retains its historical `subscription_commit_live_initial_payment` name and
  dispatches from the immutable quote; it starts one month from the new signed
  capture event, appends term history, and advances the current grant once.
  Cancellation is an owner-only RPC serialized on the organization. It preserves
  paid access and has no refund/provider effect. A cancelled, refunded, changed,
  or refund-pending term cannot renew; an in-flight captured payment is held.
  Initiation can be darkened while signed settlement/recovery remains available.
  Old payment replay never rolls the current term back. No early renewal, grace,
  tier change, add-on, or restart is added to this Live path.
- The first-full-refund path requires an owner-reviewed policy reference, one
  saved claim before provider POST, the original captured payment, no prior
  refund, and fresh full-settlement GETs. A matching settled refund ends access
  and stops renewal; later payments or changed access remain review-held.
  Signed refund deliveries and the protected bounded recovery route use GET
  only and can revisit held events after an outage.
- The installed, default-off `20260930020000` source snapshots the first verified payment's
  billing timezone and requires a refund request timestamp plus evidence
  reference. A standard first-payment request must arrive no later than local
  day 7; a separately reasoned exceptional correction remains owner-reviewed.
  Review evidence becomes immutable. The rollback-only full-schema suite covers
  a late standard rejection and an explicit exception. Genuine provider and
  customer-service acceptance remain open.
- An empty private approval ledger holds the merchant-approved exact INR
  amount, tax and refund references, customer-facing notes, term policy and
  quote lifetime. It has no application write path. The owner can preview one
  approved offer and explicitly confirm the displayed amount; a service-only
  writer copies the pricing and approval identity into an immutable quote after
  rechecking owner, pilot, eligible access and roster. For the selected
  complimentary Starter pilot, a second explicit owner acknowledgement freezes
  the original access mode and version. Claim and settlement recheck that
  snapshot; free access continues until signed captured settlement, and changed
  access holds captured funds for review. Other complimentary organizations
  remain ineligible. Customer notes remain in the
  immutable approval record. Replays return the same quote; changed amounts and
  overlapping quotes fail. Quote issuance is database-hard-closed and default
  off until an approval migration opens it.
- The owner panel labels the Usefulmade Live pilot, shows the exact amount and
  approved customer notes, and can save the Starter reminder choice. Its
  complimentary-to-paid acknowledgement is required before issuing that
  pilot's quote. Checkout checks the returned order against the reviewed quote
  before opening Razorpay; access still waits for the signed captured webhook.
  `NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI` and
  `NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI` are default off and blocked by the
  Production environment audit.
- Quote and Checkout expiry checks use wall time even if a PostgreSQL session
  began before the 30-minute deadline and waited on a lock. Quote, order and
  refund initiation read the current switch after locking the organization.
  Two-session disposable checks cover overlapping quotes, cancellation versus
  settlement, expiry while waiting, and shutdown during an order claim. The
  concurrent database clone lacked unrelated cron/realtime/vault objects; the
  complete schema separately passed three rollback-only synthetic suites,
  including the complimentary conversion and confirmed full-refund path.

## Switches and isolation

The table records the current Production baseline. The separately prepared
[first-term opening candidate](starter-live-pilot-opening-review.md) has passed
local/cloud staging rollback checks with all gates restored off. Its explicit
environment audit modes describe reviewed pilot and recovery phases; they do not
authorize activation. Production has not installed that opening candidate.

| Layer                            | Default                     | Requirement before use                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live provider                    | configured, intake on       | `USEFULDESK_SAAS_RAZORPAY_MODE=live`, independent SaaS configuration for `LIVE_KEY_ID`, `LIVE_KEY_SECRET`, `LIVE_WEBHOOK_SECRET`, `LIVE_MERCHANT_ID`, and one `USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID`; the full names use the `USEFULDESK_SAAS_RAZORPAY_` prefix. Runtime also requires `NODE_ENV=production` and `VERCEL_ENV=production`.                                                       |
| Webhook intake                   | true, owner-approved        | `USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED=true` and the matching private database merchant/pilot/intake switch. Intake alone holds evidence; it does not grant or refund.                                                                                                                                                                                                                          |
| Quote issuance                   | false, database-hard-closed | `USEFULDESK_SAAS_LIVE_QUOTES_ENABLED=true`, one explicitly approved offer row, and the matching private database switch. The database `CHECK` prevents enabling issuance in this draft; the Production audit blocks the runtime flag.                                                                                                                                                                 |
| Settlement and reconciliation    | false                       | Separate `USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED` and `USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED` flags plus private database settlement switch. The Production env audit currently blocks them.                                                                                                                                                                                           |
| New order and refund initiation  | false, database-hard-closed | Separate `USEFULDESK_SAAS_LIVE_ORDERS_ENABLED` and `USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED` flags. Database `CHECK` constraints forbid enabling either; a later reviewed migration must deliberately replace them. The Production env audit also blocks both.                                                                                                                                           |
| Complimentary Starter conversion | false, database-hard-closed | `private.subscription_live_settings.complimentary_conversion_enabled` applies only to the pinned pilot with one active INR branch, owner acknowledgement, unchanged complimentary access mode/version and no prior Test/Live paid obligations. Its `CHECK(NOT complimentary_conversion_enabled)` needs a separately reviewed opening migration; quote, order and settlement gates also remain closed. |
| Live renewal issuance            | false, database-hard-closed | `private.subscription_live_settings.renewals_enabled` plus the existing quote/order/intake/settlement gates. A later reviewed migration must replace its `CHECK(NOT renewals_enabled)`; cancellation remains available without enabling money initiation.                                                                                                                                             |
| Tier capabilities                | false                       | Existing `private.subscription_billing_settings.capabilities_enabled` remains off pending review of saved custom schedules and full acceptance. The Starter cadence is approved as 7/3/1 days before expiry after 09:00 account-local.                                                                                                                                                                |

The application does not enforce inequality between the Live SaaS merchant ID
and a gym account's OAuth merchant. Production environment audit permits a complete dark Live
configuration, rejects Test keys and money switches, and treats redacted
protected values as unverified. Its explicit intake-only audit mode
permits only literal true intake after separate approval; default auditing still
blocks intake. The separately approved activation enabled only intake; the audit itself grants no authority.

**Shared-merchant routing:** the follow-up code checks canonical provider
order/payment facts before classifying signed deliveries. A provider-proven gym
event at the SaaS URL is acknowledged as unrelated without a SaaS claim;
ambiguous or unbound SaaS deliveries stay retryable. A SaaS refund cannot
change gym payment/refund ledgers. Actual signed mixed-order/refund delivery,
redelivery and reconciliation on the shared merchant remain acceptance gates.
All payable switches stay closed.

## Remaining before any Live pilot

**External handoff:** the selected UsefulMade / Home office organization
(`8826d9aa-03f2-4ad7-ae91-0553052131f8`, one active branch) has complimentary
access with no trial dates. The default-off conversion code requires a separate
owner acknowledgement and an unchanged source mode/version through order claim
and signed settlement; it does not change Production access today. Razorpay
verified `desk.usefulmade.com` on the existing activated UsefulMade merchant
`acc_TCJwBqanN9LTrK` on 30 September. Live keys are now saved privately and
read-only authentication passes. Isolated full-schema staging and dark Production
schema installation passed. The owner-authorized Production-only credential
transfer, merchant/pilot binding and closed redeployment also passed; every
billing switch except intake remains off. The [approved intake-only activation](subscription-live-intake-proposal.md#activation-result)
is complete with an Enabled provider webhook and signature refusal verified.
Genuine signed mixed deliveries and Live financial acceptance remain pending.
The owner confirmed UsefulMade's legal business name, Punjab business address,
no GST registration, no turnover yet and no foreign-service purchase before the
later Vercel Pro checkout. Pro is now active; the owner reports payment, while
the invoice still shows Open / Payment failed.
There is no genuine first customer yet. These statements are recorded in the
private local issuer draft; the missing Udyam certificate is not a drafting
prerequisite. Before a payable quote, record PAN-wide financial-year turnover,
actual buyer geography and any compulsory-registration circumstance, especially
reverse charge on received services; seek qualified advice for a real exception.
The owner approved ₹799 gross, the Starter term and first-payment refund
timeline; UsefulMade published the [policy](https://usefulmade.com/useful-desk/refunds/)
on 30 September. The no-GST invoice draft remains conditional and is not a
tax conclusion or payable quote. Store sensitive evidence privately and put only approved
customer wording/references into the immutable offer ledger. See
[paid-pilot readiness](production-readiness.md#owner-decisions-and-acceptance-evidence)
and the private [offer draft](starter-pilot-offer-draft.md).

1. Finish the customer-payable offer: documented tax/receipt treatment,
   release-specific acceptance of the new Live refund review boundary, and
   acceptance for the selected complimentary pilot. The owner approved
   ₹799 gross, one active branch, web
   Checkout, a capture-event calendar month, and a 30-minute reviewed quote;
   late capture is review-held. There are no pilot-specific numeric member or
   staff caps. Approved Starter features are members/plans,
   memberships/renewals, attendance, manual payments, shared WhatsApp chats,
   and standard renewal reminders; custom schedules, bulk campaigns,
   configurable automations, gym-member Payment Links, and AutoPay are
   excluded. The owner requested using the existing UsefulMade merchant; its
   approved website is `usefulmade.com`; Razorpay subsequently verified
   `desk.usefulmade.com` on 30 September. Website verification is closed;
   actual signed mixed-event routing still needs provider acceptance. No
   approval row is seeded; quote issuance and Checkout remain hard-closed
   pending an explicitly reviewed opening migration.
2. Accept the approved Starter 7/3/1 reminder schedule after 09:00 account-local
   in final capability/send testing. Initial renewal is owner-initiated.
   Upgrades, paid add-ons, automated restart, and native Checkout are excluded
   from the first offer. The expiry-only Starter renewal order, settlement,
   customer review and cancellation flow is implemented behind closed gates.
   Its full-schema synthetic checks pass; genuine provider and final offer-specific
   release acceptance are still required before renewal is offered. There is no automatic SaaS debit.
3. Repeat full-schema Test acceptance through the approved migration path and
   inspect resulting tables, policies and function grants. The rollback-only
   synthetic full-schema SQL suite and the scoped two-session race checks passed
   locally; neither installed the Live schema on an operational Test project or
   used a Live provider.
4. Complete genuine provider Test delivery/outage recovery and Release web/native
   acceptance for the final offer. Only then review a separate Production
   migration, dark deployment, configuration and explicitly authorized
   real-money pilot. A synthetic capture alone does not establish Live readiness.

Rollback disables new quote/order/refund initiation first while retaining
signed webhook intake and reconciliation for in-flight money. Every uncertain
payment/refund remains an owned review item until reconciled.
