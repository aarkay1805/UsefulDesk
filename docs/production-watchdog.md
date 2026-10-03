# Independent production watchdog — active

**Approved release follow-up, 3 October 07:36 UTC:** canonical Production now
serves `c9da8c47`. Both external monitors remain active/Healthy and the test stays
paused. The primary snapshot and natural c9 native ops (10/0) and renewals (3/0),
all HTTP 200, are separately recorded in the
[release receipt](subscription-coordinated-release-execution-2026-10-03.md).
No new alert was sent; the original channel acceptance remains below.

**3 October read-only refresh:** both production monitors remain active with
300-second checks and displayed Healthy → Ongoing history; the harmless test
remains paused. The original 2 October alert receipt remains the channel acceptance,
with no new alert sent. Backup coverage/freshness and redundant schedule limits
remain separate; see the [hosting review](production-hosting-review-2026-10-03.md).

StatusCake Free is configured in the owner-created account, with no paid trial or purchase.
The owner explicitly selected the email channel and approved sharing the separate read-only monitoring URL.
Two five-minute HTTP monitors cover public login availability and primary worker/database health.
The public monitor first recorded healthy checks at 13:39 UTC on 2 October.
The worker route returned HTTP 200 with healthy ops/renewals and no-store headers after
READY Production deployment `dpl_4yLpexKqg6Ls3KxYyv7drYSjGxxd` (main `eeeb5442`).
The independent worker monitor first recorded **Healthy at 13:53 UTC**. Both
external monitors are running; the notification test remains paused.

An actual StatusCake alert reached the explicitly selected Gmail inbox at **13:42:41 UTC
(19:12:41 IST)**. Gmail delivery and sender authentication were verified through the connected
owner inbox. The harmless dedicated missing-page test was paused after receipt; the
production site/workers remained available. Monitor IDs: public `8032323`, worker
`8032327`, paused notification test `8032326`. Recipient and token stay outside Git.

Both monitors use two confirmation servers; alert delays are ten minutes for public
availability and five minutes for worker health. These are elapsed alert delays, not
claims of a configurable consecutive-failure count. Content matching and explicit SSL
validation are paid features in this account; no upgrade was started. The provider
default unhealthy HTTP status set includes 404 and 503. The expected healthy response
is HTTP 200. Three of ten free monitor slots are used, including the paused test.

The concrete configuration is [recorded here](production-watchdog-config.json).

The reviewed RPC is installed in Production as migration history
`20261001180537` (source `20261001155527_production_watchdog_snapshot.sql`).
At 18:05 UTC on 1 October, service-role execution and the fixed output allowlist
passed; anon/authenticated/PUBLIC execution was denied and the search path was
empty. The snapshot contained healthy natural primary ops and renewal aggregates.
That was the disabled baseline. The separate 256-bit token is now a Vercel Production
secret and the monitoring flag is enabled; neither dispatch credential was shared.

`GET /api/production-watchdog/[token]` requires literal Production opt-in via
`USEFULDESK_EXTERNAL_MONITOR_ENABLED=true` and a separate random 64-hex
`USEFULDESK_EXTERNAL_MONITOR_TOKEN`. It rejects reuse of either dispatch secret.
Disabled/Preview calls return 404 before database access. Enabled calls apply
per-IP rate limiting before a bounded read-only service RPC. No cron, provider
operation, reminder replay, access update or Vault read occurs.

The service-only `production_watchdog_snapshot()` RPC reads the two fixed
Supabase cron jobs and their latest aggregate responses. It returns only active
status, timestamps and numeric aggregate facts. Malformed unrelated response
bodies are skipped; missing, incomplete or stale evidence is unhealthy.
The route returns only `ok` and fixed group/reason checks, with no-store headers.
HTTP 503 means inactive/missing/stale/failed/incomplete primary evidence or an
unavailable database; ops freshness is 45 minutes and renewals 120 minutes.
This checks primary health, not independent native/GitHub schedule freshness or
backup freshness. Native natural logs and the backup workflow remain separate.

For recovery, keep the token in the owner's private monitoring records and Vercel
Production secret. URL paths can appear in request logs; this credential must never
authorize dispatch or enter Git. A successful health response alone does not prove
notification receipt; the delivered test above is the separate channel acceptance.

To contain monitoring, set its flag false and redeploy; existing schedulers and
financial recovery remain available.

Disposable SQL rollback/replay acceptance is in
`scripts/production-watchdog-acceptance.sql`; endpoint/evaluator tests cover
Preview/disabled isolation, token/dispatch-secret refusal, rate limiting,
timeouts, freshness boundaries, incomplete failures and output redaction.
