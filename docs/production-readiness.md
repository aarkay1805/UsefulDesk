# UsefulDesk paid-pilot production readiness

**Gate status: CLOSED.** Before accepting money or activating the first paid
UsefulDesk term, close the common operational and commercial decisions below.
Automated subscriptions require the additional subscription acceptance gate.
The owner-selected payment-only internal run follows its own concrete
[opening proposal](subscription-payment-only-opening-proposal.md); genuine
customer and reminder acceptance remain separate. An environment audit or a
Test payment does not authorize a paid launch.

**Current baseline — 1 October 2026:** Production is intake-only on merged
PR #21 main `71d897a6`, READY `dpl_5KoHAR59NNQyT2WWsikE2rYoDx8h` at the
canonical domain. Both reviewed opening/recovery sources are installed after
fresh full backup 36846306908; the complete 28-source manifest and connector
mapping are in the [installation record](subscription-production-install-record.md).
Every financial/capability/policy/advanced/Test gate remains closed, all SaaS
ledgers empty and existing access/data unchanged. Vercel invoice GQBCLHWV-0001
is now Paid / US$0.00 due, matching the owner's confirmation. The
[exact review packet](subscription-production-pilot-review.md) is prepared;
actual internal accounting/opening review and a human's genuine Live capture/refund
remain before financial activation. Meta approval/sync and authorized delivery
are independent reminder gates; no customer sale or self-invoice is claimed.

Use the [release review](subscription-release-review.md),
[read-only preflight](subscription-rollout-preflight.md),
[acceptance walkthrough](subscription-live-acceptance-walkthrough.md),
[financial recovery runbook](subscription-financial-recovery-runbook.md) and
[conditional customer document pack](subscription-customer-document-pack.md).
The dated checks below preserve the earlier uninstalled/closed snapshots;
those earlier observations do not override the current intake-only baseline.

**30 September public-policy update:** the owner approved ₹799 gross for an
invited Starter month, the local day-7 first-payment refund request window,
and the two-business-day acknowledgement/initiation timeline. UsefulMade PR
#2 (`eb0acb9`) published the [refund policy](https://usefulmade.com/useful-desk/refunds/),
price, terms and privacy update; the live policy URL returned 200. The owner
reported no foreign-service purchases before checkout and no real first customer.
The dedicated, empty Razorpay review account was confirmed, its sign-in verified,
and its temporary login submitted with owner authorization. The later
30 September dashboard confirms `desk.usefulmade.com` **successfully verified**.
The owner authorized Live key generation and completed Razorpay's SMS
verification. The pair is saved privately with 0600 permissions; a read-only
Orders API request returned 200. No provider order or payment was created.
At that pre-installation check the SaaS webhook configuration was prepared
privately but not yet installed.
Vercel shows **Pro Plan Active**. The owner's successful-payment confirmation
was reconciled read-only on 1 October: invoice `GQBCLHWV-0001` is **Paid**,
**US$23.60 paid / US$0.00 due** (US$20 plan plus US$3.60 tax). Its saved
on-demand usage budget is US$20, alerts on and project pausing off. No duplicate
payment was attempted; the prior Open / Payment failed discrepancy is closed.
Review the actual foreign-service invoice and applicable GST treatment before
the first customer invoice; the earlier no-purchase statement predates checkout. Neither public policy nor
an internal review account opens Live billing.

**30 September pre-installation release recheck:** PR #18 is merged at
`fbc8a9ddfddede1c4ea48dc9a77ea1a2ee6f0ac4`, with CI, CodeQL and Vercel
checks passing. GitHub Production deployment `6751236716` reports success for
that exact SHA. The focused Live provider/order/settlement/refund/Checkout,
owner-review UI and route run passed **60 tests in 9 files**. All three
rollback-only full-schema Live suites passed with twelve draft migrations,
leaving no installed Live schema. A read-only Production connector query found
**zero private subscription/billing tables**. These are disabled-release and
synthetic acceptance checks; final browser presentation, capability/send rollout
and genuine signed Live shared-merchant acceptance remain open. The owner asks
to continue on the basis of Pro Active and reported payment; work independent
of invoice settlement proceeds while the contradictory invoice remains recorded.

**30 September browser evidence:** the unchanged Live owner review component
passed an isolated synthetic browser fixture, including ₹799 terms, separate
complimentary conversion consent, reminder-gated payment, expired/held states,
cancellation/refund stops, expiry-only renewal review and errors. Shared controls
and styles fit Chrome desktop and 320/390 px phone viewports. This closes only
the component presentation check; authenticated full-app, final issuer wording,
capability/send and genuine Live acceptance remain open. See the
[Test record](subscription-test-acceptance.md).

**30 September authenticated follow-up:** four local full-schema Auth/API/RLS
and mocked-worker checks passed for Starter's standard-reminder boundary,
custom-schedule refusal, downgrade normalization, account-local 09:00 cutoff,
7/3/1 selection, dedupe, missed-day behavior and access revocation before send.
The actual signed-in settings page passed desktop/390 px checks and saved the
standard switch through the real API. Temporary data and settings were restored.
This closes local web/worker acceptance only; final operational staging,
approved-template delivery, capability activation/native and Live payment/refund
acceptance remain open. The capability SQL fixture now exercises current
transaction hooks through a repeatable rollback-only runner.

**30 September baseline cloud staging acceptance:** the owner-approved US$0/month
UsefulDesk Billing Staging project received the full schema with cron inactive.
Rollback billing/capability SQL, six real cloud Auth/API/isolation/worker checks
and staging-backed desktop/390 px settings acceptance passed. All disposable
users, tenants, payments and provider configurations were removed; every billing
gate and access enforcement is false, bindings null and cron inactive.
The older Test project remains paused. The [staging record](subscription-staging-plan.md)
identifies the missing Production independent-brand/legal-identity source and
the [26-source dark installation manifest](subscription-production-install-manifest.tsv).
This does not establish actual provider delivery or final native/Live acceptance.

**30 September dark installation, 12:31 UTC:** after the fresh encrypted database
and Storage [backup 36714071889](https://github.com/aarkay1805/UsefulDesk/actions/runs/36714071889)
passed, all 26 pinned sources installed through the approved migration tool.
Production has 24 private billing tables with RLS and no browser access, 108
public tables/313 policies and zero public tables without RLS. Every billing gate
is false, bindings null and Test/Live financial/event/offer records empty.
Existing tenant/legal/access fingerprints and settings, 554 gym payments and
both active cron jobs were unchanged. The eight legal/brand definitions and
privileges now match accepted staging. [Production health 36715265916](https://github.com/aarkay1805/UsefulDesk/actions/runs/36715265916)
passed afterward. See the [installation record](subscription-production-install-record.md).
The later owner-authorized Production configuration is recorded below; no payable offer is open.

**30 September closed configuration, 14:09 UTC:** six Production-only SaaS
entries are installed, with the key secret/webhook secret protected. The approved
merchant and Home office pilot are bound in the database; every billing boolean
remains false and existing access enforcement true. Exact main `3eb8ce2f` is
READY as `dpl_33qP9azFZjDUkBc2auiExeGBLLnh` on the canonical domain.
The audit has zero blockers/four warnings (owner-attested original protected
values, privately validated Live secrets and absent Turnstile); its private export
was removed. Four Live webhook/quote/order/refund POSTs return 404; existing
users/tenants, 554 gym payments and both cron jobs are unchanged, with new Live
financial/event/offer records empty. [Production health 36726882870](https://github.com/aarkay1805/UsefulDesk/actions/runs/36726882870)
passed. The subsequent [approved intake-only activation](subscription-production-install-record.md#approved-intake-only-activation-1615-utc)
is complete: exact main `5920fa78` is READY, the explicit audit has zero blockers,
unsigned intake returns 400 and money endpoints remain 404. Razorpay webhook
`TiJKErwIC7VvRr` is Enabled with the five approved events and a configured
secret. Every other billing/capability gate remains off, financial/event/offer
rows are empty, preservation counts are unchanged, and Production health
36742907792 passed. Genuine signed delivery/payment/refund acceptance remains.

**30 September configuration recheck, 10:17 UTC:** an isolated CLI Production
export passed the audit with **zero blockers and three warnings**: protected
site URL/key values remain unverifiable, and Turnstile is absent. Test and Live
SaaS configuration remains absent. The private export was deleted and no values
were printed. The saved CLI session refreshed successfully; no new token or
provider setting was requested. Canonical Production
`dpl_56BCLwRBcrqgVGrgbYKWByEus5Ym` is READY for exact `fbc8a9dd`, with
`desk.usefulmade.com` aliased. At the 09:57 UTC database recheck, ops and renewals
were active and last succeeded at 09:53/09:41 UTC; adjacent responses were 200
with no timeout. GitHub redundant ops, renewals and health runs succeeded on the
same SHA at 08:23/09:00/06:50 UTC. The latest backup succeeded at 23:48 UTC
on 29 September. At the 10:17 UTC pre-installation check Production had zero private subscription/billing tables.

**30 September protected-value confirmation:** the owner checked the original
secure source and confirmed both values: the site URL is the canonical
`https://desk.usefulmade.com` and the encryption key is exactly 64 hexadecimal
characters. B-05 is closed by owner attestation. The export still reports its
redaction warnings; no secret was pasted, rotated or independently revealed.

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
On 30 September, a read-only connector audit found the cloud Test project has
23 Test-specific migrations and a minimal subscription foundation, versus 299
connector migration entries in Production. Test was briefly restored to read
its history and tables, then confirmed INACTIVE again. No cloud
schema changed. It is not a full-schema staging target for the Live drafts; see
the Test acceptance record.

A read-only follow-up at **29 September 2026, 13:56–14:06 UTC** found the
then-current draft PR green at `f71930f9` and the canonical login returning HTTP 200
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

At the **29 September 2026, 17:04 UTC** PR check, the newer disabled billing
foundation at `a5120b5a` remained a draft, mergeable PR. Its
[CI run](https://github.com/aarkay1805/UsefulDesk/actions/runs/36601787804),
CodeQL checks, and Vercel preview check passed. This is a code-review and
merge candidate with billing disabled; it is not a Production deployment,
schema installation, merchant-route acceptance, payable quote, or gate opening.
A read-only Production recheck around **17:30 UTC** found Supabase
`ACTIVE_HEALTHY`, zero private subscription/billing tables, Vercel Production
still READY at `4072dccc`, and the `a5120b5a` preview READY. The Vercel team
was still on Hobby. Its Pro upgrade screen quoted US$20/month immediately plus
taxes, CDN tier and metered usage, and lacked a billing address; no upgrade was
performed. **Later release evidence:** PR #16 merged at
`a237ead7403f3d0653fb44a6a3179ad33a2a177f`; CI passed and canonical
Production is READY at `dpl_CVCkXK7H6udXzxNgdwuaaApjufak`. Login GET returned
200; unauthenticated Live quote and webhook POSTs returned 404. The foundation
app is deployed with billing off; no Production subscription migration or
billing activation occurred. PR #17 subsequently merged at
`a1a0ddab7432e0204cfdc027f042b9c87b01115e`; canonical Production
`dpl_AZtfZQ2qs1TiLhTBt6JdeoZN2vtM` was READY on 29 September. Hosted CI
and CodeQL passed, login returned 200, and unauthenticated Live quote/webhook
POSTs returned 404. Default-off shared-merchant routing and selected-pilot
conversion are deployed, while Live schema and billing remain absent. Other
Production observations below remain dated
snapshots and must be refreshed for the actual paid rollout.

## Decision record

| Area                         | Status                                | Evidence and practical limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release          | HEALTHY; INTAKE ONLY                  | Exact main `71d897a6dfd17b7938129d2b7a3cfbb808531a80`, READY canonical `dpl_5KoHAR59NNQyT2WWsikE2rYoDx8h`, main CI/CodeQL passed. Both reviewed additive sources installed; money/recovery activation closed. Natural primary ops verified recovery disabled/inspected 0. See latest installation record.                                                                                                                                                                                                                                                                               |
| Domain and TLS               | PASS                                  | `desk.usefulmade.com` has a valid Let's Encrypt certificate through 2 December 2026. HSTS, report-only CSP, permissions/referrer policies, nosniff, and frame denial were present. Report-only CSP is not enforcement.                                                                                                                                                                                                                                                                                                                                                                  |
| Vercel commercial permission | PRO ACTIVE; INVOICE PAID              | Owner confirmation reconciled read-only on 1 October: GQBCLHWV-0001 Paid, US$23.60 paid, US$0.00 due. No duplicate charge. Existing US$20 on-demand usage alerts with project pausing off are not a total spend cap.                                                                                                                                                                                                                                                                                                                                                                    |
| Core environment             | PASS WITH WARNINGS                    | The approved intake-only Production export passed with zero blockers/five warnings and all seven required core names plus the six SaaS Live entries. Key secret and webhook secret are protected; original private metadata/secret presence/format checks passed before stdin transfer. The original protected site URL and 64-hex encryption key remain owner-attested. Turnstile is absent. The temporary export was deleted. Only signed-intake flags are true; all money/UI/capability/Test flags remain false or unset. Gym OAuth remains separate from SaaS keys.                 |
| Public lead form             | UNAVAILABLE                           | Both Turnstile variables are absent; Production submissions fail closed. This is not a founder-referred pilot blocker, but public lead capture cannot be promised.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Supabase capacity            | FREE ACCEPTED TO 13 OCTOBER           | The organization still reports Free on 29 September. The 28 September dashboard had no exceeded quota: database 0.064/0.5 GB, Storage 0.004/1 GB, egress 0.229/5 GB, MAU 5/50,000, peak realtime connections 7/200. That usage snapshot is not a capacity forecast. The owner accepted Free temporarily through 13 October with earlier review triggers below.                                                                                                                                                                                                                          |
| Auth SMTP                    | SIGN-IN VERIFIED; RESET OPEN          | The 28 September configuration check found Auth SMTP enabled at `smtp.resend.com:465`, sender UsefulDesk. On 29 September, the first owner-approved sign-in and recovery emails reached the inbox; the recovery request likely superseded the unused first sign-in token, which Supabase rejected. One separately approved sign-in retest reached the inbox, redeemed successfully, created a new owner Auth session, and opened the owner dashboard. The recovery link had reached the new-password form, but no credential was entered or changed. See the dated investigation below. |
| Scheduled operations         | PRIMARY HEALTHY; MISSED ROW PRESERVED | The 17:50 UTC [preflight](subscription-rollout-preflight.md#schedulers-and-recovery-point) found primary ops at 17:38 UTC and renewals at 17:41 UTC on 30 September returning HTTP 200, failed 0, no timeout; both schedules remain active. One deferred reminder and zero attempts do not prove delivery. The owner-marked missed confirmation job `754b267e-a1c2-442d-a745-8d9c03d2b92c` retains its failed audit record and must not be replayed.                                                                                                                                    |
| Redundant GitHub schedules   | OWNED FRESHNESS EXCEPTION             | 1 October natural ops 36842360303 at 09:22:59 UTC succeeded; renewals 36832539093 at 07:49:02 UTC exceeds 120 minutes and public health 36829161013 at 07:14:08 UTC remains old. Primary ops/renewals are healthy; Rajat owns the SEV-3 redundant-path follow-up. No send-capable dispatch manufactured freshness.                                                                                                                                                                                                                                                                      |
| Supabase logs/advisors       | REVIEW REQUIRED                       | 08:46–09:46 log window: Auth errors 0, edge HTTP 5xx 0; three Postgres `42501` errors reference `my_branch_accounts`, consistent with the failing service-worker fallback. Security Advisors show no ERROR findings, but warn about mutable function search paths, public extensions, definer grants, and disabled leaked-password protection. Review context before changing intentional public/authenticated RPC grants.                                                                                                                                                              |
| Backups and recovery         | PASS WITH ACCEPTED RISK               | Full pre-install backup 36846306908 passed on 1 October with encrypted database and 44-object Storage verification. Disposable restore passed 23 August; next drill due 23 November. Prior key-custody limitations remain; no new restore drill claimed.                                                                                                                                                                                                                                                                                                                                |
| Alerts                       | GITHUB INBOX ONLY                     | Inbox failure delivery was verified 30 August in `GATES.md`. Email/mobile paging and an independent external watchdog remain unproven.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Change control and rollback  | KNOWN LIMITS                          | Main remains unprotected. Exact `71d897a6` CI 36846490310 and CodeQL 36846489827 passed. Identified prior READY `5920fa78` is an application rollback candidate before money with separate owner approval and additive schema retained. Provider effects are not undone by rollback.                                                                                                                                                                                                                                                                                                    |
| SaaS Production boundary     | CLOSED AS INTENDED                    | All 14 private Live tables have RLS/browser denial/service SELECT-only; no public tables lack RLS and no Live triggers are disabled. The 16 affected functions/catalogs match staging. Intake alone is true, financial/offer/recovery ledgers empty and tenant/access/554 gym payments unchanged. No actual Live acceptance or opening review is fabricated.                                                                                                                                                                                                                            |

The later local [dark Live boundary draft](subscription-live-boundary.md) has a
separate adapter and service-only schema, now installed with its approved closed
configuration. Its earlier rollback-only
disposable full-schema SQL check passed with synthetic facts. Separate database
sessions found and then verified a fix for a quote-expiry race, plus checked
overlapping quotes, capture/cancellation order, and shutdown during order
issuance. The concurrent clone omitted unrelated cron/realtime/vault objects;
no Live provider, Production migration or real-money acceptance was involved.
The Production status in the table remains closed.

### Closeout handoff: intake-only installation versus paid activation

The disabled foundation and 28-source schema are installed. The owner approved
PR #21's closed release/install in this separate chat; exact `71d897a6` is now
canonical READY and preservation/schema checks pass. That release installed
no offer/opening review or money/capability activation. Keep the paid gate CLOSED.

Use the [exact review packet](subscription-production-pilot-review.md) for actual
internal accounting classification/reviewer/date/evidence and the financial
opening decision. Main release, installed source/history mapping, backup,
environment and provider prerequisite evidence are now concrete. Genuine signed
capture/refund evidence follows the human run and cannot be invented beforehand.

The selected UsefulMade / Home office organization
`8826d9aa-03f2-4ad7-ae91-0553052131f8` has one active branch and complimentary
access in the recorded baseline. The default-off conversion preserves that
access until signed captured settlement and requires an unchanged reviewed
access version. An eligible processed full first-payment refund ends the paid
term without restoring complimentary access. Existing enforcement remains true;
no Production access changed. This organization shares the supplier's proprietor,
so label its future controlled run internal technical acceptance and create no
self-sale or invoice. An ordinary customer document additionally needs a genuine
buyer and final fact-supported issuer treatment.

The canonical membership renewal replacement is **In review** at Meta, with five
POSITIONAL variables, no footer and one “Help me renew” reply button. Approval,
sync and a selected authorized actual send remain before reminder delivery
acceptance. The existing service renewal contract is Approved. Earlier deliveries
of the retired membership contract are not acceptance for the current contract.
The current opening candidate permits only the initial Starter term;
expiry renewal, native Checkout, advanced add-ons, broader merchant/pilot scope
and global capability activation remain separate.

The owner-selected [payment-only proposal](subscription-payment-only-opening-proposal.md)
separates Home office ₹799 first-term capture/refund internal technical acceptance
from Meta approval/current-contract delivery. Its own exact release/opening,
internal accounting and human payment/refund gates must close first. Retain the
7/3/1 after-09:00 policy and owner acknowledgement; no reminder send, broader
feature acceptance or customer sale/invoice follows from this run.

### Owner choices recorded 29 September 2026

- **Hosting:** the owner chose Vercel Pro with alerts only for a paid pilot.
  On 30 September the owner completed checkout and Vercel showed Pro Active.
  The 1 October read-only invoice refresh now confirms GQBCLHWV-0001 Paid,
  US$23.60 paid including US$3.60 tax, US$0.00 due. The saved on-demand usage
  budget is US$20 per billing period, alerts at the displayed 50%, 75% and 100%
  thresholds, project pausing off. It excludes the base plan and separately
  billed items and does not cap total spend. No duplicate payment occurred.
- **Database capacity:** the owner accepted Supabase Free temporarily for a
  narrow paid pilot. Review by **13 October 2026**, and sooner if any published
  Free quota reaches 50%, the project pauses, a backup fails, or a paid user
  encounters a capacity issue. The existing custom backup remains a separate
  recovery control; it does not turn Free into a platform backup entitlement.
  If the first paid term starts after that date, refresh this acceptance before
  taking payment. No Pro purchase was performed.
- **SaaS merchant and tax:** the owner requested reuse of the current Razorpay
  merchant `acc_TCJwBqanN9LTrK`. Its dashboard shows business/brand UsefulMade,
  proprietorship, active account access, and approved `usefulmade.com`. It has
  historically handled gym collections, but that usage does not make it a
  separate legal merchant. Razorpay's dashboard says API keys are universal
  across approved websites/apps. The later 30 September check confirms
  `desk.usefulmade.com` successfully verified. Live keys are privately saved
  and read-only authentication passes. Independent Production-only SaaS keys,
  merchant/pilot binding and approved intake-only webhook configuration are
  now installed after isolated full-schema staging. The provider describes API keys as universal across approved
  websites/apps; this does not assume a second key pair is mandatory.
  **External merchant acceptance:** the refreshed 30 September dashboard lists
  `usefulmade.com` as Approved and `desk.usefulmade.com` successfully verified. Its additional-site dialog says the
  new site must use the same business model; a different model needs a separate
  account. The owner completed SMS OTP, authorized the dedicated empty review account
  and sharing its temporary login, and the site submission was accepted on
  30 September. The subsequent successful verification closes the website
  prerequisite. Actual Live shared-merchant delivery and reconciliation acceptance
  still precede paid activation. Keep the requested website,
  product description, policy links, sample invoice and test login (if Razorpay
  asks) aligned with the final customer offer. The handoff needs the live
  UsefulDesk product description, stable terms, privacy, cancellation/refund
  policy with a processing timeline, support contact, and an explicitly
  marked unissued ordinary-invoice sample. UsefulMade PR #2 published the
  approved Starter price, terms, privacy update and cancellation/refund policy.
  The local shared-merchant routing fix classifies provider-proven gym events as
  unrelated to SaaS, leaves ambiguous SaaS deliveries retryable, and keeps SaaS
  refunds out of the gym ledger. Signed mixed-delivery acceptance on the actual
  merchant is still required. Document the supplier's registration, tax and
  receipt determination from verified facts before a payable quote; obtain
  qualified advice if those facts or an exception remain uncertain. No approval
  ledger row or payable quote exists.
- **First paid offer scope:** the owner approved one expired-trial organization
  buying Starter at the provisional ₹799 for one calendar month and one active
  branch, through web Checkout only. The current opening candidate is initial-term
  only; approved later renewal is owner-initiated and remains hard-closed. Upgrades, paid
  add-ons, automated restart, and native Checkout are outside this first offer.
  This records product scope, not the tax-confirmed payable amount, Live billing
  authorization. The selected pilot is UsefulMade / Home office, organization
  `8826d9aa-03f2-4ad7-ae91-0553052131f8`, with one active branch. Its current
  complimentary access now has a narrowly scoped, default-off conversion draft:
  a separate owner acknowledgement freezes its mode and version in the quote,
  and free access changes only after signed captured settlement. Any conflicting
  capture is held for review. This has only synthetic rollback-only acceptance;
  it has not changed Production access or enabled a payable quote. Starter's standard
  membership/service renewal reminders are 7, 3, and 1 days before expiry after
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
  exact payable wording and tax/receipt determination still require review before a quote.
  UsefulMade PR #2 published the approved Starter price, terms and refund policy
  on 30 September, as recorded in the offer draft. Publication does not open
  billing or establish tax treatment for an actual buyer.
- **Expiry-only renewal:** the owner confirmed that renewal becomes available
  after the paid month expires. Each renewed month starts at the signed capture
  event. The default-off draft now implements reviewed renewal and cancellation;
  cancellation preserves paid access and issues no refund. This is code/test
  progress only and does not open any Production or real-money gate.

For C-01, assemble the founder's exact legal supplier/PAN and receipt address,
current and prior financial-year PAN-wide turnover, pilot-customer states,
subscription description and monthly charge, and refund process. Record a
fact-supported conclusion on registration, any geography restriction, the tax
amount or absence of tax, and supplier/customer/receipt/refund fields. Obtain
qualified advice if the facts or applicable exceptions cannot be resolved.
Store the conclusion reference privately; put only approved wording into the
immutable Live offer. The ₹0 GST draft is planning data, not a conclusion.

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

| ID   | Concrete next action                                                                                  | Required evidence / deadline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | COMPLETE: owner payment reconciled with provider invoice.                                             | On 1 October the owner confirmed payment; refreshed invoice GQBCLHWV-0001 is Paid, US$23.60 paid and US$0.00 due. Pro Active remains verified. No duplicate payment or budget change was attempted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| B-02 | Review the temporary Supabase Free acceptance by 13 October 2026, or sooner at the recorded triggers. | Owner accepted Free through 13 October 2026 with earlier 50%-quota, pause, backup, or paid-user triggers; refresh before payment if that date has passed. Pro remains an option at published base US$25/month; no purchase authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B-03 | Complete the owner password-recovery flow if it is required for onboarding.                           | Owner-approved sign-in and recovery emails reached the inbox on 29 September. The first sign-in token was most likely replaced by the following recovery request. A separately approved single sign-in retest at 13:30–13:33 UTC redeemed successfully, created a new owner Auth session, and showed the owner dashboard. The recovery link authenticated the owner and reached the new-password form; only the owner may enter and submit a new password. Record any completed reset privately before paid-owner onboarding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B-04 | Retain the missed-confirmation decision and recheck scheduler freshness at activation.                | On 29 September the owner chose **missed; do not send** for job `754b267e-a1c2-442d-a745-8d9c03d2b92c`; its terminal failed audit row remains. Scheduled ops and renewals workflows recovered by 30 September 02:24 UTC, both with successful steps on merged `a1a0ddab`. Review Advisor warnings in context. No automatic or late resend is authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B-05 | COMPLETE: original canonical URL and encryption-key format verified.                                  | Both variables are saved as write-only Vercel Secrets. The list/export and 29 September Chrome edit view cannot reveal either value. On 30 September the owner confirmed both from their original secure source: https://desk.usefulmade.com and exactly 64 hexadecimal key characters. Record this as owner attestation; export cannot independently prove either value. No rotation or secret disclosure occurred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| C-01 | Finish supplier registration, tax and receipt determination.                                          | On 30 September the owner confirmed legal business name UsefulMade, the Punjab business address and PIN, no GST registration, and no turnover yet. The private issuer draft records these statements; do not request them again or make the unrecovered Udyam certificate a drafting gate. Before a payable quote, record PAN-wide financial-year turnover, the actual buyer geography, and any compulsory-registration exception, especially reverse charge on received services. Resolve a real exception with qualified input. “GST not charged — supplier unregistered” is proposed ordinary-document wording, not tax clearance or a 0% GST rate.                                                                                                                                                                                                                                                                                                                                                                                                      |
| C-02 | Finish exact Starter offer and customer-facing terms.                                                 | The [draft](starter-pilot-offer-draft.md) now gives reviewable ₹799 Starter, separate Meta and gym-merchant charges, expiry-only renewal, cancellation and day-7 first-payment refund wording. The owner approved the customer text and two-business-day handling timeline on 30 September; UsefulDesk Starter pilot v1 is published with the refund policy, product price and terms. The actual buyer and final tax-supported gross amount remain unresolved. The installed, default-off Live refund review migration requires the request timestamp/evidence and enforces local day 7 for standard requests, with separately reasoned exceptional reviews; genuine provider and service acceptance remain. UsefulMade / Home office is an internal acceptance candidate with complimentary access, not an independent buyer or self-invoice. No Production access changed or money moved.                                                                                                                                                                 |
| S-01 | Finish the remaining product and release-specific acceptance.                                         | Full-schema owner/staff isolation, genuine Test payment/refund/renewal recovery, downgrade archive rollback/replay, and simulator plus physical iPhone access checks passed in the [Test record](subscription-test-acceptance.md). Local authenticated Starter web/API/RLS and mocked-worker acceptance passed four checks on 30 September; the signed-in settings page passed desktop/390 px inspection and real standard-switch saves. Cloud staging SQL/Auth/API/worker and desktop/390 px acceptance also passed; actual approved-template delivery, capability activation and final native acceptance remain open. A signed physical iPhone Release build passed HTTPS Test sign-in and active/refunded/trial access recovery; advanced native Checkout and distribution-signed preview remain separate checks. Physical PostgreSQL crash/storage recovery was not tested; decide whether it is a release requirement rather than treating an injected transaction failure as that proof.                                                              |
| S-02 | Accept the requested reuse of the existing UsefulMade Live merchant and finish the Live billing path. | The current account is active under UsefulMade; Razorpay verified `desk.usefulmade.com` on 30 September. Owner-authorized Live keys are privately saved and a read-only API request returned 200; no provider order or charge was created. The draft supports an exact pinned Live `acc_` merchant and local shared-merchant routing now distinguishes provider-proven gym events from SaaS events, keeps ambiguous events retryable, and prevents SaaS refunds entering the gym ledger. Independent SaaS direct keys/webhook secret are installed separately from gym OAuth; obtain release-specific signed mixed-delivery and reconciliation evidence on the actual merchant. The dark schema and Production-only credentials/merchant/pilot binding are installed with only signed intake on; the closed redeployment and health checks pass. The approved Live webhook is Enabled with signature refusal verified; genuine mixed-delivery acceptance remains and renewal is hard-closed. A controlled real-money pilot remains a separate rollout step. |
| S-03 | Accept limited Starter path before Production rollout.                                                | Synthetic full-schema checks cover quote, late-capture hold, capture-event term, owner renewal/cancellation, reminder normalization, complimentary conversion and scoped races. Signed physical iPhone Release Test access recovery and focused native tests passed. Approved PR #20 intake-only app is READY; PR #21 opening candidate is closed and staging-only. Synthetic offer/refund component presentation and local authenticated capability/worker checks passed; cloud staging and dark schema installation passed; final issuer wording, actual approved-template delivery, activation/native checks, signed mixed-merchant delivery and genuine Live evidence remain. Only separately approved intake activation occurred; money/capability activation and real-money acceptance remain pending.                                                                                                                                                                                                                                                |

For a **manual paid pilot**, B-01–B-05 and C-01–C-02 must be evidenced, the
founder must approve the exact manual offer, and the
[commercial procedure](commercial-operations.md) must be followed. Manual access
does not enforce the proposed paid-tier feature matrix; promise only the
explicitly agreed available scope. S-01–S-03 are additional requirements for
**automated subscription rollout**. Do not switch the gate to OPEN merely because
B-01–B-05 or an automated environment check pass. Record the approved path,
date, approver, offer reference, and any exclusions when opening it.

## Repeatable checks

### Starter rollout sequence

This is the ordered handoff for the narrow owner-approved internal payment-only
run. Meta approval/current-contract delivery is independent of its money
acceptance; the exact standard policy/acknowledgement remains required. The current
release is healthy with billing closed; it is not ready to accept paid orders.
Retain the Vercel invoice discrepancy as a reconciliation item under the
owner's instruction to continue. Do not attempt another charge.

| Step                                                                 | Completion evidence                                                                                                                                                                                                                                                                                                                           | Current result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Close external and issuer prerequisites                           | Razorpay approval for the SaaS product/domain on the existing merchant; actual internal accounting classification without a self-invoice; pass/fail checks of the original protected canonical URL and encryption-key format. Genuine buyer/tax/document determination remains separate before customer issuance.                             | Domain verified; Live keys saved privately/read-only authentication passed; issuer layout conditional; protected values owner-verified from originals. Home office is an internal acceptance candidate, not a customer sale.                                                                                                                                                                                                                                                                                                                                                                                            |
| 2. Accept the complete schema in an isolated operational Test target | Review the ordered migration dependencies against actual schema/history, use the approved Supabase migration tool, inspect tables/RLS/function grants, then run final offer, capability, worker, refund and native acceptance. Preserve synthetic/provider evidence separately.                                                               | Local and clean cloud full-schema SQL/Auth/API/worker checks plus staging-backed desktop/390 px settings passed. Synthetic data and gates returned to empty/off; old Test remains paused. See the [staging record](subscription-staging-plan.md).                                                                                                                                                                                                                                                                                                                                                                       |
| 3. Review the exact dark Production change                           | Pin the release SHA and migration file hashes; confirm backup and recovery ownership; install only through the approved migration tool with billing/capability/money switches off. Verify schema/grants and default-off endpoints, then save the independent SaaS configuration and webhook secret securely.                                  | 26 pinned schema sources installed after a fresh encrypted database/Storage backup. Tenant/access/financial preservation, RLS and health checks passed. Production-only credentials and merchant/pilot binding installed; closed redeployment/audit/health passed. Approved intake-only activation is complete: the Live provider webhook is Enabled and unsigned intake is refused. Money gates stay closed; see the [installation record](subscription-production-install-record.md).                                                                                                                                 |
| 4. Review and approve the controlled opening                         | Separately approve the exact first-term quote/order/refund/conversion candidate, environment phases, immutable offer/release review and 7/3/1 after-09:00 policy. Renewals stay hard-closed. Refresh deployment, environment, scheduler and backup evidence at activation.                                                                    | Candidate and explicit audit modes have recorded repository/local results. The fresh approximately 17:45 UTC exact-source cloud SQL replay passed all assertions and restored staging empty/off, while preserving the earlier historical fixture hash discrepancy. Closed SQL installed only on empty staging; Production installation/opening, real internal-accounting/offer evidence and genuine Live acceptance remain pending. Meta approval/current-contract delivery is a separate reminder gate and does not block the scoped payment-only run. See the [opening review](starter-live-pilot-opening-review.md). |
| 5. Run controlled Live acceptance and close recovery                 | After exact Production installation/opening approval, a human completes the selected real payment. Verify signed SaaS/gym routing, exact bound order/receipt, dedupe, late-capture holds and the reviewed full-refund outcome/reconciliation. Renewal remains hard-closed. Classify the same-proprietor run as internal technical acceptance. | Earlier genuine Test evidence exists; final Live capture/refund/shared-merchant evidence remains pending. Actual approved-template delivery remains a separate reminder acceptance gate. Use the [acceptance walkthrough](subscription-live-acceptance-walkthrough.md) and [financial recovery runbook](subscription-financial-recovery-runbook.md).                                                                                                                                                                                                                                                                    |

Every step requires its own dated evidence before the next dependent action.
Rollback first stops **new quote, order and refund initiation** while keeping
signed intake and reconciliation available for in-flight money. Assign every
uncertain payment/refund a review owner and next action. An application rollback
cannot undo an issued provider order, captured payment or processed refund.

In a checkout already linked to the correct Vercel project/team, export to a
private temporary directory and run the checker using the approved current
intake-only mode. The default closed mode rejects enabled intake; pilot/recovery
modes describe other separately approved phases and cannot authorize them.
Do not print exported values:

```bash
(
  umask 077
  task_tmp_dir="$(mktemp -d)" || exit 1
  trap 'rm -rf "$task_tmp_dir"' EXIT
  vercel env pull "$task_tmp_dir/production.env" --environment production --yes &&
    npm run audit:production-env -- --allow-live-intake-only --dotenv-stdin < "$task_tmp_dir/production.env"
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
