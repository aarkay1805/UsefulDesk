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

| Runner                                              | Target | Proof and cleanup                                                                                                                   |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `verify-subscription-capabilities-full.mjs`         | Full   | Restores baseline settings and account/user counts after its rollback fixture.                                                      |
| `verify-subscription-live-full.mjs`                 | Full   | Live boundary, renewal, complimentary and receipt cases; Live schema absent before/after rollback.                                  |
| `verify-subscription-live-recovery.mjs`             | Full   | Original obligations, holds and recovery; current Starter capability migration is replayed before its updated branch-limit fixture. |
| `verify-starter-live-pilot-opening.mjs`             | Full   | Default pilot checks; `--customer` adds owner/customer cases; `--documents` also adds documents and prospective signup selection.   |
| `verify-starter-document-concurrency.mjs`           | Full   | Generated clone: stale-access issuance refusal, exact retry and one-branch races; clone dropped and source unchanged.               |
| `verify-subscription-live-recovery-concurrency.mjs` | Full   | Generated clone: one original recovery obligation claimed once; clone dropped and source unchanged.                                 |
| `verify-subscription-test-concurrency.mjs`          | Test   | Trial create/restore capacity races; restores the original gate and retains synthetic fixture rows.                                 |
| `verify-subscription-renewal-concurrency.mjs`       | Test   | Renewal/refund exactly-once races; restores original settings and retains the printed synthetic organization.                       |

Example with an already prepared disposable full-schema database:

```sh
node scripts/verify-starter-live-pilot-opening.mjs <full-container> --documents
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
