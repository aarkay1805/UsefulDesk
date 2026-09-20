# UsefulDesk commercial operations

This is the founder-run procedure for selling and operating the first paid
UsefulDesk pilots. It covers UsefulDesk subscription access only. It does not
charge or refund a gym member, alter a Razorpay mandate, submit a WhatsApp
template, or send a customer message.

The commercial gate is defined in `docs/production-readiness.md`. Do not accept
money for a paid term or activate paid access while that gate is **CLOSED**.

## Offer and quote

The approved founding-customer offer is **Growth at ₹1,499 per month**, exclusive
of applicable GST, for the first 20–30 gyms. It includes a 12-month price lock in
exchange for structured feedback and, only with separate consent, a case study.
Meta, Razorpay, banking, and other third-party usage charges remain direct costs
to the customer. Do not promise unlimited provider usage, an uptime SLA, a
percentage-of-collections fee, or functionality that is still deferred.

The founder may instead quote the current public package from
`docs/pricing-and-packaging-research.md`. Any other discount, term, or scope is an
explicit founder decision; routine discounts above 15% are outside the approved
policy.

For every quote:

1. Create a non-secret commercial reference `PP-YYYYMMDD-###`.
2. Record the organization, package, price, tax treatment, start/end timestamps,
   included onboarding, third-party costs, cancellation terms, and quote expiry
   in the private commercial ledger.
3. State that the product is a founder-led paid pilot and that support response
   targets are best-effort, not a contractual SLA.
4. Use the founder's approved accounting process for the quote, tax invoice, and
   receipt. UsefulDesk gym-member invoices are not SaaS tax invoices.
5. Never place bank details, tax identifiers, customer documents, or full payment
   evidence in Git, GitHub Actions, application audit reasons, or support notes.

## Trial and conversion

The product currently grants one 14-day trial to a new verified organization
owner. The 30-day guided trial in the pricing research is a future commercial
policy, not the deployed entitlement. A trial extension is exceptional and must
have a founder-approved reason in `/platform-admin`.

Seven days before trial expiry, review usage with the decision-maker, confirm the
package and exact paid term, and issue the external quote/invoice. Conversion is
complete only after settled funds are independently visible in the
founder-controlled business bank/UPI account. A payer screenshot, pending bank
entry, or verbal promise is not settlement evidence.

After settlement:

1. Record the commercial reference, amount, currency, rail, provider/bank
   reference, settlement timestamp, verifier, and invoice/receipt reference in
   the private commercial ledger.
2. In `/platform-admin`, choose **Activate manual term** and enter the exact
   future end timestamp in the customer's agreed timezone.
3. Use an audit reason such as `Paid pilot PP-20260920-001; term 2026-09-21 to
2026-10-21; settlement independently verified`. Do not include sensitive
   payment data.
4. Re-open the organization, verify mode, end time, and new version, then confirm
   customer access in a separate authorized session.
5. Send the external receipt and onboarding confirmation. Record the operator,
   timestamp, and outcome in the private ledger.

If the organization is suspended, restore it first and then activate the paid
term. Restore alone does not renew an expired term. No platform-admin action
collects money.

## Renewal

Start renewal seven days before the manual term ends. Confirm the next package,
price, tax treatment, and exact term, then issue the external quote/invoice.
Extend or activate the next manual term only after settlement is independently
verified. If payment is not settled, do not alter the end timestamp; access
expires naturally at the stored instant.

Record every quote, reminder, payment check, access mutation, receipt, and owner
in the private ledger. Never make an unrecorded courtesy extension.

## Cancellation and refund

For cancellation at term end, record the request and simply do not renew. The
manual term expires at its existing timestamp. Use immediate suspension only for
an explicit immediate-cancellation request, abuse/security containment, or a
founder-approved refund decision; it is not the normal end-of-term path.

Refunds are manual commercial operations:

1. The founder records the request, reason, amount, tax impact, and decision.
2. Process an approved refund through the original SaaS payment rail or business
   banking process. Do not use UsefulDesk's gym-member Razorpay refund controls.
3. Verify the provider/bank result independently and issue the required external
   credit note or receipt.
4. Apply the agreed access outcome separately in `/platform-admin`, recording a
   non-sensitive reason and the resulting version.

Suspension and restoration are reversible access controls. They do not refund a
payment, cancel a member mandate, or erase commercial history.

## Support and escalation

Rajat Kashyap is the commercial, support, incident, access, and rollback owner
until another owner is explicitly delegated. During stated working hours, target
an acknowledgement within four hours for ordinary pilot requests and 30 minutes
for a production-blocking issue. Outside working hours, respond on the next
working day unless the issue meets the SEV-1 definition in
`docs/production-runbook.md`. These are operating targets, not customer SLAs.

For an incident, follow `docs/production-runbook.md`. Keep customer communication
factual: impact, workaround, owner, and next update time. Do not promise a repair
time that has not been established. Any data restore, deployment rollback,
provider change, credential rotation, send, refund, or spend requires the
founder's explicit approval.

## Pilot record checklist

Keep one private record per commercial reference with:

- organization and decision-maker;
- approved offer, taxes, term, quote, invoice, and receipt references;
- settlement evidence and independent verifier;
- product-access before/after mode, end timestamp, version, operator, and reason;
- onboarding acceptance, support contacts, renewal date, and next owner action;
- cancellation/refund decision and provider result when applicable.

The application audit is evidence of an access change, not a bookkeeping ledger.
The commercial ledger is evidence of the offer and money movement; neither
substitutes for the other.
