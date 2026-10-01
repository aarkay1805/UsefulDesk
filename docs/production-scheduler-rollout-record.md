# Production scheduler rollout — 1 October 2026

## Reviewed source and disabled deployment

PR #22 merged after exact-head CI/security checks, then stacked PR #23 was
retargeted to main, updated and checked before merging. PR #24 closes the
readiness validity/cadence mismatch and logs only native aggregate/status facts.
Its main commit `6a35e26d08245109fc9398831f7fd9fb63b7a99f` passed
[CI 36889908975](https://github.com/aarkay1805/UsefulDesk/actions/runs/36889908975)
and [CodeQL 36889909653](https://github.com/aarkay1805/UsefulDesk/actions/runs/36889909653).
Canonical off release `dpl_94NgbzhQVyQhGzrg4idR64cYjfPN` returned both
HTTP 200 disabled aggregates, dispatched 0 / failed 0, at 16:17 UTC.
The earlier PR #23 off release passed the same canonical check at 15:54 UTC.

## Deployed configuration

The exact reviewed main commit was rebuilt into Production as
`dpl_BLSjneoZFgPn7jbc3gDLdsUwcckT`, READY/aliased to
`https://desk.usefulmade.com` at **16:19:37.354 UTC**.
`USEFULDESK_VERCEL_CRONS_ENABLED=true` applies only to Production.
A new reserved `CRON_SECRET` was provisioned privately; its original random
64-hex value is retained with 0600 permissions. The existing worker credential and encryption key were retained. The original
protected URL/key had the owner's 30 September verification; opaque exports
cannot re-verify their plaintext. The Production audit has zero blockers and
explicit protected-value/natural-acceptance warnings. Both enabled canonical
routes reject unauthenticated requests with HTTP 401 without dispatch. The
provider project cron definitions point to this exact deployment, including
ops (:03/:18/:33/:48), renewals (:35) and retained daily cleanup (02:17 UTC).

## Natural execution acceptance

The initial **+10-minute scan at 16:29:42 UTC** found zero runtime error clusters
and zero deployment HTTP 5xx responses since READY. However, the first natural
native ops request at **16:33:23 UTC** returned HTTP 503, dispatched 10 / failed 10,
with all worker statuses 0 (no HTTP response). Supabase canonical dispatch was
healthy. The retained configured-origin path was therefore not accepted.

The first natural renewals request at **16:35:12.248 UTC** also returned HTTP
503, dispatched 3 / failed 3, with all worker statuses 0.

At 16:37 UTC, Production `NEXT_PUBLIC_SITE_URL` was explicitly written as
`https://desk.usefulmade.com`; the original protected Preview record was retained
separately, with no credential change. Because Next.js inlines this setting at
build time, the verified commit was rebuilt into
`dpl_6Ab5V91yTwyX7yH2xNP6mEeuu6on`, READY/aliased at **16:39:16.178 UTC**.
Unauthenticated canonical ops remains HTTP 401. Acceptance/timed scans restart
from this corrected deployment; both failed runs are preserved. A registered
request, configuration or unauthenticated probe does not establish dispatch
success. No manual authenticated native worker invocation is used.

## Readiness repair and primary preservation

Reviewed source `20261001154214_razorpay_readiness_scan_freshness.sql` was
installed through the approved migration tool as history
`20261001155436` (330 entries). Replay/rollback tests preserve leases,
provider-mode isolation and the post-expiry failure backoff. The installed
function remains invoker, with empty search path and service-only EXECUTE;
Security Advisors had no ERROR findings or finding for this function.
At natural primary ops **16:08 UTC**, token scan claimed 1 / readiness verified 1 /
failed 0 / refreshed 0. The same aggregate reports one earlier refund-reconciliation
failure because that phase precedes the readiness scan; the next natural cycle
must establish recovery health. At **16:23 UTC**, natural primary ops returned
HTTP 200, dispatched 10 / failed 0 / no timeout, with all ten workers HTTP 200,
including gym and SaaS financial recovery. The merchant activation check is now dated
16:08:04.384 UTC and the scan lease is released. No reconnect or token rotation
was needed.

Supabase ops (:08/:23/:38/:53) and renewals (:41) remain primary and active.
GitHub workflows remain enabled as redundant paths; ops natural freshness was
still a SEV-3 exception at 16:19 UTC, while renewal scheduling recovered at
15:40:49 UTC. Manual checks do not clear natural freshness. The pre-install full
backup [36846306908](https://github.com/aarkay1805/UsefulDesk/actions/runs/36846306908)
passed, including encrypted database and 44-object Storage verification.

## Financial and external boundaries

Subscription quote/order/refund initiation, complimentary conversion, renewals,
Test and broader capabilities stay closed. Signed intake, settlement and scoped
financial recovery stay available. The original full-refund access consequence
is retained. At 16:26 UTC, the lifecycle table contained zero rows; the previously
documented owner-marked missed confirmation could not be found. This inspection
precededs the first enabled native dispatch. Catalog/repository checks found no
explicit lifecycle-row cleanup function or archive; its disappearance is an open
historical preservation discrepancy, owned by Rajat for investigation against
prior private snapshots. The old failed record must not be reconstructed or
replayed. The gym payment count remains 554.

The authentic shared-merchant webhook log in the seven-day range still showed
only the three original successful SaaS deliveries at the 15:51 UTC inspection.
No duplicate or eligible mixed gym delivery was available, and no event/signature
or new charge was manufactured. Its owner/next action remains the real next
eligible provider delivery; bank refund-credit proof remains owner-deferred.

The independent watchdog is prepared in
[draft PR #25](https://github.com/aarkay1805/UsefulDesk/pull/25), with all local
4,304 tests and hosted CI/security/Preview passing. Its RPC and Production flags
are not installed. Existing/free account and owner alert channel selection remain
pending, followed by natural external probes and actual owner notification
receipt. GitHub inbox is the only previously proven alert channel. Native
execution redundancy does not establish independent paging. Meta work is excluded.

## Containment

Set the native switch false and rebuild the same verified release. Confirm both
new endpoints return the disabled aggregate. Keep Supabase/GitHub, signed intake,
settlement and scoped financial recovery; preserve immutable evidence and the
missed confirmation's terminal state. Do not reuse the watchdog token for dispatch.
