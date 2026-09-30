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

Later preparation is recorded in the
[Starter opening review](starter-live-pilot-opening-review.md). Its closed
candidate was installed and rollback-tested only on empty billing staging at
16:50 UTC; this Production installation record is unchanged by that staging
operation.

## Preservation and disabled boundary

Before/after checks retained 8 Auth users, 6 accounts, 5 organizations, 554 gym
payment records and 2 active cron jobs. Exact aggregate fingerprints of accounts,
organizations, legal entities and product-access rows were unchanged. Existing
product-access settings, including enforcement, were unchanged.

Production has 108 public base/partitioned tables and 313 public policies, with
zero public tables lacking RLS. All 24 private billing/subscription tables have
RLS and deny direct anon/authenticated SELECT, INSERT, UPDATE and DELETE.

At schema installation, every Test, capability, reminder-policy, advanced and Live switch was false.
Test merchant, Live merchant and pilot bindings were null. Test intents, payments
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

## Closed Production configuration, 14:09 UTC

The owner separately authorized transferring the existing private Live pair and
prepared webhook secret to the UsefulDesk project's **Production Vercel environment
only**, binding the existing merchant/pilot with all gates off, and redeploying.
Six environment entries were installed through stdin without secret arguments:

- `USEFULDESK_SAAS_RAZORPAY_MODE=live`.
- `USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID` and `LIVE_KEY_SECRET`, under the same prefix.
- `USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET`, independent of gym OAuth.
- `USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID=acc_TCJwBqanN9LTrK`.
- `USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID=8826d9aa-03f2-4ad7-ae91-0553052131f8`.

The key secret and webhook secret are write-only Vercel Secrets; mode, key ID,
merchant ID and pilot ID are Config entries. The original files retained 0600
permissions. Their merchant/domain/pilot metadata and secret presence/format
were checked privately before transfer; no values were emitted. No Preview or
Development credential was installed. The private export used for auditing was deleted.

The database Live merchant/pilot now match the approved values above. Every
Test, capability, policy, advanced and Live boolean remains false, including
intake, settlement, reconciliation, quote/order/refund and review/Checkout UI.
Existing access enforcement remains true. The audit passed with zero blockers
and four warnings: the two original protected-value warnings already closed by
owner attestation, protected Live secrets validated from their private source,
and absent Turnstile (public lead forms fail closed).

Production deployment `dpl_33qP9azFZjDUkBc2auiExeGBLLnh` is READY and serves
`desk.usefulmade.com`, retaining exact main source
`3eb8ce2fcfc8c5ced5915f00f69619386ac90e93`. Browser POST checks of the Live
webhook, quotes, orders and refunds returned 404. The owner session still opened
Home office. Counts remain 8 Auth users, 6 accounts, 5 organizations, 554 gym
payments and 2 active cron jobs; Live quotes/orders/payments/refunds/events/grants
and offer approvals are zero. [Production health 36726882870](https://github.com/aarkay1805/UsefulDesk/actions/runs/36726882870)
passed after redeployment.

The subsequent approved intake-only activation is recorded below. The earlier
closed configuration checks above remain historical evidence.

## Approved intake-only activation, 16:15 UTC

The owner approved merging PR #20, enabling only signed webhook intake,
redeploying, and transmitting the existing private webhook secret to the
existing UsefulMade Razorpay merchant. PR #20 merged to exact main
`5920fa78bfd60d513906616bab86e87ddddd896b`; its branch was deleted. Main
[CI 36741595399](https://github.com/aarkay1805/UsefulDesk/actions/runs/36741595399)
and CodeQL passed. The fresh Production deployment
`dpl_Hx7CKFZx6YP9iDgwPExBNGCWmTkG` is READY and serves `desk.usefulmade.com`
for that SHA. Only `USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED=true` and
`private.subscription_live_settings.webhook_intake_enabled=true` were enabled.
The explicit intake-only audit passed with zero blockers/five warnings; the
private export was removed. Unsigned webhook POST is 400 `Invalid signature`;
quote/order/refund POSTs remain 404.

One Live Razorpay webhook, `TiJKErwIC7VvRr`, was created at 16:15:34 UTC for
`https://desk.usefulmade.com/api/subscriptions/live-webhook`. Provider details
show Enabled, a configured secret, and exactly `payment.captured`,
`payment.failed`, `refund.created`, `refund.processed`, `refund.failed`. The
existing merchant alert email was retained. No SMS challenge occurred.

After creation, all money, settlement/reconciliation, conversion/renewal,
review/Checkout UI, Test, capability, reminder-policy and advanced gates remain
closed. Existing access enforcement stays true. Counts remain 8 Auth users,
6 accounts, 5 organizations, 554 gym payments and 2 active cron jobs. Live
quotes/orders/payments/refunds/events/grants and offer approvals remain empty.
[Production health 36742907792](https://github.com/aarkay1805/UsefulDesk/actions/runs/36742907792)
passed. This establishes intake configuration and signature refusal, not actual
signed provider delivery or a genuine Live SaaS payment/refund. Those acceptance
gates, issuer determination and separately reviewed financial opening remain
before payable rollout. See the [intake scope and rollback](subscription-live-intake-proposal.md).
