# Finance master section

> Status: **Phase A foundation built; remaining phases proposed** · Product roadmap · Last updated: 2026-07-23  
> Reference audit: FitGymSoftware Finance, inspected in-product on 2026-07-23. The reference is used for capability discovery only; its information architecture and visual design are not implementation targets.

## 1. Decision

Build one **Finance** section that answers four questions without making an owner assemble the answer across Members, Reports, and spreadsheets:

1. What money needs to be collected?
2. What money came in?
3. What was billed?
4. What money went out?

The section should reuse UsefulDesk's existing ledger and billing domain rather than create a second finance model. Its default experience remains an action list: collect dues, resolve failed AutoPay, open an invoice, record a payment, or send a WhatsApp reminder.

Proposed top-level navigation:

```text
Finance
├── Overview
├── Collections
├── Invoices
└── Expenses
```

Use the shared page header and `variant="line"` tabs. Do not create sidebar children for each tab.

## 2. Product fit

This section passes the UsefulDesk feature filter because it:

- saves the owner time by replacing separate collection pages and spreadsheet reconciliation;
- collects renewals through a due-first queue, UPI, AutoPay recovery, and WhatsApp;
- exposes collection exceptions with an owner and an action;
- makes daily cash/UPI/card totals understandable in under 30 seconds;
- adds a small expense ledger so the owner can see net cash movement without turning UsefulDesk into a full accounting suite.

It is not intended to become payroll, bookkeeping, inventory accounting, statutory filing, or a generic ERP.

## 3. FitGym audit

### What FitGym exposes

| Surface               | Observed capability                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All invoices          | Search by invoice/member, transaction-date range, filters for payment mode/tax/staff/group, invoice and collection totals, export, member/membership/amount/staff columns, download/message/WhatsApp/print actions |
| Today invoices        | The invoice table pre-filtered to today                                                                                                                                                                            |
| Daywise collections   | Date range, daily totals, payment-mode split                                                                                                                                                                       |
| Monthwise collections | Month range, monthly totals, payment-mode split, export                                                                                                                                                            |
| Tax invoices          | Tax type, base amount, tax amount, total amount                                                                                                                                                                    |
| Expenses              | Search, date range, add/edit/delete, category, payment mode, staff recorder, amount, bulk selection, export                                                                                                        |
| Finance summary       | Period selector, payments, expenses, profit, and two recent-activity tables                                                                                                                                        |
| Expense categories    | Account-managed category list                                                                                                                                                                                      |
| Payment modes         | Account-managed payment-mode list                                                                                                                                                                                  |
| Tax configuration     | Name, description, percentage, inclusive/exclusive, and tax type (`CGST_SGST`, `IGST`, `VAT`, or none)                                                                                                             |
| Gateway transactions  | Gateway reference, member, order ID, amount, status, timestamp, refresh, and export                                                                                                                                |

### Reference strengths

- Makes invoices, collections, expenses, and gateway activity discoverable from one domain.
- Supports day/month comparison and payment-method reconciliation.
- Records who collected or spent money.
- Treats expense categories and tax configuration as account-owned settings.
- Offers export and printable invoice paths.

### Reference weaknesses to avoid

- “All” and “Today” invoices are separate pages even though today is only a filter.
- Daily and monthly collections are separate pages even though they are two groupings of the same ledger.
- Summary repeats payment and expense tables without leading to exception-specific work.
- The invoice table exposes many icon-only row actions at once.
- Destructive invoice/payment actions appear alongside routine actions.
- Finance configuration is mixed into operational navigation.
- User-defined payment modes fragment reporting and make integrations less predictable.
- Gateway transactions are shown as a raw technical ledger rather than a recovery queue.

## 4. Existing UsefulDesk foundation

UsefulDesk already has the difficult “money in” primitives:

- `payments`: append-preserving payment ledger with manual/auto source, cash/UPI/card/bank/other method, staff recorder, gateway references, proofs, idempotency, and admin-only voiding;
- `membership_periods`: one persisted billing cycle per invoice;
- `membership_period_invoices`: reconciled billed, paid, and balance values;
- `membership_dues`: outstanding balances used by the collection queue;
- `RecordPaymentDialog`, `InvoiceDetailDialog`, `PaymentProofLink`, and payment status wrappers;
- payment-due buckets, plan filters, method chips, sorting, pagination, CSV export, and summary tiles under Members → Payments;
- UPI collection, Razorpay AutoPay mandates, failed-mandate reporting, and webhook audit;
- owner reports with revenue, collection mix, revenue trend, plan performance, and live attention queues.

The master section should move and compose these capabilities. It must not duplicate them under new tables or business rules.

### Current gaps

- Finance is split between Members → Payments, the member sheet, and Reports.
- There is no account-wide invoice list.
- There is no expense ledger or net cash movement.
- Payment history is capped to a client-loaded latest set instead of a server-paged full ledger.
- AutoPay failures are counted but are not yet a focused recovery workflow.
- There is no stable human-facing invoice number or account-wide invoice export.
- There is no GST-ready immutable tax snapshot or compliant invoice document.

## 5. Information architecture and UX

### 5.1 Overview

Purpose: let the owner understand today's money position and act within 30 seconds.

Top row:

- Collected today
- Outstanding
- Expenses this month
- Net cash this month (`collections − expenses`, labelled **Net cash**, not accounting profit)

Action list, ordered by urgency:

1. Failed AutoPay charges
2. Overdue balances
3. Due today
4. Unverified payment proofs, only if a verification state is introduced

Supporting sections:

- Collection mix by Cash / UPI / Card / Bank / Other
- Recent payments and recent expenses, each capped to a small preview with “View all”
- One period control shared by every summary on the page

Do not add decorative charts in the first release. The existing Reports page remains the analytical surface for trends, retention, acquisition, and plan performance.

### 5.2 Collections

This absorbs the current Members → Payments experience.

Two existing toolbar views remain:

- **Payment due** — the default operational queue
- **Recent payments** — the append-preserving cash-in ledger

Add:

- `SearchInput` for name, phone, Member ID, payment reference, or gateway reference;
- account-timezone date range;
- filters for due bucket/status, plan, payment method, source, and recorded by;
- server-side pagination and full-result CSV export;
- totals for the filtered result, including method split;
- an **AutoPay failed** quick filter that leads to the member, failure reason, last attempt, and the actions “Send payment reminder”, “Copy UPI”, and “Open member”.

Keep:

- `MemberIdentity`;
- `RecordPaymentDialog`;
- receipt proof;
- status/source badges;
- `ColumnHeader`;
- search → filters → sort → chips toolbar order;
- full/half amount shortcuts and balance preview.

Do not add:

- configurable payment modes;
- raw delete;
- editable gateway identifiers;
- a second payment ledger for AutoPay.

Backward compatibility:

- `/members?view=payments` should redirect to `/finance?view=collections`;
- report attention links should deep-link to the appropriate Finance quick view;
- member-level billing and payment actions remain in the member sheet.

### 5.3 Invoices

Purpose: provide an account-wide view of the invoice history that already exists on each membership.

Columns:

- Invoice
- Name
- Plan
- Billing period
- Issued on
- Total
- Paid
- Balance
- Payment status
- Actions

Filters:

- search by invoice number, name, phone, or Member ID;
- date range;
- Current / Past / Upcoming / Void lifecycle;
- Paid / Due / No charge payment state;
- plan;
- collection mode.

Row behavior:

- selecting a row opens the existing invoice detail treatment;
- due invoices offer Record payment, Copy UPI, and Send reminder;
- paid invoices offer View payment and View proof;
- PDF/WhatsApp actions appear only after a stable invoice document exists;
- void/correction is admin-only and must remain append-preserving.

Do not build separate “Today invoices” or “Tax invoices” pages. **Today** is a date chip; **Taxed** becomes a filter only if the tax phase ships.

The Upcoming invoice remains visibly labelled as a projection and must never be exported as an issued invoice.

### 5.4 Expenses

Purpose: capture the small set of cash-out entries needed for daily owner control.

List columns:

- Description
- Date
- Category
- Payment method
- Amount
- Recorded by
- Receipt
- Status
- Actions

Add-expense fields:

- Description
- Date
- Category
- Payment method
- Amount
- Optional receipt

Rules:

- account-local date, capped at today;
- amount must be chargeable and positive;
- receipts use private storage and short-lived signed URLs;
- the ledger is append-preserving;
- an incorrect expense is voided with a reason and re-recorded;
- categories are soft-archived, not deleted while referenced;
- CSV export follows the active filters;
- money totals use account currency and tabular numerals.

Seed a concise default category set:

- Rent
- Salaries
- Utilities
- Equipment & maintenance
- Marketing
- Cleaning & supplies
- Bank & gateway charges
- Taxes & licences
- Other

Custom category management belongs in Settings → Payments & currency, not the Finance navigation.

## 6. What to include, adapt, or defer

| FitGym capability              | UsefulDesk decision                                         | Reason                                                                 |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| All invoices                   | **Include, redesigned**                                     | Account-wide invoice discovery is a real gap                           |
| Today invoices page            | **Fold into date chip**                                     | Same data, no new page                                                 |
| Daily/monthly collection pages | **Fold into Overview/Reports period and grouping controls** | Avoid duplicate ledgers and navigation                                 |
| Payment-mode split             | **Include**                                                 | Essential for cash/UPI reconciliation                                  |
| Tax invoices                   | **Defer to GST phase**                                      | Requires immutable tax snapshots and compliance review                 |
| Expenses                       | **Include after the finance shell**                         | Adds daily money-out control with limited scope                        |
| Finance summary                | **Include as actionable Overview**                          | Keep exceptions and actions above passive tables                       |
| Expense categories             | **Include in Settings**                                     | Needed by the expense ledger                                           |
| Configurable payment modes     | **Do not include**                                          | Existing fixed methods keep reporting and gateway mapping reliable     |
| Tax configuration              | **Defer and simplify**                                      | Do not ship generic tax rules before the invoice model is ready        |
| Gateway transactions           | **Adapt to AutoPay recovery**                               | Owners need failed-charge actions, not raw gateway plumbing            |
| Invoice edit/delete            | **Do not copy**                                             | Billing history must remain auditable                                  |
| Group filtering                | **Do not include now**                                      | UsefulDesk has no group/branch domain; branch scope belongs to Phase 4 |
| Payroll or salary processing   | **Do not include**                                          | A salary expense category is enough; payroll is explicitly deferred    |

## 7. Data and authorization

### 7.1 Expense domain

Proposed tables:

`expense_categories`

- `id`, `account_id`, `name`, `is_active`, `sort_order`, timestamps;
- unique active name per account;
- admin-managed;
- RLS by `account_id`.

`expenses`

- `id`, `account_id`, `occurred_on`, `amount`, `description`;
- `category_id`, `method`;
- `receipt_path`;
- `recorded_by`;
- `status: posted | void`;
- `voided_at`, `voided_by`, `void_reason`;
- `idempotency_key`, timestamps.

Proposed RPCs:

- `record_expense`
- `void_expense`

Both must be idempotent and transactional. Direct client deletes are not allowed.

### 7.2 Invoice identity

Before PDF or WhatsApp invoice sharing:

- add an immutable account-scoped human invoice number;
- backfill persisted periods deterministically;
- allocate numbers transactionally and never reuse them;
- snapshot the legal/business identity used on the issued document;
- keep Upcoming projections numberless.

Invoice number format is a later product decision. Do not encode branch or fiscal-year assumptions before the multi-branch and tax phases are designed.

### 7.3 Named capabilities

Add capability predicates in `src/lib/auth/roles.ts`, tests, and matching RLS/RPC guards:

- `canViewFinance` — all account members;
- `canExportFinance` — admin+;
- `canRecordPayments` — agent+; replaces unrelated capability reuse at payment call sites;
- `canRecordExpenses` — admin+ for the first release;
- `canManageExpenseCategories` — admin+;
- `canVoidExpenses` — admin+.

Buttons should be gated with a reason, not hidden. Viewers remain read-only.

## 8. Phased delivery roadmap

### Phase A — Finance shell and collections consolidation

Goal: create one discoverable finance home without changing financial truth.

Built in the foundation:

- `/finance`, sidebar item, page title, and URL-backed Overview/Collections header tabs;
- existing payment summary and operational payment table consolidated under Collections;
- backward-compatible Members payment bookmarks and updated Reports attention links;
- payment-ledger search by member name/phone, account-timezone date range, staff, method, source, and status filters;
- server-side payment pagination and complete filtered CSV export;
- Overview using the existing payment, due, and mandate sources;
- the existing member sheet, record-payment flow, reminder action, and realtime refresh behavior retained without duplicating financial rules.

Remaining Phase A hardening:

- extend ledger search to Member ID, payment ID, and gateway reference;
- add full-query filtered collection totals and method amounts rather than counts alone;
- add focused failed-AutoPay routing with recovery actions as the Phase B bridge;
- complete the role/timezone/currency/large-ledger acceptance matrix against a connected test account.

Exit criteria:

- No payment or due logic is duplicated.
- An owner can see today's collections, total outstanding, and failed AutoPay from `/finance`.
- An agent can record a payment and send a reminder from the due queue.
- Existing `/members?view=payments` bookmarks land on the new surface.

### Phase B — AutoPay recovery

Goal: turn payment failure into an owned action before expanding the finance domain.

- Handle the immediate gateway payment-failure event.
- Store a member-readable failure summary and last-attempt time.
- Add the AutoPay failed queue/filter.
- Offer manual UPI/record-payment/WhatsApp fallback.
- Retain raw webhook diagnostics for admin/support, not the default owner view.

Exit criteria:

- Every failed charge has member, amount, state, owner, and next action.
- Recovery actions cannot create a duplicate charge or duplicate ledger row.
- A healthy AutoPay member is not chased manually.

### Phase C — Account-wide invoice master

Goal: make the existing billing history searchable and shareable.

- Add immutable invoice numbers for persisted periods.
- Add server-paged invoice query and filters.
- Reuse invoice status helpers and `InvoiceDetailDialog`.
- Add full-result CSV export.
- Add a non-tax receipt/invoice document only after immutable business/member snapshots are defined.
- Add WhatsApp sharing through the existing send pipeline.

Exit criteria:

- Every persisted billing period appears once.
- Billed, paid, and balance reconcile exactly with the payment ledger.
- Upcoming projections cannot be mistaken for issued invoices.
- Voided and no-charge periods remain visible and correctly labelled.

### Phase D — Expense ledger

Goal: add minimal money-out tracking and net cash after the collection lifecycle is coherent.

- Add migrations, RLS, named capabilities, RPCs, and private receipt storage.
- Add Expenses list, filters, totals, export, add dialog, and void dialog.
- Add Settings management for expense categories.
- Add expense totals and Net cash to Overview and owner-report export.
- Add audit metadata to every expense row.

Exit criteria:

- Owner/admin can record an expense in under 30 seconds on a phone.
- Filtered expense totals reconcile with the CSV export.
- No posted expense can be silently deleted or rewritten.
- A viewer can inspect but cannot mutate or export finance data.

### Phase E — GST-ready invoicing, optional

Goal: support gyms that genuinely need tax invoices without making tax setup mandatory for everyone.

- Validate requirements with an Indian accountant/legal reviewer before schema lock.
- Add legal entity/GSTIN/place-of-supply settings.
- Decide inclusive/exclusive pricing at the plan/account level.
- Snapshot taxable value, rate, CGST/SGST/IGST split, and legal identity on issuance.
- Add credit/debit-note correction paths; never rewrite an issued invoice.
- Add GST invoice PDF and accounting/Tally export.
- Keep e-invoice integration outside the first GST release.

Exit criteria:

- Historical documents never change when settings or plan prices change.
- Intra-state/inter-state treatment is explicit and tested.
- Totals reconcile across invoice PDF, ledger, exports, and reports.

## 9. UX and engineering invariants

- One page header; all Finance tabs and actions portal into shared header slots.
- Reuse existing `SearchInput`, Filters/Sort pill triggers, `ChipGroup`, `ColumnHeader`, `MemberIdentity`, `DatePicker`, `CurrencyInput`, tables, dialogs, badges, and pagination.
- If mobile Finance requires a new responsive data-list primitive, stop during implementation and agree whether to create a master component; do not ship page-specific cards.
- Search → Filters → Sort → chips → trailing actions.
- No native selects or date inputs.
- All account money/date/time formatting uses `useLocale()` or server-built formatters.
- Every money comparison uses the shared chargeable-amount rule.
- Every rendered money value uses tabular numerals.
- Financial writes are idempotent and database-authoritative.
- RLS, named TypeScript capabilities, and UI gates must agree.
- Payment and expense receipts remain private.
- Destructive financial corrections preserve history and require a reason.
- No raw invoice deletion, payment deletion, or gateway-reference editing.

## 10. Acceptance test matrix

Each phase must cover:

- owner, admin, agent, and viewer permissions;
- tenant isolation;
- account timezone boundaries around midnight/month end;
- non-INR formatting and absence of UPI actions;
- partial payment, overpayment guard, no-charge invoice, voided payment, and deleted-member ledger survival;
- manual and AutoPay collection in one ledger;
- failed and retried idempotent writes;
- CSV totals matching the filtered screen;
- private receipt re-signing;
- phone-width primary flows;
- 1,000+ payment/invoice/expense rows with server pagination;
- backward-compatible deep links.

## 11. Explicit non-goals

- General ledger, chart of accounts, journal entries, or bank reconciliation
- Payroll and staff salary calculation
- Vendor/payables management
- Inventory purchasing
- Custom payment methods
- Member app checkout
- Door/access integration
- Franchise consolidation before the Phase 4 branch model
- Statutory returns filing
- E-invoice integration in the first tax release

## 12. Recommended build order

Start with **Phase A**. It is primarily an information-architecture and query-hardening change over features that already work, so it delivers a coherent Finance section with the least domain risk.

Then close the collection loop with **AutoPay recovery**, followed by the **invoice master**. Add expenses after the revenue workflow is coherent; it unlocks Net cash and daily owner control with a small, understandable model. Only add GST behavior after immutable invoice identity and snapshots are proven.
