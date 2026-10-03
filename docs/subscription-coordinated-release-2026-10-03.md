# Coordinated billing release — 3 October 2026

**Approved closed release deployed on 3 October.** Canonical Production serves
`c9da8c4721221472a5f16ac623dd9b3902253285`; its application source is the reviewed
`3ff4f3071e777b27b85ebd979f3db29232116c16`. The exact unseeded renewal migration
is installed as `20261003070856`, with its hard closure intact. The sections below
preserve the original approval packet and preflight observations. Actual execution
is recorded in the [release receipt](subscription-coordinated-release-execution-2026-10-03.md).
All five implementations are published; real reminder delivery, genuine provider
redelivery and customer renewal opening remain separate unfinished acceptance.

## Accepted preparation

A fresh locked install passed `npm run verify`: lint, typecheck, **4,433 tests
in 539 files**, and the Next production build. The existing 20-source renewal
manifest matches every current file; its SHA-256 remains
`c0727bf30b2d21184ec477a8b90eb1b321e57628db8f5065a1e06d5143282151`.

Only Billing Staging `otagotpezshybxkagtwv` was restored. It began with zero
users, accounts, organizations and payments, inactive cron jobs and closed
billing gates. Exact renewal and preparation sources were connector-applied
as `20261003034637` and `20261003034645`. Their history statement MD5 values
match the full local source bytes; source SHA-256 values appear below.
Existing Production lead/invoice deltas were subsequently installed in Staging
for baseline parity. Preparation and affected lead/invoice function hashes
match Production, including the three private preparation guards.

The composed renewal and preparation rollback assertions passed through the
approved cloud connector. This includes expiry-only renewal, quote replay,
roles/tenancy, order claims/recovery, held captures, original history and
preparation source checks. The cloud run was sequential; the previously
accepted local independent-session concurrency tests remain the concurrency
evidence. No cloud concurrency result is inferred.

Four further tests used actual Staging Auth password sessions and PostgREST:
owner access, branch-admin/staff/outsider denial, cross-tenant isolation,
private-ledger/service-RPC denial, active-term/wrong-branch refusal and one
expired synthetic renewal. The actual Live webhook handler rejected bad HMAC
and wrong merchant, settled a signed synthetic capture once, and separated an
unrelated gym event. Route headers/cookies supplied the test request context;
Auth verification and SQL/RPC writes used the real isolated cloud service.
Every provider GET was answered by a synthetic fixture and every other external
network request was blocked. This proves app routing and database boundaries;
it proves neither a deployed cloud callback nor genuine provider delivery.

The coordinator separately inspected the final connector result
`routing_acceptance=pass`: one exact term, one calendar month from its start,
one renewal event and no unrelated gym event in the SaaS ledger. The archived
bridge helper checks SQL errors but does not itself assert that returned value;
this result is recorded as an operator assertion in the evidence JSON.

The accepted harness is retained with formatting only at
`scripts/acceptance/billing-release-cloud.acceptance.mjs`. The original executed
source SHA-256 is
`ec335dd374211fb3dc7e910f59aa76fe9e2d829e1cda2dc4326659a662586561`;
the retained formatted file SHA-256 is
`63e4d7e3e5e18bfb3f0c9bd571b817a7486df8ce053844531db4197ef9975bbc`.
The evidence JSON also records the formatted archive hash and verifies identical
normalized emitted JavaScript after formatting. Its explicit config uses relative repository
paths. It is an operator
acceptance artifact, excluded from normal test discovery. See its adjacent
README before any rerun: it needs disposable fixtures and an approved SQL bridge.

All disposable rows were removed, original settings and 12 historical synthetic
access-audit rows restored, and the hard `CHECK (NOT renewals_enabled)`
constraint reinstated. **All 180 public/private/Auth table counts exactly match
the pre-run baseline.** Both new private tables have RLS and service-role
SELECT only. Final readback at 04:16:48 UTC shows no customers, payments, work
rows, renewal releases or active cron jobs. Staging returned to `INACTIVE`;
temporary Stage credentials, Auth sessions and the Production environment
export were removed. Other paused projects were untouched.

The [machine-readable evidence](subscription-coordinated-release-evidence-2026-10-03.json)
contains dated counts, schema history, function hashes, closure and Production
preservation fingerprints. Counts/fingerprints are drift checks, not backups.

## Original Production preflight and exact delta

One fresh independent final review found no outstanding Critical, Important or
Minor finding after the evidence labels and historical pending entries were
clarified. It reviewed the integrated release order and read-only preservation
helper; the unperformed external/provider/deployment actions below remain
outside accepted execution evidence.

At the original preflight, Production was `fwqthstqrkrwtaehefks`. Vercel project
`prj_kn3FOeuAZkeAyCeA5lbBhsHHECne` uses GitHub `UsefulDesk`,
Production branch `main`, Node 24.x and region `sin1`. The current READY
deployment is `dpl_FXH8yD2mBgA2qmHdNgjQ6LMhPpJE`, source
`c74faf9384972d6b36642195e6aec77690e2253b`. A main push invokes CI and
Vercel publication; do not push it to make backup code available first.

| Source                                              | Actual Production disposition                                                             | SHA-256                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `20261002170000_starter_live_customer_renewals.sql` | **Only missing closed migration; apply once before the app**                              | `5b7f667eaa1f6667a3d9d9cd52168a8c1358fc725377c6679e78b40b969660ae` |
| `20261003003000_starter_signup_preparation.sql`     | Already installed as `20261002193254`; verified function parity, do not replay as missing | `7bc301a2d07015fced3b2f4b8549fe9c0a1635ac9bad39e5b81dc735abff7f71` |

Reminder repairs and the seven-bucket exporter need app/source publication,
not another Production migration. Preserve applied invoice migrations
`20261002174706` and `20261002181249`, and lead listing `20261002160135`.

Read-only Production checks at 04:16–04:19 UTC captured 33 relation fingerprints.
The prospective policy exists with **zero selections and zero preparation work
at this observation**. Justin's active Old Ambala setup, three approved Standard
prices and unsuspended version-5 paid access through
`2026-11-02T12:24:56Z` remain recorded. Both original PDFs still match their
durable hashes; Gmail SENT remains recorded, reading unproven. No repeat send.

The customer-checkout environment audit has **0 blockers and 13 warnings**.
Protected secrets are provider-hidden, so their values/formats were not verified.
Existing checkout/scope/UI, signed intake/settlement, financial recovery,
delivery evidence and native cron configuration remain enabled. Original
initiation/refund flags are false. Both renewal server/UI switches are absent.
The existing database customer scope still permits its first-sale
quote/order path; global internal initiation/refunds/renewals remain closed.
The closed release changes none of these switches. Do not globally disable
settlement or recovery to represent an additive installation as closed.

## Approved execution sequence (original packet)

1. Recheck remote/main, sole writer ownership, deployment, flags, source hashes,
   current customer binding and before-change fingerprints. Abort on unexpected
   source/configuration drift; preserve the dirty independent primary checkout.
2. Publish one immutable backup-source tag,
   `billing-release-2026-10-03-3ff4f307`, pointing to exact code
   `3ff4f3071e777b27b85ebd979f3db29232116c16`. No task branch/PR is needed.
   Run `production-backup.yml` at that tag with `include_storage=true`.
   GitHub's [dispatch API accepts a tag ref](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
   The workflow already exists on default main and checks out the selected ref.
   CI triggers only on main branch pushes; this repo has no tag deployment
   workflow. Vercel's [tag deployment guide](https://vercel.com/kb/guide/can-you-deploy-based-on-tags-releases-on-vercel)
   uses an additional explicit deployment workflow. From these configuration
   facts, the backup tag is expected to leave Production on c74faf93; verify that
   deployment/alias state immediately after publication and stop if it differs.
3. Require a successful **fresh database plus corrected seven-bucket encrypted
   R2 backup at the exact tagged SHA**. Inspect runner output, archive keys,
   remote sizes and checksum records. Check coverage against current Storage
   inventory, including private `invoice-documents` and `expense-receipts`.
   The last read-only inventory was 49 objects / 2,838,714 bytes; current counts
   may legitimately change. Older five-bucket successes omit five invoice PDFs
   and cannot substitute. Verify usable decryption with the existing
   owner-controlled replacement age identity and archive/internal checksums
   before mutation. If vault access or backup verification is unavailable,
   stop here. Do not rotate keys, change retention, restore Production or copy
   real customer data into Staging under this approval.
4. Apply only the exact unseeded renewal source through the approved Supabase
   migration tool. Never `supabase db push`. Read back history/source, RLS/ACLs,
   SECURITY DEFINER empty search paths, closed constraint and zero release rows.
   Re-run the connector-tested
   `scripts/subscription-coordinated-release-preservation.sql` before and after
   installation. It normalizes only the additive scope
   `renewals_enabled=false`/`renewal_release_id=null` and quote
   `renewal_release_id=null` fields before comparing existing whole-row hashes.
   Every pre-existing value, row count, document hash and paid term must match.
5. Publish the reviewed local main commit containing this packet by ordinary
   fast-forward push, after schema verification. Require complete main CI and
   a READY Vercel deployment whose source SHA is that exact pushed commit.
   Confirm canonical alias, expected flags, region and read-only owner/admin
   surfaces. No customer acceptance or purchase is simulated in Production.
6. Run `production-backup.yml` on new main with `include_storage=true` again
   and verify the post-install encrypted archive. Inspect natural native
   ops/renewal worker executions and read-only monitors; configuration alone
   is not execution or alert evidence. Record exact commits, deployment,
   migration version, backup objects and post-deploy preservation.

The previous successful database run is
[37079625861](https://github.com/aarkay1805/UsefulDesk/actions/runs/37079625861)
at 23:58:53 UTC on 2 October. It is dated fallback evidence, not this release's
fresh seven-bucket prerequisite. Historical restore drills and replacement
identity constraints are in [backups.md](backups.md); a newly completed full
database restore drill is not claimed.

## Failure and rollback

Before main publication, any migration/preservation failure stops publication.
Keep signed intake/settlement and existing recovery available. Do not erase
money, grants, immutable documents, release evidence or migration history.
A failed closed migration should transactionally abort; inspect actual state.

After publication, first contain only newly introduced initiation if needed
(the renewal switches already remain off). Roll back the app to the verified
previous READY deployment c74faf93 using the existing Vercel rollback path,
then recheck existing checkout, paid access and financial recovery. Retain the
additive closed schema; neither a down migration nor database/Storage restore
is authorized by this packet. Reconcile actual provider obligations through
the existing recovery runbook rather than replaying a create or refund.

## Remaining human/customer actions

Genuine WhatsApp acceptance still needs Rajat's selected connected branch,
staff-controlled recipient name/number and actual membership/service, then the
rendered exact-message approval and genuine delivered/read evidence. Justin's
WhatsApp stays deferred. Authentic duplicate/mixed provider redelivery was
human-skipped and remains unproven. A renewal opening still needs those scoped
release prerequisites and explicit authority before Justin's 2 November expiry;
the approved behavior remains owner-initiated after expiry, ₹799/calendar month.

Actual future gyms require per-customer setup/commercial review, owner approval
and verified payment. Hosting usage should be refreshed on 8 October and the
retained Free/Nano acceptance expires on 13 October. No hosting purchase,
upgrade, refund, customer send, native Checkout or gate opening is part of the
proposed closed release.
