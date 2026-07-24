# Finance master section

> Status: **Overview, Invoices, Payments, and Expenses built; Overview expense integration pending** · Product roadmap · Last updated: 2026-07-24
> Reference audit: FitGymSoftware Finance, inspected in-product on 2026-07-23. The reference is used for capability discovery only; its information architecture and visual design are not implementation targets.

## 1. Decision

Build one **Finance** section that gives the owner a calendar-period bird's-eye view without making them assemble the answer across Members, Reports, and spreadsheets:

1. What revenue came in, and how does it compare with the previous period?
2. What was invoiced, paid, partially paid, or left outstanding?
3. Which collection methods are contributing to cash-in?
4. What is likely to renew next month?
5. Once expenses are recorded, what was spent and what profit remains?

The section reuses UsefulDesk's existing ledger and billing domain rather than creating a second finance model. Its default experience is analytical and period-led. Operational collection work—recording payments, chasing dues, sending reminders, and resolving member-level exceptions—remains in **Members → Payments**.

Proposed top-level navigation:

```text
Finance
├── Overview
├── Invoices
├── Payments
└── Expenses
```

Use the shared page header and `variant="line"` tabs. Do not create sidebar children for each tab.

## 2. Product fit

This section passes the UsefulDesk feature filter because it:

- saves the owner time by replacing separate collection pages and spreadsheet reconciliation;
- collects renewals through a due-first queue, UPI, AutoPay recovery, and WhatsApp;
- makes revenue, invoice health, daily inflow, and collection mix understandable in under 30 seconds;
- projects next month's renewal income from active memberships;
- will add a small expense ledger so the owner can see profit without turning UsefulDesk into a full accounting suite;
- keeps operational collection actions close to the member who needs follow-up.

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
- Expense tracking is built, but Overview and owner reports do not yet include expense totals or net cash movement.
- Payment history is capped to a client-loaded latest set instead of a server-paged full ledger.
- AutoPay failures are counted but are not yet a focused recovery workflow.
- There is no stable human-facing invoice number or account-wide invoice export.
- There is no GST-ready immutable tax snapshot or compliant invoice document.

## 5. Information architecture and UX

### 5.1 Overview

Purpose: let the owner understand a selected calendar month's financial position in under 30 seconds.

The page follows the approved mockup hierarchy:

1. one month selector shared by the whole page, with previous/next controls and admin-only CSV export;
2. Revenue, Expenses, Profit, and Next month projected metric cards;
3. Income & expenses cash-flow chart beside invoice health;
4. Collection mix beside recent transactions.

Data rules:

- Revenue is the append-preserving paid-payment total for the selected calendar month and compares with the previous calendar month.
- Cash flow plots day-wise income and can group it by week without changing the selected period.
- Invoice health groups issued periods into Paid, Partially paid, Overdue, Open, and Outstanding.
- Collection mix uses the fixed Cash / UPI / Card / Bank & other method families.
- Next month projected uses active memberships expiring in the next calendar month and the shared next-invoice projection.
- Expenses and Profit remain visibly unavailable until the expense ledger is integrated into Overview. They must never render fabricated zeroes.
- Recent transactions initially contains payment-ledger entries; posted expenses join the same timeline when Overview expense integration ships.

The Overview is analytical, not an exception/action queue. Reports remains the broader business-analysis surface for retention, acquisition, and plan performance.

### 5.2 Payments

Finance Payments is the account-wide analytical money-in ledger. It does not replace the operational queue in **Members → Payments**.

Members retains two existing toolbar views:

- **Payment due** — the default operational queue
- **Recent payments** — the append-preserving cash-in ledger

Built:

- four horizontal summary cards—Collected, Payments, Auto-pay, and Voided—matching the established Invoices layout; Collection mix remains on Overview instead of being repeated here;
- `SearchInput` for name, phone, Member ID, payment reference, or gateway reference;
- calendar-month scope with an account-timezone date-range refinement;
- filters for status, plan, payment method, source, and recorded by;
- All / Collected / Auto-pay / Voided quick views with live counts;
- database-side pagination, sorting, exact filtered totals, and method split through the tenant-guarded `finance_payment_ledger` RPC;
- full-result CSV export using the same RPC/filter contract;
- receipt proof, recorder/source audit, gateway reference, and a member deep link that opens the existing member sheet.

Deliberately retained in Members → Payments:

- `RecordPaymentDialog`;
- due buckets and reminder actions;
- full/half amount shortcuts and balance preview.

The **AutoPay failed** queue remains pending on the Phase B failure-event domain. It belongs under Members → Payments with the member, failure reason, last attempt, and recovery actions; Finance must not fabricate it from raw webhook diagnostics.

Do not add:

- configurable payment modes;
- raw delete;
- editable gateway identifiers;
- a second payment ledger for AutoPay.

Deep-link rules:

- `/members?view=payments` remains the operational destination;
- Reports attention links deep-link to the matching Members payment queue;
- member-level billing and payment actions remain in the member sheet;
- Finance Payments does not gain mutation actions that would duplicate those flows.

### 5.3 Invoices

Purpose: provide an account-wide view of the invoice history that already exists on each membership.

Built:

- the selected calendar month scopes invoices by their issued timestamp;
- four live summaries show invoice count, invoiced value, collected value, and outstanding value;
- search covers the stable internal record reference, name, phone, and Member ID;
- lifecycle chips cover All / Current / Past / Upcoming / Void;
- filters cover payment status, plan, and collection mode;
- every sortable column and the toolbar Sort control share one sort state;
- paging is 25 rows and CSV export contains the complete filtered month, not only the visible page;
- selecting a row opens the existing `InvoiceDetailDialog`;
- a collectible invoice can open `RecordPaymentDialog` against that exact persisted period.

The first release labels the first eight characters of the immutable billing-period UUID as an **internal billing record reference**. It is stable and searchable, but it is not presented as a legal or sequential invoice number. PDF and WhatsApp document actions remain unavailable until an approved migration adds immutable human invoice identity and document snapshots.

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
- Expense type: Recurring or One-time
- Amount
- Optional receipt

Built:

- four summary cards matching the approved mock: Total expenses, Recurring, One-time, and Largest category;
- day/weekly spend trend plus category totals;
- All / Recurring / One-time quick views, search, filters, sorting, server paging, and complete filtered CSV export;
- admin-gated add and void flows with private receipt upload/viewing;
- explicit ledger-backed recurring/one-time classification on every expense;
- posted/void audit status, with void retained in filters and row history rather than promoted as a primary KPI.

Rules:

- account-local date, capped at today;
- amount must be chargeable and positive;
- recurring/one-time is an explicit classification, not an automatic scheduling or accrual engine;
- only posted amounts contribute to the four summary cards, trend, and category totals;
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
| Finance summary                | **Include as period-led Overview**                          | Owners need one comprehensible financial snapshot                      |
| Expense categories             | **Include in Settings**                                     | Needed by the expense ledger                                           |
| Configurable payment modes     | **Do not include**                                          | Existing fixed methods keep reporting and gateway mapping reliable     |
| Tax configuration              | **Defer and simplify**                                      | Do not ship generic tax rules before the invoice model is ready        |
| Gateway transactions           | **Adapt to AutoPay recovery**                               | Owners need failed-charge actions, not raw gateway plumbing            |
| Invoice edit/delete            | **Do not copy**                                             | Billing history must remain auditable                                  |
| Group filtering                | **Do not include now**                                      | UsefulDesk has no group/branch domain; branch scope belongs to Phase 4 |
| Payroll or salary processing   | **Do not include**                                          | A salary expense category is enough; payroll is explicitly deferred    |

## 7. Data and authorization

### 7.1 Expense domain

Built tables:

`expense_categories`

- `id`, `account_id`, `name`, `is_active`, `sort_order`, timestamps;
- unique active name per account;
- admin-managed;
- RLS by `account_id`.

`expenses`

- `id`, `account_id`, `occurred_on`, `amount`, `description`;
- `category_id`, `method`, `expense_kind: recurring | one_time`;
- `receipt_path`;
- `recorded_by`;
- `status: posted | void`;
- `voided_at`, `voided_by`, `void_reason`;
- `idempotency_key`, timestamps.

Built RPCs:

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
- `canExportFinance` — admin+ (**built**);
- `canRecordPayments` — agent+; replaces unrelated capability reuse at payment call sites (**built**);
- `canRecordExpenses` — admin+ for the first release (**built**);
- `canManageExpenseCategories` — admin+ (**built**);
- `canVoidExpenses` — admin+ (**built**).

Buttons should be gated with a reason, not hidden. Viewers remain read-only.

## 8. Phased delivery roadmap

### Phase A — Finance shell and Overview

Goal: create one discoverable financial snapshot without changing financial truth.

Built:

- `/finance`, sidebar item, page title, and URL-backed Overview/Invoices/Payments/Expenses header tabs;
- calendar-month navigation shared by every Overview section;
- Revenue with previous-month comparison and Next month projected from active renewals;
- day/weekly income cash flow, invoice health, collection mix, and recent payment transactions;
- admin-only CSV export with unavailable expense/profit cells left blank;
- honest Expenses and Profit placeholders until a real expense ledger exists;
- analytical Finance Payments with tenant-safe database paging, filtered totals/method mix, full export, receipt audit, and member deep links;
- Members → Payments restored as the operational due/payment home, including its existing server paging, filters, complete CSV export, reminders, payment entry, and realtime behavior.

Remaining Phase A hardening:

- complete the role/timezone/currency/large-ledger acceptance matrix against a connected test account;
- connect posted expense totals, net cash, and recent expense transactions to Overview without duplicating the Expenses ledger.

Exit criteria:

- No payment or due logic is duplicated.
- An owner can understand the selected month's revenue, daily inflow, invoice health, collection mix, and next-month renewal projection from `/finance`.
- No expense or profit figure is shown until it is backed by posted expense records.
- An agent can still record a payment and send a reminder from Members → Payments.
- Existing `/members?view=payments` bookmarks remain valid.

### Phase B — AutoPay recovery

Goal: turn payment failure into an owned action before expanding the finance domain.

- Handle the immediate gateway payment-failure event.
- Store a member-readable failure summary and last-attempt time.
- Add the AutoPay failed queue/filter under Members → Payments.
- Offer manual UPI/record-payment/WhatsApp fallback.
- Retain raw webhook diagnostics for admin/support, not the default owner view.

Exit criteria:

- Every failed charge has member, amount, state, owner, and next action.
- Recovery actions cannot create a duplicate charge or duplicate ledger row.
- A healthy AutoPay member is not chased manually.

### Phase C — Account-wide invoice master

Goal: make the existing billing history searchable and shareable.

Built:

- account-wide calendar-month invoice master over `membership_period_invoices`;
- stable internal record reference plus member/plan/billing-period context;
- reconciled invoice, paid, and balance summaries;
- search, lifecycle chips, payment/plan/collection filters, shared sorting, paging, and complete filtered CSV export;
- reused invoice payment/lifecycle helpers, `MemberIdentity`, `InvoiceDetailDialog`, and period-specific `RecordPaymentDialog`;
- Upcoming is reserved for persisted future periods and remains visually distinct.

Remaining:

- add immutable human invoice numbers for persisted periods through an approved migration path;
- Add a non-tax receipt/invoice document only after immutable business/member snapshots are defined.
- Add WhatsApp sharing through the existing send pipeline.

Exit criteria:

- Every persisted billing period issued in the selected month appears once. (**built**)
- Billed, paid, and balance reconcile exactly with the payment ledger. (**built**)
- Upcoming periods cannot be mistaken for issued/current periods. (**built**)
- Voided and no-charge periods remain visible and correctly labelled. (**built**)
- Shared invoice documents have immutable human identity and snapshots. (**pending**)

### Phase D — Expense ledger

Goal: add minimal money-out tracking and net cash after the collection lifecycle is coherent.

Built:

- migrations, RLS, named capabilities, database-authoritative RPCs, seeded categories, and private receipt storage;
- the Expenses list, filters, classification quick views, approved four-card summary, trends, category analysis, paging, export, add dialog, and void dialog;
- recurring/one-time classification persisted on every ledger entry;
- recorder, receipt, status, and void metadata on every expense row.

Remaining:

- Add Settings management for expense categories.
- Add expense totals and Net cash to Overview and owner-report export.

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

Overview, the account-wide issued-invoice master, the analytical Payments ledger, and the classified Expenses ledger are built. Next, connect posted expense totals to Overview, Profit, the expense cash-flow series, owner-report export, and the combined recent-transactions timeline already reserved in the approved design.

Keep AutoPay recovery under Members → Payments, where staff can act on the member. Only add document sharing or GST behavior after immutable invoice identity and snapshots are proven.
