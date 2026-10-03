# Coordinated billing release — execution receipt

Rajat approved the concrete closed Production release and unlocked the existing
backup vault. The reviewed main commit `c9da8c4721221472a5f16ac623dd9b3902253285`
is now published at canonical `desk.usefulmade.com`. No customer renewal gate,
charge, refund, message or hosting purchase was part of this execution.

## Publication and preserved state

- Immutable backup-source tag `billing-release-2026-10-03-3ff4f307` points to
  `3ff4f3071e777b27b85ebd979f3db29232116c16`. Its publication left the previous
  canonical deployment at `c74faf93`, as checked before schema mutation.
- Exact renewal source `20261002170000_starter_live_customer_renewals.sql`
  was connector-applied once as Production history **`20261003070856`**.
  Source SHA-256 is `5b7f667eaa1f6667a3d9d9cd52168a8c1358fc725377c6679e78b40b969660ae`;
  history statement MD5 is `719d285af17cfaf22534cae656039b5c`. Existing preparation
  history `20261002193254` was preserved, with no replay.
- All **15** renewal function source bodies match, are SECURITY DEFINER with
  empty search paths, and deny anon execution. Release-table RLS, no policies,
  service-role SELECT only, zero release rows and validated
  `CHECK (NOT renewals_enabled)` passed. Scope renewals remain false and release
  references null; both server/UI renewal flags remain absent. Existing financial
  intake, settlement, recovery and first-sale scope authority remain intact.
- All **14** existing preparation/lead/invoice function definitions match the
  preflight. These hashes use `MD5(pg_get_functiondef(oid))`, not `MD5(prosrc)`.
- All **33** normalized existing relation counts and fingerprints match before
  migration, after migration and after deployment at **07:36:31.075871 UTC**.
  Normalization removes only the approved additive false/null renewal fields.
  Justin's ready setup, version-5 paid term through `2026-11-02T12:24:56Z`,
  original documents and recorded Gmail SENT remain preserved.
- Ordinary main push passed lint, typecheck, **4,433 tests / 539 files** and build.
  [Main CI 37105658850](https://github.com/aarkay1805/UsefulDesk/actions/runs/37105658850)
  completed successfully at **07:19:56 UTC**. Canonical alias readback at 07:21 UTC
  is READY `dpl_9h5rJB2RUVmiisRJA9Kwzf69drJV`, exact `c9da8c47`, region `sin1`.

## Fresh encrypted backups and usable decryption

Both full runs exported **49 objects / 2,838,714 bytes across seven buckets**:
avatars 5, chat-media 12, member-import-drafts 27, invoice-documents 5; expense-
receipts, flow-media and payment-receipts were empty. Invoice Storage bytes are
100,894. Empty bucket coverage comes from the exact exporter and successful
seven-bucket runner; manifest v2 records objects, not empty-bucket rows.

| Run                                                                                           | Source                  | Archive timestamp UTC  | Completed UTC |
| --------------------------------------------------------------------------------------------- | ----------------------- | ---------------------- | ------------- |
| [Pre-release 37100313050](https://github.com/aarkay1805/UsefulDesk/actions/runs/37100313050)  | exact tagged `3ff4f307` | `2026-10-03T05-36-32Z` | 05:41:19      |
| [Post-release 37106078530](https://github.com/aarkay1805/UsefulDesk/actions/runs/37106078530) | exact main `c9da8c47`   | `2026-10-03T07-22-44Z` | 07:27:11      |

The private Standard R2 bucket `usefuldesk-backups` has public access Disabled.
Each runner verified remote archive/checksum sizes. The four files from each run
were then downloaded independently from R2; matching SHA-256 checksum records
passed. Existing vault identity derived the configured public recipient and
actually decrypted both database and Storage archives. Internal roles/schema/data
checksums and every Storage object's length/hash passed. The post-install schema
contains the closed renewal table and constraint.

| Archive       | Encrypted bytes | SHA-256                                                            |
| ------------- | --------------- | ------------------------------------------------------------------ |
| Pre database  | 1,021,052       | `1226213b98e0f3672f1f9e39b9d0c2703dc6dff53781a4b5b9a85e435ac78992` |
| Pre Storage   | 1,517,155       | `1ac5c78b5b05b3a57a24d75d72a7117628d71c79fd2273af8c0d12786e41c36e` |
| Post database | 1,022,610       | `caef6118780e5512d5e686ef1d84513ecc11e731d9cade64ba4ebeab2021ea30` |
| Post Storage  | 1,517,090       | `27d2c0c5b2862bcb1398ffe826fd45b5c05109388f071a475066b10af57e8676` |

Object keys are `database/2026/10/database-<timestamp>.tar.gz.age` and
`storage/2026/10/storage-<timestamp>.tar.gz.age`, each with its `.sha256` sibling.
Justin's SaaS PDF originals were verified from the private database bytea ledger,
separately from gym Storage PDFs: invoice 23,001 bytes / `af40c3f8f8d2e4d56443ba6ce786f9ae3a017502c849d2a807c7c4110bbb6198`,
receipt 23,134 bytes / `ec45b5b49bf6eb9d07452bee247e1b18c54f1fa8ec68a8eaf1a2618e06c82965`.
Both runs contain those exact originals. Plaintext scratch archives and the
temporary mode-600 identity were removed; post-run verification decrypted only
into memory. Passwords is locked. No key rotation, retention change, Production
restore or real-data copy to Staging occurred. The last full disposable restore
drill remains 23 August; usable decryption does not substitute for a fresh restore.

## Deployed surfaces and health

The existing Rajat OWNER Home office session loaded the deployed billing drawer
and correctly retained the prior refunded/cancelled status with no automatic debit.
The MFA platform-admin page loaded the empty new-gym preparation queue and showed
Justin Active. No owner impersonation, purchase, saved preparation or customer
acceptance was simulated. Read-only local screenshots are retained with execution
scratch; the Justin owner session itself was not exercised.

At 07:25–07:27 UTC, StatusCake public `8032323` and worker `8032327` remained
active at 300 seconds with Healthy → Ongoing history. Notification test `8032326`
remained paused. Original 2 October 13:42:41 UTC Gmail alert remains the channel
acceptance; no new alert was sent. The c9 runtime error/fatal scan from 07:20–07:36
UTC returned zero groups. Natural native ops at **07:33:23 UTC** dispatched 10
workers, failed 0; natural native renewals at **07:35:12 UTC** dispatched 3, failed 0. Both ran on the exact c9 deployment and every fixed worker returned HTTP 200.
No cron was manually dispatched. The separate primary watchdog at 07:35:03 UTC
showed active ops (latest 07:23:00, 10/0) and renewals (latest 06:41:00, 3/0),
HTTP 200 with no timeouts, within their existing freshness limits. These are
bounded execution/monitor observations, not genuine customer message delivery.

The [machine-readable evidence](subscription-coordinated-release-evidence-2026-10-03.json)
keeps original preparation facts separate from the dated `execution` object.

## Remaining actions

Renewal opening is still separately gated. Genuine WhatsApp acceptance needs
Rajat's actual connected branch, staff-controlled recipient/number and existing
membership/service, then exact-message approval and genuine delivered/read evidence.
Justin WhatsApp remains deferred. Authentic duplicate/mixed provider redelivery
remains human-skipped and unproven. Before Justin's 2 November expiry, finish the
scoped release prerequisites and authorize opening; owner initiation stays expiry-only
at ₹799/calendar month. Future gyms require their actual setup/commercial review,
owner approval and verified payment.

Rajat owns the 8 October usage refresh and hosting decision by the unchanged
13 October Free/Nano deadline. No upgrade was purchased. The independent primary remains on `codex/invoice-profile-error-copy` at
`c74faf93`, with its modified `supabase/.temp/cli-latest` and untracked
`docs/Settings Navigation Audit.html` preserved. Main cannot safely be restored
there while it is dirty. The finite coordination heartbeat is verified PAUSED. This receipt records actual deployment
`c9da8c47`; a later local documentation commit does not imply another deployment.
