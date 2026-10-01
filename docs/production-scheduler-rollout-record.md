# Production scheduler rollout — 1 October 2026

**Native scheduler acceptance is complete. Natural ops/renewals and timed scans passed.**
Supabase remains primary and GitHub redundant. Subscription initiation stays closed.
Independent paging and authentic duplicate/mixed provider delivery remain separate.

## Current functional release

PRs #22–#24 and #27 are merged. Final main
`e010c23c55c3ceb2c782c4d6904ca0abf031ccf3` passed
[CI 36897472192](https://github.com/aarkay1805/UsefulDesk/actions/runs/36897472192)
and [CodeQL 36897471806](https://github.com/aarkay1805/UsefulDesk/actions/runs/36897471806),
verified at 17:15:43 UTC. Canonical Production deployment
`dpl_AEhWSKnkKDuZu1xkgtbTjh9FUQ3k` is READY at **17:11:23.744 UTC**;
canonical metadata was observed at 17:14:33 UTC. Native dispatch remains
Production-only, authenticated with the reserved bearer secret, against the
explicit configured canonical origin `https://desk.usefulmade.com`.

- Natural **ops at 17:18:23.382 UTC:** HTTP 200, dispatched 10 / failed 0;
  all ten worker responses HTTP 200, with matching canonical request logs.
- **+10-minute scan at 17:22:23 UTC:** zero runtime error clusters and zero
  deployment HTTP 5xx responses, from READY through 17:22:00 UTC.
- Natural **renewals at 17:35:12.247 UTC:** HTTP 200, dispatched 3 / failed 0;
  all three worker responses HTTP 200, with matching canonical request logs.
- **+30-minute scan at 17:41:46 UTC:** zero runtime error clusters and zero
  deployment HTTP 5xx responses, from READY through 17:41:30 UTC.

There was no manual authenticated native worker invocation. Request counts,
disabled HTTP 200 and configuration are not execution or message-delivery proof.

## Reviewed source and disabled deployment

PR #22 merged after exact-head CI/security checks. Stacked PR #23 was retargeted
to main, updated and checked before merging. PR #24 adds the readiness validity/
cadence repair and redacted native outcomes. Its exact main `6a35e26d` passed
[CI 36889908975](https://github.com/aarkay1805/UsefulDesk/actions/runs/36889908975)
and [CodeQL 36889909653](https://github.com/aarkay1805/UsefulDesk/actions/runs/36889909653).
Canonical off release `dpl_94NgbzhQVyQhGzrg4idR64cYjfPN` returned both HTTP 200
disabled aggregates, dispatched 0 / failed 0, at 16:17 UTC. The earlier PR #23
off release passed the same canonical check at 15:54 UTC.

## Configuration, first failures and correction

The initial enabled `6a35e26d` rebuild
`dpl_BLSjneoZFgPn7jbc3gDLdsUwcckT` was READY/aliased at **16:19:37.354 UTC**.
`USEFULDESK_VERCEL_CRONS_ENABLED=true` applies only to Production. A new
reserved `CRON_SECRET` was provisioned privately; its original random 64-hex
value is retained with 0600 permissions. The existing worker credential and
encryption key were retained. Opaque protected exports cannot re-verify their
plaintext; the key retains the owner's original 30 September format attestation.
Production auditing had zero blockers and explicit protected-value/natural-proof
warnings. Enabled unauthenticated canonical routes return HTTP 401 without dispatch.

The initial +10-minute scan was clean at 16:29:42 UTC. However, natural ops at
**16:33:23 UTC** returned HTTP 503, dispatched 10 / failed 10; renewals at
**16:35:12.248 UTC** returned HTTP 503, dispatched 3 / failed 3. All worker statuses
were 0 (no HTTP response), while Supabase canonical dispatch was healthy.
Those failed attempts are retained and do not count as acceptance.

At 16:37 UTC, Production `NEXT_PUBLIC_SITE_URL` was explicitly written as
`https://desk.usefulmade.com`. The original protected Preview record was retained
separately, with no credential change. Next.js freezes this public setting at
build time, so the exact verified commit was rebuilt as
`dpl_6Ab5V91yTwyX7yH2xNP6mEeuu6on`, READY/aliased at **16:39:16.178 UTC**.
Natural ops then passed at **16:48:23 UTC** and **17:03:23.213 UTC**, each HTTP 200,
dispatched 10 / failed 0 / all worker HTTP 200. Its +10 scan at 16:49:55 UTC and
+30 scan at 17:10:18 UTC had zero runtime errors and HTTP 5xx. Final acceptance
restarts on the later functional release above, including prerequisite ordering.

Provider cron definitions point to the active deployment: ops (:03/:18/:33/:48),
renewals (:35), and unchanged daily import-draft cleanup (02:17 UTC).

## Readiness repair and primary preservation

Reviewed source `20261001154214_razorpay_readiness_scan_freshness.sql` installed
through the approved migration tool as history `20261001155436` (330 entries).
Replay/rollback tests preserve leases, provider-mode isolation and failure
backoff. The installed function remains invoker, with empty search path and
service-only EXECUTE; Security Advisors had no ERROR findings or finding for it.

Natural primary ops **16:08 UTC** claimed 1 / readiness verified 1 / failed 0 /
refreshed 0. Its aggregate retained one earlier refund-reconciliation failure
because that phase preceded the scan. Primary ops **16:23, 16:38, 16:53, 17:08 UTC**
then returned HTTP 200, dispatched 10 / failed 0 / no timeout. The final release's
primary ops at **17:23:00.260 UTC** and **17:38:00.250 UTC** also passed
10/0/no timeout, with the 17:23 token
claimed/refreshed/failed all 0. Primary renewals
**16:41 UTC** and **17:41:00.144 UTC** returned HTTP 200, dispatched 3 /
failed 0 / no timeout.

PR #27 moves the same bounded, leased scan before provider recovery, so claimed
expired readiness is repaired before dependent recovery phases. Its regression
failed on the old order and passes after the move; failed readiness still blocks
recovery and releases its lease. Full verification passed 4,269 tests/526 files.
No reconnect, forced token rotation, financial opening or new schema was needed.

Supabase jobs remain active: ops (:08/:23/:38/:53), renewals (:41). GitHub remains
enabled. At 17:39 UTC, its latest successful natural ops run
[36892744314](https://github.com/aarkay1805/UsefulDesk/actions/runs/36892744314)
started **16:32:19 UTC**, within 75 minutes at observation. Latest natural renewals
[36886155223](https://github.com/aarkay1805/UsefulDesk/actions/runs/36886155223)
started **15:40:49 UTC**; its two-hour limit expired at 17:40:49 UTC, leaving a
SEV-3 freshness exception while primary/native renewals are healthy. Ops expires
at 17:47:19 UTC without a newer successful natural run. Recheck at closeout;
a past pass does not keep a schedule fresh. Manual runs do not clear freshness.
Full pre-install backup
[36846306908](https://github.com/aarkay1805/UsefulDesk/actions/runs/36846306908)
passed, with encrypted database and 44-object Storage verification.

The bounded read-only closeout at **18:12:53 UTC** found GitHub natural ops
101 minutes old and renewals 153 minutes old; both remain a Rajat-owned SEV-3
freshness exception. The workflows are active on main, with no stuck run or
configuration defect found. GitHub's Actions delay incident had resolved at
17:56:54 UTC, but UsefulDesk's exact missed-cadence cause remains unproven.
Manual runs cannot clear natural freshness. The natural backup
[36793888131](https://github.com/aarkay1805/UsefulDesk/actions/runs/36793888131)
remains fresh; the later full manual backup above also verifies 44 Storage objects.
Primary ops at **18:08:00.300 UTC** passed 10/0/HTTP 200/no timeout.
The docs-only `9ee9fc75` deployment `dpl_58ZrsVtMX3X182Na5EqohWfmpQvk`
became canonical; its natural native ops at **18:03:23.166 UTC** passed
10/0/HTTP 200/all worker 200. Its application tree equals accepted `e010c23c`,
so this metadata move does not restart functional scheduler acceptance.

## Financial and external boundaries

Quote/order/refund initiation, complimentary conversion, renewals, Test and
broader capabilities stay closed. Signed intake, settlement and scoped
financial recovery stay available. Read-only checks at **17:40 UTC** retain one original
quote/order/payment/grant/refund, three signed events, 554 gym payments and
manual access version 3 with the original full-refund end time.

At **16:26 UTC**, the lifecycle table contained zero rows; the previously
documented owner-marked missed confirmation could not be found. This predates
the first enabled native dispatch. The **18:04–18:24 UTC** read-only investigation
recovered six historical SQL observations. The latest, 29 September
13:26:35.533 UTC, shows the original job terminal `failed`, with **five lookup
attempts, zero provider attempts**, and no accepted/delivered message.
The current row remains absent; historical evidence is not current-row retention.

The strongest supported explanation is the existing contact deletion cascade:
an authenticated `delete_member` request succeeded at **30 September
04:36:03.592 UTC (10:06:03 IST)**, and the exact original invoice was detached
at 04:36:03.645281 UTC. The installed contact FK is `ON DELETE CASCADE`;
the original paid payment/invoice survive with null member links. Exact
job-to-request attribution remains an inference because retained request logs
omit the contact argument and recovered job snapshots omit `contact_id`.
No explicit lifecycle cleanup/archive path was found. Investigation is complete
to available evidence; exact attribution needs existing R2 access to the verified
29 September pre-deletion encrypted backup and a targeted offline extraction.
The existing Wrangler OAuth configuration was found, but its expired token
could not refresh; authentication failed before R2 permissions were tested.
No new login/scopes/credentials, download or decryption occurred. The precise
dependency is usable existing Cloudflare/R2 authentication or the already
verified encrypted archive plus checksum; the local decryption identity exists.
No Production restore, reconstruction or replay is authorized; the owner's
missed/do-not-send decision remains binding. Audit retention during member
deletion is separately deferred work, not a schema change in this closeout.

The refreshed seven-day provider log at **16:52 UTC** still contained only the
three original successful SaaS deliveries. No authentic duplicate or eligible
mixed gym delivery was available. No event/signature or new charge was created
to fill that gap; next action is inspect the real next eligible delivery.
The refreshed **18:04–18:24 UTC** provider audit still found only those three
original HTTP 200 deliveries. All three signed SaaS events are reconciled;
the original gym-side handling of the SaaS refund supports shared-merchant
isolation, not duplicate or eligible gym-to-SaaS mixed-delivery proof.
The **18:07:12.783 UTC** financial snapshot retains one original quote/order/
payment/grant/refund, manual access version 3 and the original end time,
zero recovery queue/exceptions, 554 gym payments and closed initiation/renewal
gates. No financial reopening or manufactured provider traffic occurred.
Bank refund-credit evidence remains owner-deferred. Meta approval work is excluded.

The independent watchdog release is tracked in
[merged PR #25](https://github.com/aarkay1805/UsefulDesk/pull/25), main `e44212fa`, with default-off
code, rollback/replay acceptance and external probe configuration. Its read-only
RPC was installed at **18:05 UTC** as history `20261001180537`; service-role
execution, denied anon/authenticated/PUBLIC execution, fixed search path and
output allowlist were verified. The natural primary snapshot at 18:05:59.891
contained ops 17:53 (10/0/HTTP 200) and renewals 17:41 (3/0/HTTP 200), active
and not timed out. No new watchdog security-advisor finding appeared.
Production monitor flags/token remain unset. Focused project-note and current
browser-tab discovery found no identifiable monitoring provider.
Exact watchdog head `2bb58d12` passed
[CI 36905244071](https://github.com/aarkay1805/UsefulDesk/actions/runs/36905244071),
[CodeQL 36905238883](https://github.com/aarkay1805/UsefulDesk/actions/runs/36905238883)
and Preview. Merged main `e44212fa` passed
[CI 36906146928](https://github.com/aarkay1805/UsefulDesk/actions/runs/36906146928)
and [CodeQL 36906145805](https://github.com/aarkay1805/UsefulDesk/actions/runs/36906145805).
Production `dpl_2ZP5qPFB19qXepXnKZD8CmNFUxh5` was READY at
**18:22:22.457 UTC**; the direct custom-domain binding resolves to that release.
Public login returned HTTP 200 with the UsefulDesk title; the disabled watchdog
returned JSON 404 with no-store/no-referrer headers. Unauthenticated native
dispatch returned 401 without worker execution. Deployment metadata retains
all three cron definitions and no monitor flag/token names. The project
configuration audit has zero blockers, with provider-hidden value limitations;
financial initiation/UI gates remain closed. Bounded runtime error/fatal and
HTTP 5xx counts were zero from 18:22:22 through **18:29 UTC**. Dispatcher/worker
source equals accepted `e010c23c`; this release does not reaccept or reopen it.
The owner selected an existing monitoring
account and its configured owner channel, naming Rajat Kashyap. The service name
or dashboard URL is still required to locate it; setup, natural external probes
and actual notification receipt remain pending. GitHub inbox is the only previously proven alert channel. Execution
redundancy does not establish independent paging.

## Containment

Set the native switch false and rebuild the verified release. Confirm both new
endpoints return the disabled aggregate. Keep Supabase/GitHub, signed intake,
settlement and scoped financial recovery. Preserve immutable evidence and the
missed confirmation's non-replay instruction. Do not reuse watchdog credentials
for dispatch.
