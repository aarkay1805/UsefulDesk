# Monthly checkout — closed Production schema installation

The reviewed monthly migration is installed in UsefulDesk Production. The new
monthly checkout remains closed. Application publication and genuine customer
acceptance/opening remain pending. Rajat authorized this next prerequisite step
after the essential test and Production preflight results.

## Installed source and backup

- Project: `fwqthstqrkrwtaehefks` (UsefulDesk), ACTIVE_HEALTHY before installation.
- Exact source: `supabase/migrations/20261003010000_subscription_monthly_first_checkout.sql`.
  SHA-256: `d7052ba10813008d37a4ec66c883a26e8c6a9176c2454120ed35ec07f51bf40a`.
- Applied once through the approved Supabase migration connector as history
  **`20261003174423_subscription_monthly_first_checkout`**. The history stores one
  statement whose MD5 `6f5a2291340df250f1cab236487e7c56` matches the whole source.
  No migration replay, `db push`, Staging restore or feature activation occurred.
- Fresh full [backup run 37139986039](https://github.com/aarkay1805/UsefulDesk/actions/runs/37139986039)
  succeeded at **17:24:35 UTC / 22:54:35 IST** before installation. Database and
  Storage encryption/upload/remote-object verification passed; Storage covers
  **seven buckets, 49 objects, 2,838,714 bytes**. Archive timestamp is
  `2026-10-03T17-19-01Z`. These fresh archives were not independently decrypted
  or restored. The existing identity's successful earlier same-day decryption is
  recorded in the [coordinated release receipt](subscription-coordinated-release-execution-2026-10-03.md).

## Performed Production checks

The preceding essential preflight passed **682 tests across 15 files**, covering
monthly contract/routes, order/recovery/webhook boundaries, closed root/status
behavior and environment auditing. Both
`verify-subscription-monthly-first-checkout.mjs` and its concurrency runner passed
serially against the disposable local full-schema database. They verify all
three tiers, replay/lock races, permissions, default closure and original/Test/gym
preservation using provider mocks. The unchanged source's earlier full
lint/typecheck/4,916-test/141-page-build evidence remains valid; no real provider
transaction or fresh complete runtime-suite repeat is claimed here.

- All **33** existing relation counts and normalized whole-row fingerprints match
  at **17:43:03.837786 UTC** before and **17:45:42.156827 UTC** after installation.
  The read-only `scripts/subscription-monthly-production-preservation.sql` query
  removes only the existing renewal additions
  and new nullable monthly identity fields. Other row contents are compared whole.
- All **34** final function source bodies exactly match the local migration.
  All **11** saved original function bodies exactly match the pre-installation
  bodies. All **45** are postgres-owned SECURITY DEFINER functions with empty
  search paths; no anon execution is available. Existing public caller privileges
  are preserved, private helpers/copies deny browser and service execution, and
  new owner/MFA-admin versus service-only RPC privileges match the reviewed source.
- Three immutable catalog rows are exact: Starter 79900 INR paise / one branch,
  Growth 149900 / one branch, Ultimate 399900 / five branches, zero paid extras.
  **Zero offer sets, offers or opening-authority rows** exist. Owner-review and
  opening defaults are false; all constraints are validated and all 20 monthly
  triggers are enabled. Existing approvals/preparations/reviews/quotes retain
  NULL monthly identities.
- All three new private tables have RLS enabled, no ordinary-role SELECT or
  write privilege, and service-role SELECT only. Direct service writes remain
  revoked; authorized transactions are the mutation boundary.
- The financial recovery queue is empty. Live/billing settings are preserved,
  including existing signed intake/settlement and the already-enabled global
  capability setting. No new customer scope was opened.
- At **17:48:47 UTC**, Justin's original ₹799 purchase retains ready setup,
  unsuspended access version 5 from `2026-10-02T12:24:56Z` through
  `2026-11-02T12:24:56Z`. The sole original invoice/receipt pair remains
  `UM/2026-27/000001` / `UM-R/2026-27/000001`, 23,001 / 23,134 bytes, with its
  unchanged SHA-256 values independently matching the stored PDF bytes.
- Vercel Production metadata confirms both
  `USEFULDESK_SAAS_LIVE_MONTHLY_CHECKOUT_ENABLED` and
  `NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI` remain absent. No environment
  mutation or main push occurred; Production application source remains `c9da8c47`.

The Supabase security advisor was run after installation. Its
[RLS-without-policies information](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
for the three private tables matches the intentional closed table boundary. Its
[authenticated SECURITY DEFINER warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
for owner/admin RPCs were checked against explicit owner or MFA-admin guards and
the verified source/ACLs. None of the changed functions has a mutable search path
or anon execution. Other advisor notices concern unchanged objects/Auth settings;
this record does not claim the whole project's advisor list is empty.

The [machine-readable receipt](subscription-monthly-production-evidence-2026-10-03.json)
contains both preservation snapshots, installed-source identity, function ACLs,
closed-state checks and original customer integrity results.

## Next step

Publish the reviewed main source with both monthly switches still closed, verify
CI and the exact READY canonical deployment, then perform the deployed billing
smoke checks. Genuine new-catalog customer/commercial/provider/document evidence
and exact one-time opening remain separate from this schema prerequisite. The
prior genuine original Starter payment is preserved evidence for `starter_v1`.
No new charge, refund, provider request, document issuance or customer message
was performed.
