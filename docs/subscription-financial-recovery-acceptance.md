# Subscription financial recovery acceptance

Built and accepted on isolated staging on **30 September 2026 UTC / 1 October IST**.
Production remains the intake-only `5920fa78` deployment. This record supplies
implementation evidence for the [payment-only opening proposal](subscription-payment-only-opening-proposal.md);
it does not issue an offer, activate a gate or perform a transaction.

## Implemented behavior

- Protected operator `POST /api/subscriptions/live-recovery` scans at most five
  original obligations. Its authenticated GET cron wrapper fixes the batch at one
  and joins both existing fifteen-minute ops paths. Disabled cron is a healthy
  no-I/O skip; operator POST stays closed. No new scheduler or paid monitor exists.
- Recovery uses provider GET only for original receipt/notes/economics/merchant/
  organization verification. An uncertain POST never becomes another POST. Bound
  pending/failed/processed-unconfirmed refunds are polled even without a later
  webhook; confirmation still requires exact fully refunded parent facts.
- Five-minute leases, original immutable identities, bounded retry scans and
  canonical completion sweeps handle overlaps, worker crashes and webhook races.
  Binding an order never grants access or fabricates signed capture evidence.
- New captures durably store the existing hold reason. Historical unknown reasons
  remain explicitly unknown. Exact-bound owned exceptions retain status/next action;
  service-only operator reviews write append-only before/after audits. These reviews
  cannot resolve financial holds or change access/provider facts.
- The new `USEFULDESK_SAAS_LIVE_FINANCIAL_RECOVERY_ENABLED` flag stays false/unset in
  intake-only. Runtime and database recovery prerequisites independently fail
  closed; quote/order/refund initiation may stay off while recovery operates.

Code lives in `src/lib/subscriptions/live-recovery.ts`, the two recovery routes,
`src/app/api/database-cron/route.ts`, `.github/workflows/ops-crons.yml` and the
production environment audit. The additive migration preserves the prior capture
money/access decisions and existing canonical bind/observe/commit authority.
The signed-event reconciliation POST remains a separate operator procedure.

## Review and reproducible checks

Independent GPT 6.1 Sol/high review found and corrected two defects: pending
metadata completion was incorrectly treated as a lease failure, and canonical
binding/refund completion could strand queue metadata after a crash or webhook
race. A final root review removed per-obligation identifiers from the cron's
public scheduler output; authenticated operator diagnostics retain structured
items. No provider secret/body or raw SQL diagnostic enters persisted reasons.

Final `npm run verify` passed lint, whole-project TypeScript, **4,232 tests in
525 files**, and the build with 135 generated pages. The final focused recovery/env
suite passed 165 tests. Required verification was rerun after the cron privacy fix.

The rollback runner `scripts/verify-subscription-live-recovery.mjs` covers service
and browser grants, wrong scope/limit, exclusive leases, expiry/token mismatch,
zero/multiple lookup retries, original order binding with no grant, pending/failed
refunds, processed-parent confirmation, terminal crash/race closeout, durable late
capture/access-version holds, replay and append-only review. The migration is
applied twice inside its local rollback proof for idempotency. The independent
reviewer reran all eleven PASS sections; no local Live tables survived rollback.

`scripts/verify-subscription-live-recovery-concurrency.mjs` also ran two actual
concurrent SQL sessions against a generated disposable local clone. Exactly one
session claimed the original obligation, attempts remained one, payments/grants
remained zero, the source database stayed unchanged and the clone was removed.
Shared opening/capability fixtures now use one materialized synthetic review
clock for request/owner timestamps, avoiding the observed ordering flake without
weakening any financial evidence guard.

## Isolated cloud staging

Verified staging project `otagotpezshybxkagtwv` was empty/off with inactive cron at
**18:40:55 UTC** before installation. The approved migration connector applied
source `20260930180000_subscription_live_recovery_queue.sql` as history
`20260930184548_subscription_live_recovery_queue` at approximately 18:45 UTC.
Source timestamp and installed history timestamp differ; never repair that by
`supabase db push`.

| Exact source                              | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Recovery migration                        | `6585daeee0232133e5e450574c32168b7b25802599ebb839c3e19176ad26c272` |
| Executed assembled cloud rollback fixture | `58a763d9ea082835ca08d5271c3a232b793d7095a398c15dd46dbbe179c66c07` |

The fixture contained BEGIN/acceptance/ROLLBACK, stripped psql directives and
installed no persistent schema. It includes the original opening/capability
acceptance, all recovery injections and frozen review clocks. The connector
returned the final PASS after all assertions; PostgreSQL stops on any failure.
Regenerate with the explicit disposable local container and
`--emit-fixture=/private/temporary/acceptance.sql`; temporary output stays outside
source control.

At **18:47:09 UTC**, users/accounts/organizations, all quote/order/payment/refund/
event/grant/offer/review rows and all recovery metadata counts were zero. Merchant/
pilot/review bindings were null; all Live/Test/capability/policy gates were off;
active cron count was zero. All three metadata tables had RLS, no browser SELECT/
DML/TRUNCATE and service SELECT only; the three public RPCs were service-only,
SECURITY DEFINER with empty search path. Follow-up trigger inspection confirmed
payment/refund/grant/review freezes and new hold triggers enabled normally.

## Production preservation and remaining gates

Read-only Production preflight at **18:47:57 UTC** found 8 Auth users, 6 accounts,
5 organizations and 554 gym payments; every Live financial/event/offer ledger
remained empty. Intake alone was true, other Live/Test/capability/policy gates
closed, and opening/recovery schemas remained absent. The canonical deployment
was still READY `dpl_Hx7CKFZx6YP9iDgwPExBNGCWmTkG` at `5920fa78`.
Account/organization/legal/access fingerprints exactly matched the earlier
17:47–17:50 baseline. Primary ops 18:38 and renewals 18:41 returned 200/failed0;
the latest eight HTTP results were 200 without timeout. GitHub natural ops 14:59
and renewals 16:05 remained stale. The reviewed ops-path addition does not claim
to fix the provider's best-effort natural scheduling.

Payment-only acceptance is independent of Meta template approval; its approved
7/3/1 after-09:00 policy remains acknowledged. Exact Production release/install/
opening authority, actual internal-accounting review references and a human's
genuine ₹799 capture/full-refund run still precede acceptance. No self-invoice or
customer sale may be inferred. Customer issuance needs real buyer/issuer facts;
Meta approval/sync and real authorized delivery still precede reminder acceptance.
The Vercel invoice remains Open/Payment failed at 18:27 despite the owner's prior
payment report; reconciliation is an external fact, not another payment attempt.
Financial holds remain individually reviewed, never automatically promoted.

The fresh Production-only environment audit passed with **zero blockers/five
warnings** after the CLI's existing managed sign-in refreshed its credential.
Injecting the expired cached token had returned scope/token errors; the managed
identity verified the exact same team and project, resolving that audit-access
discrepancy. Intake alone was permitted; Test keys and the new financial recovery
flag were absent/closed. The warnings concern hidden canonical URL, encryption
key, protected Live secrets, explicit intake-only scope and absent Turnstile.
No credential/secret was printed; restricted temporary exports were removed.
