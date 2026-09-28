# Local subscription Test acceptance — 28 September 2026

The first-payment core passed real Razorpay **Test** Checkout → server
verification → disposable PostgreSQL entitlement commit. This is partial
acceptance, not a Production release or full signed-in application acceptance.
The application Test flags remain false; Production billing remains unavailable.
No Production schema/data, gym-member ledger, real charge, or recurring schedule
was changed.

## Evidence

| Case                                           | Result and boundary                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate Test credentials                      | Read-only Orders API authentication returned 200. Only the `USEFULDESK_SAAS_RAZORPAY_TEST_*` credentials were used.                                                                                                                                                                                                                                                                                              |
| Provider order and uncertain response recovery | Created `order_ThPOPMkdnJE67G` for a synthetic organization, fetched it directly, and recovered it by exact receipt plus organization/request notes. The receipt index initially returned zero, then one: an empty result must never authorize a second create. Wrong-organization notes were rejected. No payment was attempted on this order.                                                                  |
| Failed provider payment                        | Test bank Failure produced `pay_ThPZLeIQO3okic` on `order_ThPXuBhSvGX5tj`, ₹799 / 79900 paise. The provider returned `failed`; the real captured-payment verifier rejected it. Local access remained trial with zero payment rows.                                                                                                                                                                               |
| Browser reload and success                     | Reloaded the disposable browser harness after failure and reopened the same order. Test bank Success produced `pay_ThPaOBylZedRri`. Real `prepareTestCheckout` and `confirmTestPayment` used local PostgREST and the Test provider. The Checkout HMAC and fresh captured-payment GET passed; one Starter grant and payment row committed, access became manual/version 2/allowed, with exactly one access audit. |
| Signed duplicate webhook                       | Sent two locally constructed, correctly signed `payment.captured` deliveries for that real Test payment through the actual webhook route. Both returned 200; payment/grant/audit remained exactly once. **These were synthetic deliveries, not Razorpay delivery evidence.**                                                                                                                                     |
| Delayed callback                               | Disposable SQL replay with a later verification timestamp retained the original period start/end and one audit. Wrong payment, order, amount, and null replay amount/currency were rejected.                                                                                                                                                                                                                     |
| Organization isolation and privileges          | SQL refused another organization's roster, archive, intent claim, and browser-role service RPC/table access; the unrelated organization's access version stayed unchanged. Mocked API checks also reject cross-site and non-owner requests.                                                                                                                                                                      |
| Archive/restore capacity                       | SQL refused an over-cap Starter intent; explicit archive preserved all six fixture branch rows; paid Starter restore/direct insert failed at capacity; archive freed a slot and restore consumed it. Expired-trial restore retained the pre-existing product-access denial.                                                                                                                                      |
| Concurrent capacity                            | Separate PostgreSQL sessions exercised create/create, create/restore, and restore/restore with one trial slot remaining. Exactly one transaction succeeded in each pair; the other received the capacity error; active count stayed five.                                                                                                                                                                        |
| Browser request identity loss                  | SQL accepts a new browser request UUID by returning the organization's existing claimed same-tier intent. The API and UI tests verify that the canonical returned request ID is used for Checkout and confirmation. This is separate from the minimal browser harness reload above.                                                                                                                              |
| Production/default-off gates                   | API/provider tests refuse Production and non-Test mode; SQL refuses disabled billing. Repository `.env.local` billing flags stayed false. The disposable database billing switch was disabled after acceptance.                                                                                                                                                                                                  |

Repository validation: `npm run verify` passed lint, TypeScript, all **3,872 tests
in 498 files**, and the optimized Next.js production build. The targeted
subscription/access run passed 183 tests; the one-use real-provider harness
passed separately. The rollback SQL and all three concurrent-capacity pairs
passed against the disposable PostgreSQL instance.

## Fixes made during acceptance

- Resume the canonical claimed intent after browser loss instead of stranding a
  new UUID behind the one-order guard. A different tier remains blocked while an
  order needs completion/review.
- Reconcile ambiguous order creation by exact provider receipt and immutable
  organization/request notes; only a unique match is bound. Zero/multiple matches
  keep recovery blocked, without another provider POST.
- Preserve `private.is_product_organization_owner` and
  `private.has_product_account_membership` in the replacement `restore_branch`.
  Reverting to identity-only predicates had removed the existing expiry gate,
  even while subscription billing was off.
- Use null-safe amount/currency comparison on committed-payment replay, and apply
  the shared Test-mode gate to monthly intent creation.

## Repeatable disposable database checks

Existing local project:
`/Users/rajatkashyap/Library/Caches/usefuldesk-subscription-test.fLz1yB`.
Database container: `supabase_db_usefuldesk-subscription-test.fLz1yB`.
Local API is `http://127.0.0.1:54321`; PostgreSQL is on local port 54322.
This is a **minimal schema fixture**, not a restored Production database.
The cloud project named UsefulDesk Razorpay Test was inactive and was not used.

The source fixture is `scripts/fixtures/subscription-test-schema.sql`. It provides
only the subscription prerequisites plus product-access predicates copied from
`20260906171614_organization_product_access.sql`; it does not claim to reproduce
all operational RLS, account triggers, or native/API behavior.
The subscription draft was applied/reapplied **only here**, through
`supabase migration up --local --workdir <disposable-project>`. Local-only history
records the original draft plus `20260928093000`, `20260928094000`, and
`20260928094100` fixture/recovery revisions. Do not copy that fixture history into
Production or run `db push`.

```sh
docker exec -i supabase_db_usefuldesk-subscription-test.fLz1yB \
  psql -U postgres -d postgres -q < scripts/verify-subscription-test-conversion.sql
node scripts/verify-subscription-test-concurrency.mjs \
  supabase_db_usefuldesk-subscription-test.fLz1yB
npx vitest run src/lib/subscriptions src/app/api/subscriptions \
  src/components/platform-access src/lib/auth/roles.test.ts
```

The conversion SQL rolls all fixtures and gate changes back. The concurrency
runner retains synthetic rows as evidence and restores the previous billing gate.
Its container-name restriction prevents an accidental application `.env` target.
The one-use browser harness is retained in the local project's
`provider-acceptance.local.test.ts` for investigation, outside the ordinary test
suite; it is not a supported production route or a turnkey repeat command.
The paid synthetic organization is
`a2222222-2222-4222-8222-222222222222` and its intent is
`a7777777-7777-4777-8777-777777777777`.

## Still required before wider rollout

- A disposable **full application schema** with authenticated owner, invited
  staff, organization switching, actual create RPCs, operational RLS, native/API
  recovery, and complete expired-owner UI acceptance. The configured app database
  is Production; it was not used as a substitute.
- A reachable non-Production webhook endpoint registered with the separate Test
  merchant, proving Razorpay-originated delivery, retry, delayed/out-of-order
  events, and browser disappearance after capture but before the Checkout callback.
  Local signing does not prove merchant identity or delivery configuration.
- Initial capture held in `authorized`, provider timeout, and database commit
  outage recovery with real provider events. Mocked failure tests are not that
  acceptance. Unknown/absent receipt recovery stays support-held until the
  provider exposes a unique matching order.
- Renewal, upgrades/downgrades, cancellation, refunds, paid branch add-ons, and
  capability enforcement remain subsequent implementation slices. Commercial,
  tax, and explicitly authorized real-money pilot gates remain closed.

## Successor slice: renewal transactions and refund requests

Built on main after `04139509`, still default off. These are API/database drafts;
no paid Billing UI or Production rollout is claimed.

- Renewal SQL verifies one fixed 72-hour grace, previous-tier retention, no
  reopening from a late failed event, recovery only from capture verification,
  atomic exact-choice downgrade archives, cancellation without early cutoff or
  grace, access-version/roster conflict rejection, and duplicate/delayed replay.
- Refund SQL rejects non-first payments and local day-eight requests, accepts
  local day seven, freezes the original billing zone/full amount, and preserves
  access while a request is pending. Original server receipt precedes provider
  I/O; unit tests check retry after a provider outage uses that stored time.
- Concurrent PostgreSQL sessions produce one order claim, one renewal
  payment/access audit, and one refund receipt even with different request IDs.
  Synthetic organization `49630be7-fb89-4df6-a510-c17bfab73db5` is retained as
  evidence. The runner restores the prior billing switch/merchant in `finally`.
- All new provider calls are covered with mocked exact identity/status checks.
  **No new real-provider renewal or refund acceptance was performed.** No refund
  POST exists in this slice. Request reservation is not provider settlement.

Only the disposable local project above received the two new repository drafts.
Local-only versions `20260928115000` and `20260928125000` re-applied the revised
renewal checks and durable receipt step. They are fixture verification history,
not Production migrations. Both source drafts are idempotent. Repeat checks:

```sh
docker exec -i supabase_db_usefuldesk-subscription-test.fLz1yB \
  psql -U postgres -d postgres -q < scripts/verify-subscription-test-renewals.sql
node scripts/verify-subscription-renewal-concurrency.mjs \
  supabase_db_usefuldesk-subscription-test.fLz1yB
```

Successor repository validation: `npm run verify` passed lint, TypeScript,
**3,912 tests across 501 files**, and the optimized production build. The targeted
subscription route/library run passed 113 tests. The original conversion SQL
still passes with these drafts installed. Private-table RLS and service/owner
function grants were inspected, and both application flags and the disposable
billing switch were confirmed disabled afterward.

## Follow-up: full Test refund and owner billing recovery

The actual separate Test provider fully refunded `pay_ThPaOBylZedRri` on
`order_ThPXuBhSvGX5tj`: **`rfnd_ThQRsoOgXZ08eH`, 79900 paise / ₹799**, processed.
Fresh refund and original-payment GETs verified settlement. The disposable
commit confirmed at **2026-09-28 10:34:47.540716 UTC**, ended access (version 3),
stopped renewals, and wrote one `subscription_full_refund` audit. GET recovery,
service webhook reconciliation, and owner execution replay preserved that same
result and the one branch. The one-use harness used real Test credentials but
an explicitly container-bound SQL RPC adapter, never the configured cloud DB.
This proves provider and disposable transaction behavior, not a genuine incoming
Razorpay webhook delivery or full signed-in application flow.

`20260928140000_subscription_test_refund_execution.sql` was applied only to the
fixture. Local-only reapplication versions `141000` (confirmation clock) and
`142000` (foreign-key cascades) record fixture maintenance; the repository draft
contains the final definitions. Both DB `enabled`/`refunds_enabled` and repository
application flags are false afterward. Execution needs the base Test flags plus
`USEFULDESK_SUBSCRIPTION_REFUNDS_ENABLED=true` and DB `refunds_enabled=true`.
Receipts are correlation evidence, not an assumed provider idempotency key.
The attempt row permits one POST; any uncertain retry uses GET only. A zero or
ambiguous recovery stays review-held. Observed settlement survives an access
conflict so a platform correction is never overwritten silently.

The default-off owner Test UI provides billing/payment history, renewal and
cancellation, explicit refund amount/access-effect confirmation, and post-refund
plan comparison/support. Component tests verify the confirmation boundary and
no automatic payment or new trial after refund. Existing recovery identity,
organization switching, and support remain in the web gate. Restart payment
after refund is not implemented. No shared UI master was changed.

Rollback SQL exercises second-gate denial, full-amount checks, pending/failed
preservation, monotonic processed state, exactly-once access stop, blocked renewal,
owner recovery, and platform-correction review. Separate concurrent PostgreSQL
sessions check one create/recovery pair and one full-refund commit/audit, in
addition to the prior renewal/receipt races. All are synthetic fixtures.

Repository validation for this follow-up: `npm run verify` passed lint,
TypeScript, **3,945 tests in 505 files**, and the optimized Next.js production
build. Rollback SQL, concurrency checks, and the separate genuine Test-provider
refund harness passed. Private-table RLS and service-only commit privileges were
verified; application and disposable DB billing/refund flags are all off.

Remaining implementation/acceptance: upgrades, paid add-ons, restart checkout,
named tier gates across UI/API/RLS/RPC/background sends; full-schema/native
recovery; genuine provider renewal/webhook delivery and outage recovery.
Policy decisions remain: upgrade quote expiry/repricing, add-on
cancellation/refund/proration/renewal, standard reminder days/times, remaining
saleable feature matrix, commercial/tax readiness, and the Test renewal convention
and immutable schedule UX. No incomplete policy was substituted with a default.
