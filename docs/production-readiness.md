# UsefulDesk paid-pilot production readiness

**Gate status: CLOSED.** Before accepting money or activating the first paid
UsefulDesk term, close the common operational and commercial decisions below.
Automated subscriptions require the additional subscription acceptance gate.
An environment audit or a Test payment does not authorize a paid launch.

The original provider audit ran on **28 September 2026, 09:39–11:39 UTC**.
Deployment, repository, database, workflow, and public-URL evidence was refreshed
**29 September 2026, 10:18–10:29 UTC**. Plan, usage, SMTP, protected-value,
advisor, and certificate details retain their 28 September evidence dates unless
stated otherwise. This refresh purchased no plan, changed no provider setting,
applied no Production migration, moved no money, and sent or replayed no customer
message. Test work is scoped in [subscription Test acceptance](subscription-test-acceptance.md).

## Decision record

| Area                         | Status                        | Evidence and practical limit                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release          | HEALTHY; BILLING STILL OFF    | Production deployment `dpl_CGPp1Ka19Xp4kzrkTFnA4gX5Tywf` is READY at `4072dccc`, serves `desk.usefulmade.com`, and matches current `main`. `/login` returned HTTP 200 in 1.07 seconds; the last-hour Vercel runtime-error query returned no clusters. Later uncommitted work in other chats is not part of this release.                                                                                                                                                   |
| Domain and TLS               | PASS                          | `desk.usefulmade.com` has a valid Let's Encrypt certificate through 2 December 2026. HSTS, report-only CSP, permissions/referrer policies, nosniff, and frame denial were present. Report-only CSP is not enforcement.                                                                                                                                                                                                                                                     |
| Vercel commercial permission | BLOCKER                       | The last authenticated team-plan check, on 28 September, found Hobby. Reconfirm the current plan before a paid order. Vercel requires Pro or Enterprise for commercial use; an owner-approved upgrade and spend threshold remain open.                                                                                                                                                                                                                                     |
| Core environment             | PASS WITH WARNINGS            | The 28 September policy check found seven required names, live gym Razorpay mode, and false/unset acceptance flags. The 29 September Production variable-name list still has no `USEFULDESK_*` SaaS configuration, Test billing UI flag, or Turnstile names. The list does not reveal protected values; the canonical URL/key format checks remain open. Gym merchant configuration is separate from Usefulmade SaaS billing.                                              |
| Public lead form             | UNAVAILABLE                   | Both Turnstile variables are absent; Production submissions fail closed. This is not a founder-referred pilot blocker, but public lead capture cannot be promised.                                                                                                                                                                                                                                                                                                         |
| Supabase capacity            | VERIFIED; OWNER DECISION OPEN | The organization still reports Free on 29 September. The 28 September dashboard had no exceeded quota: database 0.064/0.5 GB, Storage 0.004/1 GB, egress 0.229/5 GB, MAU 5/50,000, peak realtime connections 7/200. That usage snapshot is not a capacity forecast or acceptance of Free-plan restrictions.                                                                                                                                                                |
| Auth SMTP                    | CONFIGURED; DELIVERY UNPROVEN | Auth SMTP is enabled with `smtp.resend.com:465`, sender label UsefulDesk. Credentials remained hidden; no sign-in/recovery email was sent by this audit. A Vercel email key alone is not evidence of Auth delivery.                                                                                                                                                                                                                                                        |
| Scheduled operations         | BLOCKER: ONE FAILED JOB       | Both primary database schedules remained active; latest inspected ops at 10:23 and renewals at 09:41 UTC returned HTTP 200 without timeout. Job `754b267e-a1c2-442d-a745-8d9c03d2b92c` is still `failed` after five legal-name lookup retries. It has zero provider attempts, no accepted/delivered message, and no matching payment-confirmation template message for that contact after the payment. Healthy new runs do not disposition the failed job.                 |
| Redundant GitHub schedules   | DEGRADED                      | New scheduled ops and renewal runs succeeded at 07:00 and 07:31 UTC on 29 September, replacing the earlier failed-run evidence. At 10:29 UTC they were again older than the runbook's 75-minute and two-hour freshness windows. Primary database schedules remained healthy; verify a fresh scheduled run or record an approved resolution.                                                                                                                                |
| Supabase logs/advisors       | REVIEW REQUIRED               | 08:46–09:46 log window: Auth errors 0, edge HTTP 5xx 0; three Postgres `42501` errors reference `my_branch_accounts`, consistent with the failing service-worker fallback. Security Advisors show no ERROR findings, but warn about mutable function search paths, public extensions, definer grants, and disabled leaked-password protection. Review context before changing intentional public/authenticated RPC grants.                                                 |
| Backups and recovery         | PASS WITH ACCEPTED RISK       | The 29 September nightly [backup run 36503169579](https://github.com/aarkay1805/UsefulDesk/actions/runs/36503169579) succeeded; the last separately inspected database-and-Storage upload evidence remains [run 36357784556](https://github.com/aarkay1805/UsefulDesk/actions/runs/36357784556). Disposable restore passed 23 August; next drill is due 23 November. Pre-key-rotation archives remain unrecoverable, and the replacement key has no approved offline copy. |
| Alerts                       | GITHUB INBOX ONLY             | Inbox failure delivery was verified 30 August in `GATES.md`. Email/mobile paging and an independent external watchdog remain unproven.                                                                                                                                                                                                                                                                                                                                     |
| Change control and rollback  | KNOWN LIMITS                  | `main` remains unprotected (GitHub branch-protection API returned 404). CI for deployed `4072dccc` passed ([run 36554758624](https://github.com/aarkay1805/UsefulDesk/actions/runs/36554758624)). Select a verified preceding READY application release for an approved rollback; migrations and provider effects need separate recovery. Add branch protection before multiple release operators.                                                                         |
| SaaS Production boundary     | CLOSED AS INTENDED            | All nine private tables from the four subscription billing drafts were still absent on 29 September. The only adapter is explicitly non-Production/Test-mode gated, so no automated paid grant, renewal, or SaaS refund is available. Full-schema Test capture/refund/renewal, signed provider delivery and retries, and simulator/physical-device access checks have since passed; they do not install Production billing or establish a Live Usefulmade merchant.        |

The later local [dark Live boundary draft](subscription-live-boundary.md) has a
separate adapter and service-only schema, but it is uninstalled. A rollback-only
disposable full-schema SQL check passed with synthetic facts; no Live merchant,
Production migration or real-money acceptance was involved. The Production
status in the table remains closed.

## Repository fixes and recovery

`src/lib/whatsapp/legal-business-name.ts` now selects the explicit
`accounts_organization_legal_entity_fkey` relationship. Production has both that
composite FK and the older `accounts_legal_entity_id_fkey`; an unqualified embed
returns `PGRST201`. A service worker cannot recover through the authenticated
`my_branch_accounts` fallback. Read-only queries against the affected account
reproduced the old error and verified the explicit join returns its existing
canonical legal name. No identity data or database constraint needed changing.
The authenticated branch-member fallback remains for genuine RLS restrictions.

The lookup and environment-checker fixes are in deployed `4072dccc`; they do
not retroactively change a terminal job. A 29 September read-only service-role
probe reproduced `PGRST201` with the old unqualified embed and returned the
existing legal name without error through the deployed explicit relationship.
The affected payment remains `paid`, its confirmation setting and generation
remain active, and job `754b267e-a1c2-442d-a745-8d9c03d2b92c` remains failed.
The job has zero provider attempts and no accepted/delivered message; a scoped
message-history check found no matching confirmation template after the payment.
Focused helper and lifecycle tests passed (25/25). This is enough to close the
identified code defect, not to authorize a late customer send. The payment was
created 28 September 04:39 UTC; transaction confirmations have no general
staleness cutoff, so an operator must decide whether to mark this specific job
missed or attempt a carefully reviewed recovery. Verify current payment,
recipient, feature setting, and duplicate-send facts first. Do not bulk-reset
failures or invoke cron to collect evidence.

## Owner decisions and acceptance evidence

Rajat owns these decisions unless explicitly delegated. Record approvals and
sensitive evidence privately; retain only status, date, and reference here.

| ID   | Concrete next action                                                                                                   | Required evidence / deadline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-01 | Approve and perform Vercel Pro upgrade with a deliberate Spend Management threshold.                                   | Invoice/plan confirmation and healthy READY release; before issuing or accepting a paid order. Published base US$20/month plus usage/taxes; no purchase authorized by this audit.                                                                                                                                                                                                                                                                                                                                                                                  |
| B-02 | Choose time-bounded acceptance of the verified Supabase Free-plan limits, or approve Pro.                              | Dated risk acceptance with review date and usage thresholds, or paid plan evidence; before confirming payment. Pro published base US$25/month; verification does not imply spending approval.                                                                                                                                                                                                                                                                                                                                                                      |
| B-03 | Authorize a recipient and test real Auth sign-in and recovery delivery using the configured SMTP.                      | Private timestamp, delivery and completed sign-in/recovery outcome; before paid-owner onboarding. Configuration is already verified.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B-04 | Decide the exact failed confirmation's disposition and verify scheduler recovery.                                      | Lookup patch is READY at `4072dccc`; see the scoped evidence above. Record skip or separately reviewed targeted recovery for job `754b267e-a1c2-442d-a745-8d9c03d2b92c`, plus fresh successful GitHub scheduled runs or an approved resolution of their degradation. Review Advisor warnings in context. No automatic resend is authorized.                                                                                                                                                                                                                        |
| B-05 | Check canonical URL and encryption-key format in Vercel's protected value UI.                                          | `NEXT_PUBLIC_SITE_URL` equals the canonical HTTPS origin; `ENCRYPTION_KEY` is 64 hexadecimal characters. Record pass/fail only before paid activation. Never paste values.                                                                                                                                                                                                                                                                                                                                                                                         |
| C-01 | Obtain qualified confirmation of the founder's actual registration/accounting circumstances and quote/receipt process. | Adviser-confirmed treatment for the reported Punjab, unregistered, zero-turnover business, including relevant PAN-wide turnover and customer geography. Before a payable quote. The owner's decision to draft ₹0 GST is not tax approval.                                                                                                                                                                                                                                                                                                                          |
| C-02 | Approve the exact limited pilot offer and choose manual or automated conversion.                                       | Included tested features, branch/member/staff limits, reminder schedule, third-party costs, cancellation/refund terms, quote expiry, and exact term. Provisional ₹799/₹1,499/₹3,999 monthly prices are planning inputs. Explicitly exclude unready annual/add-on features if deferred; no blanket founding-term approval. Before a payable quote.                                                                                                                                                                                                                  |
| S-01 | Finish the remaining product and release-specific acceptance.                                                          | Full-schema owner/staff isolation, genuine Test payment/refund/renewal recovery, downgrade archive rollback/replay, and simulator plus physical iPhone access checks passed in the [Test record](subscription-test-acceptance.md). Remaining work includes finishing tier/reminder enforcement and its UI/native/background acceptance, and release-build HTTPS behavior. Physical PostgreSQL crash/storage recovery was not tested; decide whether it is a release requirement rather than treating an injected transaction failure as that proof.                |
| S-02 | Establish a separate Usefulmade Live billing path and merchant readiness.                                              | Test webhook delivery, provider retry after an isolated PostgREST outage, delayed failure after capture, and settled full refund passed. Production still has no SaaS tables, Live adapter/configuration, or verified Usefulmade Live merchant. Require merchant activation, exact credential/webhook isolation from gym collections, release-specific signed delivery and reconciliation, and an explicitly authorized controlled real-money pilot. Current renewal orders are owner-initiated; do not promise automatic debit without a separate implementation. |
| S-03 | Resolve and implement the remaining saleable scope before an explicit Production rollout decision.                     | Approve upgrade quote expiry/repricing, offered add-on proration/cancellation/refund/renewal, Starter's standard reminder days/time, the final feature matrix, Test term convention for paid UX, immutable renewal-change UX, and post-refund restart. Defer excluded features explicitly. Then separately authorize migration, deployment, and gate activation; none is approved by this record.                                                                                                                                                                  |

For a **manual paid pilot**, B-01–B-05 and C-01–C-02 must be evidenced, the
founder must approve the exact manual offer, and the
[commercial procedure](commercial-operations.md) must be followed. Manual access
does not enforce the proposed paid-tier feature matrix; promise only the
explicitly agreed available scope. S-01–S-03 are additional requirements for
**automated subscription rollout**. Do not switch the gate to OPEN merely because
B-01–B-05 or an automated environment check pass. Record the approved path,
date, approver, offer reference, and any exclusions when opening it.

## Repeatable checks

In a checkout already linked to the correct Vercel project/team, export to a
private temporary directory and run the checker. Do not print exported values:

```bash
(
  umask 077
  task_tmp_dir="$(mktemp -d)" || exit 1
  trap 'rm -rf "$task_tmp_dir"' EXIT
  vercel env pull "$task_tmp_dir/production.env" --environment production --yes &&
    npm run audit:production-env -- --dotenv-stdin < "$task_tmp_dir/production.env"
)
```

The 28 September audit used explicit project/team read APIs, with decrypted values
held only in memory and protected values represented as `[SENSITIVE]`.
Ciphertext from a list endpoint must not be interpreted as a flag's plaintext
value. Repeat public/workflow/database checks from the
[runbook](production-runbook.md); read logs and failed queues as well as the most
recent HTTP aggregate. Never invoke cron merely to collect audit evidence:
cron can send messages and create provider effects.

## Provider-cost decision

The current launch path is Vercel Pro with the existing Supabase project,
subject to B-02. Known base cost is US$20/month plus usage/taxes and email/domain
costs, or US$45/month if Supabase Pro is selected. This is not a cost-validated
margin estimate. A hosting migration is outside this gate and needs separate
runtime, cron, deployment, secrets, rollback and monitoring acceptance.

Official sources checked 28–29 September: [Vercel commercial-use policy](https://vercel.com/docs/limits/fair-use-guidelines),
[Vercel pricing](https://vercel.com/pricing), [Supabase pricing](https://supabase.com/pricing),
[CBIC service-registration overview](https://cbic-gst.gov.in/pdf/01062019-GST-An-Update.pdf),
[CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html), and
[Razorpay live-payment activation](https://razorpay.com/docs/pos/payments/).
Advisor references: [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
and [Auth password protection](https://supabase.com/docs/guides/auth/password-security).
These sources establish general requirements, not Usefulmade's tax eligibility
or merchant approval. Qualified advice and provider confirmation remain required.

## Evidence refresh cadence

- Before each paid activation: deployment, environment policy, login, recent
  errors, failed jobs, both scheduler paths, and backup freshness.
- Monthly: provider plan/usage/spend thresholds and R2 lifecycle/usage.
- Quarterly: disposable-project restore drill.
- After provider, domain, auth, or billing changes: re-check the affected gate.
