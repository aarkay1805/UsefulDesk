# UPI AutoPay — mandate auto-debit (Phase 2)

> India-first recurring auto-debit for gym dues, built as an **opt-in layer over
> the existing manual `payments` ledger**. Gateway = **Razorpay** (UPI AutoPay /
> Subscriptions), which owns the RBI eMandate lifecycle and the mandatory 24h
> pre-debit notice. Manual cash/UPI collection stays the default and the
> fallback — nothing here removes it.

## Why

PushPress's "auto-debit" is a Stripe-Billing wrapper: a saved payment method
(card / ACH mandate) that Stripe charges on a nightly schedule. Stripe recurring
is weak in India and has no UPI AutoPay rail. The Indian equivalent is a
**UPI eMandate**: the member authorises a recurring debit once (one UPI-PIN
approval), the bank then auto-debits ₹X monthly. This is NPCI/RBI-regulated —
we cannot touch the rail directly and must go through a licensed gateway.

## Non-negotiable principle

Auto and manual collection share **one ledger**. Every collected rupee — however
it arrived — still lands in `payments` and settles a `membership_periods`
invoice, so dues buckets, the invoice table, `fee_status`, and reports never
learn there are two collection modes. `source='manual'` = today's behaviour,
zero regression; `source='auto'` = gateway-driven.

## The load-bearing constraint (read first)

`record_membership_payment` is **SECURITY INVOKER** and requires an agent's
`auth.uid()` → `is_account_member(account_id,'agent')`. The
`validate_membership_payment` BEFORE-INSERT trigger enforces the same. **A
webhook runs as the service role — no `auth.uid()`** — so both checks reject a
gateway-initiated insert.

Fix mirrors the existing `app.allow_payment_restamp` pattern (migration 058):

- A new **SECURITY DEFINER** RPC `record_gateway_payment` sets a
  transaction-local GUC `app.system_payment = '1'`.
- `validate_membership_payment` is modified to **skip the agent check when that
  GUC is set** (system context). It keeps every other guard — real open period,
  positive amount, ≤ outstanding balance — so a forged webhook payload still
  cannot overpay a period.
- Clients cannot set GUCs through PostgREST, so the only path to a system
  payment is the definer RPC, invoked only from the verified webhook route.

Get this wrong and the webhook either silently 500s (no collection) or the guard
is loosened too far (forged over-credit). This is the single riskiest change.

## Data model — migration `059_upi_autopay.sql`

### `payment_mandates` (new) — the saved recurring method

One active mandate per membership.

| column                         | notes                                                                     |
| ------------------------------ | ------------------------------------------------------------------------- |
| `id uuid pk`                   |                                                                           |
| `account_id uuid`              | RLS anchor → `accounts`                                                   |
| `membership_id uuid`           | → `memberships` ON DELETE CASCADE                                         |
| `contact_id uuid`              | → `contacts`                                                              |
| `gateway text`                 | `'razorpay'`                                                              |
| `gateway_customer_id text`     |                                                                           |
| `gateway_token_id text`        | reusable mandate token — charge against this                              |
| `gateway_subscription_id text` | if using the Subscriptions product                                        |
| `vpa text`                     | masked, display only                                                      |
| `method text`                  | `'upi' \| 'card' \| 'emandate'`                                           |
| `max_amount numeric`           | mandate ceiling; RBI ≤ ₹15,000 for no per-txn AFA                         |
| `frequency text`               | `'monthly' \| 'quarterly'` — mirrors plan duration                        |
| `status text`                  | `'pending' \| 'active' \| 'paused' \| 'revoked' \| 'expired' \| 'failed'` |
| `authed_at timestamptz`        |                                                                           |
| `next_charge_at date`          |                                                                           |
| `created_at / updated_at`      |                                                                           |

`UNIQUE (membership_id) WHERE status = 'active'` — one live mandate per member.

### `payments` additions — reuse the ledger, don't fork it

- `source text NOT NULL DEFAULT 'manual'` — `'manual' \| 'auto'`.
- `mandate_id uuid REFERENCES payment_mandates(id) ON DELETE SET NULL`.
- `gateway_payment_id text` — Razorpay payment id; reconcile + dedupe key.

`method` keeps its existing CHECK (`cash/upi/card/bank/other`) — an auto charge
is still `'upi'` or `'card'`; `source` is what distinguishes it.

### `webhook_events` (new) — idempotency + audit

| column                                    | notes                                                  |
| ----------------------------------------- | ------------------------------------------------------ |
| `id text pk`                              | gateway event id; atomic claim key                     |
| `account_id uuid`                         |                                                        |
| `type text`                               | `'subscription.charged'`, `'payment.failed'`, …        |
| `payload jsonb`                           | verified event; processing errors do not overwrite it  |
| `processed_at timestamptz`                |                                                        |
| `processing_status text`                  | `'pending' \| 'processing' \| 'processed' \| 'failed'` |
| `attempt_count integer`                   | incremented only when an attempt is actually claimed   |
| `last_attempt_at / processing_started_at` | recovery context + stale-worker lease                  |
| `last_error text`                         | latest bounded processing error                        |

### `memberships.collection_mode`

`text NOT NULL DEFAULT 'manual'` — `'manual' \| 'auto'`. Decides who chases:
manual → renewal cron + WhatsApp remind (today's flow); auto → gateway collects.

### `account_payment_credentials` gateway credentials

- `razorpay_key_id text`
- versioned AES-GCM ciphertext for `razorpay_key_secret` and
  `razorpay_webhook_secret`; version 0 is a transition-only dual-reader state
- `authentication_mode`, deployment-trusted `provider_mode`, OAuth merchant id,
  encrypted access/refresh tokens, scope and expiry/rotation timestamps
- connection/readiness state, bounded provider errors, refresh lease/generation,
  and the future canonical-ingress selector
- RLS stays enabled with no browser policies and all `anon` / `authenticated`
  privileges revoked. Only authenticated server routes may use the service role
  to read/write an account derived from the caller’s session.

OAuth is the default integration shape but remains disabled during rollout.
Encrypted manual credentials are an independently flag-gated rollback path,
never a silent fallback from revoked, blocked, incomplete, or wrong-mode OAuth.

(If multi-gateway later, promote to a `gateway_accounts` table. Hardcode
Razorpay for v1.)

## RPCs (SECURITY DEFINER, service-callable)

**`record_gateway_payment(p_account_id, p_membership_id, p_gateway_payment_id, p_amount, p_method, p_period_end, p_mandate_id)`**

- Runs as owner; `SET LOCAL app.system_payment = '1'`.
- Dedupes on `gateway_payment_id` (webhook retries → no double row).
- Inserts `payments` with `source='auto'`, `user_id=NULL`, resolving the period
  the same way the manual RPC does.
- Returns `{amount_paid, balance}` from `membership_period_invoices`.

**`validate_membership_payment` (modified)** — skip the agent-access check when
`current_setting('app.system_payment', true) = '1'`; keep all financial guards.

**`activate_mandate` / `revoke_mandate`** — state transitions. Agent-gated
invoker variants for staff-initiated pause/cancel; a definer variant for the
webhook's authenticated/halted confirmations.

## Server routes — `src/app/api/payments/razorpay/`

- **`POST .../mandate`** — agent starts a mandate for a member. Creates the
  Razorpay customer + subscription/mandate order, inserts `payment_mandates`
  (`status='pending'`), returns the auth link / QR to show the member. Gated
  `canManageMandates` (agent+). INR-only (`upiAvailableFor`).
- **`GET|POST .../connection`** — admin-only, account-scoped browser-safe status
  and explicit flag-gated manual rollback updates. Stored secrets are presence
  booleans on GET and are never returned to browser JavaScript.
- **`POST .../oauth/connect`, `GET .../oauth/callback`,
  `POST .../oauth/refresh`, `POST .../oauth/disconnect`** — server-only OAuth
  lifecycle bound to account, initiating user, client fingerprint, mode, exact
  redirect, one-use state, and S256 PKCE. Tokens are encrypted at rest; refresh
  uses a database lease/generation CAS to submit each rotating token once.
- **`POST .../webhook`** — the money path (service-role Supabase client):
  1. Read raw body, **verify HMAC** against `razorpay_webhook_secret`
     (constant-time). Bad sig → 400, no DB touch.
  2. Atomically claim `webhook_events`: completed → 200 no-op; failed/pending
     or stale processing lease → increment attempt and retry; concurrent live
     attempt → 200 busy.
  3. Route by event type:
     - `subscription.authenticated` / mandate active → `activate_mandate`, set
       `memberships.collection_mode='auto'`.
     - `subscription.charged` / `payment.captured` → `record_gateway_payment`;
       the period settles, `fee_status` auto-derives via the existing trigger.
     - `payment.failed` → mark the attempt failed → enqueue dunning.
     - `subscription.halted` / `mandate.revoked` → `revoke_mandate`, set
       `collection_mode='manual'` (back to the existing chase flow).
  4. Complete with `processed_at`; on handler failure retain state/error and
     return 500 so Razorpay can redeliver. Ledger idempotency remains the final
     financial duplicate guard.
  5. `razorpay_missing_payment_ledger` reports charged events with no matching
     `payments.gateway_payment_id`. It is read-only and service-only; replay or
     reconciliation always requires explicit approval.

## Fallback + dunning (existing flow, unchanged)

- `collection_mode='manual'`, or a mandate that is `revoked/failed/expired` →
  the member re-enters the existing renewal cron (`/api/renewals/cron`) →
  expiring flag → consented WhatsApp `gym_membership_renewal` Marketing contract → owner records cash/UPI via
  `RecordPaymentDialog` (`record_membership_payment`, `source='manual'`).
- **Dunning:** extend the renewal cron to also pick up `collection_mode='auto'`
  members whose **last auto-charge failed**, with a failure-specific WhatsApp
  nudge. Auto + success members are **skipped** from the nudge — no
  double-contact.

## UI

- **Member detail → Membership `⋯` menu:** "Set up auto-pay" → dialog
  (plan / amount / frequency) → `.../mandate` → render the Razorpay UPI QR /
  VPA collect. When active: badge "Auto-pay on · UPI ••@okhdfc" + Pause / Cancel.
- **Payments invoice table + `InvoiceDetailDialog`:** auto rows show an "Auto"
  chip (`Badge variant="info"`), driven by `source`; the dialog shows
  `gateway_payment_id` as the reference.
- Gate on `upiAvailableFor(currency)` (INR-only) + `canManageMandates`.
  Non-INR accounts never see it.
- New predicate `canManageMandates` in `roles.ts` (agent+ to set up, admin to
  cancel) + RLS mirror + `roles.test.ts`.

## RBI compliance (E-Mandate Framework, 2026)

- **≤ ₹15,000/txn** → no per-charge AFA (most gym plans). Store `max_amount`;
  warn/block mandate setup above ₹15k without AFA.
- **First charge needs AFA** — Razorpay handles it in the auth step (combined
  with registration).
- **24h pre-debit notice + post-debit alert** — Razorpay Subscriptions sends
  these; do NOT build a scheduler that bypasses them.

## Security checklist

- Webhook HMAC verify, constant-time, before any DB write.
- Completed `webhook_events` dedupe + `gateway_payment_id` unique guard =
  idempotency; retries cannot double-credit, while failures remain recoverable.
- `razorpay_webhook_secret` / API credentials are server-only, browser grants
  are revoked, and stored secret values are never returned or bundled.
- Keep `validate_membership_payment`'s amount/period/balance checks in the
  system path.
- Service-role credential access is limited to authenticated account-scoped
  connection/mandate routes and the verified webhook route; never client-side.

## Shipped sequence

1. Migration `059` — tables, columns, `record_gateway_payment`, the
   `validate_membership_payment` GUC bypass, grants/RLS.
2. Webhook route + HMAC + idempotency. Test with Razorpay test mode + sandbox
   VPA `success@razorpay`.
3. Mandate-setup route + dialog UI.
4. Payment-safety migration `20260726090000` — server-only credential grants,
   retryable event claims, attempt/error history, and missing-ledger
   diagnostics. Applied and schema/grants verified through the Supabase
   connector; no existing event was replayed or reconciled.

Still deferred: richer failed-payment dunning and mandate/subscription lifecycle.

## One-click "Connect Razorpay" (OAuth onboarding)

**Status (2026-08-09):** UsefulDesk's Razorpay Technology Partner account is
active, provider acceptance is complete apart from Stage 2 dual-ingress parity,
and Stage 1 OAuth/schema/settings code is implemented behind disabled rollout
flags. Both migrations plus RLS/grants/indexes/advisors are verified in the
isolated test project. The reviewed real-account zero-version-0 manual-secret
backfill, provider PKCE confirmation, and one internal development-client
connection gate enablement. Implementation details and
acceptance criteria live in
[`docs/razorpay-oauth-payment-links-and-refunds.md`](../docs/razorpay-oauth-payment-links-and-refunds.md).

The default settings UI now offers **Connect Razorpay**. The old write-only
`key_id` / `key_secret` / `webhook_secret` form appears only when the explicit
manual rollback flag is enabled.

- **Razorpay OAuth (Technology Partner program)** — a "Connect Razorpay" button
  → owner authorises on Razorpay → we receive an **access token** (Bearer,
  90-day + refresh token) that **replaces key_id/key_secret** for all
  server-to-server calls. No keys, no webhook setup by the owner.
- **Embedded / co-branded onboarding (Custom Onboarding SDK)** — owners without
  a Razorpay account complete **KYC inside our app**, never logging into
  Razorpay.

Still **Model 1**: each gym stays its own sub-merchant, money settles to their
bank, UsefulDesk never holds funds — OAuth only grants delegated API access.

**Remaining adoption work:** run the reviewed encrypted-secret backfill against
any real configured account deployment and prove zero version-0 rows · reconfirm
the development client accepts the required S256 PKCE contract · connect one
internal test account · complete Stage 2 application-webhook
parity before ingress cutover. OAuth refresh is proactive within seven days,
single-flight across server instances, and retried once after an attributable
401; a revoked or blocked connection fails closed.

**Clean swap.** `RazorpayCredentials`

- `account_payment_credentials` are the only creds surface; OAuth is additive:
  encrypted access/refresh tokens, expiry/rotation fields, connect/callback/
  refresh/revoke routes, and Bearer mode live behind the OAuth flag. Existing
  mandate code keeps using the account-scoped resolver. Keep the separately
  flag-gated encrypted key-paste path only as a server-controlled rollback
  during the adoption window.

**Sequencing:** (1) pilot with key-paste — complete → (2) Technology Partner
activation/onboarding and development capability acceptance — complete → (3)
Stage 1 code — complete behind flags → (4) isolated migration, reviewed secret
backfill, PKCE confirmation, and internal connection → (5) Stage 2 ingress
parity/cutover → (6) keep both paths during the explicit rollback window, with
OAuth default and encrypted manual keys advanced. Credential rotation remains
a hard gate before the first live merchant authorisation.

Docs: [Razorpay OAuth](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/) ·
[Embedded onboarding](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/) ·
[Custom Onboarding SDK](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/onboarding-sdk/)

## Deferred

Card eMandate (add after UPI is proven), e-NACH for high-value / annual,
multi-gateway abstraction, auto-generating future invoices (billing cron —
overlaps this).
