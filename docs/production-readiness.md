# UsefulDesk paid-pilot production readiness

**Gate status: CLOSED.** Before accepting money or activating the first paid
UsefulDesk term, close the common operational and commercial decisions below.
Automated subscriptions require the additional subscription acceptance gate.
An environment audit or a Test payment does not authorize a paid launch.

**30 September public-policy update:** the owner approved ₹799 gross for an
invited Starter month, the local day-7 first-payment refund request window,
and the two-business-day acknowledgement/initiation timeline. UsefulMade PR
#2 (`eb0acb9`) published the [refund policy](https://usefulmade.com/useful-desk/refunds/),
price, terms and privacy update; the live policy URL returned 200. The owner
reported no foreign-service purchases before checkout and no real first customer.
The dedicated, empty Razorpay review account was confirmed, its sign-in verified,
and its temporary login submitted with owner authorization. A refreshed
30 September dashboard lists `desk.usefulmade.com` as **Under review** with
a stated 24–48-hour review window. Vercel now shows **Pro Plan Active**, but
invoice `GQBCLHWV-0001` remains **Open / Payment failed** for **US$23.60**
(US$20 plan plus US$3.60 tax). Its saved on-demand usage budget is **US$20**,
with alerts enabled and project pausing off. The owner subsequently reported payment,
but the refreshed invoice still shows Open / Payment failed; the provider discrepancy remains recorded for
reconciliation. The owner authorizes continuing with Pro Active and reported payment;
do not initiate a duplicate payment on this evidence.
Review the actual foreign-service invoice and applicable GST treatment before
the first customer invoice; the earlier no-purchase statement predates checkout. Neither public policy nor
an internal review account opens Live billing.

**30 September release recheck:** PR #18 is merged at
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
on 29 September. Production still has zero private subscription/billing tables.

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

| Area                         | Status                        | Evidence and practical limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release          | HEALTHY; BILLING STILL OFF    | PR #18 merged at fbc8a9dd with all checks passing and GitHub Production deployment 6751236716 successful; the 30 September schema recheck found zero private subscription/billing tables. Earlier evidence: PR #17 merged at `a1a0ddab7432e0204cfdc027f042b9c87b01115e`; canonical Production `dpl_AZtfZQ2qs1TiLhTBt6JdeoZN2vtM` was READY on 29 September. Hosted CI and CodeQL passed, login GET returned 200, and unauthenticated Live quote/webhook POSTs returned 404. Default-off shared-merchant and selected complimentary conversion code is deployed; the Live schema and billing remain absent.                                                                                                                                                                                                     |
| Domain and TLS               | PASS                          | `desk.usefulmade.com` has a valid Let's Encrypt certificate through 2 December 2026. HSTS, report-only CSP, permissions/referrer policies, nosniff, and frame denial were present. Report-only CSP is not enforcement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Vercel commercial permission | PRO ACTIVE; OWNER PAID REPORT | The refreshed 30 September dashboard shows Pro Active and a saved US$20 on-demand usage budget with project pausing off. Invoice GQBCLHWV-0001 remains Open / Payment failed for US$23.60 (US$20 plan plus US$3.60 tax). The owner reports payment and authorizes continuing. Retain the provider discrepancy for reconciliation without a duplicate charge; alerts are not a total spend cap.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Core environment             | PASS WITH WARNINGS            | The isolated 30 September Production export passed with zero blockers/three warnings and all seven required core names, with no `USEFULDESK_SAAS_*`, `USEFULDESK_SUBSCRIPTION_*`, Test/Live billing UI flags, or Turnstile names. `NEXT_PUBLIC_SITE_URL` and `ENCRYPTION_KEY` remain write-only Secrets: list and single-variable APIs returned `decrypted:false`, and the Chrome edit view also cannot reveal them. Their values are **unverifiable through export**; the owner subsequently verified both from their original secure source on 30 September. The isolated 30 September audit confirmed live gym Razorpay mode and required names; protected formats are now owner-attested, rather than independently read from Vercel. Gym merchant configuration is separate from Usefulmade SaaS billing. |
| Public lead form             | UNAVAILABLE                   | Both Turnstile variables are absent; Production submissions fail closed. This is not a founder-referred pilot blocker, but public lead capture cannot be promised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Supabase capacity            | FREE ACCEPTED TO 13 OCTOBER   | The organization still reports Free on 29 September. The 28 September dashboard had no exceeded quota: database 0.064/0.5 GB, Storage 0.004/1 GB, egress 0.229/5 GB, MAU 5/50,000, peak realtime connections 7/200. That usage snapshot is not a capacity forecast. The owner accepted Free temporarily through 13 October with earlier review triggers below.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Auth SMTP                    | SIGN-IN VERIFIED; RESET OPEN  | The 28 September configuration check found Auth SMTP enabled at `smtp.resend.com:465`, sender UsefulDesk. On 29 September, the first owner-approved sign-in and recovery emails reached the inbox; the recovery request likely superseded the unused first sign-in token, which Supabase rejected. One separately approved sign-in retest reached the inbox, redeemed successfully, created a new owner Auth session, and opened the owner dashboard. The recovery link had reached the new-password form, but no credential was entered or changed. See the dated investigation below.                                                                                                                                                                                                                        |
| Scheduled operations         | OWNER MARKED MISS; ROW FAILED | Both primary database schedules remain active; the latest inspected ops at 13:53 and renewals at 13:41 UTC on 29 September succeeded with adjacent HTTP 200 responses and no timeout. The owner chose to mark job `754b267e-a1c2-442d-a745-8d9c03d2b92c` missed without sending. It remains `failed` after five legal-name lookup retries, with zero provider attempts and no accepted/delivered message. There is no supported operator transition from this terminal row to a separate missed state. The prior scoped history check found no matching confirmation after payment.                                                                                                                                                                                                                            |
| Redundant GitHub schedules   | RECOVERED ON 30 SEPTEMBER     | Latest scheduled [ops run 36689363304](https://github.com/aarkay1805/UsefulDesk/actions/runs/36689363304) at 08:23 UTC and [renewals run 36693348516](https://github.com/aarkay1805/UsefulDesk/actions/runs/36693348516) at 09:00 UTC succeeded on exact `fbc8a9dd`. All workflow steps reported success. The earlier 29 September stale observation remains historical. Recheck freshness at actual activation; success does not prove each customer message was delivered.                                                                                                                                                                                                                                                                                                                                   |
| Supabase logs/advisors       | REVIEW REQUIRED               | 08:46–09:46 log window: Auth errors 0, edge HTTP 5xx 0; three Postgres `42501` errors reference `my_branch_accounts`, consistent with the failing service-worker fallback. Security Advisors show no ERROR findings, but warn about mutable function search paths, public extensions, definer grants, and disabled leaked-password protection. Review context before changing intentional public/authenticated RPC grants.                                                                                                                                                                                                                                                                                                                                                                                     |
| Backups and recovery         | PASS WITH ACCEPTED RISK       | The 30 September scheduled [backup run 36647153210](https://github.com/aarkay1805/UsefulDesk/actions/runs/36647153210) succeeded at 29 September 23:48 UTC, including export, encrypt, upload and verify. Disposable restore passed 23 August; next drill is due 23 November. Pre-key-rotation archives remain unrecoverable, and the replacement key has no approved offline copy.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Alerts                       | GITHUB INBOX ONLY             | Inbox failure delivery was verified 30 August in `GATES.md`. Email/mobile paging and an independent external watchdog remain unproven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Change control and rollback  | KNOWN LIMITS                  | `main` remains unprotected (GitHub branch-protection API returned 404). CI for deployed `4072dccc` passed ([run 36554758624](https://github.com/aarkay1805/UsefulDesk/actions/runs/36554758624)). Select a verified preceding READY application release for an approved rollback; migrations and provider effects need separate recovery. Add branch protection before multiple release operators.                                                                                                                                                                                                                                                                                                                                                                                                             |
| SaaS Production boundary     | CLOSED AS INTENDED            | The 30 September 09:57 UTC Production recheck found zero private subscription/billing tables. The deployed release has no automated paid grant, renewal, or SaaS refund. Full-schema Test capture/refund/renewal, signed provider delivery and retries, and simulator/physical-device access checks have passed; they do not install Production billing or establish a Live Usefulmade merchant.                                                                                                                                                                                                                                                                                                                                                                                                               |

The later local [dark Live boundary draft](subscription-live-boundary.md) has a
separate adapter and service-only schema, but it is uninstalled. A rollback-only
disposable full-schema SQL check passed with synthetic facts. Separate database
sessions found and then verified a fix for a quote-expiry race, plus checked
overlapping quotes, capture/cancellation order, and shutdown during order
issuance. The concurrent clone omitted unrelated cron/realtime/vault objects;
no Live provider, Production migration or real-money acceptance was involved.
The Production status in the table remains closed.

### Closeout handoff: disabled foundation versus paid activation

PR #16's disabled foundation is merged and deployed. That does not authorize
applying subscription migrations to Production, adding Live billing
configuration, issuing a quote, opening Checkout, or enabling capability and
money switches. Keep the paid gate CLOSED.

For the later payable pilot, collect these private decisions and proofs in
order: (1) use the approved [customer offer](starter-pilot-offer-draft.md) and finish
release-specific acceptance of the implemented complimentary-to-paid Starter conversion; (2) document the
fact-supported tax/receipt determination for the exact payable amount and
wording (C-01/C-02 below); (3) confirm the existing UsefulMade merchant covers
the SaaS product and `desk.usefulmade.com`, configure direct SaaS API keys and
webhook endpoint/secret independently of gym OAuth, and accept signed
shared-merchant mixed deliveries; (4) finish B-01–B-05 and S-01–S-03, including final
offer-specific Test, Live-provider and release acceptance; (5) review the
exact Production migration, dark deployment,
approval-ledger entry, activation switches, and controlled real-money pilot as
separate rollout steps. The [Live boundary](subscription-live-boundary.md)
records the technical switches. The existing merchant's business identity and
activation have been seen, and the owner selected UsefulMade / Home office
(`8826d9aa-03f2-4ad7-ae91-0553052131f8`) as the pilot organization. A
read-only access check found it **complimentary**, with no trial start/end or
access end; Home office is active. A local default-off contract now permits a separately acknowledged Starter
conversion only while its complimentary access version remains unchanged;
quote/order processing leaves free access intact until signed capture. The
migration remains uninstalled and its payable offer unapproved. No Production
access changed. SaaS product/domain acceptance and tax conclusion remain open.
Selection is not real-money authorization.

### Owner choices recorded 29 September 2026

- **Hosting:** the owner chose Vercel Pro with alerts only for a paid pilot.
  On 30 September the owner completed checkout and Vercel showed Pro Active.
  A fresh invoice check still shows `GQBCLHWV-0001` Open / Payment failed for
  US$23.60, including US$3.60 tax. The saved on-demand usage budget is US$20
  per billing period, with alerts at the displayed 50%, 75% and 100%
  thresholds and project pausing off. This excludes base plan and other
  separately billed items and does not cap total spend. The owner subsequently
  reported payment, but the refreshed invoice still shows Open / Payment failed.
  Reconcile the payment confirmation before retrying; Pro's active badge alone
  does not prove payment settlement.
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
  across approved websites/apps; `desk.usefulmade.com` was not listed at that earlier check; its later submission is under review. Confirm
  SaaS product and domain approval, any required website/policy details, and
  independent SaaS direct-key and webhook configuration without changing gym
  collections. The provider describes API keys as universal across approved
  websites/apps; this does not assume a second key pair is mandatory.
  **External merchant acceptance:** the refreshed 30 September dashboard lists
  `usefulmade.com` as Approved and `desk.usefulmade.com` as Under review
  (expected update in 24–48 hours). Its additional-site dialog says the
  new site must use the same business model; a different model needs a separate
  account. The owner completed SMS OTP, authorized the dedicated empty review account
  and sharing its temporary login, and the site submission was accepted on
  30 September. Await provider review, then verify the SaaS domain and product
  are approved before Live configuration. The existing `usefulmade.com` approval does
  not establish approval for `desk.usefulmade.com`. Keep the requested website,
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
  branch, through web Checkout only. Renewal is owner-initiated. Upgrades, paid
  add-ons, automated restart, and native Checkout are outside this first offer.
  This records product scope, not the tax-confirmed payable amount, Live billing
  authorization. The selected pilot is UsefulMade / Home office, organization
  `8826d9aa-03f2-4ad7-ae91-0553052131f8`, with one active branch. Its current
  complimentary access now has a narrowly scoped, default-off conversion draft:
  a separate owner acknowledgement freezes its mode and version in the quote,
  and free access changes only after signed captured settlement. Any conflicting
  capture is held for review. This has only synthetic rollback-only acceptance;
  it has not changed Production access or enabled a payable quote. Starter's standard
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
  exact payable wording and tax/receipt determination still require review before a quote.
  The [public UsefulDesk page](https://usefulmade.com/usefuldesk/) currently
  directs visitors to contact for pricing, and the
  [public terms](https://usefulmade.com/useful-desk/terms) describe payments
  generically; final Starter price, term, cancellation and refund wording has
  not been published there.
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

| ID   | Concrete next action                                                                                  | Required evidence / deadline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | Reconcile the reported Vercel payment with the open invoice.                                          | Pro Active and US$20 on-demand usage alerts with pausing off are verified on 30 September. Invoice GQBCLHWV-0001 is Open / Payment failed for US$23.60 including tax. The owner reports payment and authorizes continuing; exact fbc8a9dd Production is READY. Retain the contradictory provider invoice for reconciliation without attempting a duplicate charge. Pro commercial-use permission is verified; this discrepancy does not block independent rollout preparation.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| B-02 | Review the temporary Supabase Free acceptance by 13 October 2026, or sooner at the recorded triggers. | Owner accepted Free through 13 October 2026 with earlier 50%-quota, pause, backup, or paid-user triggers; refresh before payment if that date has passed. Pro remains an option at published base US$25/month; no purchase authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B-03 | Complete the owner password-recovery flow if it is required for onboarding.                           | Owner-approved sign-in and recovery emails reached the inbox on 29 September. The first sign-in token was most likely replaced by the following recovery request. A separately approved single sign-in retest at 13:30–13:33 UTC redeemed successfully, created a new owner Auth session, and showed the owner dashboard. The recovery link authenticated the owner and reached the new-password form; only the owner may enter and submit a new password. Record any completed reset privately before paid-owner onboarding.                                                                                                                                                                                                                                                                                                                                                                                                          |
| B-04 | Retain the missed-confirmation decision and recheck scheduler freshness at activation.                | On 29 September the owner chose **missed; do not send** for job `754b267e-a1c2-442d-a745-8d9c03d2b92c`; its terminal failed audit row remains. Scheduled ops and renewals workflows recovered by 30 September 02:24 UTC, both with successful steps on merged `a1a0ddab`. Review Advisor warnings in context. No automatic or late resend is authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B-05 | COMPLETE: original canonical URL and encryption-key format verified.                                  | Both variables are saved as write-only Vercel Secrets. The list/export and 29 September Chrome edit view cannot reveal either value. On 30 September the owner confirmed both from their original secure source: https://desk.usefulmade.com and exactly 64 hexadecimal key characters. Record this as owner attestation; export cannot independently prove either value. No rotation or secret disclosure occurred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C-01 | Finish supplier registration, tax and receipt determination.                                          | On 30 September the owner confirmed legal business name UsefulMade, the Punjab business address and PIN, no GST registration, and no turnover yet. The private issuer draft records these statements; do not request them again or make the unrecovered Udyam certificate a drafting gate. Before a payable quote, record PAN-wide financial-year turnover, the actual buyer geography, and any compulsory-registration exception, especially reverse charge on received services. Resolve a real exception with qualified input. “GST not charged — supplier unregistered” is proposed ordinary-document wording, not tax clearance or a 0% GST rate.                                                                                                                                                                                                                                                                                 |
| C-02 | Finish exact Starter offer and customer-facing terms.                                                 | The [draft](starter-pilot-offer-draft.md) now gives reviewable ₹799 Starter, separate Meta and gym-merchant charges, expiry-only renewal, cancellation and day-7 first-payment refund wording. The owner approved the customer text and two-business-day handling timeline on 30 September; UsefulDesk Starter pilot v1 is published with the refund policy, product price and terms. The actual buyer and final tax-supported gross amount remain unresolved. The uninstalled Live refund review migration now requires the request timestamp/evidence and enforces local day 7 for standard requests, with separately reasoned exceptional reviews; genuine provider and service acceptance remain. UsefulMade / Home office is an internal acceptance candidate with complimentary access, not an independent buyer or self-invoice. No Production access changed or money moved.                                                   |
| S-01 | Finish the remaining product and release-specific acceptance.                                         | Full-schema owner/staff isolation, genuine Test payment/refund/renewal recovery, downgrade archive rollback/replay, and simulator plus physical iPhone access checks passed in the [Test record](subscription-test-acceptance.md). Local authenticated Starter web/API/RLS and mocked-worker acceptance passed four checks on 30 September; the signed-in settings page passed desktop/390 px inspection and real standard-switch saves. Operational staging, actual approved-template delivery, capability activation and final native acceptance remain open. A signed physical iPhone Release build passed HTTPS Test sign-in and active/refunded/trial access recovery; advanced native Checkout and distribution-signed preview remain separate checks. Physical PostgreSQL crash/storage recovery was not tested; decide whether it is a release requirement rather than treating an injected transaction failure as that proof. |
| S-02 | Accept the requested reuse of the existing UsefulMade Live merchant and finish the Live billing path. | The current account is active under UsefulMade and has approved `usefulmade.com`; `desk.usefulmade.com` was submitted with its dedicated review login and remains Under review on 30 September; SaaS product/domain approval is still required. The draft supports an exact pinned Live `acc_` merchant and local shared-merchant routing now distinguishes provider-proven gym events from SaaS events, keeps ambiguous events retryable, and prevents SaaS refunds entering the gym ledger. Configure SaaS direct-key and webhook endpoint/secret independently of gym OAuth, then obtain release-specific signed mixed-delivery and reconciliation evidence on the actual merchant. Production still has no SaaS tables or Live billing configuration; the renewal gate is hard-closed. A controlled real-money pilot remains a separate rollout step.                                                                              |
| S-03 | Accept limited Starter path before Production rollout.                                                | Synthetic full-schema checks cover quote, late-capture hold, capture-event term, owner renewal/cancellation, reminder normalization, complimentary conversion and scoped races. Signed physical iPhone Release Test access recovery and focused native tests passed. PR #18 default-off app is READY. Synthetic offer/refund component presentation and local authenticated capability/worker checks passed; final issuer wording, operational staging, actual approved-template delivery, activation/native checks, signed mixed-merchant delivery and genuine Live evidence remain. No Live schema, gate activation or real-money acceptance occurred.                                                                                                                                                                                                                                                                               |

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

This is the ordered handoff for the narrow owner-approved offer. The current
release is healthy with billing closed; it is not ready to accept paid orders.
Retain the Vercel invoice discrepancy as a reconciliation item under the
owner's instruction to continue. Do not attempt another charge.

| Step                                                                 | Completion evidence                                                                                                                                                                                                                                                                                                                                                    | Current result                                                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Close external and issuer prerequisites                           | Razorpay approval for the SaaS product/domain on the existing merchant; exact real-buyer and tax/receipt determination; pass/fail checks of the original protected canonical URL and encryption-key format.                                                                                                                                                            | Domain Under review; issuer layout conditional; protected values owner-verified from originals. Home office is an internal acceptance candidate, not a customer sale. |
| 2. Accept the complete schema in an isolated operational Test target | Review the ordered migration dependencies against actual schema/history, use the approved Supabase migration tool, inspect tables/RLS/function grants, then run final offer, capability, worker, refund and native acceptance. Preserve synthetic/provider evidence separately.                                                                                        | Local full-schema SQL and authenticated web/worker checks pass. The existing minimal cloud Test project is not a full-schema staging target.                          |
| 3. Review the exact dark Production change                           | Pin the release SHA and migration file hashes; confirm backup and recovery ownership; install only through the approved migration tool with billing/capability/money switches off. Verify schema/grants and default-off endpoints, then save the independent SaaS configuration and webhook secret securely.                                                           | No Production subscription tables or SaaS configuration. No Production installation or key/webhook change performed.                                                  |
| 4. Accept the actual shared merchant and controlled payment boundary | Verify signed SaaS and gym deliveries, ambiguous-event retries, exact receipt/order binding, dedupe, late-capture hold, cancellation/renewal, full-refund request evidence and reconciliation on the actual pinned merchant. A human completes any real payment. Keep the internal proprietor test distinct from a genuine customer sale.                              | Earlier genuine Test evidence exists; final offer-specific Live shared-merchant evidence does not.                                                                    |
| 5. Review and open the narrow pilot                                  | A separate reviewed change must replace the hard-closed quote/order/refund/conversion/renewal checks, update the Production environment audit for the exact permitted flags, record the immutable offer approval and 7/3/1 after-09:00 policy, and enable only the accepted pilot paths. Refresh deployment, environment, scheduler and backup evidence at activation. | Opening migration and audit allow-list change are not approved or installed; no payable approval row is seeded. Rollout remains closed.                               |

Every step requires its own dated evidence before the next dependent action.
Rollback first stops **new quote, order and refund initiation** while keeping
signed intake and reconciliation available for in-flight money. Assign every
uncertain payment/refund a review owner and next action. An application rollback
cannot undo an issued provider order, captured payment or processed refund.

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
