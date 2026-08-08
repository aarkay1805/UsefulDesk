# Razorpay operator runbook

This runbook records provider configuration and acceptance evidence for the
staged OAuth, Payment Link, and refund rollout. Never paste client secrets,
merchant tokens, webhook secrets, member data, or raw provider payloads here.

## Stage 0A provider acceptance

Dashboard verification on 2026-08-08 confirmed:

- the **UsefulDesk** Technology Partner application is active;
- separate development and production OAuth clients exist;
- the development redirect URI is
  `http://localhost:3000/api/payments/razorpay/oauth/callback`;
- the production redirect URI is
  `https://desk.usefulmade.com/api/payments/razorpay/oauth/callback`;
- one test merchant has accepted the application and is activated; and
- no test or live application webhook has been created yet.

The test application webhook selector currently exposes these events consumed
by the planned integration:

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

Stage 0A remains incomplete until all five development Bearer capability checks
pass, Payment Links and Subscriptions are confirmed active in test mode, a test
application webhook is configured on an isolated test deployment/database, and
legacy/application delivery identity is compared using a real test event.

The repository audit on 2026-08-08 found no local Vercel project configuration,
and `.env.local` targets the same hosted Supabase project linked by the
repository. Treat that database as non-isolated. Do not point the development
application webhook at it or run provider acceptance mutations against it. A
separate test deployment and Supabase project must be provisioned and explicitly
verified before webhook or end-to-end mutation acceptance.

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
Subscriptions, Payment Links, and Payments. It prints only status, latency, and
collection count. It does not print resource bodies. The Accounts API readiness
probe is reported separately and is non-blocking because imported OAuth accounts
may not grant that partner endpoint.

Archive the redacted JSON output with the deployment acceptance evidence. A
successful read-only check confirms Bearer access but not creation capability;
create/fetch one low-value test Payment Link and one disposable test
plan/subscription during the isolated end-to-end acceptance matrix before Stage 3. Stay within Razorpay's default 30-link test limit.

## Application webhook configuration

Do not create the test webhook until its HTTPS endpoint targets an isolated test
database with `RAZORPAY_MODE=test`. Select only the consumed events listed above
and use a test-only secret. Production must use its own HTTPS endpoint,
`RAZORPAY_MODE=live`, isolated production database, and live webhook secret.

During dual delivery, preserve the same test event from both the existing
per-account ingress and the application ingress. Compare the top-level
`account_id`, event type, `x-razorpay-event-id`, raw-body hash, and arrival time.
Do not switch canonical processing until those observations match and shadow
application delivery has performed zero financial mutations.
