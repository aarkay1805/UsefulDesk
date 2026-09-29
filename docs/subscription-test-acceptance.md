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
- The renewal/downgrade/cancellation and refund slices recorded below now exist
  locally, but still require full application and genuine provider-delivery
  acceptance. Upgrades, paid branch add-ons, and capability enforcement remain
  subsequent implementation slices. Commercial, tax, and explicitly authorized
  real-money pilot gates remain closed.

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

## Fresh-chat continuation: full repository schema pre-payment checks

The previous run stopped before overlapping environment work. Its cloud restore
finished; `gxwhpraswnkosjibvquz` was paused again and verified **INACTIVE**.
No cloud migration or billing configuration was changed.

A fresh local project at
`/Users/rajatkashyap/Library/Caches/usefuldesk-subscription-full-bo1rg7p0`
successfully applied all **307 repository migrations**. This is the full
repository application schema, not a claim of parity with Production's divergent
migration history. It contains 108 public tables, 313 public policies, and zero
public base/partitioned tables without RLS. No Production data was copied.

Historical replay needs `20260711173414_harden_membership_payments.sql` before
`058_payment_hardening_followups.sql`: otherwise `061` fails because
`membership_operations` does not exist. Only the disposable migration copies
were reordered and sequentially numbered; `migration-map.tsv` preserves every
source filename. Repository migration filenames/content remain unchanged.
The older failed directory `usefuldesk-subscription-full.FswjW6` is not this run.

New evidence (real Auth, PostgREST, and Next.js, no mocked clients):

- Three synthetic users were created through Auth and signed in; the actual
  provisioning triggers created their organization/branch/profile memberships.
  The owner created an invitation and the staff user redeemed it through
  `redeem_invitation` with role `agent`.
- With only the synthetic owner's trial expired, `product_access_for_account`
  returned `expired`/`allowed=false` to owner and invited staff; an outsider got
  `42501`. This exercises the backend contract consumed by native; a physical
  native-client recovery walkthrough remains unverified.
- The actual `/api/subscriptions/monthly-intents` route returned 202 to the
  signed-in owner and 403 to staff, outsider, missing-origin, and cross-origin
  requests. Authenticated operational contact inserts were RLS-denied (`42501`)
  for the expired owner/staff and outsider.
- In another synthetic live trial, `create_organization_branch_from_setup`
  created branches two through five with normal setup seeding. Both that RPC
  and legacy `create_organization_branch` rejected the sixth (`22023`); the
  expired owner's setup create was rejected (`42501`).
- The signed-in web owner saw all three Test plans, support, refresh, and sign-out.
  Choose Starter reached real Razorpay **Test Mode** Checkout for order
  `order_ThVK50mo2OaMs3`; Checkout was exited without payment. The full-schema
  SaaS payment/grant tables and gym payment ledger still contain zero rows.

Local API: `http://127.0.0.1:55321`; database: port 55322; container:
`supabase_db_usefuldesk-subscription-full-bo1rg7p0`; app: `http://localhost:3230`.
The local directory retains `api-checks.cjs`, `api-evidence.json`,
`branch-checks.cjs`, `branch-evidence.json`, and screenshots. `runtime.env` and
`users.json` contain credentials and must remain private/untracked.

**Earlier handoff (resolved below):** a temporary webhook-only proxy on port 3231 forwards only
POST `/api/subscriptions/test-webhook` to the actual local application route.
Its public endpoint returned 400 for an unsigned POST and 404 for other paths.
The Razorpay Test form is prepared for `payment.captured`, `payment.failed`,
`refund.created`, `refund.processed`, and `refund.failed`; it has **not** been
saved. The user must complete the browser credential step with the existing
Test webhook secret. No genuine delivery, new capture, or new refund is claimed.
The temporary application and full-schema DB gates are enabled only for this
pending local run; main-project application flags remain false. Finish by
disabling the temporary webhook before stopping its tunnel, restoring the local
DB gates, and stopping the local app/proxy. Resume the existing unpaid order
instead of creating a replacement merely because the browser was closed.

Still open: full-schema paid commit/refund/renewal recovery, organization-switch
UI acceptance, physical native recovery, genuine provider delivery/retry and
browser disappearance, and provider/database outage acceptance.


## Genuine provider delivery and full-schema paid recovery — 28 September

The user saved Test webhook `ThVktamqauzsWP` with the matching signing secret.
The dashboard confirmed exactly `payment.captured`, `payment.failed`,
`refund.created`, `refund.processed`, and `refund.failed`, not every event.
Only the webhook path was exposed through the temporary tunnel.

- Resumed existing `order_ThVK50mo2OaMs3`; no replacement order was created.
  The owner application tab was closed before choosing Success on Razorpay's
  demo bank page. Test payment `pay_ThVm8T3dgRLwSP` captured 79900 paise / INR;
  a fresh provider GET independently confirmed its captured status and order.
- Genuine event `ThVmOVvbqE23KL` (`payment.captured`) arrived at
  2026-09-28 15:47:35 UTC and returned 200. The actual Next.js webhook route
  verified the signature, configured merchant, and provider payment, then
  committed one payment, one Starter grant, and one `verified_subscription_payment`
  audit. No `/test-confirm` callback ran. Period start was
  `2026-09-28T15:47:35.457Z`, end `2026-10-28T15:47:35.457Z`.
- Reopening the signed-in owner web app showed Home. Actual authenticated
  `product_access_for_account` returned active/allowed/version 2 for the owner
  and invited agent; an outsider received `42501`. The actual branch-setup RPC
  refused Starter's second branch (`22023`). Two local replays of the genuine
  capture payload returned 200 without adding payment/grant/audit rows. These
  replay requests were local tests, not provider retry evidence.
- Owner UI cancellation persisted the next-renewal cancellation while retaining
  the exact paid-through timestamp and access version 2; it made no provider
  recurring schedule or early access cutoff.
- The owner UI reserved eligibility, displayed the exact full refund amount and
  access effect, and executed Test refund `rfnd_ThVp6pl8yJlG9c`. Its initially
  pending response retained access. A fresh provider GET subsequently verified
  processed / 79900 paise against the same payment.
- Genuine `refund.created` event `ThVpfoWaBHacAS` and `refund.processed` event
  `ThVpjwxHTILY36` returned 200 at 15:50:42 and 15:50:44 UTC. Fresh provider
  verification during the created event already observed settlement; access
  ended once at `2026-09-28T15:50:42.386968Z`, version 3, with one
  `subscription_full_refund` audit and renewal stopped. Replaying processed,
  then created, then processed locally preserved that result.
- After settlement, owner and invited agent access returned expired/denied;
  all three authenticated users' operational contact inserts were RLS-denied
  (`42501`). The signed-in owner retained refund confirmation, payment history,
  plan comparison, support, refresh, and sign-out. No new trial was granted.

Evidence files in the full-schema local cache directory above:
`post-capture.cjs`, `post-capture-evidence.json`, `post-refund.cjs`,
`post-refund-evidence.json`, and `final-db-evidence.json`. `deliveries.jsonl`
contains original provider bodies and signatures and remains private/untracked.
Final counts: one subscription payment, one historical grant, one capture audit,
one full-refund audit. No application code or schema change was necessary.

Cleanup: the temporary Test webhook is **Disabled**, verified in the merchant
UI before stopping the tunnel. Full-schema DB `enabled` and `refunds_enabled`
are false; temporary runtime subscription flags are false; the app, webhook proxy,
and tunnel processes were stopped. Local DB fixtures remain for investigation.
The shared `.env.local` was never edited and cloud Test remains paused.

Still unverified: provider-originated retry after an outage, genuinely delayed
or out-of-order provider delivery, authorized-but-not-captured recovery,
provider/database outage recovery, genuine renewal delivery/full-schema renewal
transitions, organization-switch UI acceptance, and physical native recovery.
Closing the app before demo-bank success proves absence of the Checkout callback;
it does not simulate the narrower timing window after capture but before callback.
Upgrades/add-ons/capability enforcement and commercial decisions remain separate.


## Genuine renewal and database-API outage recovery — 28 September

A separate synthetic organization `8fc39a3f-9307-41e3-8d7b-77a66bc80f72`
used the full-schema local database. Its previous Ultimate paid term/payment was
**seeded test data**, ending an hour before the run; it was not a historical
provider payment. `pay_SyntheticRenewalBaseline` and
`order_SyntheticRenewalBaseline` must never be sent to provider reconciliation.
The five existing synthetic branches were retained. The existing synthetic owner
was given fixture owner memberships in this organization to exercise switching;
the original refunded organization and its payment evidence were preserved.

- Actual owner Test renewal API created `order_ThWDgCFx7g0MWN`, ₹3,999 / 399900
  paise. Demo-bank Failure produced `pay_ThWDxDXCFrXBvu`; genuine
  `payment.failed` event `ThWEBBOG9boIzZ` returned 200 at 16:13:53 UTC.
  The full-schema transaction retained Ultimate and set access expiry to exactly
  original paid-through + 72 hours, with one grace audit and access version 2.
- Same-order demo-bank Success produced `pay_ThWF1gjLuFpYtO`. Fresh Test provider
  GETs independently verified failed/captured states and the shared order/amount.
  The application tab was closed, so no Checkout confirmation callback recovered
  the payment.
- Before Success, only `supabase_rest_usefuldesk-subscription-full-bo1rg7p0`
  was stopped. PostgreSQL, Auth, the local app, and webhook ingress stayed up.
  This was an actual isolated PostgREST/database-API outage, not a mocked database
  response or evidence of a PostgreSQL crash/mid-transaction failure.
- Genuine capture event `ThWFKKTEep0eYx` received 503 at 16:14:57.658,
  16:14:57.748, 16:15:05.383, and 16:15:16.779 UTC. SQL inspection before
  recovery showed zero rows for the captured payment and a pending intent.
  The REST container was restarted after the first two failures; retries continued
  while the API recovered. **Razorpay's own retry** returned 200 at 16:15:38.612.
  No locally signed/replayed request was used to obtain that successful recovery.
- Recovery wrote exactly one payment and one `verified_subscription_renewal`
  audit. Access became version 3; period start is verification time
  `2026-09-28T16:15:38.590Z`, while paid-through is
  `2026-10-28T15:11:27.627156Z`, exactly one month after the original end.
  Ultimate and all five branches were retained. Local delayed failure and capture
  replays subsequently returned 200 without reopening grace or adding an audit.
- The same signed-in owner switched from the refunded organization into the
  renewal organization, saw its separate Ultimate billing, and regained Home
  during grace/after renewal. Switching back showed the original Starter refund
  and expired access. Fresh real Auth logins and the actual access RPC admitted
  both fixture owners to the renewed organization and denied the unrelated staff
  user (`42501`). The original refund remained version 3/expired.

Evidence in the full-schema cache: `seed-renewal.py`, `renewal-fixture.json`,
`renewal-grace-evidence.json`, `outage-before-recovery.txt`,
`renewal-provider-evidence.json`, `renewal-recovered-evidence.json`,
`renewal-access-replay.cjs`, `renewal-access-replay-evidence.json`, and
`renewal-delivery-summary.json`. The summary excludes raw bodies/signatures.
The seeded first term is explicitly distinguished from the genuine provider
renewal; no initial-payment or refund acceptance was repeated.

Cleanup verified: webhook `ThVktamqauzsWP` disabled again, DB billing/refund gates
false, temporary app/proxy/tunnel stopped, REST container restored, shared app
configuration unchanged. No application/schema fix was needed. No Production
billing, customer messaging, real charge, or cloud restoration occurred.

Remaining boundaries: a physical native walkthrough needs an isolated Test client
build connected to the Test backend. No simulator was booted; the available local
build targets a physical iPhone, and the shared native configuration was not
repointed. The RPC consumed by native passed, which does not certify device UI.
Provider transport/timeout and authorized-only recovery, PostgreSQL commit-outage
recovery, genuine out-of-order delivery, and full-schema downgrade/archive renewal
acceptance remain open. This run verifies the implemented Test renewal convention;
it does not resolve commercial scheduling/upgrade/add-on policies.

## Transport ambiguity, uncaptured payment, transaction rollback and delayed failure — 28 September

This acceptance-only run used a new synthetic owner and organization
`483ef122-a803-41c1-8471-4436e7e2a0fa` in the same disposable full-schema local
stack. Five branches and an Ultimate prior term were seeded. The baseline
`pay_SyntheticRecoveryBaseline` is **not** a provider payment. The owner scheduled
Starter with four explicit archive choices through the authenticated renewal RPC;
only the fixture's term timestamps were advanced to exercise the renewal boundary.
No upgrade, add-on, capability implementation or commercial policy was changed.

- **Transport ambiguity:** the actual `prepareTestCheckout` claimed the intent
  and issued one successful Razorpay Test order POST. A transport wrapper discarded
  the genuine response and threw before binding. Receipt lookups initially returned
  no match, and the application failed closed without another POST. Once the
  provider index exposed `order_ThWTgsZ92BLfbp`, the real recovery path bound it;
  SQL still showed zero new payments, Ultimate and five active branches. This is
  injected response loss after a real provider write, not a Razorpay outage or a
  wall-clock timeout test. Fixture setup first received a definitive 400 for a
  missing manual-capture duration; that rejected setup call was corrected before
  this scenario, with the disposable claim reset explicitly documented.
- **Authorized-only:** per-order manual capture (7200-minute expiry) left genuine
  Test payment `pay_ThWVyk66P8BEdx` authorized/uncaptured for ₹799. The real
  `confirmTestPayment` fetched provider state and rejected it. The intent stayed
  pending, with zero payment rows and no tier/branch changes. No global merchant
  capture setting was changed.
- **PostgreSQL transaction failure and downgrade:** a local-only temporary trigger
  raised `P0001` on the final access update, after the function's payment insert,
  four archive writes, tier change and intent update. The authorized Test payment
  was captured via Razorpay. Genuine capture event `ThWbOLP2wn8qlX` received 503s;
  inspection proved all preceding writes rolled back: zero new payments, zero
  archive/renewal audits, five active branches, Ultimate, pending intent and an
  uncommitted schedule. After a local cleanup migration removed the trigger,
  Razorpay's own retry returned 200 at **16:36:39.594 UTC**. Exactly one payment,
  one renewal audit and four archive audits committed; Starter retained the chosen
  billing branch, and all five branch records remained. No local replay recovered
  the transaction. This proves rollback under an injected SQL exception, not a
  database crash or storage failure during physical commit.
- **Genuine out-of-order provider delivery:** the next synthetic Starter term was
  advanced locally solely for another renewal. Order `order_ThWdYxum9fUbDm`
  produced failed payment `pay_ThWehL8chEfZfe`. The webhook-only proxy deliberately
  returned 503 for its genuine event `ThWfFvyfcpdP7f` before forwarding to the app.
  A later same-order success, `pay_ThWg7Bb1gSLomn`, committed through genuine
  capture event `ThWgPlQkLoHBlM` at **16:40:37.186 UTC**, with the Checkout tab
  closed. After releasing the delay, Razorpay retried the original failed event
  at **16:42:13.319 UTC**, receiving 200. The full intent/access snapshot and
  payment count were identical before and after that delayed failure: paid access
  was not replaced by grace. Neither event body nor signature was constructed or
  locally replayed to obtain this result.

Private cache evidence: `transport-recovery-evidence.json`,
`transport-provider-observation.json`, `manual-order-setup-note.txt`,
`authorized-provider-evidence.json`, `authorized-rejection-evidence.json`,
`recovery-capture-provider-evidence.json`, `commit-rollback-evidence.json`,
`commit-recovered-evidence.json`, `out-of-order-delivery-evidence.json`, and
`out-of-order-{before,after}-delayed-failure.json`. Raw webhook signatures and
synthetic Auth credentials remain only in the private cache. Temporary fault
migrations live in that disposable stack, never repository migrations.

### Native boundary and final cleanup

An unsigned Debug iOS simulator build succeeded in the isolated managed worktree
`/Users/rajatkashyap/.codex/worktrees/subscription-recovery-gates/UsefulDesk` and
installed successfully on iPhone 17 Pro / iOS 26.5. Metro used process-only
`EXPO_PUBLIC_APP_ENV=test`, loopback Supabase/API URLs and the local public anon
key, with dotenv loading disabled. No shared mobile environment file changed.
A disposable native owner was given fixture memberships in the active recovery
and previously refunded organizations, but **native UI acceptance remains open**:
Device Hub repeatedly timed out in the native UI tool, so no sign-in, switching
or recovery walkthrough is claimed. Compile/install is not device acceptance.
The simulator build is preserved under the private cache's
`native-simulator-build/Build/Products/Debug-iphonesimulator/UsefulDeskAgent.app`;
`native-acceptance-result.json` records the boundary.

Final cleanup: the existing Test webhook is visibly Disabled; temporary Checkout,
app, proxy, tunnel and Metro processes were stopped; the local billing/refund gates
are false; the injected trigger/function were removed. The simulator was returned
to Shutdown after installation. Cloud Test remains paused and shared Production
configuration was not changed. `recovery-event-integrity.json` verifies identical
raw-body hashes across each genuine provider retry sequence. Physical-device UI,
an actual provider outage/wall-clock timeout, and physical PostgreSQL crash/storage
failure remain outside the evidence above. No implementation defect was found in
these acceptance cases, and no application code or repository migration was added.

## Native access continuation — 28 September

The prepared unsigned Debug client remained installed on iPhone 17 Pro / iOS
26.5. This continuation booted that simulator and launched
`com.usefulmade.usefuldesk.agent` through `simctl`. Metro ran with only the local
public Test URL/key and API base URL in its process environment; it listened on
`localhost:8082`. The shared Production environment files were untouched. A
successful launch command does **not** establish that the JS bundle rendered or
that any in-app action worked.

A new direct probe used the disposable native owner's real local Auth password
and `my_branch_accounts`/`product_access_for_account` RPCs. It returned the
recovery organization's one active branch as `active`/allowed (access version 4),
the previously refunded organization's branch as `expired`/denied (version 3),
and the four chosen recovery branches as archived. The provisioning trigger's
additional active trial branch also appears in the owner's roster. The probe
did not publish credentials or tokens; its sanitized output is
`native-runtime-probe-result.json` in the private cache. Seven focused native
Jest suites passed **70 tests** for Auth bootstrap/session handling, branch
selection, Account, access recovery, and SecureStore delegation.

**Device UI remains unaccepted.** `cua_repl` could inspect Finder, but opening
Xcode or `com.apple.dt.Devices` repeatedly returned `timeoutReached`, including
after simulator boot and a Device Hub process restart. This Xcode installation
has Device Hub and no separate `Simulator.app` bundle. The native window could
not be observed or controlled, so no on-screen sign-in, active/refunded switch,
archived-branch exclusion, expired recovery controls, or app reopen/session
restoration is claimed. Unit tests and backend RPCs do not replace that
walkthrough. A functioning simulator UI automation surface or a human-driven
device walkthrough is still required for those five cases. The private
`native-acceptance-result.json` records this boundary.

After probing, the native app was terminated, the simulator shut down, and Metro
stopped. Ports 3230–3233 and 8082 had no listeners. The disposable database's
`enabled` and `refunds_enabled` switches remained false and no acceptance fault
trigger remained. The Test webhook stays Disabled and the cloud Test project
stays paused. No application code, repository migration, charge, message, or
commercial policy changed in this continuation.

### Native runtime follow-up

Xcode 27 opened the isolated iOS workspace and ran the installed Debug client
on iPhone 17 Pro / iOS 26.5. Metro initially served only IPv6 localhost while
the client requested IPv4 `127.0.0.1:8082`; binding Metro to IPv4 fixed that
connection failure. Metro started from the isolated worktree then bundled
through symlinked `node_modules` and failed before React registration with
`RangeError: Maximum call stack size exceeded`. A diagnostic Metro process
started from the main checkout loaded the same mobile source (the source trees
matched, excluding generated/native and dependency directories). Xcode then
logged `Running "main"`, and its Debug View Hierarchy captured a rendered
Inbox screen. This proves native JS startup and rendering on this simulator;
the captured screen belonged to an existing session, not the disposable
subscription fixture.

Device Hub still returned `timeoutReached` and exposed no controllable window.
The hierarchy capture is read-only, so the five fixture-specific UI checks
listed above remain unaccepted. The worktree dependency symlinks are a local
Metro harness issue; no app source fix or production deployment follows from
that diagnostic result.

## Native simulator acceptance — 29 September

The owner approved local simulator CLI/XCTest after Device Hub remained
inaccessible. A fresh disposable iPhone 17 Pro / iOS 26.5 simulator ran a
locally built Debug client against the isolated Test stack. Metro ran from the
isolated worktree with physical dependency directories and process-only
loopback Test configuration. Its bundle inspection found the local Test host
and no cloud Supabase host. The generated iOS harness disabled Expo's floating
development button, which had covered Account; this was an ignored local build
setting, not an application source change.

Native XCTest entered the synthetic owner's email and password, verified the
typed values, and reached the signed-in Inbox. A second UI journey passed with
the repository's original mobile source: the Account roster included the active
paid recovery branch, the refunded branch, and the provisioning trial branch;
all four archived branches were absent and unselectable. The active paid Inbox
restored on app reopen. Selecting the refunded branch showed the expired
UsefulDesk access gate with its ended-access reason, Contact support, Check
access again, and a route to the active branch. The operational Inbox was
absent. Reopening preserved the gate and its branch recovery control; switching
back restored the active Inbox. The ended-access reason is exposed by the
native accessibility tree inside a combined Notice label. The journey's final
XCTest run passed; an earlier assertion that queried the reason as a separate
StaticText was corrected without changing product code.

Evidence is in private cache logs `native-ui-signin-local.log` and
`native-ui-journey-final.log`, plus `native-acceptance-result.json` and the
earlier real Auth/RPC probe. The simulator and UI test target were disposable;
no application code or repository migration changed. This accepts the five
simulator UI checks previously left open. Afterward the app and Metro stopped, the disposable
simulator returned to Shutdown, ports 3230–3233 and 8082 had no listeners,
and local intent, billing-UI and refund switches were false. The Test webhook
and cloud Test project retained their previously verified disabled/paused state.

### Physical iPhone Air follow-up

With owner approval, an iOS 27.0 iPhone Air build was signed and installed as
the separate `com.usefulmade.usefuldesk.agent.acceptance` app, leaving the
existing `com.usefulmade.usefuldesk.agent` install and its data untouched. The
physical app and XCTest runner used the same development team; the Test bundle
was configured for the Mac's LAN address and the disposable local Test stack.
The first runner build lacked signing and was corrected in the ignored generated
Xcode target. Subsequent runner launches stopped before any test method with
Apple's `com.apple.sharing.authentication` timeout (“Unable to Communicate with
iPhone”) over the wireless CoreDevice connection. iPhone Mirroring showed the
same connection/authentication boundary. The device then became unavailable to
CoreDevice. No physical-device UI result came from that wireless attempt.

After the owner connected USB-C, XCTest reached the native app. A physical
sign-in run entered the synthetic credentials and reached the signed-in Inbox;
the harness slowed email entry after XCTest dropped characters in its first
attempt. The owner manually trusted their own development certificate when iOS
blocked the disposable runner. An Account inspection then passed, followed by
a complete physical branch journey: the paid, refunded and provisioning trial
branches appeared; all four archived branches were absent and unselectable;
the paid Inbox restored after reopen; the refunded branch displayed the
ended-access reason, support and retry controls, and a switch back to the paid
branch while hiding operational Inbox; the expired gate survived reopen; and
switching back restored the paid Inbox. The physical sign-in and journey
XCTest methods both passed. Evidence is in private logs
`physical-ui-signin-slow.log` and `physical-ui-journey-final.log`.

The physical Debug harness used a temporary, exact LAN-host HTTP allowance
for `EXPO_PUBLIC_APP_ENV=test` so the phone could reach the disposable local
Supabase stack. That source change was confined to the isolated worktree and
restored after the run. The accepted checks cover native UI and access behavior
under Test configuration; this run does not validate a release build's HTTPS
configuration. The separate acceptance app and runner were uninstalled, the
existing UsefulDesk Agent app remained installed, Metro stopped, and no charge
or message was sent. The owner can revoke the development-certificate trust
in iPhone Settings after testing.
