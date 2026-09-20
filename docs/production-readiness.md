# UsefulDesk paid-pilot production readiness

**Gate status: CLOSED pending external provider actions.** Repository-controlled
operations are documented and testable, but the founder must close the blockers
below before accepting money for or activating the first paid UsefulDesk term.
This audit is read-only evidence captured on 20 September 2026 at 17:39 UTC; no
plan was purchased, provider setting changed, payment moved, or customer message
sent.

## Decision record

| Area                  | Status                      | Evidence and decision                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release   | PASS                        | Production served commit `92ccac89`; the active Vercel deployment was READY and PROMOTED. `/login` returned HTTP 200 in 0.18 seconds and the last hour contained zero Production error-level log entries.                                                                                                                                                                         |
| Domain and TLS        | PASS                        | `desk.usefulmade.com` resolves through Vercel DNS. Its Let's Encrypt certificate covers the hostname and is valid until 2 December 2026. HSTS, CSP reporting, permissions policy, referrer policy, MIME sniffing protection, and frame denial were present.                                                                                                                       |
| Commercial permission | **BLOCKER**                 | The Vercel project is on Hobby. Vercel documents Hobby as for non-commercial use. Upgrade the one production team seat to Pro before accepting a paid order. Current published base price: **US$20/month plus usage**.                                                                                                                                                            |
| Core environment      | PASS WITH WARNINGS          | All seven core production names are present. Razorpay is in live mode; every acceptance/pilot/refund bypass is false; WhatsApp dry-run is absent. The provider masks sensitive values, so the canonical site URL value and encryption-key format require a provider-side value check. `npm run audit:production-env` reports names and policy only and never prints values.       |
| Public lead form      | UNAVAILABLE                 | Both Turnstile production variables are absent. The form correctly fails closed in Production. This does not block a founder-referred paid pilot, but public lead capture must not be promised until both keys are configured and tested.                                                                                                                                         |
| Supabase health       | PASS WITH BLOCKERS          | The production Auth health endpoint returned HTTP 200. Current plan, database/storage/egress usage, spend controls, Auth custom SMTP, Advisors, and current database Cron rows could not be read because no authenticated Supabase management session was available. These are mandatory account-owner checks below.                                                              |
| Scheduled operations  | PASS WITH ONE VERIFY ACTION | Latest `production-health`, `ops-crons`, and `renewals-cron` GitHub runs succeeded. The database scheduler is the primary path, but its current `cron.job`/`net._http_response` state still needs a fresh authenticated read.                                                                                                                                                     |
| Alerts                | PASS FOR GITHUB INBOX       | The GitHub inbox failure path was verified on 30 August 2026 and recorded in `GATES.md`. Email/mobile delivery and an independent external watchdog are not proven and must not be represented as active paging.                                                                                                                                                                  |
| Backups and recovery  | PASS WITH ACCEPTED RISK     | Latest nightly database backup succeeded on 19 September; latest weekly full database-plus-Storage backup succeeded on 13 September. A disposable-project restore drill passed on 23 August, so the quarterly drill is current. Pre-key-rotation archives are intentionally unrecoverable; the replacement private key has one Apple Passwords copy and no approved offline copy. |
| Rollback              | PASS WITH LIMITS            | The immediately preceding READY Vercel release is the application rollback target after founder approval. Database migrations are forward-only; restore into a disposable project before any production recovery. Provider sends and payments already accepted cannot be rolled back by an application deployment.                                                                |
| Change control        | RISK FOR SOLO PILOT         | GitHub reports `main` as unprotected. CI is green, but the provider does not enforce review or status checks before a direct push. Add protection before multiple operators can release.                                                                                                                                                                                          |

## Blocking owner actions

| ID   | Owner | Action and acceptance evidence                                                                                                                                                                                                                                                                                                                  | Cost                                              | Deadline                                         |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| B-01 | Rajat | Upgrade `useful-desk` from Vercel Hobby to Pro; configure a deliberate Spend Management threshold; record the invoice and a private screenshot; verify the next Production deployment is READY and `/login` is healthy.                                                                                                                         | US$20/month base for one seat, plus usage         | Before issuing or accepting the first paid order |
| B-02 | Rajat | In Supabase Billing/Usage, record the actual plan, database size, Storage, egress, MAU, and any spend cap privately. If Free, either document a time-bounded founder risk acceptance within its limits or upgrade before the paid term. Supabase publishes Pro from US$25/month and includes larger quotas and seven-day backups/log retention. | US$0 to verify; US$25/month base if Pro is chosen | Before confirming the first payment              |
| B-03 | Rajat | In Supabase Auth SMTP settings, verify custom SMTP is configured, send a real sign-in/recovery test to the pilot owner, and record timestamp/outcome privately. A Vercel `RESEND_API_KEY` alone is not proof that Supabase Auth uses it.                                                                                                        | Provider-dependent; US$0 for the account check    | Before onboarding the first new paid-pilot owner |
| B-04 | Rajat | In the approved Supabase SQL tool, run the two read-only queries from `docs/production-runbook.md`; verify both database Cron jobs are active and recent HTTP responses are successful. Review Logs and Advisors for new error-severity findings.                                                                                               | US$0                                              | Before activating the first paid term            |
| B-05 | Rajat | Reveal values only inside Vercel's protected UI and verify `NEXT_PUBLIC_SITE_URL=https://desk.usefulmade.com` and `ENCRYPTION_KEY` is exactly 64 hexadecimal characters. Do not paste either value into an issue, terminal transcript, or Git.                                                                                                  | US$0                                              | Before activating the first paid term            |

When B-01 through B-05 are evidenced, change the gate to **OPEN**, record the
date and approver here, and follow `docs/commercial-operations.md`. The Supabase
plan purchase in B-02 is a founder decision; the plan/usage verification itself
is mandatory. Do not infer approval to spend from this document.

## Repeatable checks

Export production variables to a temporary local file using the authenticated
Vercel CLI, then run the value-redacting checker:

```bash
task_tmp_dir="$(mktemp -d)"
vercel env pull "$task_tmp_dir/production.env" --environment production --yes
npm run audit:production-env -- --dotenv-stdin < "$task_tmp_dir/production.env"
truncate -s 0 "$task_tmp_dir/production.env"
```

The checker treats Vercel's `[SENSITIVE]` placeholders as warnings rather than
proof of value correctness. Run the public and workflow checks from
`docs/production-runbook.md`, then inspect provider dashboards without copying
secrets or customer data into the evidence record.

## Provider-cost decision

The compliant current path is Vercel Pro plus the existing Supabase project,
subject to B-02. It preserves the verified Git deployment, aliases, logs,
environment boundary, rollback path, serverless behavior, and existing
monitoring. Minimum known platform base after the required Vercel upgrade is
US$20/month plus usage. If the founder selects Supabase Pro, the known base is
US$45/month plus usage and any email/domain costs.

Hostinger Web Apps Hosting is cheaper on its current India entry offer: ₹249 per
month when prepaid for 48 months (₹11,952 upfront), renewing at ₹649 per month.
It is not the launch path. Moving would require a separate migration and
acceptance plan for build/runtime compatibility, secrets, scheduled work,
deployment promotion, logs, rollback, cache behavior, and monitoring. This repo
also has a documented history of stale HTML under Hostinger's CDN. A long
prepayment before that work is proven would convert a small monthly saving into
technical and contractual risk. Re-evaluate after paid-pilot demand is proven;
do not migrate as part of this gate.

Pricing and plan policy were checked against the provider's current official
pages on the audit date: [Vercel plans](https://vercel.com/docs/plans),
[Vercel pricing](https://vercel.com/pricing),
[Supabase pricing](https://supabase.com/pricing), and
[Hostinger Web Apps Hosting](https://www.hostinger.com/in/web-apps-hosting).

## Evidence refresh cadence

- Before each paid activation: re-run environment policy, login health, current
  deployment, recent errors, database Cron, and backup freshness checks.
- Monthly: record provider plan/usage/spend thresholds and R2 lifecycle/usage.
- Quarterly: perform and record the disposable-project restore drill.
- After every provider, domain, auth, or billing change: re-check the affected
  gate and update this document without recording secrets.
