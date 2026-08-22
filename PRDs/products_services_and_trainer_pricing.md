# Products, services, and trainer-priced personal training

## Decision

UsefulDesk supports a branch-scoped, member-only catalogue alongside membership plans. A manual checkout may issue one immutable invoice containing membership, renewable services, and merchandise; anything sold after issue creates a new invoice. Personal training is a duration-based service whose sellable price is explicit for every trainer and duration—there is no fallback rate.

## Shipped scope

- Settings → **Products & services** manages active/archive catalogue items, calendar-accurate duration options, a trainer directory, and trainer-by-duration rate matrices. The Trainers tab lists every registered branch teammate with a Trainer switch and keeps no-login identities under Independent trainers, using the same avatar/name/context/switch roster UI for both groups. Enabling a teammate creates or restores one linked trainer identity; either group can be activated or archived from new assignments without changing account authorization or historical rates/assignments.
- Add member, Convert, Renew, and member-profile sales use `POST /api/member-checkouts`; the database completes member creation where applicable, invoice issue, lines, service assignment, credit application, payment, allocations, and the optional 60/40 promise in one idempotent transaction.
- `invoices` and `invoice_lines` are immutable financial records. Lines snapshot item, trainer, duration, quantity, and sold price. Existing membership periods and payments are backfilled, while `membership_period_invoices` remains the membership-line compatibility view.
- Payments and credits allocate across current line balances using deterministic proportional largest-remainder allocation at paise precision. Membership dues and `fee_status` use only the membership line; the generic invoice balance uses all active lines.
- `member_services` owns dates independently from membership lifecycle. Status is derived as upcoming/active/expired in the account timezone; cancellation is explicit. Assignment segments preserve trainer/rate history.
- Trainer reassignment retains expiry and prorates the rate difference over remaining package days. A positive delta becomes a due adjustment invoice; a negative delta offsets that service’s outstanding lines and stores any remainder as non-expiring, branch/member-specific credit.
- Members → Renewals has Memberships and Services sources. Service renewals use the current configured trainer rate. Manual and automatic reminders use the exact approved `gym_service_renewal` Marketing contract; `whatsapp_marketing` consent remains audit history but does not gate sending.
- Business → Invoices and member billing reconcile generic invoices; Payments adds immutable purpose `sale`. Revenue category comes from invoice line kind, while payment purpose remains the collection-event axis.
- All Members is a contact-backed customer directory: service-only customers remain searchable and actionable without a fake membership or Member ID, while membership, attendance, renewal, and AutoPay metrics remain membership-only. Standalone sales and service renewals accept the customer contact directly.
- Members CSV/XLSX import supports membership-only, service-only, and combined rows. It resolves only active sellable service facts, preserves explicit historical sold price/expiry/cancelled state through one audited atomic transaction per customer, and uses stable idempotency keys for safe retry. Author-private, revisioned drafts resume across devices from a private source-file bucket and expire after 30 days.

## Authorization and audit

Admin+ manages catalogue, trainers, rates, and price overrides; every override requires a reason. Agent+ sells, renews services, reassigns trainers, and records payments. Viewers are read-only. Named UI predicates mirror account-scoped RLS or database-authoritative RPC checks. Admins may permanently delete an unused catalogue item after confirmation; the database blocks deletion once an invoice or member service references the item or one of its options, keeping referenced records archive-only. Corrections are append-preserving and reasoned.

## Reminder contract

`gym_service_renewal` is a Marketing template with four body parameters: member name, service name, expiry date, and current renewal price. Its exact copy, footer, renewal/unsubscribe buttons, POSITIONAL order, Approved provider state, and latest sync are application contracts. Automation is separately opt-in, sends only after 09:00 account-local time, claims before delivery, retries failed/stale claims, and skips services with a missing current trainer rate or an archived item/option. Consent and opt-out records are retained for audit but do not suppress delivery.

## Explicit non-goals

Payroll or trainer commission, PT session allowances/attendance, stock or fulfilment, walk-in sales, cash refunds, human invoice numbering, PDF/WhatsApp invoices, GST documents, merchandise import, and multiple numbered service-column families in one source row.

## Acceptance invariants

- Issued invoices are never reopened to append later purchases.
- Trainer-priced options are unavailable without an explicit active trainer rate.
- Service dates never move because a membership freezes, changes plan, expires, or is cancelled.
- Credits apply oldest-first only to manual invoices; AutoPay invoices and fixed Razorpay charges do not consume them.
- Paid lines cannot be voided until related payments are voided. Service cancellation alone creates no refund or credit.
- Internal invoice references remain UUIDs and all public tables/views have explicit Data API grants alongside RLS.
