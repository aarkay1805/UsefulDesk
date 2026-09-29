# UsefulDesk paid-pilot production readiness

**Gate status: CLOSED.** Before accepting money or activating the first paid
UsefulDesk term, close the common operational and commercial decisions below.
Automated subscriptions require the additional subscription acceptance gate.
An environment audit or a Test payment does not authorize a paid launch.

The original provider audit ran on **28 September 2026, 09:39–11:39 UTC**.
Plan, deployment, environment-name, database, workflow, backup, and public-URL
evidence was refreshed **29 September 2026, 13:02–13:16 UTC**. Usage, SMTP
configuration, advisor, and certificate details retain their earlier evidence
dates unless stated otherwise. This refresh purchased no plan, changed no
provider setting, applied no Production migration, moved no money, and sent or
replayed no customer message. With owner approval, it sent one Auth sign-in
email and one Auth recovery email to the owner for delivery checks.
Auth diagnosis and the owner's missed-confirmation decision were recorded on
**29 September 2026, 13:16–13:26 UTC**. A separately approved single sign-in
retest ran at **13:30–13:33 UTC**. No job was replayed or customer message sent.
Test work is scoped in [subscription Test acceptance](subscription-test-acceptance.md).

A read-only follow-up at **29 September 2026, 13:56–14:06 UTC** found the
draft PR still green at `f71930f9` and the canonical login returning HTTP 200
in 1.15 seconds. The isolated Vercel Production environment export again passed
the repository audit with zero blockers and three warnings: the protected site
URL and encryption key are redacted, and Turnstile is absent. It confirmed the
gym Razorpay mode/name set and the absence of every Test and Live SaaS billing
name or enabled safety flag. A direct Supabase organization read still showed
Free and the project `ACTIVE_HEALTHY`; a read-only schema query found no private
subscription or billing tables. The database ops and renewals schedules were
active and most recently succeeded at 13:53 and 13:41 UTC, respectively, with
adjacent HTTP 200 responses and no timeout. The two GitHub redundant schedules
remained active but stale at 07:00 and 07:31 UTC. The signed-in Vercel
dashboard still showed the team on Hobby, and confirmed the site URL and
encryption key are write-only Secrets with no Reveal action. Security Advisors returned no
ERROR findings; their existing search-path, extension, definer-grant, and
leaked-password warnings still need scoped review. No Production setting,
migration, provider payment, or customer message changed.

## Decision record

| Area                         | Status                        | Evidence and practical limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release          | HEALTHY; BILLING STILL OFF    | Production deployment `dpl_CGPp1Ka19Xp4kzrkTFnA4gX5Tywf` remains READY at `4072dccc` on `main`; the newer `f9eb635a` deployment `dpl_Eu3XoYrgqbN26kr7xvfePz96pce6` is READY as a preview, not Production. `desk.usefulmade.com/login` returned HTTP 200 in 0.79 seconds on 29 September; the last-hour Vercel runtime-error query found none.                                                                                                                                                                                                                                                                                    |
| Domain and TLS               | PASS                          | `desk.usefulmade.com` has a valid Let's Encrypt certificate through 2 December 2026. HSTS, report-only CSP, permissions/referrer policies, nosniff, and frame denial were present. Report-only CSP is not enforcement.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Vercel commercial permission | BLOCKER                       | The authenticated team-plan API still returned Hobby on 29 September at about 13:04 UTC. Vercel requires Pro or Enterprise for commercial use; the owner chose Pro with alerts only, while the upgrade and exact alert amount remain open.                                                                                                                                                                                                                                                                                                                                                                                       |
| Core environment             | PASS WITH WARNINGS            | The 29 September Production list has all seven required core names, with no `USEFULDESK_SAAS_*`, `USEFULDESK_SUBSCRIPTION_*`, Test/Live billing UI flags, or Turnstile names. `NEXT_PUBLIC_SITE_URL` and `ENCRYPTION_KEY` remain write-only Secrets: list and single-variable APIs returned `decrypted:false`, and the Chrome edit view also cannot reveal them. Their values are **unverifiable**, not failed. The isolated 29 September follow-up audit confirmed live gym Razorpay mode and required names; protected value formats remain unverifiable. Gym merchant configuration is separate from Usefulmade SaaS billing. |
| Public lead form             | UNAVAILABLE                   | Both Turnstile variables are absent; Production submissions fail closed. This is not a founder-referred pilot blocker, but public lead capture cannot be promised.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Supabase capacity            | FREE ACCEPTED TO 13 OCTOBER   | The organization still reports Free on 29 September. The 28 September dashboard had no exceeded quota: database 0.064/0.5 GB, Storage 0.004/1 GB, egress 0.229/5 GB, MAU 5/50,000, peak realtime connections 7/200. That usage snapshot is not a capacity forecast. The owner accepted Free temporarily through 13 October with earlier review triggers below.                                                                                                                                                                                                                                                                   |
| Auth SMTP                    | SIGN-IN VERIFIED; RESET OPEN  | The 28 September configuration check found Auth SMTP enabled at `smtp.resend.com:465`, sender UsefulDesk. On 29 September, the first owner-approved sign-in and recovery emails reached the inbox; the recovery request likely superseded the unused first sign-in token, which Supabase rejected. One separately approved sign-in retest reached the inbox, redeemed successfully, created a new owner Auth session, and opened the owner dashboard. The recovery link had reached the new-password form, but no credential was entered or changed. See the dated investigation below.                                          |
| Scheduled operations         | OWNER MARKED MISS; ROW FAILED | Both primary database schedules remain active; the latest inspected ops at 13:53 and renewals at 13:41 UTC on 29 September succeeded with adjacent HTTP 200 responses and no timeout. The owner chose to mark job `754b267e-a1c2-442d-a745-8d9c03d2b92c` missed without sending. It remains `failed` after five legal-name lookup retries, with zero provider attempts and no accepted/delivered message. There is no supported operator transition from this terminal row to a separate missed state. The prior scoped history check found no matching confirmation after payment.                                              |
| Redundant GitHub schedules   | DEGRADED                      | The latest scheduled [ops run 36534084635](https://github.com/aarkay1805/UsefulDesk/actions/runs/36534084635) succeeded at 07:00 UTC and [renewals run 36537097296](https://github.com/aarkay1805/UsefulDesk/actions/runs/36537097296) at 07:31 UTC on 29 September. At the 14:02 UTC follow-up both were still stale against the runbook's 75-minute and two-hour windows. [Production health run 36570145710](https://github.com/aarkay1805/UsefulDesk/actions/runs/36570145710) succeeded at 12:44 UTC; that does not clear the two redundant schedules. Primary database schedules remain healthy.                           |
| Supabase logs/advisors       | REVIEW REQUIRED               | 08:46–09:46 log window: Auth errors 0, edge HTTP 5xx 0; three Postgres `42501` errors reference `my_branch_accounts`, consistent with the failing service-worker fallback. Security Advisors show no ERROR findings, but warn about mutable function search paths, public extensions, definer grants, and disabled leaked-password protection. Review context before changing intentional public/authenticated RPC grants.                                                                                                                                                                                                       |
| Backups and recovery         | PASS WITH ACCEPTED RISK       | The 29 September nightly [backup run 36503169579](https://github.com/aarkay1805/UsefulDesk/actions/runs/36503169579) succeeded, including its export, encrypt, upload, and verify step. The last separately inspected database-and-Storage upload evidence remains [run 36357784556](https://github.com/aarkay1805/UsefulDesk/actions/runs/36357784556). Disposable restore passed 23 August; next drill is due 23 November. Pre-key-rotation archives remain unrecoverable, and the replacement key has no approved offline copy.                                                                                               |
| Alerts                       | GITHUB INBOX ONLY             | Inbox failure delivery was verified 30 August in `GATES.md`. Email/mobile paging and an independent external watchdog remain unproven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Change control and rollback  | KNOWN LIMITS                  | `main` remains unprotected (GitHub branch-protection API returned 404). CI for deployed `4072dccc` passed ([run 36554758624](https://github.com/aarkay1805/UsefulDesk/actions/runs/36554758624)). Select a verified preceding READY application release for an approved rollback; migrations and provider effects need separate recovery. Add branch protection before multiple release operators.                                                                                                                                                                                                                               |
| SaaS Production boundary     | CLOSED AS INTENDED            | A 29 September Production `information_schema` check found zero private subscription billing tables. The deployed release has no automated paid grant, renewal, or SaaS refund. Full-schema Test capture/refund/renewal, signed provider delivery and retries, and simulator/physical-device access checks have passed; they do not install Production billing or establish a Live Usefulmade merchant.                                                                                                                                                                                                                          |

The later local [dark Live boundary draft](subscription-live-boundary.md) has a
separate adapter and service-only schema, but it is uninstalled. A rollback-only
disposable full-schema SQL check passed with synthetic facts; no Live merchant,
Production migration or real-money acceptance was involved. The Production
status in the table remains closed.

### Owner choices recorded 29 September 2026

- **Hosting:** the owner chose Vercel Pro with alerts only for a paid pilot.
  A suggested initial Spend Management amount is **US$20 of metered overage per
  billing cycle**, with web/email alerts at Vercel's 50%, 75% and 100%
  thresholds. This is a review suggestion, not an approved total spend cap:
  alerts do not stop usage, and the amount excludes the base plan, seats and
  other separately billed items. The team remains on Hobby; no upgrade, budget
  setting or purchase was performed. Confirm the amount and configure alerts
  when the owner performs the approved upgrade.
- **Database capacity:** the owner accepted Supabase Free temporarily for a
  narrow paid pilot. Review by **13 October 2026**, and sooner if any published
  Free quota reaches 50%, the project pauses, a backup fails, or a paid user
  encounters a capacity issue. The existing custom backup remains a separate
  recovery control; it does not turn Free into a platform backup entitlement.
  If the first paid term starts after that date, refresh this acceptance before
  taking payment. No Pro purchase was performed.
- **SaaS merchant and tax:** after checking the opened Chrome dashboard, the
  owner clarified that **no separate Usefulmade Live merchant exists yet**.
  The visible `acc_TCJwBqanN9LTrK` is the gym collection merchant already
  pinned in the repository and cannot serve as the isolated SaaS merchant.
  Create and activate a distinct account, then privately verify its `acc_`
  identity and business approval before configuring Live billing. Qualified tax
  advice for a customer-payable quote and receipt is also not yet ready. No
  approval ledger row or payable quote exists.
- **First paid offer scope:** the owner approved one expired-trial organization
  buying Starter at the provisional ₹799 for one calendar month and one active
  branch, through web Checkout only. Renewal is owner-initiated. Upgrades, paid
  add-ons, automated restart, and native Checkout are outside this first offer.
  This records product scope, not the tax-confirmed payable amount, Live billing
  authorization, or an identified pilot organization. Starter's standard
  membership/service renewal reminders are 7, 3, and 1 days before expiry at
  09:00 in the gym account timezone, subject to WhatsApp/template/send readiness.
  The initial paid month starts at the signed Razorpay `payment.captured` event
  time, not the later webhook-processing time. The owner set a **30-minute**
  lifetime from immutable owner review for the first Starter quote; capture
  after expiry stays held for review without an access grant or automatic
  refund. There are no pilot-specific numeric member or staff caps, although
  existing role, provider, technical and abuse limits remain. The approved
  Starter feature list is members/plans, memberships/renewals, attendance,
  manual payment recording, shared WhatsApp chats, and standard renewal
  reminders. Custom schedules, bulk campaigns, configurable automations,
  gym-member Payment Links, and AutoPay are excluded from this pilot. The
  exact tax-approved payable wording still requires review before a quote.

For C-01, give the qualified adviser the founder's exact legal supplier/PAN,
current and prior financial-year PAN-wide turnover, intended pilot-customer
states, proposed subscription description and monthly charge, the first-full-
payment refund policy, and the fact that the gym's member collections use its
own merchant. Obtain a written conclusion on registration before the first
charge, any customer-geography restriction, the tax amount or absence of tax
on the payable quote, and the required supplier/customer/receipt fields and
refund record. Record the conclusion reference privately and copy only the
approved customer wording into the immutable Live offer approval. The existing
₹0 GST draft is planning data and must not be presented as an adviser decision.

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
Focused helper and lifecycle tests passed (25/25). The payment was created
28 September 04:39 UTC. On 29 September the owner explicitly chose to mark this
one confirmation **missed without sending**. The queue row remains `failed`:
its state constraint has no `missed` value, and the service-role finish RPC can
move to `skipped` only from an active lease, not from this terminal failure.
There is no supported non-sending operator transition for this row. Preserve
its failed audit record and the owner's decision here; do not bulk-reset,
replay, invoke cron, or send a late confirmation.

## Auth sign-in investigation

Supabase Auth logs show the owner's magic-link request (`POST /otp`, HTTP 200)
at **13:11:42 UTC** and password-recovery request (`POST /recover`, HTTP 200)
at **13:11:55 UTC** on 29 September. The first observed magic-link verification
was `GET /verify` at **13:13:10 UTC**; Supabase rejected it as “Email link is
invalid or has expired” before the application callback. The recovery
token-hash `POST /verify` succeeded at **13:16:19 UTC** for the owner and opened
the new-password form; no password update was performed.

The sign-in email pointed to Supabase `/auth/v1/verify` with `type=magiclink`
and the intended `/auth/callback?next=/dashboard` redirect. The recovery email
used `/auth/callback` with `type=recovery`. The Production Auth Site URL is
`https://desk.usefulmade.com`; its redirect allowlist includes both the exact
callback URL and a wildcard for this origin. Redirect configuration does not
explain the provider-side 403. Supabase Auth's
[magic-link and recovery implementation](https://github.com/supabase/auth/blob/master/internal/api/mail.go)
stores both links in the same recovery-token slot; the Production
`auth.one_time_tokens` table also has a unique `(user_id, token_type)` index.
The recovery request made 13 seconds later therefore most likely replaced the
unused sign-in token.
This is a strongly supported diagnosis rather than a direct observation of the
superseded token. With separate owner approval, exactly one additional sign-in
email was requested at **13:30:56 UTC**, with no subsequent recovery request.
It reached the owner's inbox and its link was redeemed at **13:32:45 UTC**.
Supabase recorded a successful login and a new owner `auth.sessions` row at
that time. The owner dashboard was visible and remained accessible at a clean
`/dashboard` URL. The browser already held an owner session from the earlier
recovery flow, so this check proves link redemption and a new Auth session but
does not separately isolate first-time cookie setup in a signed-out browser.
No further email or password change was performed.

## Owner decisions and acceptance evidence

Rajat owns these decisions unless explicitly delegated. Record approvals and
sensitive evidence privately; retain only status, date, and reference here.

| ID   | Concrete next action                                                                                                   | Required evidence / deadline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | Confirm the suggested metered-overage alert amount and perform the Vercel Pro upgrade.                                 | Invoice/plan confirmation and healthy READY release; before issuing or accepting a paid order. Published base US$20/month plus usage/taxes; no purchase authorized by this audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B-02 | Review the temporary Supabase Free acceptance by 13 October 2026, or sooner at the recorded triggers.                  | Owner accepted Free through 13 October 2026 with earlier 50%-quota, pause, backup, or paid-user triggers; refresh before payment if that date has passed. Pro remains an option at published base US$25/month; no purchase authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| B-03 | Complete the owner password-recovery flow if it is required for onboarding.                                            | Owner-approved sign-in and recovery emails reached the inbox on 29 September. The first sign-in token was most likely replaced by the following recovery request. A separately approved single sign-in retest at 13:30–13:33 UTC redeemed successfully, created a new owner Auth session, and showed the owner dashboard. The recovery link authenticated the owner and reached the new-password form; only the owner may enter and submit a new password. Record any completed reset privately before paid-owner onboarding.                                                                                                                                                                            |
| B-04 | Verify scheduler recovery and retain the missed-confirmation decision.                                                 | On 29 September the owner chose **missed; do not send** for job `754b267e-a1c2-442d-a745-8d9c03d2b92c`. The row remains terminal `failed` because there is no supported non-sending missed transition; see the scoped evidence above. Obtain fresh successful GitHub scheduled runs or an approved resolution of their degradation, and review Advisor warnings in context. No automatic or late resend is authorized.                                                                                                                                                                                                                                                                                   |
| B-05 | Check canonical URL and encryption-key format in Vercel's protected value UI.                                          | Both variables are saved as write-only Vercel Secrets. The list/export and 29 September Chrome edit view cannot reveal either value. Verify the canonical HTTPS URL and 64-hex key format from their original secure source without pasting values, or plan a separately approved rotation and recovery check. Record only pass/fail before paid activation.                                                                                                                                                                                                                                                                                                                                             |
| C-01 | Obtain qualified confirmation of the founder's actual registration/accounting circumstances and quote/receipt process. | Adviser-confirmed treatment for the reported Punjab, unregistered, zero-turnover business, including relevant PAN-wide turnover and customer geography. Before a payable quote. The owner's decision to draft ₹0 GST is not tax approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C-02 | Finish the exact first Starter offer and customer-facing terms.                                                        | One expired-trial organization, provisional ₹799, one active branch, one capture-event calendar month, web Checkout, owner-initiated renewal, and 7/3/1 reminders at 09:00 account-local are approved as scope. The reviewed quote lasts 30 minutes; late capture is review-held. No pilot-specific numeric member/staff caps. The Starter feature list in the owner choice above is approved. Upgrades, paid add-ons, automated restart, and native Checkout are excluded. Still confirm third-party charges, cancellation/refund wording, exact tax-confirmed payable amount, and pilot organization before a payable quote.                                                                           |
| S-01 | Finish the remaining product and release-specific acceptance.                                                          | Full-schema owner/staff isolation, genuine Test payment/refund/renewal recovery, downgrade archive rollback/replay, and simulator plus physical iPhone access checks passed in the [Test record](subscription-test-acceptance.md). Tier/reminder capability activation and its final UI/native/background acceptance remain open. A signed physical iPhone Release build passed HTTPS Test sign-in and active/refunded/trial access recovery; advanced native Checkout and distribution-signed preview remain separate checks. Physical PostgreSQL crash/storage recovery was not tested; decide whether it is a release requirement rather than treating an injected transaction failure as that proof. |
| S-02 | Create and activate a separate Usefulmade Live merchant, then finish the Live billing path.                            | Test webhook delivery, provider retry after an isolated PostgREST outage, delayed failure after capture, and settled full refund passed. Production still has no SaaS tables, Live adapter/configuration, or verified Usefulmade Live merchant. Require merchant activation, exact credential/webhook isolation from gym collections, release-specific signed delivery and reconciliation, and an explicitly authorized controlled real-money pilot. Test renewal orders are owner-initiated; the Live draft has no renewal order/settlement yet. Do not promise an actionable Live renewal or automatic debit without implementation.                                                                   |
| S-03 | Accept the limited Starter path before an explicit Production rollout decision.                                        | The approved first offer excludes upgrades, paid add-ons, automated restart, and native Checkout; their detailed policies can wait. Verify the approved Starter feature list is enforced and presented accurately; test the 30-minute quote, late-capture hold, 7/3/1 at 09:00 local policy and capture-event initial term, plus owner-initiated renewal/cancellation/refund UX and relevant native access recovery. Review existing custom schedules and complete capability activation acceptance. Separately authorize migration, deployment, and gate activation; none is approved by this record.                                                                                                   |

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
value. Do not substitute `vercel env run` for this isolated export: the CLI can
also load this checkout's `.env.local`, which produced false Production blockers
in the 29 September follow-up. The isolated export above was the authoritative
audit. Repeat public/workflow/database checks from the
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
