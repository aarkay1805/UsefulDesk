# Independent production watchdog — disabled release

The read-only watchdog is implemented and disabled by default. No monitoring
account, external probe or owner delivery is established by this code.
The operator configuration is [prepared here](production-watchdog-config.json).
StatusCake Free was researched on 2 October as a no-cost small-business candidate
(ten monitors, five-minute intervals); its free signup page is open for the owner.
Rajat completed free signup/sign-in; the dashboard is accessible without a paid
trial. Exact alert email is still requested. No monitor token, monitor or test
notification has been created. Authentic provider acceptance remains the prior
ordered rollout step.
On 2 October, Rajat clarified that he has **no monitoring service/account**.
This supersedes the earlier assumed existing-account selection. New account
setup, owner alert-channel selection and verified test delivery remain necessary;
do not claim that probes or notifications exist, purchase a service, or infer an
alert recipient from unrelated account details.

The reviewed RPC is installed in Production as migration history
`20261001180537` (source `20261001155527_production_watchdog_snapshot.sql`).
At 18:05 UTC on 1 October, service-role execution and the fixed output allowlist
passed; anon/authenticated/PUBLIC execution was denied and the search path was
empty. The snapshot contained healthy natural primary ops and renewal aggregates.
Production monitor flags/token remain unset; no external probe or paging is active.

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

After identifying the selected account, verify the landed release and installed
service-only RPC, then provision the separate read-only token privately. Enable only the
Production monitor flag and redeploy the verified release. Add the two monitors
from the prepared configuration; substitute the private token only in the
selected provider's private URL field. URL paths can appear in request logs, so
the token must never authorize dispatch and must not appear in Git/evidence.

Verify natural external successful probes and then an actual provider test
notification received by the chosen owner. Record only channel type, test time
and factual delivery result. Prefer the provider's notification test; otherwise
use a dedicated test monitor with a deliberately unavailable target, removing
that test after delivery. Do not break the production application or workers.
Configuration or a successful health response does not prove notification receipt.
To contain monitoring, set its flag false and redeploy; existing schedulers and
financial recovery remain available.

Disposable SQL rollback/replay acceptance is in
`scripts/production-watchdog-acceptance.sql`; endpoint/evaluator tests cover
Preview/disabled isolation, token/dispatch-secret refusal, rate limiting,
timeouts, freshness boundaries, incomplete failures and output redaction.
