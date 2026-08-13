# Razorpay OAuth, Payment Links, and Refunds

## Implementation plan for UsefulDesk

**Status:** Razorpay Technology Partner account active and partner onboarding completed on 2026-08-08. Isolated development OAuth/API/product acceptance and Stages 1–4 passed for the single Test account, and owner-controlled Stage 5 Live provider/payment acceptance passed on production account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` / merchant `acc_TCJwBqanN9LTrK`. Current OAuth readiness was separately restored on 2026-08-11. On 2026-08-12 the owner explicitly waived the remaining policy-only 14-day rollback hold and Stage 6 retired manual keys: connector-applied migration `20260811181302_retire_razorpay_manual_keys.sql` locks Test and Production to OAuth/storage-v1/application ingress, erased Test's one dormant legacy webhook secret, and requires all manual columns null. Manual UI/API/config, Basic-auth and version-0 compatibility, legacy per-account ingress, and cutover RPCs are removed while immutable audit evidence remains. Current Production deployment `dpl_DMSmuK8UtsRbjSnY3pzrpvfrdhpz` is READY on `desk.usefulmade.com`; the exact connection remains OAuth/Live/ready with current encrypted grants, no active state/lease/error/manual material, and zero exact Live queues. OAuth, first-bind enrollment, and every provider/refund acceptance flag remain false; the obsolete manual rollback variable is absent. VBF/Aakash remains closed. This is not a real gym-owner rollout. The apparent 2026-08-12 Meta submissions were local dry-run rows and never reached Meta; after repairing Production and the trailing-parameter rejection, Meta genuinely accepted `gym_payment_link` (`1996323644342719`) and `gym_payment_due` (`1528972491789269`). An authenticated 2026-08-14 provider sync reports both **Pending**, not Approved. No WhatsApp Send is claimed. Existing OAuth client secrets remain unrotated under the explicit owner risk acceptance.
**Initial release scope:** Razorpay Technology Partner OAuth, application-level webhooks, INR generic-invoice Payment Links, WhatsApp delivery, and exactly-once settlement.  
**Later release scope:** Full gateway refunds with an explicit accounting disposition. UsefulDesk-initiated partial refunds remain deferred; imported external partial refunds require explicit admin invoice-line targeting before accounting classification.
**Rollout:** Development-client sandbox acceptance, the owner-controlled Live gate, and current-readiness recovery passed. Production remains pinned only to Rajat's accepted account/merchant behind disabled enrollment and acceptance flags. The explicit owner risk decision superseded client-secret rotation as a Stage 5 prerequisite; the secrets remain unrotated. No fleet-wide or real-customer cutover is authorized.

## 1. Outcome

UsefulDesk gym owners connect their own Razorpay account without pasting API keys. Staff can send or copy a full-balance Razorpay Payment Link for any chargeable INR UsefulDesk invoice, and a verified captured payment settles the correct invoice exactly once. In the later refund release, admins can issue a full refund with an explicit accounting disposition.

Money always settles directly between the member and the gym's Razorpay account. UsefulDesk never holds funds.

### Real-world problems this release solves

- Gym owners connect Razorpay without copying long-lived API secrets into UsefulDesk.
- Staff can turn an existing due invoice into a tracked payment request and send it in the same WhatsApp-first workflow used for renewals.
- A member payment settles the addressed invoice without staff checking Razorpay and recording it manually.
- Provider-confirmed money that does not fit the local invoice is surfaced for action instead of being lost or silently misapplied.
- The later full-refund stage prevents a refunded member from being incorrectly chased, while still supporting the valid case where the charge remains due.

## 2. Locked product decisions

1. **One Razorpay application, two clients.** Razorpay creates separate development and production clients under one application. Each client has its own client ID and client secret.
2. **OAuth is the default connection path.** Existing manual credentials remain an explicit, server-controlled rollback path during rollout; there is no silent fallback from revoked or blocked OAuth to manual keys.
3. **One Razorpay merchant per UsefulDesk account and mode.** Enforce uniqueness on `(mode, razorpay_account_id)`. Sharing one Razorpay merchant across multiple UsefulDesk branches is out of scope for this release.
4. **Payment Links cover generic INR invoices.** Membership, service, merchandise, and service-adjustment lines are eligible when `isChargeableAmount(collectible_balance)` is true. INR-only keeps the current paise conversion correct; broader currency support requires a canonical currency-minor-unit layer first.
5. **Payment Links are full-balance and non-partial.** Set `accept_partial=false` and expire links after 7 days. Manual partial collection remains available.
6. **`payment_link.paid` is the canonical settlement event.** Do not also settle from `payment.captured`; different webhook events can describe the same payment.
7. **Provider-confirmed money is never discarded.** A captured payment that cannot safely enter the ledger becomes a durable operator-visible exception, following the existing recurring-charge safety pattern.
8. **Refund and invoice adjustment are separate facts.** A processed refund reverses collected cash. The selected disposition determines whether the invoice becomes due again.
9. **Original payment rows remain immutable.** Refund and invoice-adjustment identities and amounts are immutable financial facts. Refund workflow status and classification may change only through the explicit transition RPCs below; rows are never deleted or repurposed.
10. **Only provider-processed refunds affect financial totals.** `creating`, `pending`, and `failed` refunds do not. A processed external refund awaiting classification reduces net cash and places the invoice on review hold before it can re-enter dues.
11. **The later full-refund release covers both Payment Link and AutoPay payments.** The original Razorpay payment must already exist in UsefulDesk with valid invoice-line allocations. UsefulDesk initiates only the full remaining refundable amount; an imported external partial can be resolved only by explicit admin line targeting.
12. **Payment Link is a distinct payment source.** Extend `payments.source` to `manual | auto | payment_link`. `auto` continues to mean only a recurring mandate debit and keeps its membership-line-only allocation rule. `payment_link` has no human recorder but allocates across the addressed generic invoice using the normal deterministic largest-remainder algorithm.
13. **Refund review is non-collectible.** A processed external refund with no disposition reduces net cash immediately, but its invoice has `collectible_balance = 0`. An admin can classify a supported full refund; an external partial stays blocked until every refunded paise is explicitly assigned to original payment lines. Neither may enter dues, reminders, payment-link creation, or cached `fee_status='due'` while under review.
14. **Refund capacity and classification are database transactions.** Service-role-only RPCs lock the payment/refund rows, reserve paise-exact allocations for supported full refunds, enforce idempotency and state transitions, and create a separate immutable invoice adjustment in the same transaction when required. Routes must not emulate these invariants with separate Supabase calls.
15. **Link eligibility changes are durably convergent.** Every balance/eligibility mutation requests cancellation transactionally; paid/cancelled/expired handlers are monotonic; and the 15-minute recovery worker owns remote cancellation plus creating/orphaned intent reconciliation.
16. **Provider capability acceptance is staged, not assumed.** Technology Partner activation and onboarding are complete. Before initial-release schema work, confirm development-client OAuth access to Customers, Plans, Subscriptions, Payment Links, and Payments; the exact application-webhook events and header/payload identity across legacy and application delivery; and test-mode Payment Links plus Subscriptions activation. Refund API/event acceptance gates only Stage 4. The `gym_payment_link` Meta Utility template gates WhatsApp Send only; Copy link, OAuth, Payment Link creation, and settlement remain available without it.
17. **One trusted provider mode per deployed database.** `RAZORPAY_MODE` is the authoritative `test | live` mode for OAuth, credentials, API calls, webhook secrets, and account resolution. A test deployment must use an isolated test database and test application webhook; production uses the production database and live webhook. The mode is never inferred from a webhook payload or browser input, and a stored connection whose mode differs from the deployment is unusable.
18. **Shadow webhook delivery is observational only.** During dual-ingress rollout, both the legacy per-account endpoint and the application endpoint record separate delivery observations, but only the currently active ingress may claim or complete the canonical `webhook_events` financial event. A shadow delivery can compare routing, type, payload hash, and timing; it can never suppress or execute money handling.
19. **Webhook delivery is the latency path, not the completeness boundary.** The recovery worker also verifies stale active Payment Links against Razorpay and incrementally scans provider refunds with a durable per-merchant cursor. Correctly signed webhooks normally settle first; provider reconciliation recovers events that were never delivered before Razorpay's retry window ended.
20. **An unallocated processed refund blocks further allocation.** Once any processed refund for a payment lacks complete line allocations, no later local or imported refund may fabricate “remaining” line allocations and no refund on that payment may be classified. Further provider refunds remain immutable header-only facts under the same review hold until an admin explicitly resolves the incomplete refund chain against original payment-line capacity.

### Deliberate simplifications

- **INR only instead of generic multi-currency.** The current ledger has paise-specific conversion; adding a minor-unit framework before another currency is needed would be speculative.
- **Full remaining-payment refund initiation instead of partial initiation.** A proportional split across mixed invoice lines can produce the wrong business result. UsefulDesk initiates only the full remaining payment; a Dashboard-originated partial stays contained until an admin explicitly selects its commercial line target.
- **One WhatsApp action plus Copy fallback instead of a delivery subsystem.** Existing conversation messages prove WhatsApp sends; copying a URL is not a delivery event.
- **Reuse `webhook_events` instead of a second unknown-account event store.** Preserve the existing Meta event contract and allow service-only Razorpay application events with no mapped account.
- **A delivery-observation ledger is not a second event processor.** The small service-only Razorpay delivery table exists only to compare legacy/application ingress safely during cutover. Canonical idempotency, payload ownership, processing state, and financial completion remain in `webhook_events`.
- **Revision history instead of a `superseded` Payment Link state.** Cancelled/expired terminal revisions already explain replacement.
- **One owner-facing attention count instead of a diagnostics dashboard.** Queue ages, leases, and raw provider errors remain operator concerns.
- **Two/ten-caller concurrency acceptance instead of a fifty-caller core test.** Larger load testing stays outside the release-critical suite.

## 3. Refund dispositions

Every refund request requires an admin/owner to choose one of these explicit outcomes:

### A. Refund and keep balance due

Use when the underlying charge remains valid: wrong payment method, wrong payer, or another payment that must be collected again. Chargebacks, disputes, and provider reversals are separate gateway lifecycles and are not represented as ordinary refunds in this release.

Example:

```text
Invoice total                    10,000
Payment                         -10,000
Balance                               0
Processed refund                +10,000
New balance                      10,000
```

The invoice returns to the normal dues and reminder workflows.

### B. Refund and reduce charge

Use for a cancellation, agreed discount, undelivered service, or service deficiency. The processed refund also creates an equal internal invoice adjustment, so the member is not chased again.

```text
Invoice total                    10,000
Payment                         -10,000
Processed refund                +10,000
Invoice adjustment              -10,000
New balance                           0
```

Call this an **invoice adjustment** in the product. Do not call it a GST credit note until UsefulDesk implements legally compliant GST documents and numbering.

The first refund release initiates **full remaining-payment refunds only**. This avoids incorrectly spreading a partial refund across unrelated membership, service, and merchandise lines. When Razorpay Dashboard nevertheless creates a partial refund, the admin must select the affected invoice line or lines, each line is capped at the original payment's remaining allocation, and the selected allocations must sum exactly to the provider-confirmed refund. Never infer the commercial target of a partial refund using proportional allocation.

## 4. Razorpay dashboard setup

### Provider-acceptance gate

Partner status:

- **Complete (2026-08-08):** UsefulDesk's Razorpay Technology Partner account is active and partner onboarding is complete.

Complete a thin development-client spike before initial-release migrations or UI work:

- Confirm the application exposes separate development and production clients and record their permitted redirect/webhook configuration.
- Authorize one test merchant and call Customers, Plans, Subscriptions, Payment Links, and Payments with its development Bearer token.
- Record the exact application-webhook events Razorpay exposes for this import/OAuth flow. Verify whether the same provider event retains the same `x-razorpay-event-id`, top-level `account_id`, type, and payload across legacy and application delivery. Do not assume onboarding-status events are available until they appear for the application.
- Confirm Payment Links and Subscriptions/Recurring are activated in test mode. Repeat the capability check in live mode before production connection.
- Razorpay test mode allows only 30 created Payment Links per business by default. Use a dedicated test merchant, keep the acceptance matrix within that limit, or obtain a higher limit from Razorpay before exhaustive integration testing.

Before Stage 4, separately verify that the same OAuth merchant can create, fetch, list, and refund Payments and that the application exposes the required refund events. Refund acceptance does not block OAuth, AutoPay parity, or Payment Links.

Meta approval proceeds in parallel: approve the Utility template `gym_payment_link` with the four parameters in section 10.2 before enabling **Send payment link**. Missing approval disables only Send; **Copy link** remains the operational fallback and is not a provider-acceptance failure.

Create one application under **Partners → Applications**:

- **Application name:** UsefulDesk
- **Website:** `https://usefulmade.com`
- **Logo:** approved square UsefulDesk Razorpay icon
- **OAuth scope:** `read_write`

Configure the generated clients separately:

### Development client

- Client mode: `test`
- Redirect URI: `http://localhost:3000/api/payments/razorpay/oauth/callback`
- Add a deployed HTTPS test/preview callback when testing outside localhost.
- Webhook URL must be publicly reachable HTTPS, for example `https://<test-deployment>/api/payments/razorpay/webhook`.

### Production client

- Client mode: `live`
- Redirect URI: `https://desk.usefulmade.com/api/payments/razorpay/oauth/callback`
- Webhook URL: `https://desk.usefulmade.com/api/payments/razorpay/webhook`

The development application selector was verified on 2026-08-08. Configure only the minimum events it currently exposes and UsefulDesk consumes:

- `account.app.authorization_revoked`
- `account.instantly_activated`
- `account.activated_kyc_pending`
- `subscription.authenticated`
- `subscription.activated`
- `subscription.charged`
- `subscription.pending`
- `subscription.halted`
- `subscription.cancelled`
- `subscription.completed`
- `payment_link.paid`
- `payment_link.cancelled`
- `payment_link.expired`
- `payment_link.partially_paid` as a safety alert; it should be impossible for links created by UsefulDesk
- `refund.processed`
- `refund.failed`

The selector did not expose `account.activated`, `account.under_review`, `account.needs_clarification`, `account.suspended`, `account.rejected`, or `subscription.expired`. Do not invent subscriptions for unavailable events; the account fetch/readiness probes below are authoritative for merchant readiness, and recovery/provider fetches remain authoritative for missed terminal subscription state. Re-check the production selector before Stage 5 because provider availability may change. Do not add `payment.captured` as a second Payment Link settlement trigger.

Confirm Payment Links and Subscriptions/Recurring are activated in test mode before development acceptance and in live mode before production connection.

Razorpay does not prefill the hosted checkout with supplied phone or email details under its current security policy. Acceptance testing must include the real member flow and the UI/help copy must not promise a one-tap, prefilled checkout.

## 5. Environment configuration

Use the same variable names in each deployment environment, with development or production values supplied by Vercel:

- `RAZORPAY_OAUTH_CLIENT_ID`
- `RAZORPAY_OAUTH_CLIENT_SECRET`
- `RAZORPAY_MODE` = `test` or `live`; authoritative for the whole deployed database, not only OAuth
- `RAZORPAY_OAUTH_REDIRECT_URI`
- `RAZORPAY_WEBHOOK_SECRET_CURRENT`
- `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` during secret rotation only
- `RAZORPAY_OAUTH_ENABLED`

None may use the `NEXT_PUBLIC_` prefix. Application client secrets and application webhook secrets never enter Postgres. Merchant access and refresh tokens are encrypted with the existing AES-256-GCM secret utility before database storage and decrypted only inside server-only payment modules. `RAZORPAY_MANUAL_ROLLBACK_ENABLED` was deleted from Production during Stage 6 and must not be reintroduced.

### Historical manual-secret migration (retired by Stage 6)

The following ordered rollout preserved the pre-OAuth path during Stages 1–5. It is historical evidence, not a supported runtime contract:

1. Add `secret_storage_version smallint not null default 0` with allowed values `0 | 1`, plus nullable `provider_mode`. Version `0` means the two existing manual secret columns are plaintext; version `1` means every populated secret column is AES-256-GCM ciphertext. Never guess the format by counting delimiters in a secret.
2. Deploy a server-only dual reader before changing any stored value. It may read version `0` only for the explicitly enabled manual rollback path; after a successful read it encrypts every populated secret and conditionally advances the row to version `1`. Version `1` decrypts only and fails closed on malformed ciphertext.
3. New manual writes encrypt before persistence and write version `1`. New OAuth connection rows also write version `1`; OAuth access and refresh tokens are encrypted from their first write and never have a plaintext version.
4. Run an idempotent server-side backfill with `ENCRYPTION_KEY` and the service-role client. Backfill `provider_mode` from an operator-reviewed deployment/account inventory, not from browser input or runtime key-prefix inference. A credential belonging to another mode must be moved to the matching isolated deployment/database or left blocked for operator action.
5. Verify totals for configured rows, version-0 rows, missing secrets, mode mismatches, and decrypt failures; then exercise one legacy signed webhook and one authenticated API read for every migrated pilot account.
6. Only after the verified version-0 count is zero, change the database default to version `1` and allow Stage 1 to enable OAuth by default. Keep the dual reader for the rollback window, but never write plaintext again; remove the version-0 branch when manual-key retirement completes.

Stage 6 verified zero manual-mode and zero version-0 rows in both databases, then removed the dual reader/backfill script and applied the stricter OAuth/v1/application-only database constraints. No application encryption key entered Postgres.

Fail closed at startup and at every server connection boundary when `RAZORPAY_MODE` is absent, invalid, or differs from the stored `provider_mode`. Development/test webhook URLs must terminate in a deployment backed by an isolated test database; never point a development-client webhook at the production deployment merely because the route path is the same. The application webhook resolves `(RAZORPAY_MODE, top-level account_id)` and never searches across both modes.

During webhook-secret rotation, verify against the current secret first and the previous secret second. Remove the previous secret only after Razorpay's retry window for old deliveries has passed.

### Operational constants

Keep these values in one server-only payments constants module and test their boundary behavior:

- readiness-probe freshness: 24 hours
- OAuth refresh and outbound-refund lease: 2 minutes
- Razorpay HTTP deadline: 30 seconds for every individual provider request; it must remain comfortably shorter than any owning lease
- webhook/recovery item processing lease: 5 minutes
- recovery schedule: every 15 minutes, at most 100 claimed items per invocation
- retry delays: 1 minute, 5 minutes, 15 minutes, 1 hour, then 6 hours maximum; financial/provider-confirmed items are never abandoned solely because of attempt count
- Payment Link reuse requires at least 24 hours before expiry; newly created links expire after 7 days
- active Payment Link verification: first check after 15 minutes, then progressively back off to at most 6 hours while remote status remains `created`; always verify when locally past expiry
- provider refund reconciliation: each ready merchant becomes due at least hourly; scan a 48-hour overlap behind the completed cursor and advance the cursor only after every page in the fixed window succeeds
- browser-safe stored error text: 2,000 characters maximum

## 6. Authorization model

Add named predicates in `src/lib/auth/roles.ts` and mirror them in route authorization and RLS/service-only boundaries:

- `canConfigurePaymentGateway` — existing admin/owner capability; connect, reconnect, disconnect, and connection diagnostics.
- `canManagePaymentLinks` — agent and above; create, reuse, copy, and send invoice links.
- `canRefundGatewayPayments` — admin/owner; request full refunds and select the disposition.

Add or extend tests in `roles.test.ts`. Do not use inline role comparisons at route or component call sites.

All OAuth-state, token, webhook, payment-link mutation, refund, and exception writes run through authenticated server routes or service-role-only RPCs. Browser clients never receive raw secrets or tokens.

## 7. Database design

Create migrations using the current repository migration workflow and filenames that sort after the latest migration. Every new `public` table must have explicit grants and RLS, even when it is service-role-only.

### 7.1 `razorpay_oauth_states`

Service-role-only, short-lived OAuth initiation records:

- `id uuid primary key`
- `state_hash text unique not null`; store SHA-256 of the state, never the raw value
- `account_id uuid not null`
- `initiated_by uuid not null`
- `client_id_fingerprint text not null`; non-secret stable identifier/fingerprint
- `mode text check (mode in ('test','live'))`
- `redirect_uri text not null`
- `expires_at timestamptz not null`
- `consumed_at timestamptz`
- `created_at timestamptz not null`

Use a 10-minute TTL. Consume with one conditional update requiring matching hash, account, user, mode, redirect URI, `consumed_at is null`, and `expires_at > now()`; require a returned row or fail the callback.

### 7.2 Extend `account_payment_credentials`

Retain this as the single account-scoped gateway connection surface. Its Stage 6 current contract is:

- `authentication_mode`: `oauth` only
- `razorpay_account_id`
- `provider_mode`: `test | live`; required for OAuth authentication and required to equal the deployment's `RAZORPAY_MODE`
- `secret_storage_version smallint`: `1` only; version-0 plaintext compatibility is retired
- encrypted `oauth_access_token`
- encrypted `oauth_refresh_token`
- `oauth_access_expires_at`
- `oauth_refresh_expires_at`
- `oauth_scope`
- `connection_status`: `connecting | ready | blocked | reconnect_required | disconnecting | disconnected`
- `merchant_status`: `unknown | activated | under_review | needs_clarification | suspended | rejected`
- `canonical_webhook_ingress`: `application` only
- `refresh_generation integer not null default 0`
- `refresh_lease_owner uuid`
- `refresh_lease_until timestamptz`
- `connected_at`, `disconnected_at`, `activation_verified_at`, `last_verified_at`, `last_error`

Keep the unique index on `(provider_mode, razorpay_account_id)` where the external account ID is not null. The table remains one row per UsefulDesk account because one deployed database owns exactly one provider mode. Historical manual columns remain as null-only tombstones under a check constraint; all raw grant columns stay revoked from `anon` and `authenticated`, and the GET-only connection route returns browser-safe status.

### 7.3 Extend payment provenance and ledger guards

Extend `payments.source` to `manual | auto | payment_link` without changing the meaning of existing values:

- `auto` is reserved for mandate/subscription debits, has no human recorder, and may allocate only to its trusted membership invoice line.
- `payment_link` has no human recorder, requires a gateway payment ID, must not reference a mandate, and may allocate across the addressed generic invoice with the normal deterministic largest-remainder algorithm.
- `manual` retains the existing recorder and generic-invoice behavior.

Keep the global gateway-payment uniqueness guard. Update the allocation validator so it selects the rule from the payment source rather than treating all automated rows alike. Reject attempts to pass a Payment Link settlement through the AutoPay-only RPC.

Gateway-originated payments are reversed only by refunds. Harden `void_membership_payment` and every payment-void route to reject a payment with `gateway_payment_id is not null` or `source in ('auto', 'payment_link')`; retain Void only for eligible manual payments. Map provider methods centrally: UPI to `upi`, card to `card`, netbanking/bank transfer to `bank`, and unsupported provider methods to `other` while preserving the raw method in gateway metadata.

### 7.4 `razorpay_payment_links`

One local intent/revision per remote link:

- `id uuid primary key`
- `account_id`, `invoice_id`
- `revision integer`
- stable `reference_id` no longer than Razorpay's 40-character limit
- `gateway_link_id`
- `expected_amount numeric(12,2)` and integer `expected_amount_subunits`
- `currency`
- `short_url`
- `expires_at`
- `status`: `creating | created | cancel_requested | paid | cancelled | expired | failed | orphaned`
- `created_by`
- `cancel_reason`, `setup_error`, `remote_status`, `last_verified_at`, `last_reconciled_at`, timestamps
- `next_reconcile_at`; set on creation and after every non-terminal provider verification so a remotely paid/expired link cannot remain locally active forever

Constraints:

- unique `(account_id, invoice_id, revision)`
- unique `(account_id, gateway_link_id)` when present
- unique `(account_id, reference_id)`
- at most one blocking link per invoice across `creating | created | cancel_requested | orphaned`

Reserve the local row before calling Razorpay. Use the stable reference ID to recover a remote link when Razorpay succeeded but the local finalize write failed. Mark unrecoverable remote/local divergence as `orphaned` and block another link until reviewed.

Allowed link transitions are monotonic: `creating -> created | failed | orphaned`; `created -> cancel_requested | paid | cancelled | expired`; `cancel_requested -> paid | cancelled | expired`; and recovery may move `orphaned` only to a provider-verified `created | paid | cancelled | expired | failed` state. `paid`, `cancelled`, `expired`, and `failed` are terminal. A paid provider fact wins over a concurrent cancellation result. A cancelled older revision needs no separate `superseded` state; the revision history already explains its replacement.

### 7.5 Delivery correlation

Do not add a separate `payment_link_deliveries` table in the first release. Copying a URL is not proof of delivery, and successful WhatsApp sends already exist in the conversation/message ledger. Store optional `last_whatsapp_message_id`, `last_sent_at`, and bounded `last_delivery_error` on the Payment Link row only if direct correlation is needed. A WhatsApp failure never invalidates the link; always return the short URL so staff can copy it immediately.

### 7.6 Gateway exception surfaces

Service-role-only durable records for provider-confirmed Payment Link money that cannot safely enter the ledger:

- account, invoice, link, webhook event, gateway payment ID
- amount, currency, method, provider status
- reason code/message, raw provider identifiers
- attempt count, first/last seen timestamps, resolution metadata

Unique `(account_id, gateway_payment_id)`. This follows `gateway_charge_exceptions`; do not silently drop, partially apply, or repeatedly retry an unsafe captured payment.

Do not add a separate unknown-account exception table. Extend the existing service-role-only `webhook_events` contract so an application event may retain `account_id = NULL` together with mode, top-level external account ID, `event_identity_source`, immutable payload/hash, processing status, and alert/resolution metadata. The permanent event identity prevents alert/retry amplification. Preserve the existing Meta lead-capture use of `webhook_events`, including its `gateway='meta'` identity and delete-on-handler-failure retry semantics.

Add a service-role-only `razorpay_webhook_deliveries` observation ledger for safe dual-ingress rollout:

- provider event ID, `event_identity_source`, `provider_mode`, ingress `legacy_account | application`, external account ID, resolved UsefulDesk account when known
- payload hash, event type, signature-secret generation, received timestamp, and whether the delivery was shadow-only
- unique `(provider_mode, provider_event_id, ingress)`

This table never owns processing status and never authorizes a financial handler. In shadow mode the application endpoint writes only this observation and returns 2xx; it does not insert, claim, update, or complete the canonical `webhook_events` row. After cutover, the application endpoint records the observation and then uses `webhook_events` as the sole canonical event processor. Retain the observations through the rollout audit window so routing and payload parity can be proven before retiring the legacy endpoint.

Add a service-role-only `razorpay_reconciliation_state` row per connected account for provider-source recovery:

- `account_id`, `provider_mode`, `next_refund_reconcile_at`, `refund_completed_through`
- fixed in-progress window `refund_window_from`, `refund_window_to`, and `refund_skip`; request 25 refunds per page so parent verification stays inside the five-minute lease, while the offset can resume through arbitrarily many provider pages
- lease owner/until, last success/error, and timestamps

For the first Stage 4 scan, initialize the window from 48 hours before the earliest local Razorpay gateway payment for the account, not from feature-enable time, so pre-existing Dashboard refunds on AutoPay payments are not skipped. Begin each later window 48 hours before `refund_completed_through`, deduplicate by gateway refund ID, and freeze its end timestamp before the first provider call. Advance `refund_completed_through` only after every page in that fixed window has been imported, verified, or explicitly identified as unrelated to a UsefulDesk gateway payment. A crash resumes the same window and offset; it never jumps past unseen provider refunds.

### 7.7 Refunds, adjustments, and transactional RPCs

`payment_refunds` is append-preserving but stateful:

- `id`, `account_id`, `payment_id`, `invoice_id`
- `gateway_refund_id`
- `amount`, `currency`
- source `usefuldesk | razorpay_dashboard`
- disposition `reopen_balance | reduce_charge`; nullable only for an externally initiated processed refund awaiting classification
- reason; required for UsefulDesk requests and nullable only for a newly imported Dashboard refund awaiting classification
- provider status `creating | pending | processed | failed | orphaned`
- client idempotency key and Razorpay refund idempotency key/receipt
- immutable canonical outbound request body text and SHA-256 hash; contains amount, receipt, and bounded notes but no credential material, and is reused byte-for-byte for every idempotent retry
- requested/processed/failed timestamps and actor
- outbound request lease owner/until
- provider error/status metadata

Constraints:

- unique `(account_id, idempotency_key)`
- unique `(account_id, gateway_refund_id)` when present
- refund capacity includes `creating`, `pending`, `processed`, and `orphaned`; only `failed` releases capacity
- capacity is enforced under a payment-row lock in the reservation/import RPC, not by a cross-row `CHECK`
- `has_unallocated_processed_refund(payment_id)` is true when any processed refund header for the payment lacks a complete paise-equal allocation set; while true, all further allocation, UsefulDesk refund reservation, and classification paths for that payment fail closed

Core identity, payment, amount, currency, and source are immutable after insert. Provider identifiers may be populated once and never replaced. Only the explicit workflow RPCs may update provider status/error fields, timestamps, and disposition/classification fields. Allowed transitions are:

- `creating -> pending | processed | failed | orphaned`
- `pending -> processed | failed | orphaned`
- `orphaned -> pending | processed | failed` after provider fetch/reconciliation
- `processed` and `failed` are terminal

`processed` reduces net cash. `creating`, `pending`, `orphaned`, and `failed` do not affect financial views. `status='processed' AND disposition IS NULL` derives `requires_refund_review=true`; classification fills the disposition without changing provider status. This keeps provider state and accounting classification as separate axes.

`payment_refund_allocations` maps each supported refund to the original payment's invoice-line allocations. Allocation amounts are positive and immutable. The disposition determines balance behavior. An externally initiated partial refund deliberately imports without line allocations; its exception and invoice-wide review hold make that missing commercial attribution explicit instead of inventing one. Only the explicit line-targeting transaction may later add those allocations.

A processed refund first discovered from a Razorpay Dashboard webhook or provider reconciliation scan is inserted with `source='razorpay_dashboard'`, `status='processed'`, and no disposition. It immediately reduces net cash reporting, places the affected invoice under refund review, and suppresses automated due reminders. A full remaining-payment refund waits for an admin to choose `reopen_balance` or `reduce_charge`; a partial refund additionally waits for exact invoice-line targeting.

Create separate append-only `invoice_adjustments` and `invoice_adjustment_allocations` facts. An adjustment has account/invoice identity, `source='refund'`, a unique `source_refund_id`, positive amount, reason, creator/timestamp, and immutable positive line allocations. A processed `reduce_charge` refund creates exactly one equal adjustment and allocations in the same database transaction. `reopen_balance` creates none. An imported refund creates none until classified; an imported partial can create one only inside the same transaction that validates its explicit line targets and resolves the exception.

Implement the invariants in service-role-only `SECURITY DEFINER` RPCs with fixed `search_path`, explicit argument validation, and execute revoked from `PUBLIC`, `anon`, and `authenticated`:

- `reserve_gateway_refund(...)`: lock the payment, verify tenant/provider/currency/age and identical-body idempotency, reject when any processed refund for the payment lacks complete allocations, require the amount to equal the payment's full remaining refundable amount, copy the remaining original payment allocations exactly, reserve the refund with a two-minute outbound lease, and return the existing reservation on an identical replay.
- `finalize_gateway_refund(...)`: lock the refund/payment, validate fetched provider facts and allowed transition, finalize once, and create the invoice adjustment atomically when disposition is `reduce_charge`.
- `import_gateway_refund(...)`: lock the payment, deduplicate the gateway refund, and require all active outbound leases for that payment to be finalized/reconciled. If an earlier processed refund on the payment lacks complete allocations, insert this provider-confirmed refund as an immutable header-only `processed` fact, create/update the unique `partial_refund_line_target_required` exception, and retain the invoice-wide review hold regardless of this refund's amount. Otherwise, for a full remaining-payment refund, copy the remaining original allocations and insert it as `processed` with a null disposition. For an externally initiated partial refund, insert the immutable processed refund header without line allocations, create/update the same exception in the transaction, and place the invoice on review hold. Header-only branches are detection and containment only; they cannot be classified in this release.
- `classify_gateway_refund(...)`: require actor, reason, and disposition; lock a processed full refund whose disposition is null; verify it has complete copied allocations and that no processed refund anywhere on the payment lacks allocations; fill the disposition once; and create the adjustment atomically when required. It does not rewrite provider status.
- `resolve_gateway_partial_refund(...)`: require exact admin membership, a processed Dashboard refund linked to its unresolved `partial_refund_line_target_required` exception, a reason/disposition, and one to 100 unique positive paise-exact line allocations whose sum equals the refund. Lock the refund, payment, and exception; accept only original invoice lines within remaining original-payment capacity; insert immutable refund allocations, classify the accounting outcome, create an equal adjustment for `reduce_charge`, resolve the exact exception, refresh membership fee state, and request link cancellation in one transaction. An identical replay returns `duplicate`; any mismatch is immutable conflict. Execute is service-role-only.

Application routes perform capability checks, provider calls, and provider fetch verification; these RPCs own all database concurrency and financial mutations. A sequence of separate Supabase client calls is not an acceptable substitute for the locked transaction.

If an external processed-refund event races an active UsefulDesk refund request for the same payment, leave the durable webhook pending rather than violating capacity. After the two-minute outbound lease expires, recovery fetches the parent payment's complete paginated provider refund list, matches UsefulDesk `receipt` and notes first, finalizes those reservations, and only then imports unmatched processed refunds. The provider never returns the request's idempotency header as durable refund metadata, so matching must not depend on that header. Razorpay's provider state is authoritative; no confirmed refund is dropped because of a stale local reservation.

### 7.8 Reconciled views and collection hold

Extend invoice and invoice-line balance views with explicit gross and net facts. At invoice/payment level, processed-refund totals come from immutable refund headers so externally initiated partial refunds reduce net cash immediately. At line level, the equivalent refund totals come only from `payment_refund_allocations`:

- `gross_amount_paid`
- `processed_refund_amount` from `status='processed'` refund headers at invoice/payment level, or processed refund allocations at line level
- `net_amount_paid = gross_amount_paid - processed_refund_amount`
- `invoice_adjustment_amount` from the separate adjustment allocations
- `net_total = gross_total - invoice_adjustment_amount`
- `accounting_balance = max(gross_total - member_credit - invoice_adjustment_amount - net_amount_paid, 0)`
- `requires_refund_review` when `status='processed' AND disposition IS NULL`
- `collectible_balance = 0` while `requires_refund_review` or the invoice is void, otherwise `accounting_balance`
- existing operational `balance` becomes an alias of `collectible_balance` during migration so an overlooked consumer fails closed instead of chasing a member under review

For an externally initiated partial refund without line allocations, do not fabricate line balances. Show the provider-confirmed amount in payment/invoice cash reporting, keep line-level balances unchanged, set `requires_refund_review=true`, and expose `collectible_balance=0` for the whole invoice until an admin completes explicit line targeting.

If `amount_paid` currently drives product behavior, migrate it deliberately to the net collected meaning and add `gross_amount_paid` for audit/reporting. Propagate `collectible_balance` and `requires_refund_review` through `membership_period_invoices`, `membership_dues`, and cached membership `fee_status`; review-held invoices remain non-due until classification.

Audit and update every collection consumer together: installment/reminder cron, Members dues/action lists, dashboard counts, follow-up creation, manual payment, Payment Link creation/invalidation, invoice detail, Finance summaries, and CSV exports. Operational collection surfaces use `collectible_balance`; Finance and the refund-review UI may show `accounting_balance`, gross/net cash, and adjustments explicitly. The installment cron must filter out `requires_refund_review` even if an upstream view regresses.

### 7.9 RLS and visibility matrix

- OAuth states, raw credentials, raw webhook events including unmapped-account events, financial mutation RPCs, leases, and provider exception payloads are service-role-only with no browser grants.
- Account members may read browser-safe Payment Link status and reconciled invoice/payment/refund facts through tenant-scoped views; viewers remain read-only.
- Payment Link creation/delivery routes require `canManagePaymentLinks`; refund and classification routes require `canRefundGatewayPayments`; connection routes require `canConfigurePaymentGateway`.
- No browser role may insert/update/delete payment, refund, refund-allocation, adjustment, adjustment-allocation, exception, or webhook rows directly. Routes return fixed browser-safe shapes and bounded error text, not raw provider payloads.
- Add positive cross-tenant denial tests for every table, view, and RPC in addition to grant/advisor checks.

## 8. OAuth implementation

### 8.1 Connect

`POST /api/payments/razorpay/oauth/connect`

1. Require `canConfigurePaymentGateway`.
2. Generate at least 32 random bytes for state; store only its hash.
3. Bind state to authenticated user, account, client/mode, and exact redirect URI.
4. Persist before redirecting.
5. Build the Razorpay authorization URL with `response_type=code`, `scope=read_write`, and raw state.

### 8.2 Callback

`GET /api/payments/razorpay/oauth/callback`

1. Require a valid UsefulDesk session and re-run `canConfigurePaymentGateway`.
2. Atomically consume the bound, unexpired state before token exchange.
3. Handle denial/rejection responses without creating a connection.
4. Decode the authorization code and exchange it server-side using the bound redirect URI and configured mode.
5. Validate response shape, granted scope, and `razorpay_account_id`.
6. Require the bound OAuth-state mode and token-exchange mode to equal server-only `RAZORPAY_MODE`; reject a merchant already bound to another UsefulDesk account in that mode.
7. Encrypt access/refresh tokens and persist expiry from `expires_in`; record the 180-day refresh deadline.
8. Fetch `/v2/accounts/:razorpay_account_id` when the application's partner permissions allow it and persist `status` plus the live-payments flag. For imported accounts where that endpoint is unavailable, use only provider-confirmed non-mutating readiness checks identified in the acceptance spike; do not create live plans, subscriptions, links, or refunds merely as a probe. Set `ready` only after OAuth and capability readiness are verified, and retain explicit product errors.
9. Redirect to Settings with a browser-safe success/failure code, never token data.

### 8.3 Token loading and refresh

Put OAuth selection behind `getRazorpayConnection`; callers continue consuming the existing API-key/OAuth authentication union.

- Refresh proactively when the access token has seven days or less remaining.
- Run the daily due-token refresh scan from the shared 15-minute recovery worker using the existing cron-auth helper and a once-per-day database lease.
- Acquire the two-minute database lease and record `refresh_generation` before the network call.
- Abort the provider request after 30 seconds. No refresh, link, refund, cancellation, fetch, or reconciliation call may outlive its owning lease.
- After Razorpay returns a new pair, update tokens only if lease ownership and generation still match.
- Waiting callers reload after the active refresher completes instead of refreshing concurrently.
- On provider `401` attributable to token expiry, refresh and retry the original request once only.
- On any refresh failure or timeout, reload the connection row first. If another owner advanced `refresh_generation` and committed a valid pair, use that pair and do not change connection status. If generation is unchanged and the provider may have accepted the refresh without returning the new pair, mark `reconnect_required`; never retry an outcome-unknown refresh with the old token because a successful refresh invalidates it. This cross-system crash window cannot be made fully atomic.
- Never fall back to manual credentials when OAuth is revoked, blocked, suspended, rejected, or reconnect-required.

### 8.4 Disconnect and revocation

- User disconnect: set `disconnecting` first so new operations stop immediately, revoke both refresh and access tokens as applicable, then clear encrypted OAuth tokens and mark `disconnected`.
- If Razorpay is unavailable, retain encrypted tokens only for a retry worker while the local connection remains blocked.
- `account.app.authorization_revoked`: mark blocked/disconnected immediately, clear or quarantine tokens, disable new links/refunds/mandates, and surface Reconnect.
- Account status events update `merchant_status`. Explicit `under_review`, `needs_clarification`, `suspended`, and `rejected` states always block new mutations. `unknown` is allowed only when `activation_verified_at` came from a recent successful readiness probe; it must not remain an unverified bypass.

## 9. Application webhook architecture

Replace the per-account webhook route with:

`POST /api/payments/razorpay/webhook`

Processing order is load-bearing:

1. Read the raw body once.
2. Verify `x-razorpay-signature` against the current or previous application webhook secret before parsing or writing anything.
3. Parse the signed payload and require top-level `account_id`. Prefer `x-razorpay-event-id` as the stable event ID. If Razorpay omits it, derive `fallback:<sha256(provider_mode + top-level account_id + raw body)>`; never derive event identity from the signature because legacy/application endpoints and secret generations sign the same payload with different secrets. Persist `event_identity_source = header | payload_hash_fallback`, alert on every fallback, and use the same identity algorithm at both ingresses.
4. Bind the delivery to server-only `RAZORPAY_MODE`, then resolve the UsefulDesk account through unique `(provider_mode, razorpay_account_id)`. Never infer mode from the payload or search both modes.
5. Insert the immutable `razorpay_webhook_deliveries` observation for the application ingress.
6. While the application ingress is in shadow mode, stop here and return 2xx. Do not insert, claim, mutate, or complete `webhook_events`, do not call a financial handler, and do not use `after()` for event processing.
7. While the application ingress is active, persist/claim the immutable canonical raw event as `pending` before external verification or financial work. If canonical persistence fails, return non-2xx so Razorpay retries.
8. Once durable, return 2xx within Razorpay's five-second window.
9. Start best-effort post-response processing with Next.js `after()` and retain a cron worker as the durable recovery path for pending/failed/stale events. `after()` is a latency optimization, not the source of durability.

When the application ingress is active, unknown but correctly signed external account IDs remain in `webhook_events` with `account_id = NULL`, return 2xx to avoid futile retries, and alert operators. During shadow mode they remain only in `razorpay_webhook_deliveries`, where they still raise the routing-parity alert but cannot create canonical state.

Preserve the existing claim/lease/complete/fail semantics. Update them for the active application route without weakening permanent event idempotency or the final `(account_id, gateway_payment_id)` money guard. During dual ingress, update the legacy route to write its own delivery observation before consulting the account's `canonical_webhook_ingress` and using its unchanged canonical claim. The stored account field selects exactly one canonical ingress at a time; enabling application processing and disabling legacy processing for an account is one database transition, not two unrelated configuration changes.

Handlers consume only the configured canonical events:

- `payment_link.paid` and `payment_link.partially_paid` use the settlement/exception paths below.
- `payment_link.cancelled` and `payment_link.expired` resolve by signed merchant plus gateway link ID, fetch the link with that merchant's token, cross-check account/reference, and record the matching terminal state. A terminal event never regresses a local `paid` link.
- `refund.processed` and `refund.failed` use the verified refund finalization/import path below.
- authorization and merchant-status events update connection state; subscription events keep the existing AutoPay handler and source semantics.

### 9.1 Durable recovery worker

Add `GET /api/payments/razorpay/recovery/cron`, protected by the existing cron authorization helper. Run it every 15 minutes by adding the endpoint to the repository's existing `ops-crons.yml` workflow during rollout; do not add a second scheduler for the same endpoint. Each invocation claims at most 100 local items or one 25-refund provider page with five-minute database leases and uses the retry schedule defined above.

The worker recovers pending/failed/stale webhook events, `cancel_requested` links, stale `creating`/`orphaned` links, due `created` links selected by `next_reconcile_at`, expired-lease `creating` refunds, `pending`/`orphaned` refunds, disconnect-revocation retries, and due per-merchant refund-reconciliation windows. It also performs the daily due-token refresh scan behind a database timestamp/lease so the 15-minute schedule does not refresh repeatedly. A failure in one item cannot abort the batch. Emit counts and oldest-age metrics for every queue. Next.js `after()` may invoke the same item processor after acknowledgement, but only the claimed database state, provider cursors, and this worker provide durability.

For a due `created` link, fetch it by stored gateway ID. If Razorpay reports `paid`, run the same fetched-payment verification and settlement/exception path as `payment_link.paid`; if `cancelled` or `expired`, record the matching monotonic terminal state; if still `created`, update `last_verified_at` and progressively move `next_reconcile_at` out to at most six hours. A locally expired link is always verified rather than being marked expired from local time alone.

For an expired-lease `creating` refund, lock the refund/payment and acquire a new outbound lease. Fetch the parent payment's complete paginated refund list and match the immutable internal refund ID in `receipt` first and notes second. A verified match uses the normal finalization RPC. If no match exists, retry the original create-refund call with the exact stored idempotency header and exact stored serialized request body; Razorpay idempotency makes both the crash-before-call and accepted-response-lost cases safe. A definitive provider rejection may transition to `failed`; another ambiguous timeout keeps the reservation recoverable with backoff and must never release capacity or create a second refund identity.

For a due merchant refund window, fetch `/v1/refunds` with the frozen `from`, `to`, `count=25`, and stored `skip`. For each refund, first require a local payment with the same account and gateway payment ID. Refunds for unrelated merchant transactions are counted as out-of-scope scan observations and produce no UsefulDesk financial row or owner alert. For a matching local payment, fetch and verify the parent provider payment with bounded concurrency of at most five, finalize matching UsefulDesk reservations by `receipt`/notes, and import every other provider refund through `import_gateway_refund(...)`. Commit the next `skip` only after the entire page succeeds; after a short final page, complete the window and advance the overlap cursor. Webhooks and scans deduplicate on gateway refund ID and share the same finalization/import RPCs.

## 10. Payment Link lifecycle

### 10.1 Create or reuse

`POST /api/payments/razorpay/payment-links`

Input: `invoiceId` and optional delivery intent. The account comes only from authenticated server context.

1. Require `canManagePaymentLinks` and a ready OAuth connection whose merchant state is activated or readiness-verified within the last 24 hours, and is not explicitly blocked.
2. Load the tenant-scoped invoice, `collectible_balance`, and refund-review state.
3. Reject review-held, void, settled/no-charge, non-INR, missing-member, or non-chargeable invoices. Missing WhatsApp contact details disable Send on WhatsApp but do not block creating or copying a link.
4. If a `created` link has the same collectible balance/currency and at least 24 hours of validity remaining, reuse it.
5. If the collectible balance changed, mark the old created link `cancel_requested`; the recovery worker cancels it remotely, and a new revision is allowed only after terminal confirmation.
6. Paid, cancelled, or expired links are terminal. If a later refund reopens the invoice, create a new revision; never attempt to cancel the paid link.
7. Reserve the local `creating` row and stable reference before the remote call.
8. Create a Standard Payment Link for the exact collectible balance in paise, `accept_partial=false`, 7-day expiry, `notify.sms=false`, `notify.email=false`, and `reminder_enable=false` to avoid duplicate messaging.
9. Store invoice/account/link identifiers in bounded notes for cross-checking, never as the sole authorization source.
10. Finalize the local row with gateway ID, complete short URL, and `next_reconcile_at = now() + 15 minutes` so remote payment remains recoverable without a webhook.

Create a transactional `request_invoice_link_cancellation(invoice_id, reason)` database function. It recomputes invoice eligibility and collectible balance, and changes an incompatible `created` link to `cancel_requested` with a reason; it performs no network call. Invoke it from idempotent statement/row triggers covering all balance or eligibility mutations: payments/void state, payment allocations, member-credit allocations, refund status/classification/allocations, invoice adjustments/allocations, invoice-line amount/state/voiding, and invoice void/state changes. The recovery worker performs remote cancellation and records `cancelled`; webhook cancellation/expiry is the independent terminal confirmation.

Late events are monotonic and idempotent: `paid` never becomes cancelled/expired, and a confirmed paid event still enters settlement even if the link was `cancel_requested`. A race where a member pays before cancellation is handled as an exception when it cannot fit the locked collectible balance, never as an overpayment or missing ledger entry. Entering refund review is an eligibility change and immediately requests cancellation of every created link for that invoice.

For stale `creating` or `orphaned` rows, recovery calls Razorpay's Standard Payment Link list endpoint with the exact provider-unique `reference_id`, then cross-checks amount, currency, and UsefulDesk notes. One exact match is adopted and receives the normal active-link `next_reconcile_at`; a confirmed zero-result lookup marks `failed`; any provider-contract violation or mismatched result remains `orphaned` for operator review. An orphan blocks another revision until the remote state is verified terminal. Operator actions retry the exact-reference lookup or cancel a verified link; they never bypass the blocking invariant.

### 10.2 WhatsApp delivery

Use `sendMessageToConversation` through `POST /api/whatsapp/send` with `contact_id` and approved Utility template `gym_payment_link`:

1. Member name
2. Outstanding amount formatted through the account locale
3. Invoice reference
4. Complete Razorpay short URL

The primary UI action creates or reuses the link and sends it in one step. On success, optionally correlate the Meta message ID and send time on the link row; on failure, retain a bounded error and return the short URL. Always keep **Copy link** available. Do not record Copy as a delivery event.

### 10.3 Settlement

On `payment_link.paid`:

1. Resolve the stored link by gateway link ID and signed top-level merchant account.
2. Fetch both the Payment Link and payment using that merchant's OAuth token.
3. Require captured payment status and match merchant, payment ID, link ID, reference, invoice, INR amount in paise, and UsefulDesk notes.
4. Call a service-role-only `record_gateway_invoice_payment` RPC.
5. Inside one transaction, lock invoice, open lines, and link; re-read collectible balance; enforce gateway-payment idempotency; create one immutable `payments` row with `source='payment_link'`, `user_id=null`, no mandate, and trusted purpose `due`; then allocate across eligible open invoice lines using the generic deterministic largest-remainder rules.
6. If any validation or balance invariant prevents safe application, preserve `gateway_payment_exceptions`, mark the link paid, complete the webhook, and alert an operator. Provider-confirmed money must not remain in endless webhook retries.

`payment_link.partially_paid` is always preserved as an exception because UsefulDesk-created links disallow partial payments.

## 11. Refund lifecycle

### 11.1 Request

`POST /api/payments/razorpay/refunds`

Input: UsefulDesk payment ID, disposition, reason, and client idempotency key. The server derives the full remaining refundable amount; the browser does not choose an amount in this release.

1. Require `canRefundGatewayPayments` and a ready OAuth connection whose merchant state is activated or readiness-verified within the last 24 hours, and is not explicitly blocked.
2. Require an original captured Razorpay payment with a gateway payment ID.
3. Call `reserve_gateway_refund(...)`; its transaction locks the payment and refund allocations, rejects any processed refund on the payment without complete line allocations, derives and requires the full remaining refundable amount, rejects zero/currency mismatch/void/provider mismatch or payments older than Razorpay's six-month refund window, and returns an existing row only for an identical idempotent request.
4. Use the returned `creating` refund and copied remaining original allocations as the durable intent before the external call.
5. Build the canonical serialized request body once, persist it with its SHA-256 hash before the provider call, and send Razorpay `X-Refund-Idempotency` with the stable UUID-shaped internal refund ID. In the stored body, set `receipt` to that exact ID and bounded notes containing the UsefulDesk refund ID, payment ID, and invoice ID. Enforce Razorpay's minimum 10-character and `[A-Za-z0-9_-]` format. Every ambiguous retry must reuse the identical header and exact stored bytes after verifying their hash; it must not reconstruct or semantically reserialize the body. Provider reconciliation matches `receipt` first and notes second; it never expects the idempotency header to appear in a fetched refund.
6. Fetch/verify the returned refund as needed and call `finalize_gateway_refund(...)` to persist the gateway ID and `pending | processed | failed` result through an allowed transition.
7. If the response is already processed, use the same verified finalization RPC as the webhook; do not update refund and adjustment rows in separate calls.

### 11.2 Finalization

For `refund.processed` and `refund.failed`:

1. Resolve the local refund by gateway refund ID or stable receipt/idempotency metadata.
2. Fetch the refund and parent payment from Razorpay using the mapped merchant token.
3. Match account, parent payment, amount, currency, and internal reference.
4. `processed`: call `finalize_gateway_refund(...)`; it atomically marks processed, exposes allocations to reconciled views, and creates the equal adjustment when the disposition is `reduce_charge`.
5. `failed`: mark failed with provider reason; balances remain unchanged. A later fresh attempt uses a new idempotency key.
6. Duplicate response/webhook/fetch reconciliation stays a no-op by gateway refund ID.
7. If no local intent exists for a provider-processed **full remaining** refund, call `import_gateway_refund(...)` to import it once as `status='processed'` with a null disposition, copy the remaining original allocations, apply the non-collectible review hold, request active-link cancellation, and require an admin to classify it. Never guess that an external refund cancelled the charge.
8. If Razorpay reports an externally initiated **partial** refund, persist the provider-confirmed refund header and a durable `partial_refund_line_target_required` exception, reduce payment-level net cash reporting, place the whole invoice on non-collectible review hold, and do not fabricate line allocations. It remains blocked until an admin explicitly assigns the full refund amount to original payment lines and chooses the accounting disposition. An unmatched failed refund creates/updates a reconciliation exception only and has no financial effect.

Refunds are irreversible once accepted by Razorpay, so the UI must confirm the derived full amount, member, invoice, original payment, reason, and disposition before submission. Explain that a Razorpay `processed` refund may still take several working days to reach the original payment method and that Razorpay's original transaction fee may not be returned; do not present provider processing as confirmed customer receipt or exact bank-settlement profit.

### 11.3 External refund classification

`POST /api/payments/razorpay/refunds/:refundId/classify` requires same-origin `canRefundGatewayPayments`, reason, and disposition. A processed full Dashboard refund calls `classify_gateway_refund(...)`. A header-only external partial additionally requires explicit `{ invoiceLineId, amount }` allocations that sum exactly to the refund and calls `resolve_gateway_partial_refund(...)`. `reopen_balance` removes the review hold and exposes the attributed accounting balance to dues/reminders; `reduce_charge` creates an equal immutable adjustment before removing the hold. Membership fee-status reconciliation occurs in the same transaction. An identical replay is a no-op; conflicting reclassification is rejected and requires a separately designed corrective accounting workflow.

## 12. UI changes

Follow `docs/ui-patterns.md` and reuse existing master components.

### Settings → Payments

- Replace manual key fields with **Connect Razorpay**.
- Connected state shows merchant account ID suffix, test/live mode, OAuth/merchant readiness, last verified time, and one consolidated **Payments need attention · N** action when review items exist.
- Actions: **Reconnect** and destructive **Disconnect** for admin/owner.
- Manual credential fields and legacy per-gym webhook instructions do not exist; Connect/Reconnect OAuth is the only setup path.
- Keep raw pending-webhook, token-refresh, queue-age, and lease metrics in operator monitoring rather than exposing a diagnostic wall to gym owners.

### Invoice detail

- Agent+: primary **Send payment link** creates or reuses and sends in one step; secondary **Copy link** creates or reuses without requiring WhatsApp delivery.
- Reuse compatible active links and show expiry/status.
- Disable with an explicit reason when connection, account status, invoice state, non-INR currency, refund review, or `isChargeableAmount(collectible_balance)` is ineligible. Missing WhatsApp contact details disable only Send, not Copy.
- Admin/owner payment rows expose **Refund** only for refundable Razorpay payments. They never expose **Void** for a gateway payment; Void remains available only for eligible manual payments.
- Disable **Refund** for every payment that has any processed refund without complete line allocations; explain that the existing review must be line-targeted before another refund can be safely allocated.
- Payment history shows gross payment, refunded amount, net collected, refund status, reason, disposition, and actor without mutating the original payment.
- An unclassified external full refund shows a prominent **Refund review** state with provider amount/date, accounting impact, and an admin-only **Classify refund** action. An external partial refund shows the same hold plus **Line targeting required** and an admin-only **Resolve refund review** action that lists only original payment lines and enforces the exact total/capacity before submission. Record payment, Send/Copy payment link, reminder, and due-follow-up actions remain disabled while either hold exists; the UI must not label the held accounting balance as currently due.

### Finance reporting

- Keep gross invoice value, invoice adjustments, gross collections, processed refunds, and net collections distinct.
- A `reopen_balance` refund increases receivables and returns the member to dues.
- A `reduce_charge` refund lowers net invoice value and does not create a due balance.
- An externally initiated unclassified refund lowers net cash immediately but places the invoice under review and suppresses automated chasing until disposition is chosen.
- CSV exports include gateway payment/refund IDs and disposition.
- Payment Link collections report as `payment_link`, never as AutoPay; recurring mandate collections alone report as `auto`.

## 13. Verification

### OAuth and authorization

- State entropy, hash-only storage, 10-minute expiry, replay rejection, wrong user/account/client/mode/redirect rejection.
- User removed or downgraded between connect and callback.
- Duplicate merchant connection across tenants.
- Tokens encrypted at rest and never returned by API responses/logs.
- Existing manual-key rows migrate explicitly from `secret_storage_version=0` plaintext to version `1` ciphertext: the dual reader preserves the legacy webhook/API path during the rollout, new writes are encrypted, the idempotent backfill leaves no version-0 or decrypt-failure rows, and `provider_mode` is operator-verified rather than inferred.
- Manual fallback cannot bypass revoked/blocked OAuth.
- Missing/invalid `RAZORPAY_MODE`, stored-mode mismatch, a test webhook reaching the live deployment, and any attempt to search both modes fail closed.
- The development OAuth/webhook deployment is backed by an isolated test database and cannot resolve production connections.
- Viewer/agent/admin/owner route and UI capability coverage.

### Token refresh

- Proactive refresh, on-demand refresh, one retry on authenticated 401.
- Two and ten concurrent callers produce one provider refresh; run higher-volume load testing outside the core acceptance suite.
- Stale lease recovery.
- Crash before provider response, after provider response/before DB commit, and after DB commit.
- Provider calls abort before the two-minute lease; a timed-out or crashed refresh cannot overlap a second provider refresh under an expired lease.
- After a refresh timeout/failure, a newly committed higher generation wins; unchanged outcome-unknown generation becomes Reconnect without retrying the possibly consumed old token.
- Old refresh token invalidation transitions unrecoverable cases to Reconnect.

### Application webhook

- Current and previous secret verification over raw body.
- Header-based event identity remains identical across legacy/application delivery and current/previous webhook secrets; when the header is absent, both ingresses derive the same mode/account/raw-body hash fallback, record its source, and alert instead of using the signature.
- Invalid signature causes no DB write.
- Unknown external account handling.
- Event replay, concurrent delivery, stale lease, handler failure, and recovery cron.
- Durable acknowledgement within five seconds.
- Same gateway payment described by multiple events still creates one ledger row.
- With application ingress active, signed unknown-account events deduplicate in service-only `webhook_events` rows with `account_id = NULL` and alert once; in shadow mode they deduplicate only as delivery observations and cannot create canonical state.
- Existing Meta leadgen claims retain `gateway='meta'`, cannot collide with Razorpay event IDs, and preserve their delete-on-handler-failure retry behavior.
- Legacy and application delivery observations coexist for the same provider event without colliding with or completing each other's canonical financial claim.
- In application-shadow mode, a valid event writes only an observation: no `webhook_events` mutation, handler call, `after()` processing, payment, mandate, refund, or exception write.
- The per-account canonical-ingress transition is atomic: before it, only legacy may claim; after it, only application may claim. Reordered dual deliveries still produce one canonical handler run.
- Cancelled/expired terminal handlers fetch and cross-check the remote link and never regress `paid`.
- Fifteen-minute recovery claims bounded batches, isolates item failures, honors leases/backoff, and publishes oldest-age metrics.

### Payment Links

- Generic membership-only and mixed membership/service/merchandise invoices.
- INR-only exact chargeable balance, paise conversion, and 7-day expiry.
- Sub-₹0.50/display-zero residue is rejected through `isChargeableAmount`.
- Concurrent create calls produce one remote link intent.
- Remote success/local failure recovery by stable reference.
- Compatible active-link reuse.
- Balance change cancellation and replacement.
- Paid link plus processed refund creates a new revision, not cancellation.
- Manual-payment/cancellation race parks provider-confirmed overpayment as an exception.
- WhatsApp success, failure, retry, and Copy-link fallback.
- `payment_link.paid` fetch verification and exactly one payment/allocation set.
- Settlement writes `source='payment_link'`, never `auto`, and a mixed invoice uses generic paise-exact allocation while AutoPay remains membership-line-only.
- Unexpected `payment_link.partially_paid` exception path.
- Every payment, allocation, credit, refund/classification, adjustment, line edit/void, and invoice-void path requests cancellation when amount or eligibility changes.
- Cancellation/expiry webhooks and recovery converge `cancel_requested`, while late paid events remain monotonic and settle-or-except exactly once.
- Exact-reference orphan lookup adopts one matching remote link, fails on confirmed absence, and blocks on mismatch until verified terminal.
- A paid event omitted for longer than Razorpay's webhook retry window is recovered by the due-`created` link sweep and produces exactly the same payment or exception as the webhook path.
- Active-link verification backs off from 15 minutes to at most six hours, verifies locally expired links remotely, and never marks a link terminal from local time alone.
- Importing an external refund immediately places the invoice on hold and requests cancellation of its active link.

### Refunds

- Full remaining-payment refund, already-refunded, and zero-remaining cases.
- Razorpay idempotency header and identical-body retry.
- Idempotency keys satisfy Razorpay's length and character constraints.
- Concurrent refund requests cannot exceed unrefunded captured amount.
- Capacity and allocation checks execute inside the locked reservation/import RPC; separate client calls cannot race them.
- Pending does not affect balances; processed does; failed does not.
- `reopen_balance` returns the correct invoice lines to due state and reminder queues.
- `reduce_charge` creates equal adjustment and leaves no artificial due.
- Full refund allocations exactly copy every original payment allocation's remaining amount.
- The outbound request persists the same stable UUID in `X-Refund-Idempotency`, body `receipt`, and bounded identifying notes; a lost response is recovered from provider data without relying on the request header being returned.
- An expired `creating` lease fetches and matches the complete provider refund list before retrying; a no-match retry reuses the verified exact stored request bytes and idempotency header, while another ambiguous result retains capacity and remains recoverable.
- Duplicate response/webhook/reconciliation finalizes once.
- Refund initiated directly in the Razorpay Dashboard is imported once, suppresses reminders, and requires classification.
- An externally initiated partial refund is never proportionally fabricated: it reduces payment-level net cash, holds the invoice, and remains an explicit `partial_refund_line_target_required` exception until an admin supplies exact line targets.
- After any header-only processed refund, later local refund requests and ordinary classification fail closed; later external refunds remain header-only. The explicit resolver must validate the complete selected refund against original payment capacity and cannot infer line attribution.
- Exact partial-refund resolution is admin-only and atomic: wrong totals, duplicate lines, excess line capacity, unrelated lines, stale/resolved exceptions, and conflicting repeats fail; an identical repeat is a no-op.
- The hourly provider refund cursor scans a 48-hour overlap, paginates past 100 results, resumes a crashed fixed window/offset, deduplicates webhook discoveries, and never advances past a failed page.
- The initial cursor drains history from the earliest local gateway payment before refund features enable; provider refunds for unrelated merchant payments advance the scan safely without creating UsefulDesk financial rows or owner alerts.
- Dashboard refund reason may be absent only while unclassified; classification requires actor, reason, and disposition and cannot be changed in place later.
- Review hold propagates through invoice views, membership dues/fee status, action lists, manual collection, Payment Links, installment cron, Finance, and exports; no member chase occurs before classification.
- `reduce_charge` creates one separate immutable invoice adjustment in the same finalization/classification transaction; `reopen_balance` creates none.
- Original payment remains immutable.

### Regression

- Existing AutoPay mandate setup and hardened `subscription.charged` flow continue through OAuth Bearer auth.
- Meta lead-capture claim, retry, and dedupe behavior remains unchanged while sharing `webhook_events`.
- AutoPay remains `source='auto'` and membership-line-only; Payment Links are not counted or labelled as AutoPay.
- Database and route guards reject Void for gateway/automatic payments while eligible manual-payment voiding remains unchanged.
- Manual payment, checkout, member credit, invoice views, fee status, finance summaries, and exports remain correct.
- RLS/grants/advisors verify all new tables, views, and functions.

## 14. Rollout

### Stage 0A — initial provider acceptance

- **Complete (2026-08-08):** Technology Partner account activation and partner onboarding.
- **Complete (2026-08-08):** isolated Supabase/Vercel acceptance environment, disabled rollout flags, test-only webhook secret, and `RAZORPAY_MODE=test` fail-closed observation endpoint.
- **Complete (2026-08-08):** development OAuth `read_write` grant and test-mode token exchange; HTTP 200 Bearer access across Customers, Plans, Subscriptions, Payment Links, and Payments.
- **Complete (2026-08-08):** ₹1 Payment Link create/fetch/cancel and ₹1 weekly plan plus two-cycle Subscription create/fetch/cancel. Real signed cancellation events were acknowledged inside five seconds with no database or financial write.
- **Complete (2026-08-08):** exact 16-event application selector and the production-client configuration path recorded in `docs/razorpay-operations.md`; the documented test limits are 30 Payment Links and 30 Subscription Links per business.
- **Remaining before Stage 2 cutover:** compare the same real event's event id, account id, type, raw-body hash, and timing across legacy per-account and application delivery using the delivery-observation ledger.
- Repeat product activation checks in live mode before Stage 5. Rotate all credentials exposed during acceptance before the first live merchant authorisation; rotation was deliberately deferred for the isolated test environment only.
- Stop initial-release schema work and revise the plan only if an initial-release API, application event, identity contract, or required test-mode product is unavailable.

### Parallel delivery dependency — WhatsApp template

- Submit and approve the Meta Utility template `gym_payment_link` with the four parameters in section 10.2.
- **Verified 2026-08-14:** the apparent 2026-08-12 submissions were synthetic local dry-run rows and never reached Meta. After deleting those exact rows, removing Production dry-run mode, and correcting Meta code `100/2388299` by placing fixed wording after the final parameter, Meta accepted the owner-approved `gym_payment_link` Utility / `en_US` template as numeric ID `1996323644342719`. An authenticated provider sync reports **Pending**. Do not claim or exercise Send until Meta reports **Approved**.
- **Alternative reminder evidence (2026-08-14):** the separately authorized built-in `gym_payment_due` Utility / `en_US` starter was genuinely accepted by Meta as numeric ID `1528972491789269`; the same authenticated sync reports **Pending**. It asks the member to reply for a link, contains no URL, and does not satisfy or replace the four-parameter Payment Link Send contract. The already-approved provider template `payment_reminder` was deliberately not used because it claims an automatic scheduled payment and possible fees.
- Missing approval disables **Send payment link** only. **Copy link**, OAuth, Payment Link creation, and settlement may proceed through their own acceptance gates.

### Stage 1 — schema and OAuth behind flags

- **Implemented in code (2026-08-09):** idempotent mode-scoped schema, encrypted OAuth/manual secret storage, bound state + S256 PKCE, account/user/client/mode/redirect validation, merchant readiness, server-only connect/callback/refresh/revoke routes, database-leased refresh rotation, fail-closed OAuth Bearer resolution, explicit manual rollback, and the owner/admin settings flow.
- **Complete in the isolated test project (2026-08-09):** applied both migrations through the approved Supabase migration tool and verified schema, explicit grants, RLS, function execution grants, foreign-key indexes, and advisors. The test project contained zero configured manual/version-0/OAuth rows; no credential or merchant data was touched.
- **Operational acceptance complete in the isolated test project (2026-08-09):** the permitted inventory was rechecked as zero manual/version-0 rows; a synthetic internal owner completed a real development-client authorization with `code_challenge_method=S256`, and the successful callback code exchange proves the provider accepted the bound `code_verifier`. Imported-account readiness fell back from the provider's HTTP 400 Accounts response to HTTP 200 Customers, Plans, Subscriptions, Payment Links, and Payments probes. A forced refresh returned 200 and advanced `refresh_generation` to 1; disconnect then revoked/scrubbed both encrypted tokens and the merchant id. No real member, live merchant, or money was used. Both rollout flags were restored false on deployment `dpl_CVUuVk1hHcZ2Gzu2czZ4W2mkE3YQ`.
- **Still required outside the isolated scope:** deploy the version-aware manual-secret reader and encrypted-write path before running `npm run backfill:razorpay-secrets -- --inventory <reviewed-account-mode.json>` against any environment that actually contains configured merchants. Dry-run first; `--apply` additionally requires `RAZORPAY_SECRET_BACKFILL_CONFIRM=reviewed`. Provider mode is operator-reviewed and never inferred. Verify zero remaining plaintext/version-0 rows and the legacy API/webhook checks before enabling OAuth by default.
- Keep current webhook and manual-key flow operational.
- Keep `RAZORPAY_OAUTH_ENABLED=false` and `RAZORPAY_MANUAL_ROLLBACK_ENABLED=false` by default. Enabling OAuth does not enable manual rollback, and revoked/blocked OAuth never silently uses stored manual credentials.

### Stage 2 — application webhook and AutoPay parity

- **Implemented and accepted in the isolated Test stack (2026-08-09):** migrations `20260809110000_razorpay_webhook_recovery_and_token_scan.sql` and `20260809111000_index_webhook_events_account_id.sql` add immutable canonical identity checks, owner-bound five-minute leases, a 100-item `SKIP LOCKED` recovery claim, documented retry backoff, and a once-daily OAuth scan layered over the existing two-minute refresh generation/CAS lease. All six new RPCs are `SECURITY INVOKER`, browser roles have no execute privilege, service role alone can execute, the FK follow-up cleared the only new advisor notice, and advisors report zero errors.
- **Recovery acceptance complete (2026-08-09):** deployment `dpl_HAFtXdLJY22nLt2PojMFP9ACputY` is READY on the public Test alias with both rollout flags false. A temporary OAuth-enabled exercise authenticated through the new cron route, claimed one ready Test connection, correctly skipped provider rotation because its access token expires outside the seven-day window, advanced the next scan by one day, and returned zero failures. Database verification retained `refresh_generation=1`, no scan/refresh lease, zero unresolved Razorpay events, the existing single accepted AutoPay payment, zero charge exceptions, and `canonical_webhook_ingress=legacy_account`.
- **Implemented and applied in the isolated test project (2026-08-09):** migration `20260809100000_razorpay_webhook_delivery_observations.sql` adds the service-only observation ledger and parity view. RLS is enabled, `anon`/`authenticated` have no access, service role has only `SELECT, INSERT`, the shadow/no-mutation check is enforced, and advisors introduced no error finding.
- **Implemented in code (2026-08-09):** the legacy route records `legacy_account` observations before consulting the selector, uses the shared canonical processor only while selected, and stays signature-verifying/observation-only after application cutover. Header event ids and mode/merchant/raw-body fallback hashes are shared across ingresses.
- **Implemented in code (2026-08-09):** the application route verifies the current or previous application secret, resolves exactly `(RAZORPAY_MODE, top-level account_id)`, records every signed observation, and may durably claim then schedule the shared processor only when that resolved account's selector is `application`. Unknown or legacy-selected merchants stay observation-only; immutable identity conflict, processed replay, and busy lease states fail safely before any second handler run.
- **Accepted in the isolated Test stack (2026-08-09):** the application/Vercel secret pair was rotated together; the Test merchant's per-account webhook was configured for the seven supported Subscription events; and a narrowly gated operator route encrypted that legacy webhook secret without changing the connection from OAuth mode. One OAuth Bearer-created ₹1 Test Subscription then produced paired `subscription.authenticated`, `subscription.activated`, and `subscription.charged` events. Each pair had identical provider event id, resolved account, type, and payload hash, one delivery per ingress, 0.379–1.016 seconds skew, and `shadow_mutation_attempted=false`. Legacy stayed canonical and both rollout flags were restored false after acceptance.
- **Implemented, applied, and exercised in the isolated Test stack (2026-08-09):** migration `20260809120000_razorpay_application_webhook_cutover.sql` adds a service-only `SECURITY INVOKER` cutover RPC and RLS-on/no-browser-policy audit table. The authenticated same-origin admin/owner route is hidden outside Test acceptance. In one transaction the RPC locks an OAuth-ready, scan-current, lease-free legacy selector; requires exactly three distinct recent authenticated/activated/charged pairs with one row per ingress, identical account/external id/type/hash, header identity, sub-five-second skew, zero shadow mutation, three processed events, one charged ledger result, and zero unresolved events; then updates the selector and inserts one audit row.
- **Cutover evidence (2026-08-09):** READY deployment `dpl_iS9HGYNi5B9dK8J2SBHNPBXMkDzn` served the authenticated gate with both rollout flags false. The isolated selector changed once to `application`. Immediate cancellation of the accepted synthetic Subscription produced one `subscription.cancelled` delivery at each ingress with the same account and hash, 0.180-second skew, application canonical/legacy shadow roles, no observation mutation, one completed canonical attempt, a revoked mandate, one unchanged AutoPay payment, and zero unresolved events or charge exceptions. The mutable synthetic Subscription is now cancelled; its plan and database fixtures remain where Razorpay/database cleanup permits.
- **Implemented and applied (2026-08-09):** migrations `20260809130000_razorpay_provider_retry_acceptance.sql`, `20260809131000_restrict_razorpay_retry_acceptance_grants.sql`, and `20260809132000_audit_razorpay_retry_provider_trigger.sql` add an RLS-on, service-only audit/control table plus `SECURITY INVOKER` RPCs. Browser roles have no table or function access; service role has only `SELECT, INSERT, UPDATE` on the table. The authenticated same-origin admin/owner route is hidden unless provider mode is Test and acceptance mode is enabled. It arms one exact fresh local `subscription.cancelled` target for ten minutes, audits one provider cancellation trigger, returns a deliberate 503 only after valid signature/routing/observation and before canonical persistence, and permits only an identical header event ID/raw-body hash retry to reach the existing canonical claim path.
- **Genuine provider-retry acceptance (2026-08-09):** temporary OAuth-enabled READY deployment `dpl_A5rS1nFHFVKdFFNUhMe2Cfur83wv` created a fresh ₹1 Test mandate and armed its exact Subscription. The audited cancellation produced signed application event `TNfmPtAekGkLfO`; the first delivery recorded SHA-256 `524452d60dbed7f061f5c4f933980f7bf4e091d5b525194851994aa4179512e8` and received 503. Razorpay retried 1.55 seconds later with the same event ID, raw hash, and current-secret signature generation. The retry received 200 with claim result `claimed`; one canonical row completed at `attempt_count=1`, the mandate became revoked/manual once, no payment row was created for it, one application observation and one legacy shadow-only/no-mutation observation remained, and unresolved events plus charge exceptions were zero. The normal recovery queue was clean after acknowledgement. READY deployment `dpl_SWV4baDBnuRUeZAMERLMMiDn4RKB` then restored `RAZORPAY_OAUTH_ENABLED=false`; manual rollback remained false throughout. This is genuine provider-originated duplicate-delivery evidence and does not depend on reserializing a body, manufacturing a signature, or support replay.
- Cut over additional accounts only after reordered dual-delivery, replay, missing-event recovery, and exception monitoring are clean. Do not remove the legacy endpoint until the observation audit window has passed.
- **Stage 2 accepted for the isolated Test account only (2026-08-09):** exact parity, application-canonical cutover, post-cutover shadow evidence, durable recovery/acknowledgement, and genuine Razorpay retry evidence are complete. Ticket `20297340` remains pending as supplemental successful-event replay evidence but is no longer an acceptance gate. Do not cut over another account, remove the legacy endpoint, enable production, or advance to Stage 3 under this acceptance. Every credential visible during acceptance—including development and production OAuth client secrets—must rotate before any live merchant authorises.

### Stage 3 — Payment Links

- **Implemented, applied, and accepted for the single isolated Test account (2026-08-09):** migrations `20260809140612_razorpay_payment_links.sql`, `20260809150500_payment_link_settlement_invalidation.sql`, and `20260809153500_index_payment_link_foreign_keys.sql` add the durable lifecycle, one-blocking-link/revision rules, service-only exception and settlement boundaries, deterministic allocation, cancellation invalidation, recovery leases, gateway-payment void protection, and complete FK indexing. The API/UI adds the named `canManagePaymentLinks` capability, Copy/Send actions, and readiness counts without changing shared UI masters.
- **Provider evidence:** a ₹1.00 mixed service/merchandise invoice created link `plink_TNhvWMuBAVA4aF`; a genuine signed `payment_link.paid` event created exactly one `source='payment_link'` payment and ₹0.40/₹0.60 allocations. Repeating Copy reused the same link, and replaying the verified settlement RPC returned the same payment as `duplicate` without financial mutation.
- **Revision and dual-ingress evidence:** a ₹1.00 service-adjustment link entered `cancel_requested` when its line changed to ₹1.01, then genuine event `TNiizRkBY0dLpo` marked it cancelled. Revision 2 created a new unique ₹1.01 link and genuine event `TNilK8pGmgYG0W` settled one ₹1.01 allocation. Both events arrived once at each ingress with identical raw hashes; application was canonical, legacy was shadow-only/no-mutation, with 1.038-second and 0.432-second skew respectively. The paid replacement retained `cancel_reason=NULL`, proving settlement's own allocation no longer invalidates its link.
- **Final isolated state:** three terminal Test links (two paid, one cancelled), two immutable Payment Link payments, zero active/failed links or leases, zero unresolved Razorpay events, zero payment/charge exceptions, and no `payment.captured` canonical event in the exercise. The merchant legacy selector now includes all four Payment Link events in addition to its seven Subscription events. Advisors report no errors; new FK indexes are expected to be unused until exception/operator lookups occur.
- **WhatsApp/template status:** `gym_payment_link` is not approved, so the UI correctly disables Send with setup guidance. Copy, provider creation, verified settlement, cancellation, revision, and reconciliation remain available and passed. This is not fabricated Send evidence.
- READY deployment `dpl_AKMLBbZUXfRcMKbfuZ7eoK8VpxPs` restored `RAZORPAY_OAUTH_ENABLED=false`, `RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`, and `RAZORPAY_MODE=test`. Stage 3 acceptance does not authorize another account, production/Live Mode, legacy-endpoint retirement, or Stage 4 refunds.

### Stage 4 — refunds

- Before refund schema/UI implementation, verify the OAuth merchant can create, fetch, list, and refund Payments and record the exact application refund events. A failure here revises Stage 4 without blocking the shipped initial release.
- Enable admin-only after Payment Link settlement is stable.
- Before exposing refund totals or actions for an allowlisted account, initialize and completely drain its historical provider-refund window from 48 hours before the earliest local Razorpay gateway payment. Verify every matching historical refund was imported/finalized and unrelated merchant transactions were skipped without local financial writes.
- Support full remaining-payment refunds only and test both dispositions.
- Detect externally initiated partial refunds, hold the invoice, and expose the blocked exception without fabricating line allocations.
- Validate Finance, invoice, dues, WhatsApp reminder, and CSV behavior.

- **Provider preflight passed before schema/UI work (2026-08-09):** the isolated OAuth Test merchant created, fetched, listed, and fully refunded payment `pay_TNi3WGJgRRCase`. Provider refund `rfnd_TNkCeNk0w0Fj41` emitted genuine signed application event `TNkDHhl9ggNXmp` with raw-body SHA-256 `95be3dcc7d63cdb79af34ab45a2ed82d835d2309c7f7c87d8844ec86cb37aa19`; it processed once. This proves the required Payment/refund API and signed refund-event capabilities for the one Test merchant only.
- **Implemented and applied only in UsefulDesk Razorpay Test:** migrations `20260809165718_razorpay_full_refunds.sql`, `20260809171336_harden_razorpay_full_refunds.sql`, `20260809171510_complete_razorpay_refund_recovery_contract.sql`, `20260809172816_finance_refund_reporting.sql`, `20260809185043_extend_retry_acceptance_to_refunds.sql`, and `20260810034213_resolve_external_partial_refunds.sql` add service-only refund reservation/finalization/import/classification/resolution boundaries, immutable allocations, append-only adjustments, recovery/cursors, exception containment, RLS, and refund-aware reporting. The admin API/UI uses the named `canRefundGatewayPayments` predicate; no shared UI master changed.
- **Historical import gate completed:** the required first window began at `2026-08-07T05:09:39.873369Z`, exactly 48 hours before the earliest local gateway payment. A first attempt failed closed on an invalid UUID receipt lookup; after the parser was corrected, the normal 15-minute backoff retry completed the frozen window at `2026-08-09T18:01:27.567423Z`, with no active cursor/lease, `last_error=NULL`, and zero unrelated-refund financial writes. It imported the preflight full refund and its exact ₹1.00 allocation before refund actions/totals were exercised.
- **Both full-refund dispositions passed with genuine provider facts:** the imported ₹1.00 full refund was classified through the product UI as `reopen_balance`, creating no adjustment and exposing ₹1.00 accounting/collectible balance. A fresh ₹1.01 UsefulDesk Payment Link (`plink_TNlWej827ue5lB`) paid as `pay_TNljNUc8Iw6RJu` through the Test wallet simulator and signed event `TNljakxZuhT8Cv`. The admin then issued full refund `rfnd_TNlm2Bm865srX2` as `reduce_charge`. Acceptance-only fault injection discarded the successful create response; receipt-based search adopted the exact provider refund, and signed application event `TNlmf523ukqmWy` (SHA-256 `ac041a19724bcc917a6f174ddc894fcf7c4252fdaeb8190d01bb539913232940`) finalized one ₹1.01 refund allocation plus one equal ₹1.01 adjustment/allocation. The resulting invoice has gross total/paid ₹1.01, refund ₹1.01, net paid ₹0, adjustment ₹1.01, net total/balances ₹0, and no review hold. Canonical request SHA-256 is `d5cc88a51bf42da4ec73a69d0dca3d1cdb0310eae6661301b660e9ced36572ae`; the UUID is also the provider receipt and idempotency key.
- **External partial containment and explicit closure passed:** Razorpay Dashboard Test Mode created ₹1.00 refund `rfnd_TNlC69tk2RY9yk` against ₹1.01 payment `pay_TNiktFgXrBvGZP`. Signed event `TNlCjoMScyDhIs` first imported an immutable header-only refund, reduced payment-level net cash to ₹0.01, held the invoice non-collectible, disabled unsafe collection actions, and exposed `partial_refund_line_target_required` without inventing a line allocation. Additive migration `20260810034213_resolve_external_partial_refunds.sql` then added the service-only resolver. Through the product UI, the owner explicitly assigned all ₹1.00 to original payment line `64db2ce5-9b92-4c70-8dd4-c9c8fd373eb2`, chose `reduce_charge`, and recorded reason `Stage 4 partial refund line-target acceptance`. One transaction inserted one ₹1.00 immutable refund allocation, classified the provider refund without changing provider identity, created adjustment `47cff14c-3532-4c84-bb6a-aace324090d8` plus one equal allocation, resolved exception `73e6a8b2-70aa-4f56-8827-d732e8e3ec76`, and left invoice `e9d17389-92e0-4eb7-87e6-41b7267f2a9d` with gross total/paid ₹1.01, refund/adjustment ₹1.00, net total/net cash ₹0.01, zero accounting/collectible balance, no review hold, no dues/reminder target, and no active link. Repeating the exact RPC returned `outcome='duplicate'`; no row changed.
- **Reporting and ingress evidence:** the Test UI showed gross/refund/net totals, a Refund review invoice-health bucket, processed/refund-origin details, and both full dispositions. The downloaded August invoice CSV contained gross collected, processed refunds, net collected, adjustments, review flag, gateway payment/refund IDs, and disposition. Payment Link event `TNljakxZuhT8Cv` arrived application-canonical and legacy-shadow with identical hashes. Refund events arrived through the application webhook only, as expected from the merchant legacy webhook's still-unchanged 11-event Subscription/Payment-Link selection; the application selector alone includes `refund.processed` / `refund.failed`.
- **Refund-specific provider retry evidence (2026-08-10):** additive migration `20260809185043_extend_retry_acceptance_to_refunds.sql` extends the existing RLS-on, service-only, Test-only acceptance harness to one exact fresh local refund UUID recovered only from signed `refund.entity.notes.usefuldesk_refund_id`. It cannot be armed with the ambiguity exercise, rejects unsafe account/refund state before provider mutation, records the first valid signature/header-identity delivery before returning 503, and admits only a redelivery with the identical event ID and raw-body hash. A fresh ₹1.03 Payment Link `plink_TNmLBcB5CH4NR9` paid as `pay_TNmNAOYec3Z8Jy`; UsefulDesk then initiated full `reopen_balance` refund `rfnd_TNmPln6l55dKxs` (`97b4d7c0-0312-4f81-bfce-0a02a5ffab94`). Signed application event `TNmQOT5sYfpjpn` first arrived at `2026-08-09T19:04:31.135431Z`, recorded raw-body SHA-256 `894688dc045148c1539f40e7f0ad0e91b20b8ab6ad8facf6e5fef7940884084d`, and received 503. Razorpay retried 1.257 seconds later with the same event ID, hash, current-secret signature generation, and header identity; the retry received 200. One canonical row completed with `attempt_count=1`, `delivery_count=2`, and claim result `claimed`. The refund owns exactly one immutable ₹1.03 allocation, creates no adjustment, and leaves gross total/paid/refund ₹1.03, net paid ₹0, collectible balance ₹1.03, and no review hold. Refund ingress remained application-only as configured and expected.
- **Acceptance status — accepted for the single isolated Test account (2026-08-10):** all canonical Razorpay events are processed; refund-specific provider retry is genuine; no refund is `creating`, `pending`, or `orphaned`; unresolved event, charge, payment, and refund exception counts are all zero. Finance, invoice balances, dues/action eligibility, reminder suppression/re-entry behavior, and the downloaded August CSV were rechecked. The final CSV renders the target's net invoice total and net collected as exact `0.01`, not a binary floating-point artifact. Post-migration Supabase security/performance advisories contain no resolver finding.
- **Restored state:** READY deployment `dpl_4V52iQ6Rjm1MGxCByNDjp5p3pzso` restored `RAZORPAY_OAUTH_ENABLED=false`, `RAZORPAY_MANUAL_ROLLBACK_ENABLED=false`, `RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE=false`, and `RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE=false`; mode remains Test. No other account, production/Live Mode, real money, credential rotation, legacy retirement, or Stage 5 work is authorized.

### Stage 5 — production client

- Configure the production client credentials and HTTPS redirect/webhook on the same Razorpay application.
- Configure Vercel production secrets with `RAZORPAY_MODE=live`; verify the production deployment/database cannot load test-mode connection rows.
- Connect one selected production branch.
- Run one low-value live Payment Link, captured payment, and full refund.
- Observe webhook, token, link, ledger, refund, and exception monitoring before expanding the allowlist.

- **Read-only preflight blocked before configuration (2026-08-10):** production Vercel project `useful-desk` (`prj_kn3FOeuAZkeAyCeA5lbBhsHHECne`) serves `desk.usefulmade.com` from READY deployment `dpl_DQ89zFgKbfJmC66ENPJtxwBL94na`, but its production environment contains zero `RAZORPAY_*` variables. Production Supabase project **UsefulDesk** (`fwqthstqrkrwtaehefks`) is isolated from **UsefulDesk Razorpay Test** and its remote migration history stops at `20260804183451_harden_razorpay_recurring_charges`; none of the Stage 1–4 OAuth, delivery, recovery, Payment Link, or refund migrations are applied.
- **Manual-account inventory:** production has ten active account rows and exactly one configured Razorpay credential row, on INR account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` (`Rajat Kashyap`). The production schema still has only `razorpay_key_id`, `razorpay_key_secret`, and `razorpay_webhook_secret`; all three are populated, but there is no `secret_storage_version`, `provider_mode`, `authentication_mode`, `razorpay_account_id`, OAuth connection state, or selector. Therefore the row is only a candidate: do not infer Test/Live from the key, do not infer that its branch is the pilot, and do not backfill it without the operator-reviewed mapping.
- **Provider capability inventory:** the same UsefulDesk Razorpay application exposes its production OAuth client and the expected `https://desk.usefulmade.com/api/payments/razorpay/oauth/callback`, but reports **No live webhook created**. The dashboard remained in Test mode and exposed only the already accepted isolated Test merchant. No live merchant authorization, live event-selector availability, Payment Links activation, Subscriptions/Recurring activation, Payments/refund capability, or signed live delivery was established.
- **Exact stop gate:** obtain an explicit pilot branch and live merchant selection; confirm whether the legacy row belongs to that merchant and record its reviewed mode; confirm the exact acceptance-exposed credential rotation set and maintenance authority without touching unrelated credentials; then rotate before authorization and only afterward configure the production webhook/secrets and run non-mutating Live capability probes. Before real money, separately name the payer, merchant, amount, and refund disposition. No database, provider, Vercel, credential, flag, webhook, merchant, or financial state changed during this preflight, and Stage 5 is not accepted.
- **Pilot and Live capability continuation (2026-08-10):** the user explicitly selected production account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` (`Rajat Kashyap`). Razorpay Live mode contains exactly one accepted application merchant, activated `acc_TCJwBqanN9LTrK`, with the same name and application, and no prior Live transaction. The Live Dashboard exposes create-capable Payment Links and active Subscriptions surfaces. The unsaved live application-webhook form exposes every required event: the three account events, seven consumed Subscription events, four Payment Link events, and two refund events. It also exposes additional events that UsefulDesk must not select. No webhook draft was saved.
- **Legacy-row classification:** the selected Live merchant's API-key surface shows **Generate Key**, not an existing key. Therefore the production database's old manual credential row cannot be a Live credential; this is provider evidence, not a key-prefix inference. It must not be migrated as `live`, used for rollback, copied into Live configuration, or replaced with a generated manual Live key during this pilot.
- **Superseded rotation gate (2026-08-10):** the owner explicitly accepted the low-but-nonzero temporary risk of using the existing OAuth client secrets because their disclosure was confined to a private Codex browser-tool transcript; they were never committed, published, written to local environment files, or sent to support. At the decision point neither secret had been deployed. The Production secret was later transferred directly into a sensitive Production-only Vercel variable without being written locally; the secrets are **not rotated**. Ticket `20303463` is no longer required; a reply requested cancellation of the callback, closure with no action, and no rotation/regeneration or application change. This decision supersedes the prior provider-assisted rotation prerequisite only; secret-blind handling, single-pilot scope, fail-closed mode isolation, and every real-money acceptance gate remain mandatory.
- **Production foundation applied (2026-08-10):** production deployment `dpl_CJuMiLV5EW5VhYpCogGcK6YS248v` is READY on `desk.usefulmade.com` with `RAZORPAY_MODE=live`, the exact HTTPS redirect and pilot account id, and OAuth/manual/provider/refund acceptance flags all `false`. The Production OAuth client id/existing unrotated secret and a new application-webhook secret are deployed only to Vercel Production, with both secrets marked sensitive. The one Live application webhook uses the exact root URL; re-opening it confirmed the required three account, seven Subscription, four Payment Link, and two refund events with no extras. Invalid-signature ingress now returns 400, proving the secret is loaded. Production Supabase received the Stage 1–4 migrations plus `20260810160000_razorpay_live_application_ingress.sql` through the approved migration connector only. The migration adds a service-only, readiness-gated, audited transaction that can move the pilot's canonical selector from `legacy_account` to `application` only after an exact Live OAuth connection exists, the current application-webhook secret is deployed, and no manual material remains. All new tables have RLS; browser roles cannot write them; the activation RPC is executable only by `service_role`.
- **Legacy containment completed:** the provider-confirmed non-Live key id, key secret, and webhook secret were removed from the exact pilot row without reading or printing their values. The row remains disconnected, version 0, mode-null, manual, and `legacy_account`, with no external merchant or OAuth tokens. The Live callback now refuses to start over any unreviewed legacy secret, is hard-bound by `RAZORPAY_LIVE_PILOT_ACCOUNT_ID`, and activates the application selector only after capability/readiness verification. The root application webhook accepts Live only when the Test provider-acceptance flag is false and accepts Test only when it is true.
- **Exact merchant pin added before authorization:** after Rajat signed in to the correct pilot workspace, the first consent attempt was cancelled before **Authorize** because the callback did not yet independently pin the returned merchant. No grant or selector mutation occurred and OAuth was restored false. The callback now requires `RAZORPAY_LIVE_PILOT_MERCHANT_ID`, compares the exchanged `account_id` to exact merchant `acc_TCJwBqanN9LTrK`, and revokes both returned tokens before failing on any mismatch. The Vercel value is non-secret and Production-only.
- **Live OAuth readiness complete (2026-08-10):** the shortest hardened window authorized the exact Rajat Kashyap pilot. Razorpay returned merchant `acc_TCJwBqanN9LTrK` with `read_write`; all five non-mutating Payments/refunds, Payment Links, plans, and subscriptions probes passed. The connection is `oauth`, `live`, storage version 1, `ready`, free of manual key/webhook material and refresh leases, and has current encrypted access/refresh tokens. Razorpay's imported-account fallback recorded a fresh activation verification while the stored merchant status remains `unknown`. The service-only transaction changed the selector once from `legacy_account` to `application` and wrote one exact immutable Live activation audit. Both OAuth states are consumed and none remains active.
- **Mode-scoped zero-queue evidence:** the production database retained 16 immutable pre-OAuth legacy events whose provider mode and merchant identity are both null; four carry historical failures and five charged rows lack matching ledger entries. They predate the Live pilot and are not evidence for merchant `acc_TCJwBqanN9LTrK`. Migration `20260810162750_scope_razorpay_health_to_provider_identity.sql`, applied through the approved connector, adds mode/merchant identity to the service-only missing-ledger view, retains all legacy rows, and makes the Settings health queries require the exact stored mode and merchant. The exact Live scope now has zero events, failed webhooks, missing-ledger rows, open charge/payment exceptions, orphaned links, links, or refunds. The production UI shows **Connected**, **Readiness verified**, **Live mode**, merchant suffix `N9LTrK`, and no attention alert.
- **Accepted Live payment/refund exercise (2026-08-10):** Rajat Kashyap reconfirmed merchant `acc_TCJwBqanN9LTrK`, paid Mohit's isolated sale invoice `2f8411b6-8fdf-4d5c-81c6-a9fdcad958a7` through ₹1 link `plink_TO8x9EEvAaFTvD`, and selected a full `reopen_balance` refund. Signed header-identity event `TO8zmuGUYRsb5p` (SHA-256 `3ab40cd109aea866670580a6d4bb4df0d3402e2146cde79a799e09f7958a633d`) created payment `pay_TO8zjE5Mshx3y6` and one exact ₹1 line allocation. A real recovery run initialized the fixed historical refund cursor and scanned zero refunds/unrelated rows with no lease or error. Refund `rfnd_TO9JVjXVBBVKQT` then completed through signed event `TO9Lk5YahoU3O9` (SHA-256 `c3a07cf30084c3bf42b174d897761173fbabed0d4e52506d79696d7de49fbc8a`), producing one processed refund and one ₹1 allocation, no adjustment, and a collectible/accounting balance of ₹1. Both events used the current application secret, processed at `attempt_count=1`, and had one genuine application delivery with no legacy delivery; no provider retry was available, so no duplicate was manufactured.
- **Accounting and containment evidence:** Finance shows ₹1 gross, ₹1 refund, ₹0 net, one open invoice, ₹1 outstanding, and zero refund review. The downloaded August invoice CSV contains the exact payment/refund ids, `reopen_balance`, gross/refund/net `1/1/0`, and collectible balance `1`. Mohit's separate ₹2,700 joining invoice, membership due, and reminder row stayed unchanged; the sale refund did not enter membership dues/reminders. `gym_payment_link` remains unapproved and WhatsApp Send was not exercised. The single-use catalog item is archived while its immutable sale/invoice history remains.
- **Production fixes and final state:** checkout exposed an ambiguous composite-row assignment in `perform_member_checkout`; migrations `20260810165912` and `20260810170205` were applied through the approved connector, with the second replacing every broken assignment. The first Live recovery run then exposed an older mode-inference defect by claiming four identity-less pre-OAuth events. Migration `20260810172657_scope_razorpay_recovery_to_provider_identity.sql` requires stored mode and exact credential merchant identity, never fills mode from current credentials, and restores those four rows to unknown mode without deleting or marking them processed. The exact Live merchant now has zero unresolved events, missing-ledger rows, unfinished links/refunds, and payment/refund exceptions. READY deployment `dpl_KoiCtsfbL3SAefMxpUKuUYj7QUyJ` serves `desk.usefulmade.com` with OAuth, manual rollback, provider acceptance, ambiguity acceptance, and retry acceptance false; the local Vercel link is restored to the isolated sandbox. Stage 5 is accepted only for this pilot.
- **Co-branded VBF continuation closed (2026-08-11):** the brief VBF enrollment window is superseded and must not be resumed. Read-only production verification found four expired, unconsumed OAuth state reservations and zero active states, credentials, selector activations, Payment Links, gateway payments, or refunds for account `9c50dcd9-ed4a-427c-a2fc-07d452f0aec7`. No Razorpay merchant was authorized or bound. Production variables are restored to Rajat account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and exact merchant `acc_TCJwBqanN9LTrK`; deployment `dpl_J9UvqQCnTapi33A3zpGaEqCyP7Qx` is READY with OAuth, first-bind enrollment, manual rollback, provider acceptance, refund ambiguity acceptance, and refund-retry acceptance false. The exact Rajat Live scope again reports zero unresolved events, missing-ledger rows, charge/payment/refund exceptions, unfinished links/refunds, or recovery attention. The accepted ₹1 exercise was not repeated, and no real-customer rollout or Stage 6 work is claimed.
- **Current connection readiness restored (2026-08-11):** historical Stage 5 money-path acceptance remained valid, but the mutable Rajat row was `disconnecting` after a failed provider revocation. Migration `20260811172006_reconcile_razorpay_failed_disconnect.sql`, applied through the approved Supabase connector, adds service-role-only invoker RPCs that can claim only the exact stored OAuth/mode/merchant tuple and commit `ready` only with rotated future-dated encrypted tokens plus a fresh provider readiness result; it never admits first binding or writes readiness directly. The first secret-blind refresh returned Razorpay's exact `Token is already revoked` classification, released its lease, and moved the row to `reconnect_required`. Rajat then completed one shortest pinned OAuth consent. The callback returned `acc_TCJwBqanN9LTrK`, `read_write`, current encrypted access/refresh grants, and fresh success across the existing read-only Payments/refunds, Payment Links, plans, and subscriptions probes. Current state is OAuth/Live/storage-v1/ready, merchant status `unknown` with fresh activation verification, application-canonical with the original single selector audit, no manual or legacy webhook material, refresh lease, disconnect timestamp, or error. Active OAuth states, exact Live unresolved events, missing ledger, charge/payment/refund exceptions, unfinished mandates/links/refunds, leases, and reconciliation attention are zero. No Payment Link, payment, refund, VBF action, WhatsApp Send, or Stage 6 work occurred. Deployment `dpl_5GkfJc9Nj21pH5Liy8obPbfXpSuN` is READY on `desk.usefulmade.com` with OAuth, first-bind enrollment, manual rollback, provider acceptance, refund ambiguity acceptance, and refund-retry acceptance false; the existing unrotated application secrets remain under the explicit owner risk acceptance.

### Stage 6 — manual-key retirement

- **Complete 2026-08-12 under explicit owner waiver.** The recorded 14-day hold was a rollback policy, not a technical prerequisite: Production already had zero manual material, both accepted databases had zero manual-mode and zero storage-v0 rows, and the ready OAuth resolver failed closed. The owner chose seamless OAuth-only onboarding over retaining dormant expert-only key entry.
- Before DDL, Production had one OAuth/v1/application-ready row and zero manual key IDs, manual secrets, or legacy webhook secrets; Test had one OAuth/v1/application-ready row and only one dormant legacy webhook secret. Migration `20260811181302_retire_razorpay_manual_keys.sql` erased that Test secret and added OAuth-only, storage-v1-only, application-only, and manual-columns-null checks in both databases. The legacy cutover/activation RPCs were dropped; immutable cutover and delivery evidence was retained.
- Runtime retirement removed the manual connection POST route/UI, manual rollback environment/config, Basic-auth provider branch, plaintext/version-0 reader and backfill script, legacy-secret and per-account webhook routes, and the Test cutover route. OAuth recovery, named capability gates, application ingress, exact mode/merchant binding, strict Test/Live database isolation, and VBF exclusion remain intact.
- Production deployment `dpl_9ZTDDvDN88gNm6CZ4qswhW47Ata1` is READY on `desk.usefulmade.com`, and isolated Test deployment `dpl_AAJxU93wfh5dva7nhR4wRdimHymQ` is READY on `usefuldesk-razorpay-test.vercel.app`. Their rollout/acceptance flags are false and the retired manual variable is absent. Production remains exactly one OAuth/Live/ready `read_write` connection on `acc_TCJwBqanN9LTrK`, with zero manual material, active states, leases/errors, unresolved events, missing ledger rows, exceptions, unfinished mandates/links/refunds, or reconciliation attention. Supabase advisor counts were unchanged before/after DDL. No real-money exercise, VBF action, or WhatsApp Send occurred.

## 15. Operational monitoring

Alert on:

- OAuth connections expiring within seven days without successful refresh
- `reconnect_required`, revoked, suspended, rejected, clarification, or review status
- refresh lease older than its allowed window
- webhook pending/processing age and failed attempts
- unknown signed merchant account events
- mode mismatches or any test delivery reaching the live deployment
- shadow application deliveries that attempted a canonical mutation; expected count is always zero
- legacy/application delivery parity gaps before cutover and legacy canonical-claim attempts after cutover
- orphaned Payment Links or refunds
- overdue `created` Payment Link verification and remotely paid links missing local settlement
- captured Payment Link payment exceptions
- processed refund missing local finalization
- overdue merchant refund cursors, failed/stuck provider pages, and refunds for locally known gateway payments that remain absent locally
- payments blocked by unallocated processed refunds
- active link amount different from collectible invoice balance
- WhatsApp template/setup failures

Provide account-scoped diagnostics to admins without exposing raw payload secrets or tokens. Reconciliation remains read-only unless an operator explicitly approves an event-level corrective action.

## 16. Documentation and completion

The feature is complete only when the implementation also updates:

- `docs/gym-domain.md`
- `PRDs/upi_autopay.md`
- `docs/automations-and-cron.md`
- payment/refund operational documentation
- privacy/subprocessor text if the transmitted data set changes
- `docs/changelog.md`
- `PRDs/roadmap.md`

Record the exact Razorpay dashboard event selection and test/live capability activation in the operational runbook.
The current acceptance evidence and rerunnable read-only probe live in `docs/razorpay-operations.md`.

## 17. Deferred

- Selecting and authorizing a real-customer co-branded Razorpay pilot
- Sharing one Razorpay merchant across multiple UsefulDesk branches
- Legal GST invoice/credit-note generation and numbering
- Automatic resolution of captured-payment exceptions
- Partial Payment Links
- UsefulDesk-initiated partial refunds
- Chargeback, dispute, and provider-reversal accounting
- Non-Razorpay gateways

## 18. Acceptance criteria

The release is accepted when:

1. An admin connects a test merchant without entering API keys.
2. AutoPay works through OAuth Bearer authentication.
3. An agent creates and sends one full-balance generic-invoice link.
4. A captured Payment Link payment produces exactly one immutable payment and correct invoice-line allocations.
5. That payment is recorded as `payment_link`, supports mixed-invoice allocation, and cannot enter the AutoPay-only or payment-void paths.
6. Replayed and concurrent events cannot double-credit.
7. Unsafe provider-confirmed money is visible as an exception rather than lost or blindly applied.
8. Full remaining-payment refunds reserve/finalize exactly once through database-locked RPCs and cannot exceed refundable capacity under concurrency.
9. `reopen_balance` and `reduce_charge` produce different, correct invoice and reminder behavior, with the latter creating a separate equal invoice adjustment.
10. An unclassified external full refund reduces net cash but is non-collectible everywhere until an admin records its reason and disposition; an external partial remains a visible blocked exception until an admin explicitly allocates every paise to original payment lines and records the disposition.
11. Every balance/eligibility mutation invalidates incompatible active links, and terminal webhooks plus the recovery worker converge cancellation/orphan states without regressing paid links.
12. Revoked or blocked merchants cannot perform new Razorpay operations.
13. Token refresh races are single-flight and unrecoverable rotation failures visibly require reconnect.
14. Shadow application deliveries cannot touch canonical event state or money, and the atomic ingress switch leaves exactly one endpoint able to claim each account's event.
15. A missed Payment Link webhook is recovered from the provider, and a missed external refund is discovered through the resumable paginated cursor without double-applying either fact.
16. A header-only external partial refund blocks ordinary later allocation/classification on that payment while preserving every later provider refund as a visible header fact; only the atomic admin resolver may add exact line targets and clear the matching exception.
17. Test and live deployments derive mode only from server configuration and isolated databases; cross-mode connections and events fail closed.
18. All tenant, role, RLS, grant, security-advisor, and regression tests pass.
19. One low-value production payment and refund reconcile end to end before broad rollout.

## Official references

- Razorpay OAuth build integration: https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/integration-steps/
- Razorpay application webhooks: https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/subscribe-to-webhooks/
- Razorpay webhook retries and event identity: https://razorpay.com/docs/webhooks/faqs/
- Razorpay account status events: https://razorpay.com/docs/partners/technology-partners/onboard-businesses/status/
- Razorpay Payment Links API: https://razorpay.com/docs/api/payments/payment-links/
- Razorpay fetch-all Payment Links filters: https://razorpay.com/docs/api/payments/payment-links/fetch-all-standard/
- Razorpay Payment Link webhooks: https://razorpay.com/docs/webhooks/payment-links/
- Razorpay refund idempotency: https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/
- Razorpay refund entity and recoverable receipt: https://razorpay.com/docs/api/refunds/entity/
- Razorpay paginated refund listing: https://razorpay.com/docs/api/refunds/fetch-all/
- Supabase Data API explicit grants change: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
