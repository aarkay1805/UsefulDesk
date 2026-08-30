# UsefulDesk production runbook

This is the shortest safe path from an alert to a verified recovery. It covers
the production application at `desk.usefulmade.com`, Vercel project
`useful-desk`, Supabase project `fwqthstqrkrwtaehefks`, and the scheduled
GitHub Actions in `aarkay1805/UsefulDesk`. Never paste credentials, tokens,
member data, webhook bodies, or the private backup identity into an incident
note or command output.

## Ownership

- **Primary incident and rollback owner:** Rajat Kashyap.
- **Alert destination:** the repository's GitHub Actions failures, GitHub
  notification inbox, and the primary owner's enabled Actions email/mobile
  notifications. Delivery is not considered live until the owner completes the
  verification in **Alerts** below.
- **Decision boundary:** the owner decides whether to roll back, disable a
  feature, send a provider canary, restore data, or change a production
  provider setting. An operator may investigate read-only without that extra
  approval.
- **Incident record:** open one private operational note with the start time,
  severity, affected feature, deployment id/commit, factual evidence, actions,
  owner, and next update time. Do not include secrets or customer payloads.

If Rajat is unavailable, stop consequential recovery actions. Keep collecting
read-only evidence and preserve the failing deployment and logs until an
explicitly delegated owner takes responsibility.

## Observability

| Signal                | Source                                       | Healthy state                                                                                                                   | Retention / limitation                                                          |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Public availability   | `production-health` GitHub workflow          | `/login` returns successfully and contains the UsefulDesk title; scheduled workflow history remains inside the thresholds below | GitHub schedules are best-effort; this is not a hard ten-minute SLA             |
| Critical workers      | Supabase Cron + `ops-crons` workflow         | latest database aggregate is HTTP 200/`failed: 0`; GitHub succeeds within 75 min                                                | Either scheduler may mask failure of the other, so inspect both                 |
| Renewal workers       | Supabase Cron + `renewals-cron` workflow     | latest database aggregate is HTTP 200/`failed: 0`; GitHub succeeds within 2 hours                                               | A delayed run can delay account-local reminders                                 |
| Backup recovery point | `Production backup` workflow                 | latest nightly database job succeeds; weekly/full run also verifies Storage                                                     | See `docs/backups.md`; old pre-rotation archives are not considered recoverable |
| Server errors         | Vercel Runtime Logs, Production, Error level | no unexplained burst of errors after a release or alert                                                                         | Hobby runtime logs retain only the latest hour; capture evidence promptly       |
| Database/Auth         | Supabase Logs and Advisors                   | no correlated 5xx/Auth/database errors and no new error-severity advisor finding                                                | Dashboard access is required                                                    |

Quick read-only triage:

```bash
curl --fail --silent --show-error --location --max-time 20 \
  --output /dev/null --write-out '%{http_code} %{time_total}\n' \
  https://desk.usefulmade.com/login

gh run list --workflow production-health.yml --limit 10
gh run list --workflow ops-crons.yml --limit 10
gh run list --workflow renewals-cron.yml --limit 10
gh run list --workflow production-backup.yml --limit 5
gh run view <failed-run-id> --log-failed

vercel logs --environment production --level error --since 1h --expand
```

Supabase SQL Editor or the approved read-only connector:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN ('usefuldesk-ops-cron', 'usefuldesk-renewals-cron');

SELECT status_code, timed_out, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
```

The cron routes and their expected response shapes are documented in
`docs/automations-and-cron.md`. Never put `AUTOMATION_CRON_SECRET` on a command
line or in an incident note; read it into the environment or use an approved
secret store when a manual authenticated check is necessary.

## Alerts

Treat a signal as actionable when any threshold below is met:

- **SEV-1:** login is unavailable on two checks ten minutes apart; confirmed
  cross-tenant/security exposure; destructive data loss; or inbound/outbound
  provider processing is corrupting records. Owner response target: 10 minutes.
- **SEV-2:** both execution paths miss a worker window; either database job is
  inactive; a database aggregate or GitHub critical-worker step fails; the
  last successful GitHub `ops-crons` run is older than 75 minutes; the last
  successful GitHub `renewals-cron` run is older than 2 hours; the nightly
  database backup is missed; or a new release produces repeated server errors.
  Owner response target: 30 minutes.
- **SEV-3:** one transient probe fails and its retry succeeds, or a noncritical
  degradation has a safe workaround. Review during the same working day.

The `production-health` workflow also runs
`scripts/github-workflow-freshness.mjs`. It checks only successful scheduled
runs—not manual dispatches—and turns the existing ops (75 minutes), renewals
(two hours), and nightly-backup (30 hours) freshness limits into a failed
Actions run. This detects dropped schedules as soon as GitHub runs the health
workflow again. It cannot page while GitHub's scheduler itself is completely
silent; closing that final gap requires an external monitoring provider and a
separate alert-delivery decision.

One-time alert delivery verification (manual gate):

1. In GitHub, watch `aarkay1805/UsefulDesk` and enable Actions notifications in
   the primary owner's notification settings (web plus email or mobile).
2. Run **production-health** manually from Actions; verify the run is green and
   appears in the notification inbox.
3. Use a temporary workflow-dispatch-only failing probe, or GitHub's approved
   notification test mechanism, to verify one failure reaches the owner. Remove
   the temporary failure in the same session. Do not break the scheduled probe.
4. Record only the date, delivery channel, recipient role, and successful test
   run id in `GATES.md`; do not record addresses, phone numbers, or secrets.

Until that delivery test is complete, the repository contains monitoring but
does not have a verified paging channel.

## Triage and containment

1. Declare severity, owner, and the next update time. Note the current UTC time.
2. Check public availability, both Supabase Cron jobs/responses, and the three
   GitHub workflows above. Open the failed step; do not rerun it yet.
3. Capture the active Vercel deployment id/URL and Git commit. Query the latest
   hour of Production error logs before Hobby retention expires.
4. Correlate with Supabase Logs and provider health. Redact all customer data.
5. Identify the smallest affected path. Do not globally disable messaging,
   rotate credentials, send a canary, move money, or modify production data
   without the owner's explicit approval.
6. If the failure is isolated to an idempotent cron and the cause is understood,
   obtain approval before manually dispatching it. Confirm its JSON counters and
   queue health rather than relying only on HTTP 200.

## Rollback

Application rollback owner: Rajat Kashyap. Rollback is a consequential
production action and always requires his explicit approval.

1. Preserve the failing deployment id, commit, UTC start time, relevant redacted
   logs, and any migration/version involved.
2. Identify the immediately preceding **READY** production deployment and the
   commit it serves. On Vercel Hobby, rollback is limited to that immediately
   preceding production deployment.
3. Confirm the suspected fault is application-only. Do not roll application
   code behind an incompatible database migration.
4. After approval, execute `vercel rollback <previous-deployment-url-or-id>` or
   use Vercel's production rollback control. Do not redeploy an unverified local
   working tree as a substitute.
5. Verify `/login`, authentication, the affected feature, and the next relevant
   scheduled worker. Scan Production errors for at least ten minutes.
6. Record the rollback deployment, verification evidence, residual risk, and
   follow-up owner.

Database migrations are forward-only during an incident unless a separately
reviewed corrective migration exists. Never use `supabase db push`. A data
restore follows `docs/backups.md`, requires explicit approval, and must restore
into a disposable project first unless the owner accepts a documented emergency
exception.

## Verification cadence

- **Each working day:** confirm the latest public probe, `ops-crons`, and
  `renewals-cron` runs are green and inside their freshness thresholds.
- **Each Monday:** confirm the latest database and Storage backup evidence,
  inspect Vercel/Supabase error summaries, and review unresolved Meta, WhatsApp,
  and Razorpay operational queues.
- **After every production release:** wait for READY, verify `/login` and the
  changed path, then scan Production error logs after 10 minutes and again after
  30 minutes.
- **Monthly:** test that the owner still receives one approved alert, confirm
  rollback access, and review this runbook's owners, commands, thresholds, and
  provider-plan assumptions.
- **Quarterly:** perform the documented disposable-project restore drill or
  record why it was deferred and who owns the next date.

Current baseline verified 2026-08-24: `/login` returned HTTP 200; ops run
`32704584749` and renewals run `32702202707` succeeded. This is historical
evidence, not a substitute for the cadence above.
