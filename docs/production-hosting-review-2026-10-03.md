# Production hosting review — 3 October 2026

**Conclusion:** the existing Production project is healthy within the narrow paid
Starter pilot, but its recovery review found a real Storage coverage gap. The
exporter now includes gym invoice PDFs and expense receipts; local export/restore
acceptance passes. The corrected exporter has **not** run in GitHub/R2 yet.
The early review trigger is also met: published upcoming log ingestion is at 60%
of its Free allowance. No enforced usage quota is at 50%, no Production pause or
failed backup was observed, and no capacity failure appeared in the checked health
window. These observations are not a forecast or a new hosting acceptance.

Rajat's existing temporary Free acceptance still ends **13 October 2026**. This
review does not extend it or authorize a purchase. Step 4's implementation is
complete at `ca4da6f5`; genuine WhatsApp delivery remains pending recipient/subject
selection and exact-message approval. Rajat directly requested this review on
3 October while that item remains pending.

## Current project and usage evidence

Read-only connector and signed-in dashboard checks ran from approximately
03:06–03:20 UTC (08:36–08:50 IST). Production is UsefulDesk
`fwqthstqrkrwtaehefks`, Singapore, `ACTIVE_HEALTHY`, on organization
`faupslcsefqjmlirbfyg` / Free / Nano. Billing Staging, Razorpay Test and the older
ekhata project remain `INACTIVE`; none was restored or changed.

The dashboard billing period is **8 September–8 October 2026**. Organization totals
include earlier staging/Test usage. Project-filtered values are reported separately
because most usage quotas are shared by the organization; database size is per
project. The dashboard warns that usage can lag by one hour and MAU by 24 hours.

| Metric                    | Organization / Free allowance     | Production project                       | Early review |
| ------------------------- | --------------------------------- | ---------------------------------------- | ------------ |
| Database size             | 0.068 / 0.5 GB (14%, per project) | Same quota display; size detail 65.02 MB | Below 50%    |
| Uncached egress           | 0.291 / 5 GB (6%)                 | 0.290 GB                                 | Below 50%    |
| Cached egress             | 0.024 / 5 GB                      | 0.024 GB                                 | Below 50%    |
| Storage                   | 0.003 / 1 GB                      | 0.003 GB                                 | Below 50%    |
| Monthly active users      | 14 / 50,000                       | 8                                        | Below 50%    |
| Peak Realtime connections | 8 / 200                           | 7                                        | Below 50%    |
| Realtime messages         | 4,780 / 2,000,000                 | 4,776                                    | Below 50%    |
| Edge Function invocations | 0 / 500,000                       | 0                                        | Below 50%    |
| Upcoming log ingestion    | **0.603 / 1 GB (60%)**            | 0.581 GB                                 | **Reached**  |
| Upcoming log query        | 19.308 / 100 GB (19%)             | 19.272 GB                                | Below 50%    |

The [actual usage dashboard](https://supabase.com/dashboard/org/faupslcsefqjmlirbfyg/usage)
reported no exceeded Free quota. Current official [log-ingest documentation](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest)
and [log-query documentation](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query)
describe a grace period through the start of 2027. The 60% finding therefore triggers
the owner's **review** rule without establishing a present billing charge or
restriction. Do not disable audit logs to suppress this metric. Current Postgres
logging is `ddl`, duration logging disabled, message level `warning`, and connection
and disconnection logging off; the source of total service log volume was not
attributed by this review.

At 03:10:37.441055 UTC, the read-only database check returned 52,907,155 bytes,
23 database connections / `max_connections=60`, and 49 Storage objects totaling
2,838,714 bytes. The live database value and lagged quota display are distinct
observations; use the provider quota display for its threshold. The project overview
showed CPU 5%, disk 18%, RAM 61%, and 21/60 connections in its earlier snapshot.
Resource utilization is not a published monthly usage quota or a load test.

## Health, schedules and independent monitoring

- Vercel's canonical `desk.usefulmade.com` resolves to READY Production
  `dpl_FXH8yD2mBgA2qmHdNgjQ6LMhPpJE`, deployed `c74faf93` in `sin1`.
  It does not include local billing steps 1, 3 or 4. Public login returned HTTP 200
  in 0.96 seconds. Supabase's 07:40–08:38 IST dashboard window showed 689 requests,
  100% success and zero listed warnings/errors; this is a bounded observation,
  not proof that every customer action succeeds.
- At 03:10:37 UTC, the service-only watchdog snapshot showed active primary ops
  with HTTP 200 at 03:08:00 UTC, dispatched 10 / failed 0, and active primary
  renewals with HTTP 200 at 02:41:00 UTC, dispatched 3 / failed 0. Neither timed out.
  Both fit the existing 45-/120-minute freshness limits.
- [GitHub health 37088449414](https://github.com/aarkay1805/UsefulDesk/actions/runs/37088449414)
  passed at 02:03:59 UTC. Redundant
  [ops 37084770936](https://github.com/aarkay1805/UsefulDesk/actions/runs/37084770936)
  last started successfully at 01:05:57 UTC and
  [renewals 37086177905](https://github.com/aarkay1805/UsefulDesk/actions/runs/37086177905)
  at 01:27:44 UTC. At 03:10:37 UTC ops was about 125 minutes old, beyond its
  non-blocking 75-minute limit; renewals was about 103 minutes old, within 120.
  Rajat retains the existing GitHub schedule-freshness exception. Primary health
  does not establish the native/GitHub backup schedules' cadence.
- A refreshed signed-in StatusCake read showed both production monitors active
  at 300-second intervals and 100% displayed uptime. Public monitor `8032323`
  was Healthy from 2 October 13:39 UTC → Ongoing, and worker `8032327` from
  13:53 UTC → Ongoing. Public history extended through approximately 3 October
  03:13 UTC and worker history through approximately 03:11 UTC.
  Test monitor `8032326` remains paused. The genuine owner alert receipt remains
  the dated 2 October 13:42:41 UTC evidence in [the watchdog record](production-watchdog.md);
  this review did not send a new alert or disclose the private worker URL.
- Fresh Security and Performance Advisors returned no ERROR groups. Existing
  search-path, extension placement, definer-grant, password-protection and RLS
  performance warnings remain scoped maintenance work. Absence of ERROR groups
  is not an assertion that all warnings are harmless. See the prior findings in
  [Production readiness](production-readiness.md).

The [25 September PostgreSQL upgrade notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)
is relevant to the observed Postgres 17.6 release. Read-only catalog detection at
03:14:36 UTC found zero ltree indexes, zero float GiST indexes, zero affected
custom-estimator operators, and zero authored public/private functions referencing
PGP encryption. Repository searches found no PGP encrypt/decrypt or legacy-cipher
options. This is no claim about externally imported encrypted values. Rajat owns
checking upgrade availability and arranging a separately reviewed maintenance
window; no restart, version upgrade or reindex was performed.

## Backup coverage and recovery limits

[Scheduled database backup 37079625861](https://github.com/aarkay1805/UsefulDesk/actions/runs/37079625861)
succeeded on 3 October at 05:28:53 IST (2 October 23:58:53 UTC). Its actual log
confirms the encrypted database archive verified in R2 at 23:58:49 UTC, with an
archive timestamp of 23:53:55 UTC. It was database-only. Every job step passed;
the Git checkout cleanup emitted an exit-128 warning without failing the run.
The latest eight inspected backup runs all succeeded.

The latest inspected full database/Storage run,
[37018637357](https://github.com/aarkay1805/UsefulDesk/actions/runs/37018637357),
verified at 2 October 14:22:52 UTC, exported **44 objects / 2,737,820 bytes /
five buckets**. The old fixed export list omitted `invoice-documents` and
`expense-receipts`. Current Production has five private gym invoice PDFs /
100,894 bytes in the former and zero objects in the latter. A successful older
five-bucket run therefore cannot establish current full Storage recovery.
This finding is about gym invoice artifacts, not evidence that Justin's immutable
SaaS document ledger was absent from database backups.

`scripts/export-supabase-storage.mjs` now covers all seven current buckets. The
default export/restore regression first failed for both omitted buckets, then
passed after the minimal list correction. A real **read-only** Production export
at **03:20:15.965 UTC (08:50:15 IST)** downloaded all 49 objects / 2,838,714 bytes,
including the five invoice PDFs, and independently rechecked every byte length
and SHA-256. Plaintext temporary files were deleted in `finally`; no remote write
or restore occurred. The empty expense bucket was successfully listed. Synthetic
restore acceptance verifies bytes and manifest metadata without changing Production.

The existing daily database / weekly Storage schedules, age recipient, private R2
destination and 35-day lifecycle are retained. These are recovery-point **targets**,
not strict 24-hour/seven-day bounds: GitHub's latest nominal 20:30 UTC database
schedule actually started at 23:52:51 UTC. Backup freshness health fails after
30 hours; the independent StatusCake checks cover primary workers, not backups.
The last disposable database/Storage restore drill remains **23 August**; next
quarterly drill is due **23 November 2026**. No new cloud restore, current R2
decryption drill or lifecycle recheck is claimed. The replacement identity's
single Apple Passwords vault and loss of the original pre-replacement identity
remain the explicitly accepted custody limitations in [the backup runbook](backups.md).

## Options, costs and owned next actions

Official Supabase pricing, backup and logs pages were checked on 3 October;
Context7 resolved `/supabase/supabase` and supplied separate quota/pausing and
backup/recovery documentation. Prices below are USD before taxes, usage and
currency-conversion charges. No purchase or spending-control change is authorized.

| Option                                                               | Supabase base cost              | Effect and decision                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue the current narrow Free pilot to 13 October                 | $0 additional                   | Existing temporary acceptance only; external backup and pause/capacity risk remain. Recheck the new billing cycle on 8 October and decide by 13 October.                                                                                  |
| **Recommended: Pro with one Micro Production project by 13 October** | **$25/month additional**        | $25 plan, $10 Micro compute offset by $10 credit. Avoid Free inactivity pausing, gain seven days of managed daily database backups and larger quotas. Retain the external Storage/R2 backup; do not restore paused projects incidentally. |
| Pro plus seven-day PITR on Small                                     | About $130/month Supabase total | $25 plan + $15 Small compute − $10 credit + about $100 PITR. Consider only if a shorter database recovery point is actually required; Storage objects still need separate backup.                                                         |

Sources: [Supabase pricing and compute credits](https://supabase.com/pricing),
[database backups and PITR](https://supabase.com/docs/guides/platform/backups).
Basic Pro daily backups do **not** turn the database recovery point into minutes.
PITR requires Small or larger compute and is a separate add-on.

Vercel remains Pro Active. The refreshed existing invoice `GQBCLHWV-0001` is Paid,
$23.60 paid / $0 due ($20 plan + $3.60 tax). Current displayed included usage is
$2.84 / $20; on-demand spend is $0 against the saved $20 alert budget, with project
pausing and webhook off. This is a spend snapshot, not a future bill estimate.
Keep Vercel and Supabase in place; a migration brings no demonstrated benefit
for this review and would require separate runtime/recovery acceptance.

| Next action                                                                                                           | Owner                    | Due / evidence required                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish the corrected exporter through the coordinated main release, then run Production backup with Storage included | Release operator / Rajat | Before treating the recovery gap as closed. Require a successful encrypted R2 database/Storage run covering seven buckets, invoice object count/bytes and the manifest. Local export acceptance alone is insufficient. |
| Recheck shared usage after the 8 October cycle reset                                                                  | Rajat                    | Preserve the 60% early-review finding; distinguish upcoming logs from currently enforced quotas. Do not forecast from the dated values.                                                                                |
| Choose Pro Micro or a new explicit bounded risk decision                                                              | Rajat                    | By 13 October; present the provider's final tax-inclusive amount before any purchase. Earlier pause, any published Free quota ≥50%, failed backup or paid-user capacity trouble requires immediate renewed review.     |
| Review GitHub redundancy and database upgrade maintenance                                                             | Rajat                    | Existing schedule-freshness exception remains open; use a fresh backup and scoped maintenance acceptance before a restart/upgrade.                                                                                     |
| Complete the quarterly disposable restore drill                                                                       | Rajat                    | By 23 November, including current invoice/expense buckets and the actual current encryption identity. Keep preserved evidence projects paused until explicitly needed.                                                 |

Local verification: 14 focused backup/freshness tests and all **4,433 tests** pass.
Lint, typecheck, touched-file formatting, relative documentation links and script
syntax checks pass. Independent read-only review found no remaining findings. No UI, database schema, billing gate, customer
message, payment, plan, monitor or Production configuration changed.
