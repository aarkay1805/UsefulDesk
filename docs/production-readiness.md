# UsefulDesk paid-pilot production readiness

**Gate status: CLOSED.** Before accepting money or activating the first paid
UsefulDesk term, close the common operational and commercial decisions below.
Automated subscriptions require the additional subscription acceptance gate.
An environment audit or a Test payment does not authorize a paid launch.

Read-only provider evidence was captured on **28 September 2026, 09:39–11:39
UTC**. Repository fixes are local pending release. This audit purchased no plan,
changed no provider setting, applied no Production migration, moved no money,
and sent or replayed no customer message. Earlier Test payments/refunds are
separately scoped in [subscription Test acceptance](subscription-test-acceptance.md).

## Decision record

| Area                         | Status                        | Evidence and practical limit                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release          | HEALTHY; NEW WORK UNDEPLOYED  | Production deployment `dpl_H4DXZ5oY24pmsntrxCXTyyajubTZ` is READY at `d1c7245d`. `/login` returned HTTP 200 in 0.96 seconds at the refresh; Vercel's last-hour error query returned no rows. Subsequent local subscription, mobile, Home, and audit commits are not deployed.                                                                                                                                              |
| Domain and TLS               | PASS                          | `desk.usefulmade.com` has a valid Let's Encrypt certificate through 2 December 2026. HSTS, report-only CSP, permissions/referrer policies, nosniff, and frame denial were present. Report-only CSP is not enforcement.                                                                                                                                                                                                     |
| Vercel commercial permission | BLOCKER                       | Authenticated team API confirms Hobby. Hobby is restricted to non-commercial use; a deliberate Pro upgrade and spend threshold are required before a paid order.                                                                                                                                                                                                                                                           |
| Core environment             | PASS WITH WARNINGS            | Seven required names are present; gym Razorpay mode is live. Acceptance/dry-run flags are false/unset. All three SaaS Test flags and all `USEFULDESK_SAAS_RAZORPAY_*` configuration are absent. The strengthened checker reports zero blockers, with masked canonical URL/key format and absent Turnstile as three warnings. Hidden values are not verified values.                                                        |
| Public lead form             | UNAVAILABLE                   | Both Turnstile variables are absent; Production submissions fail closed. This is not a founder-referred pilot blocker, but public lead capture cannot be promised.                                                                                                                                                                                                                                                         |
| Supabase capacity            | VERIFIED; OWNER DECISION OPEN | Dashboard confirms Free, no exceeded quota, billing cycle 8 September–8 October. Database 0.064/0.5 GB, Storage 0.004/1 GB, egress 0.229/5 GB, MAU 5/50,000, peak realtime connections 7/200. Hourly dashboard accounting differs from SQL database size (47 MB). This snapshot is not a capacity forecast or acceptance of Free-plan restrictions.                                                                        |
| Auth SMTP                    | CONFIGURED; DELIVERY UNPROVEN | Auth SMTP is enabled with `smtp.resend.com:465`, sender label UsefulDesk. Credentials remained hidden; no sign-in/recovery email was sent by this audit. A Vercel email key alone is not evidence of Auth delivery.                                                                                                                                                                                                        |
| Scheduled operations         | BLOCKER                       | Both database schedules are active. Latest inspected ops response at 11:38 and renewals response at 10:41 are HTTP 200, `failed: 0`. However one payment-confirmation job exhausted five attempts with `legal_business_identity_lookup_unavailable`, zero provider attempts. Earlier renewal aggregates returned 503. The healthy aggregate after exhaustion does not recover that job.                                    |
| Redundant GitHub schedules   | DEGRADED                      | Latest ops success was 07:44, production-health success 06:52, and renewal run at 05:54 failed on `/api/reminders/cron` (503). At refresh the redundant cron runs exceed the runbook freshness windows. Primary database schedules remain healthy; this is not proof the redundant path recovered.                                                                                                                         |
| Supabase logs/advisors       | REVIEW REQUIRED               | 08:46–09:46 log window: Auth errors 0, edge HTTP 5xx 0; three Postgres `42501` errors reference `my_branch_accounts`, consistent with the failing service-worker fallback. Security Advisors show no ERROR findings, but warn about mutable function search paths, public extensions, definer grants, and disabled leaked-password protection. Review context before changing intentional public/authenticated RPC grants. |
| Backups and recovery         | PASS WITH ACCEPTED RISK       | [Backup run 36357784556](https://github.com/aarkay1805/UsefulDesk/actions/runs/36357784556) succeeded 27 September, with encrypted database and Storage uploads verified at 23:17 UTC. Disposable restore drill passed 23 August; next quarterly drill is due 23 November. Pre-key-rotation archives remain unrecoverable; the replacement key has one Apple Passwords copy and no approved offline copy.                  |
| Alerts                       | GITHUB INBOX ONLY             | Inbox failure delivery was verified 30 August in `GATES.md`. Email/mobile paging and an independent external watchdog remain unproven.                                                                                                                                                                                                                                                                                     |
| Change control and rollback  | KNOWN LIMITS                  | `main` is unprotected. CI for deployed `d1c7245d` passed ([run 36392531008](https://github.com/aarkay1805/UsefulDesk/actions/runs/36392531008)). Select a verified preceding READY application release for owner-approved rollback; migrations are forward-only and provider effects cannot be rolled back by deployment. Add branch protection before multiple release operators.                                         |
| SaaS Production boundary     | CLOSED AS INTENDED            | All nine private tables introduced by the four subscription draft migrations are absent in Production at 11:37 UTC. No automatic paid grant, renewal, or SaaS refund is available there. Real Test capture/refund and minimal-fixture SQL evidence do not constitute full application acceptance.                                                                                                                          |

## Repository fixes and recovery

`src/lib/whatsapp/legal-business-name.ts` now selects the explicit
`accounts_organization_legal_entity_fkey` relationship. Production has both that
composite FK and the older `accounts_legal_entity_id_fkey`; an unqualified embed
returns `PGRST201`. A service worker cannot recover through the authenticated
`my_branch_accounts` fallback. Read-only queries against the affected account
reproduced the old error and verified the explicit join returns its existing
canonical legal name. No identity data or database constraint needed changing.
The authenticated branch-member fallback remains for genuine RLS restrictions.

Regression coverage reproduces the ambiguous embed plus denied service RPC.
The environment checker now rejects enabled/hidden Test billing flags and any
unreleased SaaS merchant configuration in Production, printing names only.
Validation passed: 51 targeted tests across the helper, environment checker,
lifecycle worker and shared sender; root TypeScript; changed-file ESLint; and
diff/format checks. The preceding Home commit `d84a16e5` passed the full
3,964-test suite and production build before this audit. This audit did not
repeat the full build or claim authenticated end-to-end send acceptance.
These fixes do not deploy themselves or change the failed job. Review its
current relevance and delivery history before any separately authorized
recovery; do not bulk-reset failures or bypass stale/duplicate-send checks.

## Owner decisions and acceptance evidence

Rajat owns these decisions unless explicitly delegated. Record approvals and
sensitive evidence privately; retain only status, date, and reference here.

| ID   | Concrete next action                                                                                                   | Required evidence / deadline                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | Approve and perform Vercel Pro upgrade with a deliberate Spend Management threshold.                                   | Invoice/plan confirmation and healthy READY release; before issuing or accepting a paid order. Published base US$20/month plus usage/taxes; no purchase authorized by this audit.                                                                                                                                                                       |
| B-02 | Choose time-bounded acceptance of the verified Supabase Free-plan limits, or approve Pro.                              | Dated risk acceptance with review date and usage thresholds, or paid plan evidence; before confirming payment. Pro published base US$25/month; verification does not imply spending approval.                                                                                                                                                           |
| B-03 | Authorize a recipient and test real Auth sign-in and recovery delivery using the configured SMTP.                      | Private timestamp, delivery and completed sign-in/recovery outcome; before paid-owner onboarding. Configuration is already verified.                                                                                                                                                                                                                    |
| B-04 | Release the reviewed lookup patch, decide the failed reminder's disposition, and verify scheduled recovery.            | READY commit, fresh error/queue review, relevant worker result, and fresh successful GitHub cron runs or a documented owner-approved resolution of redundant-path degradation. Review Advisor warnings in context. Before paid activation; no automatic resend is authorized.                                                                           |
| B-05 | Check canonical URL and encryption-key format in Vercel's protected value UI.                                          | `NEXT_PUBLIC_SITE_URL` equals the canonical HTTPS origin; `ENCRYPTION_KEY` is 64 hexadecimal characters. Record pass/fail only before paid activation. Never paste values.                                                                                                                                                                              |
| C-01 | Obtain qualified confirmation of the founder's actual registration/accounting circumstances and quote/receipt process. | Adviser-confirmed treatment for the reported Punjab, unregistered, zero-turnover business, including relevant PAN-wide turnover and customer geography. Before a payable quote. The owner's decision to draft ₹0 GST is not tax approval.                                                                                                               |
| C-02 | Approve the exact limited pilot offer and choose manual or automated conversion.                                       | Included tested features, branch/member/staff limits, reminder schedule, third-party costs, cancellation/refund terms, quote expiry, and exact term. Provisional ₹799/₹1,499/₹3,999 monthly prices are planning inputs. Explicitly exclude unready annual/add-on features if deferred; no blanket founding-term approval. Before a payable quote.       |
| S-01 | Complete subscription acceptance against the full application schema and authenticated owner/staff web/native flows.   | Expiry/recovery, RLS and API denials, branch changes, background sends, rollback/replay/version conflicts and cross-organization isolation; minimal SQL fixtures alone are insufficient.                                                                                                                                                                |
| S-02 | Prove genuine separate Test-merchant webhook delivery, renewal and outage recovery.                                    | Provider-origin signatures/delivery/retries, delayed/duplicate events, browser loss, failed renewal/grace, refund settlement recovery without duplicate provider actions. Existing Test refund used direct provider GET/POST plus disposable SQL, not incoming provider webhook delivery.                                                               |
| S-03 | Resolve and implement the remaining scope before an explicit Production rollout decision.                              | Upgrade quote expiry/repricing, any offered add-on mechanics, paid tier gates and standard schedule, Test term convention, immutable renewal-change UX, post-refund restart policy. Defer excluded features explicitly. Then obtain separate migration, deployment and live-pilot authorization; no subscription Production migration is approved here. |

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

The audit itself used explicit project/team read APIs, with decrypted values
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

Official sources checked 28 September: [Vercel Hobby commercial-use policy](https://vercel.com/docs/plans/hobby),
[Vercel pricing](https://vercel.com/pricing), [Supabase pricing](https://supabase.com/pricing).
Advisor references: [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
and [Auth password protection](https://supabase.com/docs/guides/auth/password-security).
No tax eligibility determination is made by this record.

## Evidence refresh cadence

- Before each paid activation: deployment, environment policy, login, recent
  errors, failed jobs, both scheduler paths, and backup freshness.
- Monthly: provider plan/usage/spend thresholds and R2 lifecycle/usage.
- Quarterly: disposable-project restore drill.
- After provider, domain, auth, or billing changes: re-check the affected gate.
