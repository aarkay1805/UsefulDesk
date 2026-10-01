# Subscription staging migration plan — 30 September 2026

**Current Production status, 1 October 2026:** exact PR #21 implementation
`71d897a6` is READY in recovery-only mode. The approved internal ₹799 capture/full
refund and three original signed-event reconciliations are complete, access is
ended and new initiation/UI are closed. Bank debit proof is private; bank-credit
proof is owner-deferred. Genuine duplicate/mixed provider delivery and reminder
acceptance remain separate. See the [opening/closeout record](subscription-production-pilot-opening-record.md).
Historical staging/candidate statements below retain their original dates.

Production billing remains closed. Razorpay verified `desk.usefulmade.com`;
owner-authorized Live keys are privately saved, and read-only authentication
passed. Production-only Live credentials and exact merchant/pilot bindings are installed.
Approved PR #20 main `5920fa78` enables signed intake only, with an Enabled
provider webhook; every other money/capability/policy/advanced/Test switch stays
false. Billing ledgers exist but contain no Live transactions or paid grants.
Clean full-schema staging and the 26-source dark Production installation passed.
The latest opening candidate `33df55bf` / `c3031efa` is closed and installed on
staging only; Production candidate review/install approval and genuine Live
acceptance remain pending. Dated evidence follows; see the
[release review](subscription-release-review.md) and
[latest read-only preflight](subscription-rollout-preflight.md).

## Target and preservation

The owner selected `aarkay` and confirmed the provider's US$0/month quote.
`otagotpezshybxkagtwv` (UsefulDesk Billing Staging) is ACTIVE_HEALTHY in
Singapore. Its initial inspection found zero users and application tables.
No Pro upgrade or paid development branch was purchased.

The 328-source replay completed through the approved migration tool in 50
schema batches, with the historical Production cron activation replaced by an
explicit inactive staging override. A read-only WebSocket subscription initialized
Supabase's Realtime service schema; no application message was sent. The staging
database has 108 public tables and 313 public policies, zero public base tables
without RLS, and 24 private billing/subscription tables with RLS and no direct
anon/authenticated access. All Test, capability, policy and Live billing switches
are false; the Live merchant and pilot remain unbound. Cron is inactive.

All three rollback-only Live SQL suites passed through the approved tool,
including a deliberately delayed quote/capture renewal case. The original
renewal fixture used transaction-start `now()` for a capture after a wall-clock
quote, intermittently producing `review_required / quote_expired_or_changed`.
It now freezes one capture timestamp after the quote and reuses it for event,
settlement and term assertions. The unchanged application correctly held the
invalid synthetic capture; no billing rule was relaxed. Local replay also passes.
After acceptance, users, accounts, Live payments and offer approvals are zero,
and every gate remains false. These are synthetic SQL checks, not genuine
provider delivery.

Four authenticated cloud Auth/API/RLS and mocked-worker checks also passed:
custom-schedule refusal, reviewed downgrade normalization, local 09:00 cutoff,
7/3/1 membership/service selection, dedupe, missed-day behavior and suspension
at the final send boundary. Two additional real Auth checks refused staff
settings writes and outsider branch reads/writes; neither could read private
billing records. Non-staging network requests were denied by the harness.
The current-source local web app used only this cloud database and disposable
credentials. Its signed-in settings page saved standard off/on through the real
API and showed the plan restriction at desktop and an actual 390 px Chrome
viewport, without horizontal page overflow. This is staging-backed web
acceptance, not a deployed cloud web release or native/provider delivery proof.
All three synthetic users and their organizations, accounts, contacts, templates,
fake WhatsApp configuration and Test payment/grant records were removed.
Post-cleanup counts are zero, access enforcement is restored to false, all Test
and Live switches are false, merchant/pilot bindings are null, and cron is inactive.
Temporary passwords and service-key file copies were removed.

The pre-installation schema comparison found no missing/different Production column definitions.
Function comparison identified three intentionally changed subscription wrappers
and seven older Production onboarding/legal-name definitions. At that comparison Production also
lacked `save_organization_brand_name(uuid,text)`. Its history omitted
`20260924110000_independent_gym_brand_and_legal_identity.sql`; that existing
source restores the independent brand/legal identity without changing existing
tenant rows. Rollback-only reapplication in staging leaves all eight accepted
definitions identical, including their existing privileges. The remaining raw
differences normalize to formatting/comments. Apply this identified baseline
source before the billing drafts; do not copy the older Production definitions
over staging. The private comparison artifact is
`function-definition-differences.patch` beside the source manifest.

Preserve `gxwhpraswnkosjibvquz` (UsefulDesk Razorpay Test) paused. Its 23-entry
history is not a complete schema manifest: the project has an older application
snapshot, 16 Auth users, 18 accounts, a subscription Test payment, two gateway
credential rows and two WhatsApp configurations. Both database cron jobs were
inactive during the read-only inspection. No data, schema or credential changed;
the project returned to INACTIVE.

Before installation, Production's connector history had 299 entries, ending at
`20260927125734_google_signup_locale_completion`. A fresh schema-only audit
compared columns and function definitions: the older Test snapshot lacks current
reminder, collection, mobile-push and onboarding changes. At that pre-installation
audit, Production had zero private subscription/billing tables. History-count similarity is insufficient
to establish staging parity.

## Production installation follow-up

The [26-source installation](subscription-production-install-record.md) completed
through the approved tool after a fresh encrypted database/Storage backup.
Production's eight legal/brand definitions and privileges now match accepted
staging. Tenant/legal/access fingerprints and settings, gym payment count and
active cron were preserved. At installation, all new billing switches were false
and payment/order/refund/event/offer records empty. The owner then approved
Production-only credential transfer, merchant/pilot binding and the closed
redeployment on main `3eb8ce2f`. The subsequent approved intake-only PR #20
activation deployed main `5920fa78` and registered the Enabled provider webhook;
unsigned intake returns 400 while quote/order/refund endpoints remain 404.
All other switches remain false and financial/event/offer records remain empty.
See the [installation record](subscription-production-install-record.md) and
[approved intake scope](subscription-live-intake-proposal.md).

At 16:50 UTC the approved connector installed only the closed opening candidate
`20260930164040_starter_live_pilot_opening_preparation.sql` on empty staging,
with history entry `20260930165031_starter_live_pilot_opening_preparation`.
Opening/capability SQL acceptance passed inside rollback; all synthetic data was
removed, all switches remain false and merchant/pilot/review bindings null.
The [opening review](starter-live-pilot-opening-review.md#validation-record)
records the source hash, historical fixture hash discrepancy and scoped advisor
check. A fresh exact-source rollback-only replay at approximately 17:45 UTC
passed all assertions through the approved connector. Payload SHA-256:
`a9bd010e4d58b74cbabf97c34302fa0129a991f1c1f3c3cd17d6a9547764f0f9`;
psql-stripped fixture SHA-256:
`384c0bdc331f98cf35f9176c3c82aac1c2f7debdb1a322c34df6f2db4d146ebf`.
The 17:46:07 UTC postcheck retained zero users/tenants/financial/event/offer/review/
grant rows, all flags false, bindings null, cron inactive and the immutable-grant
trigger restored. This does not
install the opening candidate in Production, authorize a real-money run, or
prove actual Meta delivery or Live capture/refund.

## Completed baseline replay procedure and inspection

The following preserves the baseline replay procedure used for the 26-source
installation; it is not a new instruction to repeat Production mutations. The
latest opening candidate needs its separate release review.

1. Pin source to main `3eb8ce2fcfc8c5ced5915f00f69619386ac90e93`.
   The source manifest contains 328 repository migrations and SHA-256 hashes.
   Its checksum is
   `80a6699b953356154b87c1c28509410bc67be3985ae23fb95ed48e566459abdd`.
   The private local artifact is `staging-migration-manifest.tsv` in the
   `usefuldesk-razorpay-approval-20260930` cache directory.
2. Preserve the already verified historical replay order: apply
   `20260711173414_harden_membership_payments.sql` before
   `058_payment_hardening_followups.sql`. The earlier 307-source map records
   this dependency correction. Append the 21 subsequent capability/advanced/Live
   drafts in filename order. This is repository-schema replay, not a claim that
   divergent Production history can be replayed verbatim.
3. Apply schema only through the approved Supabase migration tool. Never use
   `supabase db push`. Copy no Auth users, tenant rows, provider credentials,
   cron authorization, storage objects or private issuer evidence from Production
   or the older Test project. Replace the historical cron activation with the
   documented inactive staging override. Keep cron inactive and billing, capability, policy,
   quote, order, settlement and refund gates disabled after installation.
4. Inspect resulting tables, RLS, policies, function signatures/grants, triggers,
   extension dependencies and settings. Compare baseline schema definitions with
   Production; review differences rather than declaring parity from file names.
5. Seed only separately identified synthetic Test users and organizations.
   Configure only Test provider credentials for Test workflows. Repeat owner/staff
   isolation, reminder normalization and worker checks, payment/refund/recovery,
   and release web/native acceptance. Label synthetic and genuine provider
   evidence separately.
6. The [Production source manifest](subscription-production-install-manifest.tsv)
   orders the identified legal-identity source before 25 default-off billing
   migrations, all pinned to the main SHA above. Its SHA-256 is
   `0587a9d996228f7891c801f9b0b4722f8258c6bebaa1ac7ff8616f6f16bb8bcf`.
   It contains no opening migration, payable offer seed or credential. Take a
   fresh encrypted database/Storage backup before applying it, preserve existing
   access enforcement and cron, and compare tenant/access/financial facts after
   installation. Prepare independent SaaS configuration only after this check.
7. The separately approved dark Production configuration and intake activation
   are completed in the installation record. The SaaS endpoint is
   `/api/subscriptions/live-webhook`, with `payment.captured`, `payment.failed`,
   `refund.created`, `refund.processed` and `refund.failed`. The webhook secret
   is independent of gym OAuth. Do not enable a provider webhook while its
   deployed receiver is unavailable.

Website verification and API authentication do not open a payable offer. The
hard-closed opening migration, immutable offer approval, real-buyer issuer
determination, actual shared-merchant delivery and controlled Live acceptance
remain separate release gates in [production readiness](production-readiness.md).
