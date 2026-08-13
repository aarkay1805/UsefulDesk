# Razorpay operator runbook

This runbook records provider configuration and acceptance evidence for the
staged OAuth, Payment Link, and refund rollout. Never paste client secrets,
merchant tokens, webhook secrets, member data, or raw provider payloads here.

## Stage 0A provider acceptance

Provider and sandbox verification on 2026-08-08 confirmed:

- the **UsefulDesk** Technology Partner application is active;
- separate development and production OAuth clients exist;
- the development redirect URIs include localhost and
  `https://usefuldesk-razorpay-test.vercel.app/api/payments/razorpay/oauth/callback`;
- the production redirect URI is
  `https://desk.usefulmade.com/api/payments/razorpay/oauth/callback`;
- one activated test merchant accepted the development client with
  `scope=read_write` and a `mode=test` token exchange;
- all five development Bearer list checks returned HTTP 200: Customers, Plans,
  Subscriptions, Payment Links, and Payments;
- a ₹1 test Payment Link was created, fetched, and cancelled successfully;
- a ₹1 weekly test plan and two-cycle Subscription were created and fetched,
  and the Subscription was cancelled before authorisation; and
- the real `payment_link.cancelled` and `subscription.cancelled` application
  webhooks were signature-verified and acknowledged with HTTP 200.

The acceptance objects are test-only. The Payment Link and Subscription are
cancelled; Razorpay does not expose plan deletion, so the disposable acceptance
plan remains in the test merchant. The temporary development access token was
revoked after the checks and was never persisted. No real payment or member data
was used.

### Isolated acceptance environment

- Supabase project: **UsefulDesk Razorpay Test** (`hkuqzmgnhhgecqcbwupb`),
  region `ap-southeast-1`, with all repository migrations applied and no
  production rows copied into it.
- Vercel project: **usefuldesk-provider-sandbox**
  (`prj_L6hmOdVTLdYwV0dqD8PM6ns2T3H3`). The public production domain is
  `https://usefuldesk-razorpay-test.vercel.app`; raw deployment and preview
  URLs retain Vercel protection.
- Runtime safety flags: `RAZORPAY_MODE=test`,
  `RAZORPAY_PROVIDER_ACCEPTANCE_ONLY=true`, `RAZORPAY_OAUTH_ENABLED=false`,
  and `RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`.
- The application webhook points only at the isolated Test endpoint and uses a
  test-only secret. The account selector now chooses which signed ingress may
  enter the shared canonical processor; the unselected ingress records only
  the service-role delivery observation described below.

Fresh-database bootstrap exposed one historical ordering dependency:
`20260711173414_harden_membership_payments.sql` must be applied before
`058_payment_hardening_followups.sql`, which reads the receipt columns introduced
by the timestamped migration. The isolated project was bootstrapped in that
order. Supabase advisors reported no error-severity findings; the remaining
security and performance warnings are the repository baseline and must still be
reviewed with any schema change.

The configured test application webhook selects these 16 events consumed by the
planned integration:

- account: `account.app.authorization_revoked`,
  `account.instantly_activated`, and `account.activated_kyc_pending`;
- subscription: `subscription.authenticated`, `subscription.activated`,
  `subscription.charged`, `subscription.pending`, `subscription.halted`,
  `subscription.cancelled`, and `subscription.completed`;
- Payment Link: `payment_link.paid`, `payment_link.partially_paid`,
  `payment_link.expired`, and `payment_link.cancelled`; and
- refund: `refund.processed` and `refund.failed`.

The selector does **not** expose the planned `account.activated`,
`account.under_review`, `account.needs_clarification`, `account.suspended`, or
`account.rejected` names. Treat the application event selector as authoritative
and keep account readiness probes as the fallback described in the
implementation plan. Re-check the live selector before Stage 5 because provider
event availability may change.

The environment, OAuth, API, product-activation, signed-webhook, five-second
acknowledgement, and duplicate-delivery identity portions of the isolated
acceptance are complete. On 2026-08-09, one OAuth-created Test Subscription
produced matching `subscription.authenticated`, `subscription.activated`, and
`subscription.charged` deliveries at both ingresses. The shared processor and
guarded selector cutover subsequently shipped in the isolated stack; the
production client stays disabled. A later controlled-503 exercise produced a
genuine Razorpay retry with identical event ID/raw hash and completed Stage 2
acceptance for this isolated Test account only.

Secret rotation was explicitly deferred on 2026-08-08. This is acceptable only
for the isolated test environment. Rotate the OAuth client secret, webhook
secret, isolated Supabase service-role key, and any other exposed acceptance
credential before the first live merchant authorisation or production rollout.

## Stage 1 OAuth rollout

Stage 1 code landed on 2026-08-09 with both runtime switches still disabled:

```sh
RAZORPAY_OAUTH_ENABLED=false
RAZORPAY_MANUAL_ROLLBACK_ENABLED=false
```

The schema migrations are
`supabase/migrations/20260809000000_razorpay_oauth_connections.sql` and the
foreign-key index follow-up
`supabase/migrations/20260809001000_index_razorpay_oauth_state_foreign_keys.sql`.
Apply them only through the approved Supabase migration mechanism, first against
the isolated test project. Never use `supabase db push`. After applying, verify:

- `razorpay_oauth_states` and `account_payment_credentials` have RLS enabled;
- `PUBLIC`, `anon`, and `authenticated` have no table access, while only
  `service_role` has the required table grants;
- the three refresh lease/commit/reconnect RPCs are executable only by
  `service_role`;
- the `(provider_mode, razorpay_account_id)` uniqueness constraint exists; and
- Supabase security/performance advisors introduce no new release-blocking
  findings.

Both migrations were applied to **UsefulDesk Razorpay Test** through the
approved connector on 2026-08-09. Verification found all 20 connection fields,
RLS enabled on both credential/state tables, no `anon`/`authenticated` table or
RPC access, service-role-only invoker RPCs, both foreign-key indexes, and no
advisor errors. The no-policy notices are intentional for service-only tables;
new indexes report unused until a state attempt exists. Aggregate inventory was
zero configured manual rows, zero configured version-0 rows, and zero OAuth
rows, so no credential data was read or rewritten during schema acceptance. The
later internal acceptance account was synthetic and test-only.

### Manual-secret inventory and backfill

Deploy the dual-reader/encrypted-writer code before touching stored manual
secrets. Build a reviewed JSON inventory that maps each configured account id to
exactly `test` or `live`; do not infer mode from key prefixes, payloads, or the
browser. Keep the inventory outside version control. Dry-run first:

```sh
RAZORPAY_MODE=test \
NEXT_PUBLIC_SUPABASE_URL='<isolated project URL>' \
SUPABASE_SERVICE_ROLE_KEY='<temporary isolated service-role key>' \
ENCRYPTION_KEY='<64 hex characters>' \
npm run backfill:razorpay-secrets -- --inventory '<reviewed inventory.json>'
```

Only after confirming the exact target project and inventory, repeat with
`RAZORPAY_SECRET_BACKFILL_CONFIRM=reviewed` and `--apply`. The command prints
counts only. An apply is incomplete if any configured row lacks inventory or
required secrets, has a mode mismatch/decrypt failure, or any version-0 row was
not conditionally updated. Independently query the target afterward and require zero configured
`secret_storage_version=0` rows before OAuth or rollback is enabled.

### Internal connection acceptance

Before temporarily setting `RAZORPAY_OAUTH_ENABLED=true` for the isolated
internal account, configure the development client id/secret, exact test HTTPS
callback, `RAZORPAY_MODE=test`, and the same encryption key used for stored
tokens. Reconfirm with Razorpay that the client accepts `code_challenge_method`
`S256` and `code_verifier`; the public integration guide documents state but
does not make that PKCE contract explicit, so a rejection keeps OAuth disabled.

Connect only the approved internal test merchant. Confirm the callback is
single-use and bound to the initiating signed-in admin, selected branch, client
fingerprint, mode, and redirect. Confirm the settings card shows the expected
merchant suffix/readiness and force one refresh through the authenticated route;
the database-leased concurrency cases remain covered by automated tests. Revoke/disconnect and confirm new
operations fail closed without using stored manual keys. Re-disable both flags
after the test unless a separately reviewed allowlist rollout is approved.

The isolated exercise completed on 2026-08-09:

- the authorization request reached the real Razorpay Test consent screen with
  a high-entropy state, S256 code challenge, and `read_write` scope;
- Razorpay accepted the authorization and callback code exchange, which proves
  the development client accepted the matching PKCE verifier;
- the imported merchant's Accounts lookup returned HTTP 400, so readiness used
  the planned five read-only Bearer probes; all passed and the connection became
  `ready` in test mode;
- an authenticated forced refresh returned HTTP 200, advanced
  `refresh_generation` from 0 to 1, and left both token deadlines current;
- disconnect completed with no provider/local error and database verification
  showed access token, refresh token, and merchant id scrubbed; and
- `RAZORPAY_OAUTH_ENABLED` was restored to `false`, manual rollback remained
  `false`, and deployment `dpl_CVUuVk1hHcZ2Gzu2czZ4W2mkE3YQ` became READY on
  the public test alias.

No member record, live merchant, production project, or money was used. The
allowed Supabase project's manual/version-0 inventory was zero; reviewing or
backfilling any configured merchant in another environment remains a separate
pre-live operation and was not inferred from this result.

The recurring mandate path may use OAuth Bearer credentials in Stage 1, but the
legacy per-account webhook remains canonical. The application/legacy delivery
ledger, parity exercise, and canonical-ingress switch are Stage 2. A scheduled
due-connection sweep should join that shared recovery worker; the Stage 1
resolver and admin refresh route already perform lease-protected rotation.

## Read-only Bearer capability check

Obtain a development OAuth access token for the activated test merchant, then
run the check with temporary shell variables. Do not add the token to an env
example, commit it, or paste its value into an issue or log.

```sh
RAZORPAY_MODE=test \
RAZORPAY_ACCEPTANCE_ACCESS_TOKEN='<development OAuth access token>' \
RAZORPAY_ACCEPTANCE_ACCOUNT_ID='<authorized test merchant account id>' \
npm run accept:razorpay
```

The command makes read-only `count=1` list requests to Customers, Plans,
Subscriptions, Payment Links, and Payments. It handles Razorpay's
`payment_links` array response separately from the other APIs' `items` arrays,
and prints only status, latency, and returned array length. It does not print
resource bodies. The Accounts API readiness probe is reported separately and is
non-blocking because imported OAuth accounts may not grant that partner
endpoint.

Archive the redacted JSON output with the deployment acceptance evidence. A
successful read-only check confirms Bearer access but not creation capability;
create/fetch one low-value test Payment Link and one disposable test
plan/subscription during the isolated end-to-end acceptance matrix before Stage 3. The 2026-08-08 acceptance run completed both and cancelled the mutable test
objects. Stay within Razorpay's default 30-link and 30-subscription-link test
limits.

## Application webhook configuration

The test webhook targets the isolated HTTPS endpoint above with
`RAZORPAY_MODE=test`, the 16 consumed events, and a test-only secret. Production
must use its own HTTPS endpoint, `RAZORPAY_MODE=live`, isolated production
database, and live webhook secret.

During dual delivery, preserve the same test event from both the existing
per-account ingress and the application ingress. Compare the top-level
`account_id`, event type, `x-razorpay-event-id`, raw-body hash, and arrival time.
Do not switch canonical processing until those observations match and shadow
application delivery has performed zero financial mutations.

### Stage 2 shadow ledger status

Migration
`supabase/migrations/20260809100000_razorpay_webhook_delivery_observations.sql`
was applied to **UsefulDesk Razorpay Test** through the approved Supabase
migration connector on 2026-08-09. Verification showed:

- RLS enabled on `razorpay_webhook_deliveries` with no browser-client policy;
- no `anon` or `authenticated` table access;
- service role limited to observation `SELECT, INSERT`;
- uniqueness on `(provider_mode, provider_event_id, ingress)`;
- a database check that rejects a shadow row marked as attempting canonical
  mutation; and
- zero rows and zero shadow-mutation attempts immediately after migration, with
  no new advisor error.

The deployed route code records redacted application and legacy observations
using the same header-or-mode/merchant/payload identity. Both routes share one
canonical processor. Only an exactly resolved account whose selector matches
the ingress may claim; unknown application merchants and the unselected ingress
return after observation.

On 2026-08-09 an authenticated operator rotated the isolated application
webhook secret in Razorpay and Vercel together, verified a signed application
observation, and configured the Test merchant's per-account webhook for the
seven supported Subscription events. The test-only
`POST /api/payments/razorpay/webhook/legacy-secret` operator route encrypted the
account secret without changing OAuth authentication mode; it is hidden unless
both Test mode and provider-acceptance mode are active.

The isolated merchant was reconnected with the OAuth flag enabled only for the
exercise. OAuth Bearer calls created a ₹1 monthly Test plan and Subscription,
and Razorpay's simulated card authorisation produced three paired events. In
`razorpay_webhook_delivery_parity`, every pair had one delivery per ingress,
the same resolved account, event type, and payload hash, 0.379–1.016 seconds
arrival skew, and no shadow mutation attempt. The legacy ingress remained
canonical throughout that parity run. `RAZORPAY_OAUTH_ENABLED` was restored to
`false` immediately afterward; manual rollback stayed false.

### Stage 2 recovery and token-scan status

Migrations `20260809110000_razorpay_webhook_recovery_and_token_scan.sql` and
`20260809111000_index_webhook_events_account_id.sql` were applied to
**UsefulDesk Razorpay Test** through the approved Supabase migration connector
on 2026-08-09. Verification found all six new recovery/scan RPCs use
`SECURITY INVOKER`, are not executable by `PUBLIC`, `anon`, or `authenticated`,
and are executable by service role only. The account FK follow-up removed the
only new advisor notice; security and performance advisors reported zero
errors, with the documented service-only/no-policy and unused-new-index notices
remaining informational.

The Test-only recovery route was deployed behind the existing cron
authorization. With OAuth disabled it returned zero webhook claims and marked
the token scan disabled. During one explicitly scoped OAuth-enabled exercise it
claimed the ready Test connection once, correctly skipped refresh because the
access token expires outside the seven-day window, advanced its next scan by
one day, and returned zero failures. Database verification retained refresh
generation 1, no scan or refresh lease, zero unresolved Razorpay events, the
existing accepted AutoPay payment, zero charge exceptions, and legacy canonical
ingress. `RAZORPAY_OAUTH_ENABLED=false` and
`RAZORPAY_MANUAL_ROLLBACK_ENABLED=false` were restored on READY deployment
`dpl_HAFtXdLJY22nLt2PojMFP9ACputY`.

### Stage 2 canonical cutover status

Migration `20260809120000_razorpay_application_webhook_cutover.sql` was applied
to **UsefulDesk Razorpay Test** through the approved connector on 2026-08-09.
The audit table has RLS and no browser-role grants. The cutover RPC is
`SECURITY INVOKER`, service-role-only, Test-only, and locks the credential row
while revalidating recent exact three-event parity, OAuth/scan/lease readiness,
canonical processing, charged-ledger evidence, and a zero-unresolved queue.
The same transaction updates the selector and inserts one immutable audit row.

Deployment `dpl_iS9HGYNi5B9dK8J2SBHNPBXMkDzn` became READY on the public Test
alias with `RAZORPAY_OAUTH_ENABLED=false`,
`RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`, `RAZORPAY_MODE=test`, and provider
acceptance mode true. A signed-in owner invoked the same-origin cutover route;
it qualified the three saved events, returned HTTP 200, switched the one
allowlisted selector to `application`, and wrote one audit row. No code deploy
or flag alone can switch another merchant.

The synthetic accepted Subscription was then cancelled immediately in Razorpay
Test. Its real `subscription.cancelled` event reached both ingresses with one
delivery each, the same account and payload hash, 0.180-second skew, application
canonical/legacy shadow roles, and no observation mutation. The shared handler
completed once (`attempt_count=1`), revoked the mandate, left the accepted
AutoPay payment unchanged, and left zero unresolved events or charge exceptions.

### Stage 2 genuine provider-retry status

Migrations `20260809130000_razorpay_provider_retry_acceptance.sql`,
`20260809131000_restrict_razorpay_retry_acceptance_grants.sql`, and
`20260809132000_audit_razorpay_retry_provider_trigger.sql` were applied through
the approved connector. They provide a service-only, Test-only, ten-minute,
one-subscription audit gate. The authenticated same-origin admin/owner route
arms or cancels the gate and audits the exact provider cancellation trigger.
Normal events and every non-Test deployment pass through unchanged; invalid,
expired, cross-account, non-header-identified, or mismatched retry input fails
closed. The first exact signed application delivery is observed and answered
503 before canonical persistence. Only a subsequent delivery with the same
`x-razorpay-event-id` and raw-body SHA-256 can enter the usual claim/processor.

On 2026-08-09, temporary OAuth-enabled READY deployment
`dpl_A5rS1nFHFVKdFFNUhMe2Cfur83wv` created and cancelled a fresh ₹1 Test
Subscription. Event `TNfmPtAekGkLfO` first arrived at 12:34:29.581 UTC, with
raw hash `524452d60dbed7f061f5c4f933980f7bf4e091d5b525194851994aa4179512e8`,
and received 503. Razorpay itself retried at 12:34:31.136 UTC with the identical
event ID, raw hash, and current-secret signature generation. The retry was
acknowledged 200, claimed once, and completed with one canonical row and
`attempt_count=1`. The mandate changed to revoked/manual once, no payment was
created for that mandate, the legacy observation remained shadow-only with no
mutation attempt, and both unresolved-event and open charge-exception counts
were zero.

READY deployment `dpl_SWV4baDBnuRUeZAMERLMMiDn4RKB` then restored the public
Test alias with `RAZORPAY_OAUTH_ENABLED=false`; direct connection-status
verification reported OAuth false, manual rollback false, Test mode, and the
unchanged application selector. Manual rollback was never enabled.

Stage 2 is therefore accepted for the single isolated Test account. Support
ticket `20297340` remains pending as optional additional evidence, not a gate.
Do not reserialize stored JSON or manufacture a signature. This acceptance does
not authorize another account cutover, legacy endpoint retirement, Stage 3, or
any production/Live action. Keep both rollout flags false outside a separately
scoped isolated Test exercise.

Client-secret fields were visible during this acceptance session. Rotate both
OAuth client secrets, the application and merchant webhook secrets, the isolated
service-role key, and every other acceptance credential before the first live
merchant authorisation. Do not rotate or touch a live credential as part of the
isolated Test exercise without separate authority.

## Stage 3 Payment Link acceptance

Stage 3 was implemented and accepted on 2026-08-09 only in **UsefulDesk
Razorpay Test** (`hkuqzmgnhhgecqcbwupb`), the isolated Vercel Test project, and
Razorpay Test Mode merchant `acc_TCJwBqanN9LTrK`. Migrations
`20260809140612_razorpay_payment_links.sql`,
`20260809150500_payment_link_settlement_invalidation.sql`, and
`20260809153500_index_payment_link_foreign_keys.sql` were applied through the
approved Supabase connector; the recorded remote versions are `20260809142909`,
`20260809151529`, and `20260809153444`. No `supabase db push` was used.

The durable link state is `creating | created | cancel_requested | paid |
cancelled | expired | orphaned | failed`. Reservation locks one active revision
per invoice. Provider creation is INR, exact paise full balance,
`accept_partial=false`, seven-day expiry, and one unique `udpl_<uuid>` reference
with account/invoice/link notes. Creation failure searches by that reference and
adopts only an exact contract match; recovery uses five-minute owner leases to
adopt creating/orphaned links, verify stale active links, cancel invalidated
links, and settle remotely paid links. Only `payment_link.paid` settles;
`payment.captured` remains non-financial. Unsafe captured or partial facts are
contained in `gateway_payment_exceptions`, and gateway-originated payments are
blocked from the manual void path.

### Real Test lifecycle evidence

- The signed-in Test owner created mixed-invoice link
  `plink_TNhvWMuBAVA4aF` for exactly ₹1.00. A second Copy reused that same
  provider/local identity. Razorpay Test card payment
  `pay_TNi3WGJgRRCase` produced signed application event `TNi4boArXVByWA`
  with raw SHA-256
  `9dbf8dcfc16298a547c62ce8b294443831439318ed12ab53befc461840d1a914`.
  The canonical handler completed once and created payment
  `875d2f32-a00a-4824-a119-c937fc47595a`, `source='payment_link'`, with
  ₹0.40 service and ₹0.60 merchandise allocations. The invoice balance became
  zero. A controlled settlement replay returned `outcome='duplicate'` and the
  same payment ID; it created no second payment or allocation.
- The isolated merchant webhook was expanded in Razorpay Test from the seven
  Subscription events to those seven plus `payment_link.paid`,
  `payment_link.partially_paid`, `payment_link.expired`, and
  `payment_link.cancelled`. The unrelated Test webhook row was not touched.
- Revision exercise link `plink_TNiXkOTfl6BsBO` reserved ₹1.00. Changing its
  synthetic service-adjustment line to ₹1.01 transactionally requested
  cancellation. Razorpay cancellation emitted event `TNiizRkBY0dLpo`, raw hash
  `381520292de4064fd651d9b6fd1b79d33e0a58ea04a9a8195d41df135b6b5f1c`.
  Application arrived first and processed once; legacy arrived 1.038 seconds
  later as shadow-only, with the identical event ID/hash and no mutation.
- Revision 2 created unique exact-₹1.01 link `plink_TNijewByCEsiUw`; a second
  Copy reused it. Razorpay Test payment `pay_TNiktFgXrBvGZP` emitted signed
  `payment_link.paid` event `TNilK8pGmgYG0W`, raw hash
  `f54789c32a684b4028b88ef824bdb6b7e6060264d968970b2508c1685d82c804`.
  Application processed once and legacy arrived 0.432 seconds later as an
  identical shadow observation. One immutable ₹1.01 payment and one exact
  service-adjustment allocation settled the invoice. The paid link retained no
  cancellation reason, proving settlement's own ledger triggers do not
  invalidate it.
- An authenticated Test-owner call to the existing void RPC against the first
  gateway payment was rejected with the provider-refund-workflow guard; the
  payment remained `paid` with no void timestamp or reason.
- The final Test database has three terminal Stage 3 links (two paid, one
  cancelled), two Payment Link payments, zero active/failed links, zero active
  recovery leases, zero unresolved Razorpay events, zero open payment or charge
  exceptions, and no canonical `payment.captured` event from the exercise.
  Security/performance advisors report no errors; the service-only exception
  table's RLS-without-browser-policy notice is intentional, and the five new FK
  indexes are expected to remain unused until operator/exception lookups occur.

The Meta Utility template `gym_payment_link` is not approved in the Test
account. The UI therefore disabled **Send payment link** with setup guidance,
while **Copy link**, creation, verified settlement, cancellation, revision, and
reconciliation remained available and passed. No WhatsApp Send acceptance is
claimed.

The temporary OAuth window used deployment
`dpl_3TCVLunnfZefJzGLEVhPS4h2i4y3`; manual rollback remained false. READY
deployment `dpl_AKMLBbZUXfRcMKbfuZ7eoK8VpxPs` restored the public Test alias
with `RAZORPAY_OAUTH_ENABLED=false`,
`RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`, and `RAZORPAY_MODE=test`. This
acceptance authorizes no other account, production/Live Mode, real money,
legacy-endpoint retirement, credential rotation, or Stage 4 refund work.

## Stage 4 full-refund implementation and Test evidence

Stage 4 was implemented, exercised, and accepted on 2026-08-09/10 only in
**UsefulDesk Razorpay Test** (`hkuqzmgnhhgecqcbwupb`), the isolated Vercel Test
project, and Razorpay Test Mode. Migrations `20260809165718`, `20260809171336`,
`20260809171510`, `20260809172816`, the additive Test retry migration
`20260809185043`, and the external-partial resolver `20260810034213` were
applied only through the approved Supabase connector. Never substitute
`supabase db push`.

The release permits only a payment's full remaining refundable amount. The
admin-only route reserves immutable canonical request bytes/hash and a provider
idempotency key, copies the payment's remaining original line allocations, and
owns `creating | pending | processed | failed | orphaned`. A definitive provider
failure is terminal. An ambiguous create searches `/v1/refunds` by the local
UUID receipt/notes and adopts only an exact amount/payment/identity match.
Signed events and the hourly provider scan fetch both refund and parent payment
before using the same service-only finalization/import functions.

### Provider and historical-window evidence

- Before schema or UI work, the OAuth Test merchant successfully created,
  fetched, listed, and refunded payment `pay_TNi3WGJgRRCase`. Refund
  `rfnd_TNkCeNk0w0Fj41` produced signed application event
  `TNkDHhl9ggNXmp`, proving the required API/event capability.
- The initial scan started at `2026-08-07T05:09:39.873369Z`, exactly 48 hours
  before the earliest local gateway payment. Its first page failed closed when
  a provider receipt was incorrectly sent to a UUID lookup. The corrected
  worker honored the stored 15-minute backoff, resumed the same frozen window,
  completed at `2026-08-09T18:01:27.567423Z`, cleared its cursor/lease/error,
  and imported the matching historical full refund. No unrelated merchant
  transaction produced a local financial row.

### Genuine accounting lifecycle

- The imported full ₹1.00 refund was classified in the product as
  `reopen_balance`: its copied allocation is ₹1.00, it has no adjustment, and
  the invoice exposes ₹1.00 collectible balance again.
- A fresh exact ₹1.01 Payment Link `plink_TNlWej827ue5lB` was paid in Razorpay
  Test through the wallet simulator as `pay_TNljNUc8Iw6RJu`. Signed
  `payment_link.paid` event `TNljakxZuhT8Cv` settled one ₹1.01 allocation.
- UsefulDesk then requested full `reduce_charge` refund
  `rfnd_TNlm2Bm865srX2`. The Test-only ambiguity flag deliberately discarded
  the successful create response. Provider receipt recovery adopted the same
  refund, and signed application event `TNlmf523ukqmWy` finalized it once. The
  refund owns one ₹1.01 immutable allocation and exactly one ₹1.01 append-only
  invoice adjustment/allocation. Gross total/paid are ₹1.01, refund/net paid
  are ₹1.01/₹0, adjustment/net total are ₹1.01/₹0, and both balances are zero.
- A separate Dashboard Test refund `rfnd_TNlC69tk2RY9yk` returned ₹1.00 from
  ₹1.01 payment `pay_TNiktFgXrBvGZP`. Signed event `TNlCjoMScyDhIs` first
  imported it as header-only, reduced payment-level net cash to ₹0.01, left
  line accounting unchanged, made collectible balance zero, disabled unsafe
  actions/reminders, and created `partial_refund_line_target_required` without
  inventing a target. The owner then used **Resolve refund review** to assign
  all ₹1.00 explicitly to original line
  `64db2ce5-9b92-4c70-8dd4-c9c8fd373eb2` and choose `reduce_charge`. The
  service-only transaction inserted one immutable refund allocation, created
  equal adjustment `47cff14c-3532-4c84-bb6a-aace324090d8` and allocation,
  resolved exception `73e6a8b2-70aa-4f56-8827-d732e8e3ec76`, and preserved
  provider/payment identity. Exact replay returned `duplicate` with no write.
- A fresh ₹1.03 Payment Link `plink_TNmLBcB5CH4NR9` settled as
  `pay_TNmNAOYec3Z8Jy`, after which UsefulDesk requested full `reopen_balance`
  refund `rfnd_TNmPln6l55dKxs`. The Test-only refund-retry acceptance returned
  503 to the first valid signed application delivery of event
  `TNmQOT5sYfpjpn`. Razorpay redelivered the identical event ID and raw-body
  SHA-256 `894688dc045148c1539f40e7f0ad0e91b20b8ab6ad8facf6e5fef7940884084d`
  1.257 seconds later; the retry received 200 and one canonical attempt
  finalized exactly one ₹1.03 immutable refund allocation with no adjustment.
  Net paid is ₹0, collectible balance is ₹1.03, and no review hold exists.

Finance Overview, invoice health, invoices, payments, recent transactions, dues,
and the downloaded August invoice CSV were checked against these rows. Target
invoice `e9d17389-92e0-4eb7-87e6-41b7267f2a9d` has gross total/paid ₹1.01,
refund/adjustment ₹1.00, net total/net cash ₹0.01, zero accounting/collectible
balance, no review, no due/reminder target, and no active Payment Link. The CSV
contains gross/refund/net cash, adjustments, review state, provider payment and
refund IDs, disposition, and the exact decimal `0.01`. Authenticated
cross-tenant reads returned no refund/allocation/adjustment rows, and browser
roles cannot update immutable tables or execute the service-only RPCs directly.

### Ingress, recovery, and current gate

The Payment Link paid event had identical application-canonical and
legacy-shadow observations. Refund events arrived only at the application
ingress: the application webhook selects both refund events, while the
unchanged merchant legacy webhook still has the 11 Subscription/Payment-Link
events from Stage 3 and therefore is not expected to observe refunds. Every
canonical Razorpay event is processed; no refund is creating, pending, or
orphaned. Two deliberate provider-400 attempts against the older AutoPay
payment are terminal `failed` rows with no gateway refund or accounting effect.

Migration `20260809185043` extends the service-only, Test-only retry acceptance
to one exact fresh local refund UUID read from signed provider notes. It is
mutually exclusive with ambiguity acceptance, returns 503 only after signature,
routing, and first-delivery identity/hash persistence, and permits only the
identical provider redelivery to enter the canonical claim path. This is an
acceptance harness, not production behavior.

Stage 4 is accepted for the single isolated Test account. The genuine
refund-specific duplicate/retry evidence is complete, every canonical event is
processed, no refund is `creating`, `pending`, or `orphaned`, and unresolved
charge, payment, and refund exception counts are zero. The external-partial
exception was not deleted or redefined: it was resolved through explicit
admin-selected line targeting, exact original-payment capacity checks, atomic
classification/adjustment, and an audited resolution note. Supabase security
and performance advisories contain no finding for the new resolver.

After the exercise, READY deployment `dpl_4V52iQ6Rjm1MGxCByNDjp5p3pzso`
restored `RAZORPAY_OAUTH_ENABLED=false`,
`RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`,
`RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE=false`, and
`RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE=false`; provider mode remains Test.
No account expansion, production/Live Mode, real money, Stage 5, legacy
retirement, or credential rotation is authorized.

## Stage 5 production-readiness preflight

Read-only preflight on 2026-08-10 stopped before any provider, deployment,
database, credential, webhook, flag, merchant, or financial mutation.

### Isolated production surfaces

- Vercel production project **useful-desk**
  (`prj_kn3FOeuAZkeAyCeA5lbBhsHHECne`) owns `desk.usefulmade.com`. Deployment
  `dpl_DQ89zFgKbfJmC66ENPJtxwBL94na` is READY and remains the current alias
  target.
- Its production environment has zero variables whose names begin
  `RAZORPAY_`. In particular, no authoritative `RAZORPAY_MODE`, production
  OAuth client pair, redirect, application webhook secret, or rollout flags
  are configured. Do not deploy the Stage 1–4 code expecting implicit mode;
  the new connection boundary must fail closed.
- Supabase production project **UsefulDesk** (`fwqthstqrkrwtaehefks`) is
  distinct from **UsefulDesk Razorpay Test**. Its migration history currently
  ends at `20260804183451_harden_razorpay_recurring_charges`; none of the
  OAuth, delivery-observation, recovery, application-cutover, Payment Link,
  or refund migrations from Stages 1–4 are present.

### Redacted manual-account inventory

Production contains ten active account rows. Exactly one has a configured
`gateway='razorpay'` credential row:

- account `50a9e8f9-d7e5-44d2-ba04-c367509b981e`, branch name
  **Rajat Kashyap**, currency INR;
- key id, key secret, and per-account webhook secret are all present; and
- the legacy schema has no secret storage version, provider mode,
  authentication mode, external Razorpay account id, connection status, or
  canonical-ingress selector.

No credential value or full identifier was read into this runbook. The row is
not evidence of Live Mode and does not select the pilot. Build the reviewed
inventory outside version control, confirm the exact merchant/mode pairing,
and dry-run the existing backfill only after the branch is explicitly chosen.

### Provider application inventory

The UsefulDesk Razorpay application has a production OAuth client and the
expected HTTPS redirect
`https://desk.usefulmade.com/api/payments/razorpay/oauth/callback`. It currently
reports **No live webhook created**. The inspected dashboard remained in Test
mode and showed only the already accepted isolated Test merchant. Consequently
there is no current evidence for a live merchant authorization, live event
selector, Payment Links, Subscriptions/Recurring, Payments/refunds, signed
application delivery, account routing, or live readiness probes.

### Historical gate at the read-only preflight

The list below records the stop condition at that checkpoint. The later owner
risk decision and production-foundation section supersede its rotation and
no-mutation instructions; the real-money inputs remain required.

Require these explicit inputs, in order:

1. select the one production branch and Razorpay merchant, and confirm whether
   the legacy credential row belongs to it;
2. operator-review that row's Test/Live mode without key-prefix inference;
3. identify and authorize the exact acceptance-exposed credential rotation
   set and maintenance window, excluding unrelated credentials;
4. rotate that set before the first live authorization, then configure the
   production-only Vercel values and live application webhook/event selector;
5. prove non-mutating Live product/API readiness before applying migrations,
   backfilling the selected row, or enabling OAuth; and
6. before a payment, explicitly name the payer, pilot merchant, low-value
   amount, and refund disposition.

Keep OAuth and manual rollback disabled except for the later shortest approved
exercise. Keep the legacy webhook ingress. Do not apply migrations, backfill
secrets, create a live webhook, rotate credentials, authorize a merchant, or
move money while any gate above is unresolved. Stage 5 is not accepted.

### Pilot selection and Live provider capability continuation

The user selected UsefulDesk production account
`50a9e8f9-d7e5-44d2-ba04-c367509b981e` (**Rajat Kashyap**) as the only pilot.
Read-only Razorpay Live checks then established:

- the UsefulDesk application has exactly one accepted Live merchant,
  `acc_TCJwBqanN9LTrK`, with the selected name and `Activated` status;
- that merchant is not yet transacted in Live mode;
- the Live Payment Links surface offers **Create Payment Link**;
- the Live Subscriptions product exposes its normal Subscriptions, Plans, and
  Settings surfaces; and
- the unsaved live application-webhook selector exposes the exact 16 events
  UsefulDesk consumes: three account, seven Subscription, four Payment Link,
  and two refund events. Additional payment/order/refund events remain
  deliberately unselected. The draft was cancelled without saving.

The Live merchant's API-key settings offer **Generate Key** and show no
existing key. This provider-labeled Live evidence proves that the old manual
credential stored on the production UsefulDesk account is not a Live key; no
prefix inference is involved. Never backfill that row as `live`, use it for
rollback, or copy it into a Live deployment. Its later removal is recorded
below. A new Live rollback credential is outside this pilot and requires
separate owner authority; if ever approved, it must use the encrypted
version-1 path.

### Owner-approved temporary credential risk

The owner explicitly accepted the low-but-nonzero temporary risk of continuing
the single Live pilot with the existing Development and Production OAuth
client secrets. They were disclosed only in a private Codex browser-tool
transcript and were not committed, published, written to a local environment
file, or sent to support. Neither was deployed at the decision point; the
Production secret was later transferred directly into a sensitive
Production-only Vercel variable without being written locally. They are **not
rotated**. Ticket `20303463`
is no longer required; the support reply requested cancellation of the
callback, closure with no action, and no rotation/regeneration or application
change. Do not create another Razorpay application.

This exception removes only the rotation prerequisite. Never reveal, retrieve,
print, log, snapshot, commit, or paste either secret. At the production
credential gate, Rajat enters the value directly into a hidden field while the
agent remains secret-blind. The single pilot, strict Test/Live separation,
disabled manual fallback, exact event selector, readiness probes, signed
delivery, reconciliation, and real-money authorization gates are unchanged.

### Stage 5 production foundation applied

Production deployment `dpl_CJuMiLV5EW5VhYpCogGcK6YS248v` is READY on
`desk.usefulmade.com`. Its deployed non-secret Razorpay configuration is:

```text
RAZORPAY_MODE=live
RAZORPAY_OAUTH_ENABLED=false
RAZORPAY_MANUAL_ROLLBACK_ENABLED=false
RAZORPAY_PROVIDER_ACCEPTANCE_ONLY=false
RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE=false
RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE=false
RAZORPAY_OAUTH_REDIRECT_URI=https://desk.usefulmade.com/api/payments/razorpay/oauth/callback
RAZORPAY_LIVE_PILOT_ACCOUNT_ID=50a9e8f9-d7e5-44d2-ba04-c367509b981e
RAZORPAY_LIVE_PILOT_MERCHANT_ID=acc_TCJwBqanN9LTrK
```

The Production OAuth client id and existing unrotated client secret are now
deployed only to Vercel Production; the secret is sensitive and neither value
is enabled for Preview. A new application-webhook secret is also sensitive and
Production-only. Invalid-signature traffic now reaches the Live application
ingress and returns 400, proving the secret is loaded without disclosing it.
The local `.vercel` link was restored to the isolated provider sandbox after
each deployment.

The Razorpay application now has one Live webhook at
`https://desk.usefulmade.com/api/payments/razorpay/webhook`. Re-opening its
editor confirmed exactly 16 selected events and no extras: the three account,
seven Subscription, four Payment Link, and two refund events enumerated above.
The configured secret was generated in memory, transferred directly to both
systems, and then cleared from the browser-control session.

Production Supabase `fwqthstqrkrwtaehefks` received the Stage 1–4 OAuth,
delivery, recovery, application-cutover, Payment Link, and refund migrations,
plus `20260810160000_razorpay_live_application_ingress.sql`, through the
approved migration connector; `supabase db push` was not used. RLS is enabled
on every Stage 5 table, browser roles have no write access to service-only
surfaces, and `activate_razorpay_live_application_webhook` is executable only
by `service_role`. The only relevant advisor results are expected INFO notices
for RLS-on/no-policy service tables and unused fresh indexes.

The provider-confirmed non-Live legacy key id, key secret, and webhook secret
were removed from the exact pilot row without reading their values. The row
remains `manual`, mode-null, storage version 0, disconnected, and selected for
`legacy_account`, with no external account id or OAuth tokens. This deletion is
intentional and not recoverable from UsefulDesk. No manual Live key was created.

Code now fails closed before OAuth state creation if any unreviewed legacy
secret remains, permits Live OAuth only for the configured pilot id, rejects a
Test acceptance flag in Live application ingress, and atomically switches the
selector only after the exact Live OAuth merchant is ready, read-write scoped,
lease-free, and free of all manual credential material. Activation writes an
immutable service-only audit row and an exact retry is idempotent.

### Live OAuth readiness and pilot acceptance evidence

After the browser was signed in to exact branch
`50a9e8f9-d7e5-44d2-ba04-c367509b981e`, the first consent attempt was cancelled
before **Authorize**: review found that the callback allowlisted the UsefulDesk
account but did not independently compare the exchanged Razorpay merchant.
OAuth was restored false and no provider grant or selector change occurred.
The callback now requires the Production-only, non-secret
`RAZORPAY_LIVE_PILOT_MERCHANT_ID`, compares the exchanged account exactly, and
revokes both returned tokens before rejecting a mismatch.

The next shortest hardened window authorized only Live merchant
`acc_TCJwBqanN9LTrK`. The callback received `read_write`, passed the five
non-mutating Payments/refunds, Payment Links, plans, and subscriptions probes,
and persisted one encrypted storage-version-1 OAuth connection. Database
verification shows `provider_mode='live'`, `connection_status='ready'`, current
access/refresh expiries, no manual key id/secret/webhook secret, no refresh
lease, and no last error. The imported-account readiness fallback left
`merchant_status='unknown'` with a fresh activation verification. The audited
selector transaction changed `legacy_account` to `application` exactly once
for the exact merchant; both created OAuth states are consumed and none is
active. The product UI independently renders **Connected**, **Readiness
verified**, **Live mode**, and merchant suffix `N9LTrK`.

The first post-connect health read exposed four failed and five missing-ledger
alerts. Inspection proved they belonged to 16 preserved pre-OAuth legacy
events from July/August: every row has null provider mode and null external
merchant identity, so none can be attributed to the Live pilot. Do not delete,
rewrite, or relabel those provider/payment facts. Migration
`20260810162750_scope_razorpay_health_to_provider_identity.sql` was applied
through the approved Supabase connector. It appends provider mode and merchant
identity to the read-only missing-ledger view and makes both health queries
require the exact stored scope. The exact Live scope now contains zero events,
failed webhooks, missing-ledger entries, open payment/charge exceptions,
orphaned links, Payment Links, or refunds; the UI has no attention alert.

Rajat then explicitly named himself as payer, reconfirmed merchant
`acc_TCJwBqanN9LTrK`, chose ₹1, and selected `reopen_balance`. A separate
single-use sale invoice was created for Mohit so the existing ₹2,700 joining
invoice would remain untouched. The first checkout attempt exposed a PostgreSQL
composite-row assignment bug in `perform_member_checkout`: `SELECT balance`
resolved the view's numeric `balance` column instead of its row. Connector-
applied migration `20260810165912` did not replace the already-correct second
occurrence because of its early-return guard; follow-up migration
`20260810170205` replaced every remaining ambiguous assignment with
`SELECT balance.*`. The ₹1 invoice is
`2f8411b6-8fdf-4d5c-81c6-a9fdcad958a7`; the original joining invoice
`696007a4-3ff1-45a8-a4c8-19ffc9bc06d9` remained ₹2,700 throughout.

Live Payment Link `plink_TO8x9EEvAaFTvD` used reference
`udpl_f4c235d7df494e23ab01b298e7bd0f31`, exact expected amount 100 subunits,
and `accept_partial=false`. Rajat paid by UPI. Signed application event
`TO8zmuGUYRsb5p` used header identity, current-secret generation, and raw-body
SHA-256 `3ab40cd109aea866670580a6d4bb4df0d3402e2146cde79a799e09f7958a633d`.
It processed once at `attempt_count=1`, created immutable payment
`eb7f0aa2-4374-4609-9445-e8efcbd1b1d3` / provider payment
`pay_TO8zjE5Mshx3y6`, and allocated exactly ₹1 to the sale line. The link is
terminal `paid` locally and remotely with no recovery lease or exception.

The refund dialog remained disabled until historical provider reconciliation
completed. Manual dispatch of the existing `ops-crons` workflow (run
`31413801147`) initialized the exact Live account's fixed refund window,
scanned zero refunds and zero unrelated rows, advanced
`refund_completed_through` to 2026-08-10 17:24:00 UTC, set
`initial_scan_completed_at`, and released the lease with no error. That same
run exposed an older isolation defect: the recovery RPC inferred mode from the
account's current credential and temporarily claimed four identity-less
pre-OAuth events. Connector-applied migration
`20260810172657_scope_razorpay_recovery_to_provider_identity.sql` now requires
the event's stored provider mode, non-null canonical identity, and exact match
between its external merchant and the account credential. It never fills mode
from current credentials and restored those four rows to unknown mode without
deleting, marking processed, or inventing provider facts.

UsefulDesk requested exactly one full ₹1 refund with frozen request SHA-256
`7bf5c2bc543839c29e44f3c600fcd9a5a4af92d905ec859ba201a984136b3428`.
Provider refund `rfnd_TO9JVjXVBBVKQT` first returned `pending`, then signed
application event `TO9Lk5YahoU3O9` completed it. The event used header identity,
current-secret generation, SHA-256
`c3a07cf30084c3bf42b174d897761173fbabed0d4e52506d79696d7de49fbc8a`,
and processed once at `attempt_count=1`. Final state is one processed refund,
one exact ₹1 refund allocation, no adjustment/allocation, no provider error or
lease, and the immutable original payment remains `paid` and unvoided. Both
Live financial events had one genuine application delivery and no legacy
delivery; Razorpay offered no duplicate/retry, so none was manufactured.

Invoice `#2F8411B6` now shows ₹1 gross collected, −₹1 processed refunds, ₹0 net
collected, and ₹1 reopened collectible/accounting balance with no review hold.
Business shows ₹0 net collections, one open invoice, ₹1 outstanding, and paired
+₹1 payment/−₹1 refund transactions. The downloaded August invoice CSV contains
the exact payment/refund ids, `reopen_balance`, gross/refund/net `1/1/0`, no
review, and collectible balance `1`. Mohit's membership due/reminder surface
remains exactly ₹2,700; the sale invoice does not enter membership dues or its
reminder queue. The unapproved `gym_payment_link` template remains a hard
WhatsApp Send exclusion, and no Send evidence is claimed. The single-use
`Stage 5 live pilot` catalog item is archived while invoice history remains.

Exact Live unresolved canonical events, missing-ledger rows, open payment or
refund exceptions, unfinished links/refunds, and recovery leases are zero.
Post-lockdown workflow run `31415235489` claimed zero webhooks/links, reported
zero failures or notes, and showed token/refund work disabled with OAuth false.
Historical READY deployment `dpl_KoiCtsfbL3SAefMxpUKuUYj7QUyJ` served
`desk.usefulmade.com` with OAuth, manual rollback, provider acceptance, refund
ambiguity acceptance, and refund-retry acceptance false at acceptance closure.
The local Vercel link was restored to the isolated provider sandbox. Stage 5
is accepted only for this account/merchant; do not infer authority for Stage 6,
another merchant/account, a manual Live key, legacy-ingress removal, or
WhatsApp Send. The later mutable connection-status caveat is recorded below.

### Co-branded VBF continuation closed

The Stage 5 money path above remains owner-controlled acceptance evidence, not
a real gym-owner rollout. The earlier VBF/Aakash continuation is superseded and
must not be resumed without a new explicit pilot decision. The provider-hosted
account-creation flow and first-bind implementation remain available in code,
but the gate is disabled and dormant.

Read-only Production verification on 2026-08-11 found four OAuth state
reservations for VBF account `9c50dcd9-ed4a-427c-a2fc-07d452f0aec7`; all four
expired unconsumed and none is active. VBF has zero Razorpay credential rows,
Live selector activations, Payment Links, gateway payments, or refunds. No
provider merchant, KYC completion, authorization, webhook cutover, or money
movement is claimed.

READY deployment `dpl_J9UvqQCnTapi33A3zpGaEqCyP7Qx` serves
`desk.usefulmade.com` with the safe resting configuration:

```text
RAZORPAY_MODE=live
RAZORPAY_OAUTH_ENABLED=false
RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED=false
RAZORPAY_MANUAL_ROLLBACK_ENABLED=false
RAZORPAY_PROVIDER_ACCEPTANCE_ONLY=false
RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE=false
RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE=false
RAZORPAY_LIVE_PILOT_ACCOUNT_ID=50a9e8f9-d7e5-44d2-ba04-c367509b981e
RAZORPAY_LIVE_PILOT_MERCHANT_ID=acc_TCJwBqanN9LTrK
```

The exact Rajat Live scope had zero unresolved events, missing-ledger rows,
open charge/payment/refund exceptions, unfinished Payment Links/refunds, or
recovery leases/errors. The accepted ₹1 Payment Link/payment/refund exercise
was not repeated. A later provider-grounded recovery closed the mutable
`disconnecting` caveat as recorded below. The local `.vercel` link remains on
`usefuldesk-provider-sandbox`.

### Failed-disconnect recovery and current readiness

On 2026-08-11, migration
`20260811172006_reconcile_razorpay_failed_disconnect.sql` was applied through
the approved Supabase connector. Its three service-role-only, `SECURITY
INVOKER` RPCs lease and generation-guard only the exact stored OAuth/Live/
merchant tuple. They cannot admit a first binding and cannot commit `ready`
without rotated future-dated encrypted grants plus provider readiness verified
within five minutes. The authenticated same-origin recovery route and Settings
**Recheck connection** action expose that contract through the existing
`canConfigurePaymentGateway` capability.

The first secret-blind recovery call asked Razorpay to refresh the stored grant.
Razorpay returned `Token is already revoked`, so UsefulDesk released the lease
and moved the row to `reconnect_required`; it did not rewrite readiness. Rajat
then completed the shortest OAuth consent while Production remained pinned to
account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and merchant
`acc_TCJwBqanN9LTrK`, with first-bind enrollment still false. The callback
returned that exact merchant and `read_write`, stored only current encrypted
access/refresh grants, and freshly passed the existing read-only
Payments/refunds, Payment Links, plans, and subscriptions probes.

Current database state is OAuth/Live/storage-v1/ready, merchant status
`unknown` with fresh activation verification, selector `application` with its
single immutable Live activation audit, and no manual key/secret, legacy
webhook secret, refresh lease, disconnect timestamp, or last error. Active
OAuth states, exact Live unresolved events, missing ledger, open
charge/payment/refund exceptions, unfinished mandates/Payment Links/refunds,
provider-work leases, and reconciliation attention are zero. This is current connection-readiness
evidence, separate from the historical ₹1 acceptance; no money, VBF action, or
WhatsApp Send was repeated.

READY deployment `dpl_5GkfJc9Nj21pH5Liy8obPbfXpSuN` serves
`desk.usefulmade.com` with the safe resting configuration shown above: OAuth,
first-bind enrollment, manual rollback, provider acceptance, refund ambiguity
acceptance, and refund-retry acceptance are all false. Existing OAuth secrets
remain unrotated under the explicit owner risk acceptance. This was the final
pre-Stage-6 checkpoint; VBF remains closed.

### Stage 6 manual-key retirement

On 2026-08-12, the owner explicitly waived the remainder of the recorded
14-day rollback hold. The hold retained policy optionality but no longer added
technical recovery value: Production already had one exact OAuth/Live/ready,
application-canonical connection with zero manual material, and both accepted
databases had zero manual-mode and zero storage-version-0 rows. The runtime
resolver already failed closed on revoked, blocked, mode-mismatched, or
non-ready OAuth instead of falling back.

Secret-blind preflight found:

- Production: one Razorpay row; zero non-OAuth, non-v1, non-application,
  manual-key-ID, manual-secret, or legacy-webhook-secret rows.
- Test: one Razorpay row; zero non-OAuth, non-v1, non-application,
  manual-key-ID, or manual-secret rows; one dormant legacy webhook secret.

Migration `20260811181302_retire_razorpay_manual_keys.sql` was created with the
Supabase CLI naming helper and applied only through the approved Supabase
migration connector, first to isolated Test and then Production. Its
transactional preflight rejects any non-OAuth/non-v1/non-application row; it
erased Test's one dormant legacy webhook secret, requires all three historical
manual columns to remain null, locks authentication/storage/ingress to
`oauth`/`1`/`application`, and drops the retired cutover and Live activation
RPCs. Historical `razorpay_webhook_deliveries`, cutover, and activation audits
remain immutable. Post-DDL Supabase security/performance advisor counts were
identical to their respective baselines in both projects.

The reviewed runtime change removes manual credential UI and connection POST,
the Basic-auth provider path, plaintext/version-0 compatibility and its
backfill script, the manual rollback config/environment variable, legacy
secret/cutover operator routes, and the per-account webhook route. The sole
webhook ingress resolves only an exact OAuth/v1/application-canonical
mode/merchant binding; an unknown signed merchant remains observation-only.
Named capabilities, OAuth refresh/disconnect/recovery, strict Test/Live
databases, current/previous application-secret rotation, and provider-backed
financial verification are unchanged.

Production artifact `dpl_9ZTDDvDN88gNm6CZ4qswhW47Ata1` built successfully,
was promoted, and is READY on `desk.usefulmade.com`. Secret-blind environment
verification shows `RAZORPAY_MODE=live`; OAuth, first-bind enrollment, provider
acceptance, refund ambiguity acceptance, and refund-retry acceptance are all
false; `RAZORPAY_MANUAL_ROLLBACK_ENABLED` is absent. Public route probes return
401 for the protected connection GET, 405 for its retired POST, and 404 for
the per-account, legacy-secret, and cutover routes. The new deployment has no
runtime error logs in its post-deploy window.

The isolated Test artifact `dpl_AAJxU93wfh5dva7nhR4wRdimHymQ` is likewise
READY on `usefuldesk-razorpay-test.vercel.app`. Its mode is Test; OAuth,
provider acceptance, refund ambiguity acceptance, and every other present
Razorpay rollout/acceptance flag are false; absent optional gates are disabled,
and the manual rollback variable is absent. The protected connection GET
returns 401 without a session, retired operator routes return 404, and the
post-deploy runtime error scan is clean. No provider operation was invoked.

Final Production evidence remains exact-account scoped:

- one OAuth/Live/storage-v1/application/`read_write`/ready row for account
  `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and merchant
  `acc_TCJwBqanN9LTrK`;
- zero manual material, active OAuth states, refresh/scan/link/refund leases,
  last errors, unresolved Live events, missing-ledger rows, open
  charge/payment/refund exceptions, unfinished mandates/Payment Links/refunds,
  or reconciliation attention;
- zero Razorpay credentials for VBF; the closed VBF/Aakash path was not
  reopened;
- no repeated payment/refund exercise and no WhatsApp Send. The
  `gym_payment_link` template remains unapproved, and existing OAuth client
  secrets remain unrotated under the explicit owner risk acceptance.

### Post-Stage-6 Meta template verification

The authenticated 2026-08-12 **Sync from Meta** was valid and returned
`total=0`, but both apparent submissions that followed were not provider
submissions: Production still had `WHATSAPP_TEMPLATES_DRY_RUN=true`, so it wrote
synthetic `dry-run-*` identifiers locally. On 2026-08-14 those exact synthetic
rows were removed, Production's dry-run variable was removed, and deployment
`dpl_BonbafyGjSn27wFFu8SEGW37VrpE` restored real Meta ingress. No WhatsApp
message was sent.

The first real `gym_payment_link` attempt reached Meta and returned code
`100/2388299`, `Leading or trailing params not allowed`, because the body ended
at `{{4}}`. The provider-error parser now preserves Meta's code and actionable
detail, and local validation rejects bodies that begin or end with a variable.
The owner-approved meaning and four-parameter contract were retained by adding
fixed wording after the link:

> Hi {{1}}, your payment of {{2}} for invoice {{3}} is due. Pay securely using
> this link: {{4}}. Please contact us if you need help.

Meta accepted the corrected **Utility** / `en_US` template with numeric ID
`1996323644342719`. The separately authorized product starter was then
submitted as **Utility** / `en_US` with its existing dummy review samples
(`Rahul`, `₹3,999`, and `Quarterly`):

> Hi {{1}}, a payment of {{2}} for your {{3}} membership is still pending.
> Please clear it to keep your access active. Reply here for a payment link or
> any help.

Meta accepted `gym_payment_due` with numeric ID `1528972491789269`. An
authenticated provider sync returned `total=2`, zero inserts and two updates;
both exact templates are **Pending** with no submission error. This
three-parameter reminder contains no payment URL and is not a substitute for
the four-parameter `gym_payment_link` contract. It therefore does not unlock
**Send payment link**. An older approved provider template named
`payment_reminder` was not used because it inaccurately describes an automatic
scheduled payment and possible fees. Production deployment
`dpl_DMSmuK8UtsRbjSnY3pzrpvfrdhpz` contains the provider-error and validation
repair. Do not claim or exercise Send until a later provider sync reports
`gym_payment_link` **Approved**; Copy remains independent.

### Next real gym-owner OAuth pilot — authorization plan only

No pilot is selected by this plan. VBF/Aakash is permanently excluded from
this continuation, and the Rajat acceptance account is historical
owner-controlled evidence rather than the real gym-owner pilot.

1. **Selection authority:** the owner must name one exact active UsefulDesk
   account UUID and branch name, the legal gym owner/admin who will consent,
   and one exact activated Razorpay Live merchant ID and dashboard name. The
   authorization must explicitly cover read-only eligibility checks only.
2. **Secret-blind preflight:** verify the account is INR, has no conflicting
   Razorpay binding or active OAuth state, and is eligible under the named
   capability/RLS boundary. Verify the exact merchant belongs to the gym,
   uses the UsefulDesk Production application, is activated for the required
   products, and is not already bound elsewhere. Keep Production/Test
   databases, clients, webhooks, and modes isolated. No flag or provider state
   changes in this step.
3. **OAuth-window authority:** only after a second explicit approval for that
   exact account/merchant tuple, temporarily pin
   `RAZORPAY_LIVE_PILOT_ACCOUNT_ID` and
   `RAZORPAY_LIVE_PILOT_MERCHANT_ID` to it and enable only
   `RAZORPAY_OAUTH_ENABLED` for the shortest deployment window. Keep
   `RAZORPAY_LIVE_PILOT_ENROLLMENT_ENABLED` and every provider/refund
   acceptance flag false. The gym owner initiates and approves the exact
   merchant consent; a mismatch must revoke the returned grant and fail.
4. **Readiness closeout:** require `read_write`, encrypted storage version 1,
   Live mode, application-canonical ingress, fresh provider readiness, no
   manual material, active state, lease, or error, and zero exact-merchant
   operational queues. Immediately redeploy with OAuth false and restore the
   resting pilot pins. Record the exact evidence without tokens or secrets.
5. **Stop after OAuth:** connection readiness alone completes this smallest
   pilot. Do not create a Payment Link, authorize a payer, send WhatsApp, or
   move/refund money. Any one-invoice money-path exercise must later name the
   exact member/payer, invoice, merchant, amount, delivery intent, and refund
   disposition under a separate approval; WhatsApp Send additionally requires
   an actually approved `gym_payment_link` template.

All rollout and acceptance flags remain false at rest. The existing OAuth
client-secret rotation remains deferred under the recorded owner risk
acceptance and is not part of this pilot plan.
