# Closed billing installation — 30 September 2026

Production billing remains closed. This records schema installation and
preservation checks; it authorizes no paid offer, order, refund or access change.

## Installed source and recovery point

The [26-source manifest](subscription-production-install-manifest.tsv) pins main
`3eb8ce2fcfc8c5ced5915f00f69619386ac90e93` and each SQL file hash. Its SHA-256 is
`0587a9d996228f7891c801f9b0b4722f8258c6bebaa1ac7ff8616f6f16bb8bcf`.
The identified independent-brand/legal-identity source precedes the 25 billing
migrations. It preserves existing legal names and adds the missing brand-name
RPC. Its eight final definitions and privileges match accepted staging.

Before installation, [backup run 36714071889](https://github.com/aarkay1805/UsefulDesk/actions/runs/36714071889)
successfully exported, encrypted, uploaded and verified both database and Storage
snapshots in the existing R2 backup destination. The established restore ownership
and accepted key-custody limitations in production readiness still apply.

All 26 sources applied successfully to `fwqthstqrkrwtaehefks` through the approved
Supabase migration tool as `dark_saas_*` entries. At 12:31 UTC, history contained
325 entries and ended at connector version `20260930122917`. This connector
version mapping differs from source filenames; never substitute `db push`.
No new application implementation or opening migration was installed.

## Preservation and disabled boundary

Before/after checks retained 8 Auth users, 6 accounts, 5 organizations, 554 gym
payment records and 2 active cron jobs. Exact aggregate fingerprints of accounts,
organizations, legal entities and product-access rows were unchanged. Existing
product-access settings, including enforcement, were unchanged.

Production has 108 public base/partitioned tables and 313 public policies, with
zero public tables lacking RLS. All 24 private billing/subscription tables have
RLS and deny direct anon/authenticated SELECT, INSERT, UPDATE and DELETE.

Every Test, capability, reminder-policy, advanced and Live switch is false.
Test merchant, Live merchant and pilot bindings are null. Test intents, payments
and paid grants are empty; Live orders, payments, refunds and event records are
empty; the offer approval ledger is empty. Hard-closed quote/order/refund,
conversion and renewal constraints remain. No tenant data or synthetic fixture
was inserted into Production, and no provider order, charge, refund or message
was created.

The separate [cloud staging acceptance](subscription-staging-plan.md) passed
rollback billing/capability suites, six real Auth/API/isolation/worker checks and
staging-backed desktop/390 px settings inspection. Its disposable users, tenants,
payment facts, templates and fake provider configurations were removed; all gates
and access enforcement are false, bindings null and cron inactive. The older
Test project remains paused.

## Next private configuration step

The owner authorized saving the generated Live pair only in its private local
file. Before transferring it to another service, obtain specific authorization
for the UsefulDesk project's **Production Vercel environment only**. Prepare:

- `USEFULDESK_SAAS_RAZORPAY_MODE=live`.
- `USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID` and `LIVE_KEY_SECRET`, under the same prefix.
- `USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET`, independent of gym OAuth.
- `USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID=acc_TCJwBqanN9LTrK`.
- `USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID=8826d9aa-03f2-4ad7-ae91-0553052131f8`.

Keep intake, settlement, reconciliation, quote, order, refund, review/Checkout UI
and capability switches off for this configuration step. Keep secrets out of
source, PRs, screenshots and command arguments. Verify the resulting deployment
and audit before a separately reviewed intake-only receiver/webhook setup.

The intended SaaS receiver is
`https://desk.usefulmade.com/api/subscriptions/live-webhook`, for
`payment.captured`, `payment.failed`, `refund.created`, `refund.processed` and
`refund.failed`. No webhook is installed or enabled. Do not register an active
provider webhook until the deployed receiver can safely accept its deliveries.
Actual signed shared-merchant delivery, controlled human-completed Live
payment/refund acceptance, real-buyer issuer determination and the separate
hard-gate opening change remain required before a payable rollout.
