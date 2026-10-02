# Starter customer checkout — closed Production release, 2 October 2026

Scope: install and deploy the default-closed customer implementation from
[PR #31](https://github.com/aarkay1805/UsefulDesk/pull/31). This release creates no
customer commercial authority, changes no tenant facts and enables no customer
initiation, refund, UI or capabilities.

## Reviewed source and backup

- Reviewed head: `15593b4770073185cca5f80ca1651918bf570988`; squash merge:
  `930495b203cb62eb32d2ba4babfeb11604d1185e`. The merged tree exactly matches
  the reviewed head. PR CI, CodeQL and Preview passed; fresh source review found
  no closed-release blocker. Local original-pilot/capability/customer replay and
  rollback acceptance passed again before installation.
- The [28-file review manifest](subscription-starter-customer-release-manifest.tsv)
  freezes PR #31's changed files at that reviewed implementation, including its
  then-current documentation. Manifest SHA-256:
  `71cc658460944fa2dece2b314defec59fdbba600ed892861ce6f5cb2a04f8b40`.
  Later release-record documentation changes do not revise this historical manifest
  or the original internal-pilot opening manifest.
- Exact migration:
  `20261002080000_starter_customer_checkout_scope.sql`, SHA-256
  `cae7b505f06ad741eacd0733b3edbb470f7a55a33d592a243f5747a993c1c70c`.
  Billing Staging's accepted final history is `20261002083552`; its fresh
  **08:59:32 UTC** check again found zero users, organizations, reviews, scopes,
  quotes, orders and payments.
- [Full backup 36986931966](https://github.com/aarkay1805/UsefulDesk/actions/runs/36986931966)
  succeeded at **09:03:08 UTC**, before installation. Encrypted database and
  Storage archives plus checksum sidecars were uploaded and remotely size-verified:
  `database/2026/10/database-2026-10-02T08-57-48Z.tar.gz.age` and
  `storage/2026/10/storage-2026-10-02T08-57-48Z.tar.gz.age`.
  Storage contains 44 objects, 2,737,820 bytes, across five buckets. This is
  fresh backup/upload evidence, not a new restore drill. The replacement encryption
  identity and owner-accepted single-vault recovery limitation remain as recorded
  in [the backup runbook](backups.md).

## Installation and preservation

The approved Supabase connector installed the exact source in Production
`fwqthstqrkrwtaehefks` as history **20261002090428**. Before installation, both
customer tables were absent. At **09:04:46 UTC**, both were empty; the original
quote's new nullable customer-review field was NULL. RLS, 25 constraints, four
enabled triggers and three false/nonnullable initiation defaults match Staging.
Browsers have no table privileges; service has SELECT and no direct DML/TRUNCATE.
All 29 changed function definitions, execution grants, postgres ownership and
empty definer search paths match accepted Staging. The other 68 subscription
functions retain their definitions, ACLs, ownership and search paths.

Fresh **09:04:20 UTC** pre-install and **09:04:46 UTC** post-install counts and
whole-row fingerprints match across all 22 relations below. Checks include the
original merchant/listener/opening review, offer, quote/order/payment/refund/grant
and event history, access, tenant/legal facts and gym invoice/payment rows.
Intake/settlement remain on; quote/order/refund initiation, conversion, renewals,
Test, capabilities and advanced commercial/payments gates remain off.
Justin's existing trial, AED branch and legal facts are preserved.

Run [the read-only preservation query](../scripts/subscription-starter-customer-preservation.sql)
through the approved connector to repeat this comparison. Hashes use sorted
whole-row JSONB text; only the additive `customer_review_id` key is excluded
from old quote fingerprints so a NULL schema extension can be compared fairly.
These are drift checks, not backups or provider/commercial acceptance.

| Relation                                          | Rows | Before/after fingerprint           |
| ------------------------------------------------- | ---: | ---------------------------------- |
| `private.organization_product_access`             |    6 | `6acb6713966aa8b71baedaf61617e6fa` |
| `private.subscription_billing_settings`           |    1 | `729cd9bc51305f245078a793d2433f56` |
| `private.subscription_live_delivery_receipts`     |    0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `private.subscription_live_grants`                |    1 | `c9fee2201d0bf90e11cb37acb70e6b96` |
| `private.subscription_live_offer_approvals`       |    1 | `cec469846e3ad26a35d089a8985bf0f6` |
| `private.subscription_live_orders`                |    1 | `396cc37e1c4bf0b3700ae368c26556b2` |
| `private.subscription_live_payments`              |    1 | `97f03b9536a088b31702519f3e76510a` |
| `private.subscription_live_pilot_opening_reviews` |    1 | `d6f1f1d6fd9bf48f9140a91c525aafaf` |
| `private.subscription_live_quotes`                |    1 | `49e3595ba7fbe4b1cf36ac4158cf4297` |
| `private.subscription_live_recovery_exceptions`   |    0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `private.subscription_live_recovery_queue`        |    0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `private.subscription_live_recovery_reviews`      |    0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `private.subscription_live_refund_reviews`        |    1 | `5f10fd7e5ac68c746d01755adaf6bb76` |
| `private.subscription_live_refunds`               |    1 | `1879d45a930188a1e4e0b87ac0ff50cf` |
| `private.subscription_live_settings`              |    1 | `85635bb5dea615c2da7e49115aa61c72` |
| `private.subscription_live_webhook_events`        |    3 | `d594855ef39715f0d8360ec7bd5bf660` |
| `public.accounts`                                 |    7 | `f5d16a01b9c96f8f7de8c71846b808b5` |
| `public.invoices`                                 |  563 | `3b1b22d27834ac98330c0da7bbd93235` |
| `public.legal_entities`                           |    6 | `0a8fc1e2a21a2aefb323f2aabd3b957b` |
| `public.memberships`                              |    0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `public.organizations`                            |    6 | `7e6d83161688766c27a0b3fd115d55a0` |
| `public.payments`                                 |  554 | `c630ea027229802e36f10fbcfcf54af5` |

## Runtime and release acceptance

[Merged-source CI 36987745795](https://github.com/aarkay1805/UsefulDesk/actions/runs/36987745795)
passed at **09:11:15 UTC**: formatting, lint, TypeScript, 4,340 tests in 529
files and the 137-page Production build. Merged-source CodeQL also passed.
Vercel held the ready build until CI succeeded; canonical
`desk.usefulmade.com` then resolved to **`dpl_m6uiUuVstikocsJueXpuMQU6HYNC`**,
Production/main SHA `930495b203cb62eb32d2ba4babfeb11604d1185e`, confirmed at
**09:13 UTC**. No runtime environment variable was changed.

Before and after deployment, the private exported-environment recovery-only audit
passed with **zero blockers / 11 warnings**. All four new customer switches are
absent/false, existing original quote/order/refund/UI switches remain closed,
and original intake/settlement/refund reconciliation/financial recovery plus
receipt collection remain enabled. Provider-hidden secrets, natural scheduler
execution and commercial/provider-acceptance warnings are separate evidence
limitations; an environment audit does not resolve them. Temporary private
exports were removed.

At **09:13:17 UTC**, the canonical login returned HTTP 200; empty POSTs to the
quote, order and refund initiation routes returned HTTP 404 at the closed gate,
before Auth/database/provider handling. These probes created no fixture or
provider financial call. The **09:13:07 UTC** post-release snapshot still matches
all 22 preserved relations. Error/fatal and HTTP 5xx log scans scoped to the new
deployment through **09:13:37 UTC** returned no rows. These are bounded startup
checks, not sustained runtime, authentic delivery or customer opening acceptance.
The last read-only primary worker baseline had ops **08:53** and renewals
**08:41 UTC**, both HTTP 200 with zero failed workers.

[Post-install full backup 36988101301](https://github.com/aarkay1805/UsefulDesk/actions/runs/36988101301)
succeeded at **09:15:44 UTC**, remotely verifying the database/Storage archives
and checksum sidecars for timestamp `2026-10-02T09-09-55Z`. Its Storage snapshot
again contains 44 objects and 2,737,820 bytes across five buckets. It captures the
installed closed schema; this upload check is not a restore drill.

## Containment and separate customer review

With no customer orders or scopes, keep all four new switches absent/false:
`USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED`,
`USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED`,
`USEFULDESK_SAAS_LIVE_CUSTOMER_REFUNDS_ENABLED` and
`NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI`.
Preserve original signed intake, settlement, financial/refund reconciliation and
receipt collection. Revert the application to the prior known-good deployment
`dpl_bG47ueynfNRitE3qb8BvbTX8TiR8` (main `5936e11b36b385881afdc7a0486a715fb1d11887`)
if this closed source breaks existing recovery; retain the additive schema and
immutable evidence. Do not drop customer/history tables or restore Production
merely to test rollback. Investigate any unexpected authority rows, gate drift,
original/gym financial/access fingerprint change or new recovery runtime failure
before opening customer initiation.

After a separately approved customer order exists, retain its customer scope
support and history while closing initiation/refund/UI gates independently.
The original pilot must never be rebound. A genuine buyer, authentic geography,
issuer/PAN financial-year/document review, reminder delivery, repeat/mixed provider
acceptance and identified external watchdog remain separate pending dependencies.
No nonempty evidence reference or synthetic acceptance supplies those facts.
No provider POST, manufactured redelivery, synthetic Production fixture, message,
customer activation or commercial issuance was performed for this release.
