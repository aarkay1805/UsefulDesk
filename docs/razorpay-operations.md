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
- The application webhook points only at the isolated observation endpoint,
  uses a test-only secret, and cannot perform database or financial writes.

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

The environment, OAuth, API, product-activation, signed-webhook, and five-second
acknowledgement portions of Stage 0A are complete. The remaining acceptance item
is duplicate-delivery identity parity between the legacy per-account ingress and
the application ingress. Run that comparison when Stage 2 introduces the
delivery-observation ledger; until then the application endpoint stays
observation-only and the production client stays disabled.

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
rows, so no credential data was read or rewritten.

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
merchant suffix/readiness and that two and ten concurrent refresh callers cause
one provider refresh-token submission. Revoke/disconnect and confirm new
operations fail closed without using stored manual keys. Re-disable both flags
after the test unless a separately reviewed allowlist rollout is approved.

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
