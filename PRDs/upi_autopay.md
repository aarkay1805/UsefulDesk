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
- `razorpay_key_secret text`
- `razorpay_webhook_secret text`
- RLS stays enabled with no browser policies and all `anon` / `authenticated`
  privileges revoked. Only authenticated server routes may use the service role
  to read/write an account derived from the caller’s session.

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
- **`GET|POST .../connection`** — admin-only, account-scoped status and manual
  credential updates. Stored secrets are presence booleans on GET and are never
  returned to browser JavaScript. The server connection loader returns an
  API-key/OAuth authentication union, so partner OAuth token loading can be
  added later without changing mandate or webhook logic.
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
  expiring flag → WhatsApp `gym_renewal_reminder` → owner records cash/UPI via
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

## Future: one-click "Connect Razorpay" (OAuth onboarding)

The current settings UI asks a gym owner to paste `key_id` / `key_secret` /
`webhook_secret` — fine for self-onboarded pilots, but a typical gym owner won't
do it. Razorpay offers the Stripe-Connect / Meta-embedded-signup equivalent:

- **Razorpay OAuth (Technology Partner program)** — a "Connect Razorpay" button
  → owner authorises on Razorpay → we receive an **access token** (Bearer,
  90-day + refresh token) that **replaces key_id/key_secret** for all
  server-to-server calls. No keys, no webhook setup by the owner.
- **Embedded / co-branded onboarding (Custom Onboarding SDK)** — owners without
  a Razorpay account complete **KYC inside our app**, never logging into
  Razorpay.

Still **Model 1**: each gym stays its own sub-merchant, money settles to their
bank, UsefulDesk never holds funds — OAuth only grants delegated API access.

**Adoption cost:** become a Razorpay Technology Partner (application + approval,
days–weeks) · register an OAuth app (`client_id`/`client_secret`) · build a
Connect button + callback route (code → token exchange) + per-account token
storage & **refresh logic** (90-day expiry) · teach the server connection loader
to select/refresh the OAuth token. `razorpay.ts` already accepts Bearer auth
alongside the existing Basic-auth key path.

**Clean swap — the current build already abstracts this.** `RazorpayCredentials`

- `account_payment_credentials` are the only creds surface; OAuth is additive:
  add `access_token` / `refresh_token` / `token_expires_at` columns, the connect +
  callback routes, and a Bearer mode in `razorpay.ts`. Everything downstream
  (mandate route, webhook, RPCs, UI) is unchanged. Keep the key-paste path as a
  power-user fallback.

**Sequencing:** (1) pilot with key-paste (current) → (2) apply for Technology
Partner → (3) build OAuth "Connect Razorpay" once approved → (4) keep both
paths (OAuth default, keys advanced). Runs parallel to the account-KYC /
recurring-clearance track, which gates going live either way.

Docs: [Razorpay OAuth](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/) ·
[Embedded onboarding](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/) ·
[Custom Onboarding SDK](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/onboarding-sdk/)

## Deferred

Card eMandate (add after UPI is proven), e-NACH for high-value / annual,
multi-gateway abstraction, auto-generating future invoices (billing cron —
overlaps this).
