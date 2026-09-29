# Usefulmade Live SaaS billing draft

**Status (29 September 2026): local, uninstalled, default off.** This is a
reviewable initial-term and first-full-refund boundary, not a payable offer or
permission to deploy, enable billing, or move money. Gym Razorpay OAuth,
webhooks, mandates and member ledgers remain separate.

## Boundaries

- `src/lib/subscriptions/live-provider.ts` uses only the Usefulmade Live key,
  secret, webhook secret and pinned `acc_` merchant. It refuses non-Production
  runtimes and any Test SaaS credential. Only the key ID may be returned to
  Checkout. Provider GETs verify exact order receipt, organization notes, INR
  paise and captured/refunded facts.
- `20260929170000`–`20260929250000` create private Live records with explicit
  `provider_mode='live'`, merchant, organization and pilot links. RLS grants no
  anon/authenticated writes; service-only RPCs check the JWT role. The Live
  order claim is durable before POST and every uncertain create becomes
  GET-only exact-receipt recovery. A signed webhook is durably held before
  acknowledgment. Duplicate event IDs require the same body digest.
- The initial settlement locks the organization, verifies the immutable
  reviewed quote and order, checks the expired trial and branch roster, then
  grants one monthly term or persists a captured payment as `review_required`.
  The paid month and quote expiry use the signed `payment.captured` event time,
  stored separately from processing time. Missing event time stays held.
  This is the provider's capture **event** time, not a separately documented
  capture instant: the [Razorpay payment entity](https://razorpay.com/docs/api/payments/entity/)
  defines `created_at` as payment creation. The proposed
  `calendar_month_from_capture_event` term needs explicit offer approval.
  Starter requires the owner's one-time reminder acknowledgment before Checkout;
  the grant transaction normalizes schedules and retires unattempted custom
  claims. A changed or unapproved reminder policy holds captured funds for
  review. Test and Live grants cannot coexist. The shared named
  capability predicate recognizes a Live grant for RLS and web/native
  snapshots when the separate capability switch is eventually enabled. Its
  activation trigger checks Live Starter schedules and unsent custom claims.
- The first-full-refund path requires an owner-reviewed policy reference, one
  saved claim before provider POST, the original captured payment, no prior
  refund, and fresh full-settlement GETs. A matching settled refund ends access
  and stops renewal; later payments or changed access remain review-held.
  Signed refund deliveries and the protected bounded recovery route use GET
  only and can revisit held events after an outage.
- An empty private approval ledger holds the merchant-approved exact INR
  amount, tax and refund references, customer-facing notes, term policy and
  quote lifetime. It has no application write path. The owner can preview one
  approved offer and explicitly confirm the displayed amount; a service-only
  writer copies the pricing and approval identity into an immutable quote after
  rechecking owner, pilot, trial and roster. Customer notes remain in the
  immutable approval record. Replays return the same quote; changed amounts and
  overlapping quotes fail. Quote issuance is database-hard-closed and default
  off until an approval migration opens it.
- The owner panel labels the Usefulmade Live pilot, shows the exact amount and
  approved customer notes, and can save the Starter reminder choice. Its
  Checkout control checks the returned order against the reviewed quote
  before opening Razorpay; access still waits for the signed captured webhook.
  `NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI` and
  `NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI` are default off and blocked by the
  Production environment audit.

## Switches and isolation

| Layer                           | Default                     | Requirement before use                                                                                                                                                                                                                                                                                                |
| ------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live provider                   | absent                      | `USEFULDESK_SAAS_RAZORPAY_MODE=live`, distinct `LIVE_KEY_ID`, `LIVE_KEY_SECRET`, `LIVE_WEBHOOK_SECRET`, `LIVE_MERCHANT_ID`, and one `USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID`; the full names use the `USEFULDESK_SAAS_RAZORPAY_` prefix. Runtime also requires `NODE_ENV=production` and `VERCEL_ENV=production`. |
| Webhook intake                  | false                       | `USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED=true` and the matching private database merchant/pilot/intake switch. Intake alone holds evidence; it does not grant or refund.                                                                                                                                          |
| Quote issuance                  | false, database-hard-closed | `USEFULDESK_SAAS_LIVE_QUOTES_ENABLED=true`, one explicitly approved offer row, and the matching private database switch. The database `CHECK` prevents enabling issuance in this draft; the Production audit blocks the runtime flag.                                                                                 |
| Settlement and reconciliation   | false                       | Separate `USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED` and `USEFULDESK_SAAS_LIVE_REFUND_RECONCILIATION_ENABLED` flags plus private database settlement switch. The Production env audit currently blocks them.                                                                                                           |
| New order and refund initiation | false, database-hard-closed | Separate `USEFULDESK_SAAS_LIVE_ORDERS_ENABLED` and `USEFULDESK_SAAS_LIVE_REFUNDS_ENABLED` flags. Database `CHECK` constraints forbid enabling either; a later reviewed migration must deliberately replace them. The Production env audit also blocks both.                                                           |
| Tier capabilities               | false                       | Existing `private.subscription_billing_settings.capabilities_enabled` remains off pending Starter cadence and full acceptance.                                                                                                                                                                                        |

The application never compares a Live merchant ID to a gym account's OAuth
merchant. Production environment audit permits a complete dark Live
configuration, rejects Test keys and money switches, and treats redacted
protected values as unverified.

## Remaining before any Live pilot

1. Approve the offer, tax/receipt treatment, exact INR amount and term policy,
   quote lifetime, refund/cancellation rules, and one pilot organization. A
   qualified adviser and the Usefulmade Live merchant owner must confirm their
   respective facts privately. No approval row is seeded; quote issuance and
   Checkout remain hard-closed pending an explicitly reviewed opening migration.
2. Approve Starter's standard reminder days/time, Live renewal,
   upgrade/add-on/restart scope or explicitly exclude them from the offer.
   Current initial-term flow is not an automatic recurring debit.
3. Repeat full-schema Test acceptance through the approved migration path,
   inspect resulting tables/policies/function grants, and run concurrency,
   genuine provider and outage checks. A rollback-only synthetic full-schema
   SQL check passed in the disposable local stack; it left no Live schema
   installed and did not use a provider.
4. Complete genuine provider Test delivery/outage recovery and Release web/native
   acceptance for the final offer. Only then review a separate Production
   migration, dark deployment, configuration and explicitly authorized
   real-money pilot. A synthetic capture alone does not establish Live readiness.

Rollback disables new quote/order/refund initiation first while retaining
signed webhook intake and reconciliation for in-flight money. Every uncertain
payment/refund remains an owned review item until reconciled.
