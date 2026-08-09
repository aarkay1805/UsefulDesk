# Gym domain layer

> Read this before touching members, plans, memberships, billing, payments, auto-pay, or attendance.

**A member = a `contacts` row that also has a `memberships` row.** (Leads = contacts that anti-join memberships.) Core tables land in migration `031_gym_memberships.sql`; the model was extended by `057` (billing periods), `058` + `20260711173414` (payments hardening), `059`/`060` (UPI AutoPay), `061` (mid-cycle plan change), `062` (plan types + pricing options), `063` (attendance usage RPC + plan-type lock).

All date math is **account-timezone-first** (`src/lib/memberships/expiry.ts`) — a member must not expire a day early/late. "Expired" is **derived at read time**, never a stored status.

---

## Plans

### `membership_plans` (restructured by `062`, PushPress-style)

| Column                                 | Meaning                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_type`                            | `recurring` = billing cycles + renewal chase + autopay · `non_recurring` = fixed term, pay once, **excluded from renewal reminders/action lists** · `session_pack` = punchcard                |
| `attendance_limit_count` / `_interval` | visit cap (`'period'` \| `'week'` \| `'month'`); NULL = unlimited                                                                                                                             |
| `sessions_count`                       | pack size                                                                                                                                                                                     |
| `is_active`                            | soft-archive (FK RESTRICT)                                                                                                                                                                    |
| ~~`price`~~ / ~~`duration_days`~~      | **LEGACY-FROZEN.** Pricing lives on the child table. The settings UI mirrors the first option into them (for rollback + the autopay day-snap fallback only). **New code must not read them.** |

`plan_type` is **DB-locked once memberships reference the plan** (`063` trigger `lock_live_plan_type`, mirroring the editor's UI lock). Settings-class RLS (admin write).

### `plan_pricing_options` (`062`)

One row per **billing option** a plan sells: `duration_count × duration_unit ('day'|'week'|'month'|'year')`, `price`, one-time `setup_fee`, `is_active`, `sort_order`. One "Gold" plan carries monthly/quarterly/yearly rows.

- **`setup_fee` is no longer editable** — the plan editor sells duration × price only. The column and every consumer stay, so a legacy/backfilled fee still bills and renders, and the editor round-trips it untouched rather than zeroing it.
- **`setup_fee` folds into the FIRST cycle's `fee_amount` only.** Renewals, plan changes, and CSV import bill `price` alone.
- **Durations are calendar-accurate.** TS `addDuration()` (`expiry.ts`, end-of-month clamp: Jan 31 + 1mo = Feb 28) mirrors SQL `date + count * INTERVAL '1 <unit>'`.

### Pure helpers (never inline this math)

- `src/lib/memberships/pricing.ts` — `activeOptions` / `defaultOption` (first active by sort = the no-picker/CSV rule), `optionEndDate`, `firstCycleFee`, `renewalFee`, `durationLabel`, `pricingCadenceLabel`, and `monthlyPriceInsight`. Cadence copy preserves recurring/fixed-term/session-validity semantics. The monthly insight accepts only exact month/year terms, excludes session-pack validity windows, and shows savings only against exactly one active 1-month option on the same plan.
- **`isRenewalChaseable(plan)`** (`pricing.ts`, tested) is the named predicate for "chased for renewal?" — recurring, or a legacy-NULL plan. Used by the cron, the Renewals lists, `canSetupAutoPay`, and the mandate route. **Never inline-compare `plan_type` for this.**
- `src/lib/memberships/attendance-limits.ts` — `membershipUsageWindowStart`, `attendanceUsage`, `sessionsRemaining`, `checkInWarning`, `usageSummary` (the shared usage line both check-in surfaces render).
- `src/lib/memberships/check-in.ts` — Supabase orchestration: `fetchCheckInUsage` (fresh count + warning), `fetchUsageCounts` (batched per-window counts via the `063` `attendance_usage_counts` RPC). **Never inline the count query in a component.**
- `src/lib/memberships/plan-change.ts` — `planChangeQuote` (tested).
- `src/lib/memberships/filters.ts` — `applyMemberFilters` (tested), shared by the members table / select-all-matching / CSV export. **"Expired" is derived**, so its predicate is `status='active' AND end_date < today` — never `.eq('status','expired')`.

### Plan editor UI

`plans-settings.tsx` (list) + `plan-editor-dialog.tsx`. Type = three always-open `RadioGroup` cards at the top, then name, then description. All pricing rows + the add-row button live in ONE bordered container (row = duration count+unit over a `CurrencyInput` price). Visit limit = a `Checkbox` (default OFF = unlimited) revealing count+interval via `Collapse`.

**Copy is per plan type — `PLAN_COPY`.** The same `duration_count × duration_unit` column means a different thing per type, so the labels must too:

| Type          | Section            | Duration label     | Add button         |
| ------------- | ------------------ | ------------------ | ------------------ |
| recurring     | Billing options    | Bill every         | Add billing option |
| non_recurring | Pricing & expiry   | **Expire plan in** | Add another price  |
| session_pack  | Pricing & validity | Valid for          | Add another price  |

The repeater stays on **all three** (PushPress sells several terms under one fixed-term plan too). The visit-limit `period` interval reads "per term" on a fixed-term plan (`limitIntervals(planType)`). Before this, fixed-term shared the recurring branch and told the owner a never-billing plan "bills every 1 month". **Any new type-facing string goes in `PLAN_COPY`** — never a `session_pack ? … : …` split at a call-site.

**Canonical picker: `PlanOptionPicker`** (`components/members/plan-option-picker.tsx`) — plan Select + conditional option Select, labelled per type via `OPTION_LABEL` (Billing option / Term / Pricing), single option auto-selects, trial sentinel + required star + footer slots. Mounted in member-form, renew, change-plan, import-members. (Bulk-convert keeps its DropdownMenu style with an option submenu.)

---

## Memberships

`memberships` — one per member (`UNIQUE(account_id, contact_id)`):

**`member_number`** (account-wide Member ID; DB-assigned from 1001, immutable, never reused, and deliberately not branch-scoped) · `plan_id` · **`pricing_option_id`** (FK RESTRICT, `062`; the renew/edit/change RPCs keep it in sync and validate option↔plan; NULL on legacy/trial rows) · `start_date` · `end_date` (the hot column) · `status` (`active`/`frozen`/`cancelled`; **expired is derived**) · `fee_amount` · `fee_status` (`paid`/`due` — **derived by DB trigger from the ledger, never written by clients**) · `frozen_at` · `collection_mode` (`manual`/`auto`).

**Member ID (`20260721120000`):** uniqueness is `(account_id, member_number)`, and an account is now one operational branch. Two branches in the same organization may both have `1001`; every organization-wide surface must therefore render **Branch + Member ID** (or another unambiguous branch-qualified reference). The private `account_member_number_counters` row serializes every membership insert—including imports and conversions—and is never decremented on deletion. There is no cross-branch portability or automatic member transfer: branch-local contacts and memberships remain the operational sources of truth. Treat Member ID as an identifier, never an authentication secret.

**Multi-branch boundary (`20260728162503`):** organizations group branch accounts, legal entities sit under the organization, and every branch belongs to one legal entity. `account_memberships` is the branch-role source of truth; `profiles.account_id/account_role` is only the compatibility default for old URLs. Plans, members, memberships, invoices, attendance, payments, mandates, credentials, corrections, reconciliation, and jobs remain account/branch-scoped. Consolidated reporting is owner-only and read-only, retains branch/legal-entity attribution, never merges plans by display name, and reports different currencies separately rather than fabricating a converted total. Closing a branch archives it and preserves financial/message history.

Operational RLS (agent write). Renewals mutate in place — the row is the **current-cycle pointer**.

**Single-member creation (`20260721130000`, bonus months `20260729173714`):** `MemberForm` has one canonical split screen for both Add member and Convert to member. Its left rail uses the same click-to-edit personal-information treatment for name, phone, email, Birthday, account-configured Gender, and localized height/weight. A seeded lead persists those edits to the existing contact immediately and supports profile-photo editing; a new member keeps them in the form draft until submit creates or attaches the deduped contact. The right side keeps plan, billing-option expiry, joining offers, and collection decisions together. Either path may apply one fixed-amount or percentage discount to the initial invoice and/or extend the initial service period by a positive whole number of bonus months. The legacy-named `memberships.conversion_list_price` plus `conversion_discount_*` columns retain the price offer; `conversion_standard_end_date` plus `conversion_bonus_months` retain the service offer. The birth trigger copies both snapshots to the initial `membership_periods` row, and `membership_period_invoices` exposes the breakdown. The membership's first `fee_amount` is the discounted net total and its first `end_date` is the bonus-adjusted expiry. The selected `pricing_option_id` never changes: every later renewal starts from that actual expiry and returns to `plan_pricing_options.price` plus the option's normal duration. Quote and validation math lives in `src/lib/memberships/discount.ts` and `src/lib/memberships/bonus-time.ts`; do not reimplement either in a component. Batch import and bulk conversion remain purpose-built batch surfaces rather than imitating a single-person dialog.

**Joining installments (`20260729190000` + generic checkout):** when a single-member creation—Add member or Convert to member—collects the initial invoice, it chooses either full payment or a fixed no-fee 60/40 split. The percentages apply to the full combined membership/products/services invoice. Add member may still leave the invoice unpaid; lead conversion keeps collection required. For a split, the first 60% is collected immediately through the append-only ledger and the remaining 40% stays due on that invoice exactly 28 account-local calendar days later. `perform_join_checkout` creates the member, invoice, payment, allocations, and `membership_installment_plans` promise in one idempotent transaction, while a trigger independently validates the paid amount, split, tenant references, and deadline. The hourly `/api/payment-installments/cron` route sends the approved `gym_installment_reminder` WhatsApp template 7, 3, 1, and 0 days before the deadline, claim-first through `installment_reminders_sent`; it always re-reads the live generic invoice balance and skips settled invoices. Shared UI/date math lives in `src/lib/memberships/installments.ts`.

---

## Products, services, and generic invoices

`catalog_items` is the account-scoped member catalogue: `service` or `merchandise`. Services own one or more `catalog_options` with calendar-accurate `duration_count × duration_unit`; merchandise uses quantity and unit price only. A service option is either fixed-price or trainer-priced. Trainer-priced options have **no fallback**: checkout requires an active `trainer_rates` row for the selected trainer/option pair. `trainers` may optionally link one registered teammate through `linked_user_id`, but trainer identity/title never changes RBAC. The Trainers settings tab lists the full branch team roster; its Trainer switch creates/restores or archives that linked identity, preserving rates and assignment history. Trainers without platform access remain independent identities and expose a permanent-delete action instead of the redundant switch. Deletion cascades through their saved rates; invoice lines and service assignments set the live trainer reference to NULL while retaining name/title snapshots. An unused item may be permanently deleted with its unused options and trainer rates; invoice or member-service references are database-`RESTRICT`ed, so anything with history remains archive-only.

`member_services` records the sold service dates independently from membership dates. Status is derived account-timezone-first (`upcoming` / `active` / `expired`) except explicit `cancelled`; freeze, plan change, membership cancellation, and membership expiry never mutate service dates. `service_trainer_assignments` is dated append-only history. Reassignment retains expiry and prorates only remaining package days; a positive difference issues a separate adjustment invoice and a negative difference offsets service debt before creating member credit.

`invoices` + `invoice_lines` are the generic immutable ledger for membership, service, merchandise, and service adjustments. A single checkout may combine line kinds; a later purchase always creates another invoice. Every `membership_period` links to exactly one membership line. `membership_period_invoices` remains the compatibility view and exposes only membership-line paid/balance semantics, while `invoice_balances` exposes generic total, cash paid, credit applied, and balance. Historical rows snapshot customer, item, trainer, duration, quantity, and price.

`payment_allocations` and `invoice_credit_allocations` are append-only. Manual payments and credits allocate proportionally across open line balances and use deterministic largest-remainder paise rounding so allocations reconcile exactly. An AutoPay charge allocates only to the membership line explicitly identified by its membership period; it never settles services or merchandise on a combined invoice. Member credit is branch/member-specific, non-transferable, non-expiring, and consumed oldest-first by the next manual checkout; AutoPay invoices never consume it.

`POST /api/member-checkouts` is the canonical agent-gated checkout boundary for join, convert, membership renewal, sale, and service renewal. It calls one idempotent transaction; do not reintroduce a fragmented membership/payment sequence. Admin price overrides require a stored reason. The fixed 60/40 promise applies to the full combined invoice. Payment purpose `sale` means a standalone product/service checkout; later collection remains `due`.

Canonical pure helpers live in `src/lib/products-services.ts`. Full product behavior and non-goals are in `PRDs/products_services_and_trainer_pricing.md`.

## Billing periods and membership invoice lines (`057` + generic invoice layer)

`membership_periods` — **one row per billing cycle = one membership invoice line**: `period_start/end`, `fee_amount` snapshot, `state: open|void`, `pricing_option_id`, `UNIQUE(membership_id, period_end)`.

The `memberships` row stays the current-cycle pointer (its start/end/fee mirror the live cycle, so every pre-existing read keeps working); periods accumulate the HISTORY, giving recurring members a real Paid/Unpaid/Upcoming trail + arrears.

**View `membership_period_invoices`** preserves the legacy column contract but now derives `amount_paid` / `balance` from allocations on its linked membership line. Combined service and merchandise lines never change membership dues, plan revenue, or `fee_status`.

**Status is derived in TS**, not SQL — it needs the account's tz "today", so the view stays tz-agnostic. `periodStatus()` in `src/lib/memberships/periods.ts`.

### Lifecycle — who creates/moves a period

| Op                                          | Path                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| membership created (any of 5 paths)         | `AFTER INSERT` trigger `create_initial_membership_period` → **zero TS needed**                                                  |
| renew / convert                             | RPC `renew_membership_transaction`                                                                                              |
| mid-cycle plan swap / upgrade               | RPC `change_membership_plan` (`061`)                                                                                            |
| edit cycle / unfreeze / cancel / reactivate | RPCs `edit_membership_cycle` / `unfreeze_membership` / `set_membership_cancellation` (`058`) — thin TS wrappers in `periods.ts` |
| freeze                                      | the one remaining direct membership write — still chains `.select('id')`                                                        |

A trigger can't tell a renewal from an edit from an unfreeze — hence the RPCs, each ONE transaction. Lifecycle RPCs raise **real errors** (no silent-RLS ambiguity).

**Renew opens a NEW period; the old one stays = arrears.** Settling an old arrears invoice records against **that** period (`RecordPaymentDialog` takes an optional `period` prop) and does **not** touch the membership's live `fee_status`.

### ⚠️ Reconcile-key gotcha (load-bearing)

Payments ↔ periods join **only on `period_end`**. Any op that moves a cycle's `period_end` (an unfreeze pushes it by the frozen days; an edit can shift it) **MUST re-stamp that cycle's existing payments to the new key** — otherwise they orphan and a paid cycle reads Unpaid.

The `058` RPCs do this INSIDE the same transaction. `payments.period_start` / `period_end` / `plan_id` are **protected financial fields**: a direct agent update is rejected by `protect_payment_financial_fields`, so the RPCs (via the tx-local GUC `app.allow_payment_restamp`) are the only re-stamp path besides an admin. A shared "sync period" SQL helper callable by `authenticated` would re-open the forge — **the sync logic is deliberately inlined per-RPC.**

### Upcoming invoice

The single _next_ invoice is **projected in TS** (`projectNextInvoice`) — display-only, it can't be real until it happens. It returns null for a lapsed membership (`end_date <= today`) so an expired member never shows a phantom past-dated "Unpaid" projection. Past + current periods are persisted.

`InvoiceDetailDialog` reads the view's `amount_paid` (not `fee − balance`) so an over-paid cycle's total is honest.

### ⚠️ Display-precision money rule (non-negotiable)

`formatCurrency` renders **0 fraction digits**, so any amount below half a currency unit prints as `₹0`. A mid-cycle plan change routinely leaves such a residue (it re-invoices the truncated cycle at its pro-rated used value — a one-day stub bills ₹0.32). A raw `balance > 0` test therefore put a **"Due" pill on a row reading ₹0 / ₹0 / ₹0**, and the money is unchaseable anyway (the ledger's ≤-balance guard rejects even a ₹1 payment against it).

**Every money judgement goes through `isChargeableAmount(amount)`** (`periods.ts`, `SETTLED_BALANCE_EPSILON = 0.5`). **Never `> 0` / `<= 0` on a fee or balance again.** The same epsilon gates `isCollectiblePeriod`, the Record-payment / Copy-UPI affordances, the member card's "₹x due" chip, the payment-due buckets, and bulk record-payment.

An invoice's **payment axis** is orthogonal to its Current/Past/Upcoming/Void lifecycle: pure `invoicePaymentState()` → `paid | due | no_charge`, rendered by `InvoicePaymentBadge`. **No charge** (neutral) = the cycle billed AND collected nothing (a zero-fee cycle, or a stub whose fee rounds to zero) — neither Paid (no money moved) nor Due (nothing owed). A stub that DID collect money still reads Paid. `periodStatus()` delegates to it.

---

## Payments ledger

`payments` — **append-only**: `amount`, `method` (cash/upi/card/bank/other), `paid_at`, `invoice_id`, protected historical `period_start/end` and `plan_id` snapshots, `screenshot_url/path`, `user_id` (**nullable** — auto-pay rows have no human recorder; render "Auto-pay"), `source` (`manual`|`auto`), immutable `payment_purpose` (`joining`|`renewal`|`sale`|`due`|`other`), `mandate_id`, `gateway_payment_id` (`UNIQUE(account_id, gateway_payment_id)` = retry-safe).

Hardened by `20260711173414` + `058` — the ledger is DB-authoritative and tamper-resistant:

- **`fee_status` is derived by triggers** (`derive_membership_fee_status`, `refresh_…`) — never written by a client.
- Every INSERT is validated by `validate_membership_payment`: real open period, amount > 0, ≤ outstanding balance, agent access.
- Payment purpose is assigned only by trusted database paths: `perform_join_checkout` covers initial combined joining collection; `perform_member_checkout` classifies membership renewal, standalone sale, and service renewal; `record_invoice_payment` is the later/due path; legacy membership and AutoPay RPCs keep their operation/cycle classification. Joining = initial collection, renewal = a payment opening a later membership cycle, sale = the payment issued with a standalone product/service invoice, due = money applied later to an existing invoice, and other = plan-change or genuinely ambiguous history. Never accept a purpose from the browser or rewrite it after insert.
- Idempotent transactional RPCs: `record_joining_payment` · `record_membership_payment` · `renew_membership_transaction` · `void_membership_payment` (admin-only, reasoned; **append-preserving** — status `void` + `voided_at/by/reason`; UI = `VoidPaymentDialog` + `VoidedPaymentBadge` tooltip) · `delete_member` (ledger survives — payment FKs are SET NULL).
- **Receipts live in the PRIVATE `payment-receipts` bucket** — `uploadPrivateAccountMedia`, viewed via signed URL (`PaymentProofLink` re-signs after 4 min). **Never persist a signed URL.** Storage DELETE: agents only for objects unreferenced by a payment row (staged uploads); admins any.
- `membership_periods` DELETE is admin-only.
- Error toasts → `getErrorMessage` (`src/lib/errors.ts`).

**Reconciliation UX:** every payment row shows who recorded it (`payments.user_id` → `useAccountStaff`). `payments-ledger.tsx` has per-method collected totals (voids excluded) + CSV export + a "latest 100" truncation notice. `InvoiceDetailDialog` offers Copy-UPI for an arrears balance. `RecordPaymentDialog` has Full/Half chips + live "remaining after this payment"; both record dialogs cap `paid_on` at today. Bulk record shows a per-member name→balance preview and names failures in the toast.

---

## Mid-cycle plan change (`061`)

Member sheet → Membership `⋯` → **Change plan** (first item; active + non-trial only — trials keep Convert, frozen must resume first).

`ChangePlanDialog`: pick the new plan + switch date (min = day after the current cycle starts), see the credit quote live. Unused **paid** days of the current cycle come back as a credit against the new plan's fee:

```
usedValue = fee × used/total
credit    = max(0, paid − usedValue)
netFee    = max(0, price − credit)
```

(`planChangeQuote`, pure + tested; degenerate inputs quote as fully-used = zero credit. Fee + collect amount follow the quote until touched — the member-form `feeTouched` idiom.)

Commit = RPC `change_membership_plan` — one transaction, `membership_operations` idempotency op `'plan_change'`: truncate the current period at the switch date → re-invoice it at `oldCycleFee = usedValue` → re-stamp its payments under the `058` GUC → open the new plan's period → roll the pointer → optionally record the first collection. A paid cycle then reads as **over-paid by exactly the credit** (honest, via the view's `amount_paid`); an unpaid one keeps arrears for used days only. The old cycle's fee is capped at its original fee (truncation can't inflate it). Period-end collisions raise friendly errors. Switching on/after the old expiry skips truncation (plain succession).

"Edit membership" stays for corrections.

---

## Attendance & limits

- **Session-pack remaining is DERIVED** (`sessions_count` − attendance count since current cycle start, keyed `membership_id`) — **never a stored counter.**
- Limits / exhausted packs are **warn-with-override at check-in** (`AttendanceOverrideDialog`, both check-in paths) — **never a hard block.**
- Both paths (`check-in-view.tsx`, member-sheet `checkIn()`) fresh-count the plan's usage window and open the override dialog at the limit / on an exhausted pack. Usage lines ("9/12 this month" / "7 of 10 sessions left") render in check-in row meta + the sheet's Attendance section.
- The Attendance register has one search field for member name or Member ID. Staff select the matching row and use its existing check-in/check-out action, which keeps the normal limit/override flow and avoids a separate ID-specific action. Member ID remains an identifier, never a self-service PIN.
- **Attendance risk is an action list, not a bare threshold.** Dashboard → Members at risk opens Members → At risk, where `member_activity` separates members whose last visit was 10+ days ago from members who never checked in. Rows show the actual absence/joining context and use the canonical Follow-up flow with reason `inactive`.

---

## UPI AutoPay (`059`, `060`, `20260804233201`) — see `PRDs/upi_autopay.md`

India-first recurring auto-debit, built as an **opt-in layer over the manual ledger**. Gateway = **Razorpay Subscriptions** (it owns the RBI eMandate + 24h pre-debit notice). **Auto and manual collection share ONE ledger**: an auto charge still lands in `payments` and settles a `membership_periods` invoice, so dues/invoices/`fee_status`/reports are mode-agnostic.

Each gym connects its **own** Razorpay account (creds in `account_payment_credentials`, service-role-only, deliberately kept OFF `accounts` and revoked from browser roles) — money flows member → gym's Razorpay → gym's bank. **UsefulDesk never touches it.** Stage 1 prefers a mode-scoped OAuth Bearer connection with encrypted rotating tokens; encrypted manual keys remain an explicit server-controlled rollback only. Stored secret values are never returned to browser JavaScript, and revoked/blocked or mode-mismatched OAuth never falls back to manual credentials.

**Tables:** `payment_mandates` (one blocking setup/live mandate per membership across `creating|pending|active|paused|orphaned`; snapshots the pricing option, recurring amount/currency, cycle duration, original period end, and last applied Razorpay `paid_count`) · `gateway_charge_exceptions` (provider-confirmed money that could not safely enter the ledger; service-role-only, unique by account + gateway payment) · `webhook_events` (idempotency + audit; RLS-on/no-policy = **service-role only**) · `account_payment_credentials`.

**⚠️ The service-role bypass.** A webhook runs as service-role with no `auth.uid()`, so gateway inserts go through SECURITY DEFINER `record_gateway_payment` / `record_gateway_charge`, which set the tx-local GUC `app.system_payment='1'`. `validate_membership_payment` then skips **only the agent check** — every financial guard (open period, amount > 0, ≤ balance) still runs. Same GUC-bypass shape as `058`'s `app.allow_payment_restamp`. All gateway RPCs are revoked from clients and granted to `service_role`.

**Lifecycle RPCs:** `activate_mandate` / `revoke_mandate` (both flip `collection_mode`).

**Code:** `src/lib/payments/razorpay.ts` (server-only REST client, no SDK dep, Basic/Bearer auth, 30-second provider timeout, plus `createPlan`/`createSubscription`/`cancelSubscription`, raw-body HMAC verification, and money/status helpers) · `src/lib/payments/credentials.ts` (account-scoped fail-closed credential resolver and explicit manual rollback) · `src/lib/payments/razorpay-oauth.ts` / `razorpay-refresh.ts` (bound OAuth state, token exchange/revoke/readiness, and database-leased rotation) · `src/lib/payments/razorpay-webhook-processor.ts` / `razorpay-recovery.ts` (shared subscription handler, immutable owner-leased canonical claims, bounded recovery/backoff, and daily token-due scan) · predicates `canManageMandates` (agent+) / `canConfigurePaymentGateway` (admin).

**Routes:**

- `POST /api/payments/razorpay/mandate` (agent-gated) — load membership+plan → reserve a `creating` mandate locally → create the Razorpay plan/subscription with `{account_id, membership_id, contact_id, mandate_id, pricing_option_id}` in `notes` → persist the subscription reference/link as `pending`. Concurrent/repeated setup reuses the pending link or conflicts against the blocking reservation. If the remote subscription exists but pending persistence fails, cancel it immediately; an uncertain creation/cancellation is `orphaned` and blocks retry for operator review. Monthly/quarterly cadences only; derives cadence from the pricing option (month×1/×3, week×4/×12|13, day-range snap for backfilled day-unit options); **rejects non-recurring plans**; mandates authorise `option.price` (not the setup-fee-inflated first `fee_amount`).
- `GET|POST /api/payments/razorpay/connection` — admin-gated browser-safe status and explicit, flag-gated manual rollback writes. GET returns merchant/key suffixes, presence booleans, readiness, mode, and reconciliation counts; POST derives `account_id` from the authenticated server context and never echoes secrets.
- `POST /api/payments/razorpay/oauth/connect`, `GET .../callback`, `POST .../refresh`, and `POST .../disconnect` — admin-gated OAuth lifecycle. Connect binds a hashed one-use state and encrypted S256 verifier to the account, initiator, client fingerprint, provider mode, and exact redirect; callback consumes it before exchange, verifies merchant readiness, and stores only encrypted tokens. Refresh uses a two-minute database lease/generation CAS so rotating refresh tokens have one submitter. Disconnect blocks new operations before attempting provider revocation and remains visibly retryable if the provider result is uncertain.
- `POST /api/payments/razorpay/webhook/[accountId]` — per-gym URL carries the account id → look up THAT gym's secret → verify the **raw body** HMAC → record the durable observation → atomically claim `x-razorpay-event-id` only while that account selects `legacy_account` → route through the shared handler: `subscription.authenticated` → `activate_mandate`; `subscription.charged` → **`record_gateway_charge`** with payment status/currency/invoice plus subscription `paid_count` and current timestamps; `halted`/`pending` → revoke-failed; `cancelled`/`completed`/`expired` → revoke. After application cutover it remains signature-verifying and observation-only. Success stamps `processed`; a completed duplicate stays a 200 no-op; a recorded handler failure retains attempt/error context and returns 500 so Razorpay can redeliver safely. Concurrent attempts are lease-protected.
- `GET /api/payments/razorpay/recovery/cron` — shared-cron-secret protected, every 15 minutes → claims at most 100 pending/failed/stale Razorpay events with five-minute owner leases and fixed backoff, isolates item failures, and leases ready OAuth connections once daily; refresh is attempted only inside the seven-day window through the separate two-minute refresh generation/CAS lease.
- `POST /api/payments/razorpay/webhook` — Test application ingress → verify current/previous raw-body HMAC, resolve exact mode + top-level merchant account, record the durable observation, and enter the same canonical claim/handler only when that UsefulDesk account's selector is `application`; unknown or legacy-selected merchants remain observation-only.
- `POST /api/payments/razorpay/webhook/cutover` — isolated Test-acceptance-only, same-origin admin/owner gate → invoke the service-only transactional parity proof; code or flags alone never change the selector.

**⚠️ Charge identity and exceptions.** Never infer a charged cycle from “latest/current period is paid.” `paid_count=1` addresses the mandate's snapshotted `initial_period_end`; each later count must be exactly one greater than `last_applied_paid_count` and advances from `last_applied_period_end` using the frozen cycle duration. Amount/currency/captured state, subscription/mandate identity, pricing context, target-period state, and membership-line balance must all match. A mismatch—including a manual prepayment that leaves less balance than the captured charge—is committed to `gateway_charge_exceptions` and the webhook completes; money is not moved to another cycle. Operators see open exception/setup counts and the latest charge reason in Settings → Payments & currency. Resolution/replay remains manual and deliberately unimplemented.

**⚠️ Webhook account guard.** The route cross-checks the subscription's `notes.account_id` against the URL's `[accountId]` and fails on mismatch; the immutable payload stays intact while `last_error`, `attempt_count`, `last_attempt_at`, and `processing_status` hold recovery context. Pasting _another_ UsefulDesk account's webhook URL into Razorpay can still produce a valid signature when accounts share a secret, so this guard remains load-bearing. A missing mandate on activate also fails.
**Reconciliation:** `razorpay_missing_payment_ledger` reports `subscription.charged` events whose payment id has no matching ledger row. Settings shows the account-scoped count. This surface is read-only: never replay an event, invoke a gateway RPC, stamp `processed_at`, change a subscription, refund, or otherwise reconcile without explicit user approval and a reviewed event-by-event plan.

**Auto-renew on charge (`060`):** `record_gateway_charge` — the first charge settles the current cycle; every later charge **opens the next period + rolls the membership `start_date`/`end_date` forward + settles it**, all one transaction, idempotent on `gateway_payment_id`. Guards `plan_type='recurring'`, rolls by the option's calendar interval, bills `option.price`, and rolls the pointer's `fee_amount` — **so a custom-negotiated fee resets at auto-renewal.**

**Dunning fallback:** the renewal cron filters `.eq('collection_mode','manual')` — a healthy auto member is skipped (their mandate collects; nagging = double-contact). A member whose mandate DIED is already flipped back to `'manual'` by `revoke_mandate`, so they fall through to the normal WhatsApp reminder. An un-approved `pending` mandate also stays `'manual'`, so it's still chased. The manual "Remind" button is always allowed.

**UI:** the member sheet's **Billing** section header carries "Set up auto-pay" (gated `canSetupAutoPay` = `canManageMandates` + active + non-trial + recurring plan + no blocking mandate) → `SetUpAutoPayDialog` posts to the mandate route and shows the `short_url`. The Billing card body shows active, pending, creating, paused, or reconciliation-review state. Settings → Payments & currency has an admin-gated, INR-only **Connect Razorpay** card showing merchant suffix, test/live mode, OAuth/readiness state, last verification, and one consolidated **Payments need attention · N** action. Manual credential fields and the legacy per-gym webhook URL appear only while the rollback flag is enabled. `InvoiceDetailDialog` shows an "Auto" `Badge` next to a `source='auto'` payment's method.

**Payment Links (`20260809140612`–`20260809153500`):** an agent may create or reuse one active full-collectible-balance INR link from an eligible invoice. The provider contract is exact paise, `accept_partial=false`, seven-day expiry, and a unique durable reference/notes tuple. Invoice or allocation changes request cancellation transactionally; only a terminal old revision permits a replacement. Verified `payment_link.paid` fetches both provider link and payment, then the service-only RPC writes one immutable `source='payment_link'` payment with normal generic-invoice allocations. `payment.captured` never settles the link. Unsafe captured or partial facts become `gateway_payment_exceptions`; provider payments cannot use the manual void RPC. Copy works without WhatsApp, while Send additionally requires a connected number and approved `gym_payment_link` template. Recovery shares the Razorpay cron and owns ambiguous-create adoption, active verification, remote cancellation, and missed-webhook settlement.

**RBI:** ≤₹15k/txn = no per-charge AFA (covers most gym plans); the first charge needs AFA (gateway handles).
**Gotcha:** Razorpay's Subscriptions/Recurring product must be **ACTIVATED** on the account (even in test mode) — `/plans` and `/subscriptions` 401 until then, while basic `/orders` works.

**Still open:** richer `payment.failed` handling (an immediate "auto-pay failed, pay manually" nudge instead of waiting for `subscription.halted`); production/manual-account inventory and backfill; approval of `gym_payment_link` before WhatsApp Send; any additional application-ingress/account rollout or legacy retirement; Stage 4 refunds; all acceptance-credential rotation before live authorisation; embedded onboarding remains optional and later.

---

## RPC gotcha — adding a param

`renew_membership_transaction` / `edit_membership_cycle` / `change_membership_plan` gained a trailing `p_pricing_option_id UUID DEFAULT NULL` in `062`. **Adding a param needs `DROP FUNCTION` by exact old identity first** — `CREATE OR REPLACE` leaves a PostgREST **HTTP 300 overload**. Re-apply GRANTs after.
