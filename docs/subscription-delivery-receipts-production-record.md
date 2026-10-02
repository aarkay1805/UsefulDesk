# Starter delivery receipts — Production release, 2 October 2026

Scope: future completed Live webhook delivery evidence for Starter web rollout.
This release preserves the original internal pilot's recovery and does not open
customer payment initiation, tier capabilities, renewals or native Checkout.

## Source, backup and installation

- [PR #29](https://github.com/aarkay1805/UsefulDesk/pull/29) merged as
  `1e5a33f287cf949875dc4290f9deb28041bc732b`. PR CI, CodeQL and Preview passed;
  local required verification passed lint, TypeScript, 4,315 tests and the
  137-page optimized build. Exact merged-source CI
  [36956583003](https://github.com/aarkay1805/UsefulDesk/actions/runs/36956583003)
  and CodeQL passed before activation.
- [Backup run 36956202457](https://github.com/aarkay1805/UsefulDesk/actions/runs/36956202457)
  succeeded at **02:40:04 UTC**. Encrypted database and full Storage archives and
  checksum sidecars were uploaded and remote sizes verified before migration.
  Archive timestamp is `2026-10-02T02-34-47Z`; Storage contains 44 objects,
  2,737,820 bytes, across five buckets. This verifies upload, not a restore drill.
- Production project `fwqthstqrkrwtaehefks` received
  `20261002023000_subscription_live_delivery_receipts.sql` through the approved
  connector as history **20261002024027**. Source SHA-256:
  `2ba1a27f89685e50c1b581c087f9765070cdefce26bdc7053f8e41a2a17c0ec4`.
- At **02:40:37 UTC**, receipts were zero, RLS enabled, all 14 constraints and
  the append-only trigger present. Browsers have no table access or RPC execute;
  service has SELECT and RPC execute, no direct INSERT/UPDATE/DELETE/TRUNCATE.
  Both functions are postgres-owned definers with empty search paths. Installed
  function fingerprints and constraint definitions match isolated Billing Staging.

## Preservation

The **02:39:06 UTC** baseline and **02:40:36 UTC** post-installation snapshot
and **02:49:00 UTC** post-activation snapshot match: one original
quote/order/payment/refund/grant/offer/refund review, three
events, 554 gym payments, zero recovery queue items/exceptions. The original
merchant, listener organization and opening review remain bound. Intake and
settlement remain enabled; quotes/orders/refunds/conversion/renewals, Test,
capabilities and advanced payments/commercial approval remain disabled.

Fresh before/after aggregate fingerprints (drift checks, not backups):

| Scope          | Fingerprint                        |
| -------------- | ---------------------------------- |
| Access         | `712b7445f3ebd4b26b3ed9d60e8674ed` |
| Accounts       | `4e9261d4fe6dad606691c2a8458199f8` |
| Organizations  | `811505278063f66b442dbf7fdb6844eb` |
| Legal entities | `5e5ef2ddb79af1816cb905381bc95dbf` |

These compare this release's fresh snapshots; historical fingerprints in the
original opening record are separate dated observations.

## Activation and authentic evidence

The disabled exact-source deployment `dpl_HoH4Yv5qmCKA9hBiP5MJoPHi4ud5` was
canonical after main CI passed at **02:44:50 UTC**. Only
`USEFULDESK_SAAS_LIVE_DELIVERY_EVIDENCE_ENABLED=true` was then added to Production
and the same source rebuilt. Enabled deployment
`dpl_3JCvxyoykucMAixZGyXAg2cQcE41` became READY/PROMOTED at
**02:47:58.756 UTC**, with `desk.usefulmade.com` assigned and the same exact
merged SHA. The recovery-only exported-environment audit verifies literal true
for the evidence flag and **zero blockers / 11 warnings**; protected-value,
database/offer, natural execution and provider-acceptance warnings remain
separate from this audit. No other runtime flag was changed.

The canonical login returned HTTP 200. Initial enabled-deployment error-level
and HTTP 5xx scans through **02:48:48 UTC** returned no rows. The **02:49 UTC**
database check found zero receipts and unchanged RLS/grants and preservation
fingerprints. These are bounded startup checks, not sustained runtime or actual
signed-delivery acceptance. Primary ops at 02:38 and renewals at 02:41 returned
HTTP 200 / zero failed workers before the enabled deployment.

Contain collection by closing the evidence flag and rebuilding; preserve the
receipts and original signed intake/settlement/recovery. The original 28-source
opening manifest remains historical and unchanged.

The provider dashboard was refreshed at **02:39 UTC**, selecting 25 September
through 2 October. It still shows only the original capture and two refund
deliveries, all HTTP 200. No authentic same-event repeat or mixed gym/SaaS
delivery has arrived. No provider redelivery, synthetic Production fixture,
payment/refund or message was initiated for this evidence release.

Receipts require natural traffic after activation; none are backfilled. Repeated
provider IDs/body hashes remain private review candidates, and unrelated receipts
alone do not establish gym routing. Inspect aggregates using
`scripts/subscription-live-delivery-evidence.sql` and correlate real provider
response/ingress/ledger evidence. Genuine customer scope/opening, authorized
reminder delivery and independent owner paging remain pending as described in
[current rollout actions](subscription-starter-rollout-next.md).
