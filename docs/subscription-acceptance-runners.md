# Subscription acceptance runners

These runners use explicit disposable local Docker databases. They do not load
application `.env` files, resolve a cloud target, call Razorpay or change Production.
The shared command boundary lives in `scripts/lib/disposable-postgres.mjs`.

## Target and command boundaries

Full-schema runners accept only
`supabase_db_usefuldesk-subscription-full-<lowercase-alphanumeric-suffix>`.
The older Test concurrency fixtures accept only
`supabase_db_usefuldesk-subscription-test.<alphanumeric-suffix>`.
A missing target, a cloud URL/project ID, a mismatched kind or extra command
arguments in the container name fail before any process call.

The helper invokes Docker without a shell and always passes
`ON_ERROR_STOP=1`. Full-schema sessions retain `psql -X`; older Test sessions
retain their existing argument behavior. Output remains raw so each runner owns
its existing trim/comparison rules. SQL failures propagate. Buffer limits and
clone restore roles remain caller-specific.

## Existing commands and lifecycle

| Runner                                              | Target | Proof and cleanup                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-subscription-capabilities-full.mjs`         | Full   | Restores baseline settings and account/user counts after its rollback fixture.                                                                                                                                                         |
| `verify-subscription-live-full.mjs`                 | Full   | Live boundary, renewal, complimentary and receipt cases; Live schema absent before/after rollback.                                                                                                                                     |
| `verify-subscription-live-recovery.mjs`             | Full   | Original obligations, holds and recovery; current Starter capability migration is replayed before its updated branch-limit fixture.                                                                                                    |
| `verify-starter-live-pilot-opening.mjs`             | Full   | Default pilot checks; `--customer` adds owner/customer cases; `--documents` also adds documents and prospective signup selection; `--preparation` adds accountable work, closed renewal compatibility and tracked capture/hold/replay. |
| `verify-starter-preparation-concurrency.mjs`        | Full   | Generated clone: actual authenticated invoice upsert/retry, overlapping work/freeze, changed-buyer capture hold/no grant and actual document issuance; clone removed.                                                                  |
| `verify-starter-document-concurrency.mjs`           | Full   | Generated clone: stale-access issuance refusal, exact retry and one-branch races; clone dropped and source unchanged.                                                                                                                  |
| `verify-subscription-live-recovery-concurrency.mjs` | Full   | Generated clone: one original recovery obligation claimed once; clone dropped and source unchanged.                                                                                                                                    |
| `verify-subscription-test-concurrency.mjs`          | Test   | Trial create/restore capacity races; restores the original gate and retains synthetic fixture rows.                                                                                                                                    |
| `verify-subscription-renewal-concurrency.mjs`       | Test   | Renewal/refund exactly-once races; restores original settings and retains the printed synthetic organization.                                                                                                                          |
| `verify-starter-live-renewals.mjs`                  | Full   | Customer renewal source replay and expiry-only/hold/history cases; synthetic opening and all Live schema roll back.                                                                                                                    |
| `verify-starter-renewal-concurrency.mjs`            | Full   | Generated clone: overlapping quotes, one-create claim, both capture/cancellation outcomes and shutdown races; clone dropped and source unchanged.                                                                                      |

Example with an already prepared disposable full-schema database:

```sh
node scripts/verify-starter-live-pilot-opening.mjs <full-container> --preparation
node scripts/verify-starter-preparation-concurrency.mjs <full-container>
node scripts/verify-starter-document-concurrency.mjs <full-container>
```

Inspect and start only the explicit local databases needed for a run. Serialize
runners sharing a database; their rollback/baseline assumptions are not a parallel
test contract. Stop those databases when acceptance finishes; preserve volumes.

Rollback runners require the existing full application baseline with no installed
Live subscription tables. The Test fixtures use their separate synthetic schema.
Do not point either kind at a development database with real customer records.

## Payment helper ownership

`src/lib/subscriptions/provider-utils.ts` owns only JSON-record detection,
SHA-256 HMAC matching and the existing uncached, timed Basic-auth transport.
`test-provider.ts` and `live-provider.ts` keep their own credential/configuration,
identifier, merchant, authority, economics and money-gate checks. Their public
interfaces and mode-specific errors stay unchanged. The shared helper is server-only.

Local regression/concurrency evidence does not establish genuine provider
redelivery, cloud Auth/API behavior, native delivery or WhatsApp delivery. Use
the separately reviewed cloud acceptance target when those checks are needed;
pausing it does not remove the tests or authorize activation.

## Monthly first Checkout regression and concurrency

Run serially on an existing explicit full target:

```sh
node scripts/verify-subscription-monthly-first-checkout.mjs <full-container>
node scripts/verify-subscription-monthly-first-checkout-concurrency.mjs <full-container>
```

The rollback runner applies the monthly migration twice, exercises all three
fixed tiers, replays original Starter writers under the new dispatch, and runs
the dormant Test upgrade/add-on/restart suite on the full baseline. The latter's
counts are scoped to its synthetic organizations, so existing Test history is
preserved. No separate Test container is needed. Whole-row comparisons retain
all pre-existing columns, with separate NULL assertions for newly added contract
columns; gym payment/mandate/invoice rows and original issued document bytes are
included. Shared setup lives in `verify-subscription-monthly-seed.sql`; tier,
capability and document/refund scenarios remain focused companions.

The concurrency runner dumps the source into a randomly named database in that
same container, loads current migration sources and synthetic reviews, and opens
independent psql sessions with bounded lock/statement/idle timeouts. It checks
real lock contention for selection, quotes, claims, branch changes, capture,
refund and document issuance. Deterministic create counters stand in for provider
POSTs; a repeated order/refund claim only permits recovery. No provider is called.
Fixture-only helpers in the clone use fixed private names and restricted grants;
authorization checks call the actual product RPCs as authenticated/service roles.
The clone is force-dropped in `finally`, even on assertion failure, and every
source public/private/auth table's whole-row fingerprint is compared afterward.

For the deliberate negative control, append `--without-monthly`. This omits only
the new monthly migration, retains the full original baseline and issued-document
fixture, and must exit nonzero with `MISSING MONTHLY GUARD`: a competing source
insert succeeds while owner review holds the organization lock. This is an
expected regression failure, never a reason to change the source database.

The expiry race models a 1,800-second quote by setting a synthetic review time
1,798 seconds before transaction start and expiry two seconds after it. All
quote guards are restored before a real second session blocks on the quote row;
the first session releases after another 2.3 seconds. It proves the post-wait
expiry check, not 30 minutes of elapsed wall time. Separate buyer-write races
briefly disable only synthetic local product-access enforcement to allow the
ordinary authenticated settings RPC on an expired trial; the subscription
capability and financial guards stay active. No genuine opening/evidence exists.

Capability closure blocks monthly initiation and retains durable financial
identity/recovery. Existing global capability-gate fallback semantics are not
changed by these tests; the paid branch/capability assertions run with that gate
enabled. Actual owner restoration at five Ultimate branches must refuse a sixth.
Stop any task-started container when finished and retain its named volume.
