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

Stage 4 was implemented and exercised on 2026-08-09/10 only in **UsefulDesk
Razorpay Test** (`hkuqzmgnhhgecqcbwupb`), the isolated Vercel Test project, and
Razorpay Test Mode. It is not accepted under the task's strict final gate; see
the blockers below. Migrations `20260809165718`, `20260809171336`,
`20260809171510`, `20260809172816`, and the additive Test-acceptance migration
`20260809185043` were applied only through the approved Supabase connector.
Never substitute `supabase db push`.

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
- A separate Dashboard Test refund `rfnd_TNlC69tk2RY9yk` returned ₹1.00 from a
  ₹1.01 payment. Signed event `TNlCjoMScyDhIs` imported it as header-only,
  reduced payment-level net cash to ₹0.01, left line accounting balance
  unchanged, made collectible balance zero, disabled unsafe actions/reminders,
  and created the visible `partial_refund_line_target_required` exception.
  This release must not allocate, classify, or clear that partial refund.
- A fresh ₹1.03 Payment Link `plink_TNmLBcB5CH4NR9` settled as
  `pay_TNmNAOYec3Z8Jy`, after which UsefulDesk requested full `reopen_balance`
  refund `rfnd_TNmPln6l55dKxs`. The Test-only refund-retry acceptance returned
  503 to the first valid signed application delivery of event
  `TNmQOT5sYfpjpn`. Razorpay redelivered the identical event ID and raw-body
  SHA-256 `894688dc045148c1539f40e7f0ad0e91b20b8ab6ad8facf6e5fef7940884084d`
  1.257 seconds later; the retry received 200 and one canonical attempt
  finalized exactly one ₹1.03 immutable refund allocation with no adjustment.
  Net paid is ₹0, collectible balance is ₹1.03, and no review hold exists.

Finance Overview, invoice health, invoices, payments, recent transactions, and
the downloaded August invoice CSV were checked against these rows. The CSV
contains gross/refund/net cash, adjustments, review state, provider payment and
refund IDs, and disposition. Authenticated cross-tenant reads returned no
refund/allocation/adjustment rows, and browser roles cannot update the immutable
tables or execute the service-only RPCs directly.

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

Do **not** mark Stage 4 accepted yet. The genuine refund-specific duplicate and
retry evidence is complete, every canonical event is processed, and there are
zero unresolved charge exceptions. The required external-partial exercise must
retain one unresolved line-targeting exception by design, which conflicts with
the task's strict zero-unresolved-exception gate. Keep that exact pending
evidence—do not clear it, manufacture line allocations, or redefine the gate.

After the exercise, READY deployment `dpl_7s1VtoUyXyUb3V2JiPqTCyovxsRj`
restored `RAZORPAY_OAUTH_ENABLED=false`,
`RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`,
`RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE=false`, and
`RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE=false`; provider mode remains Test.
No account expansion, production/Live Mode, real money, Stage 5, legacy
retirement, or credential rotation is authorized.
