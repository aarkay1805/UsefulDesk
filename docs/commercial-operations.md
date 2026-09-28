# UsefulDesk commercial operations

This is the founder-run procedure for selling and operating the first paid
UsefulDesk pilots. It covers UsefulDesk subscription access only. It does not
charge or refund a gym member, alter a Razorpay mandate, submit a WhatsApp
template, or send a customer message.

The commercial gate is defined in `docs/production-readiness.md`. Do not accept
money for a paid term or activate paid access while that gate is **CLOSED**.
The subscription decision brief is `PRDs/usefuldesk-subscriptions.md`.

The local Test plan-selection and Checkout routes, separate Usefulmade Test
merchant adapter, and private billing migration are engineering drafts. They
are disabled by default and unavailable in Production. The server draft checks
Checkout or webhook signatures and freshly reads captured Test payment state
before an atomic first-term commit, but no SaaS Test credentials are configured
and the SQL is unapplied. None of this opens the commercial gate. Do not use an
intent or a Test payment record as evidence of an accepted customer charge or
a payable quote.

## Offer and quote

The approved provisional monthly software prices for launch/pilot planning are
**Starter ₹799, Growth ₹1,499, Ultimate ₹3,999**, with **₹499 per eligible
additional branch per month**. Growth with its one paid extra branch has ₹1,998
in listed monthly software charges; Ultimate with six branches has ₹4,498. The former Growth ₹1,499 founding-customer
proposal happens to match the newly accepted base price; its founding terms and
12-month lock are not approved. Starter includes one branch with no add-on; a
second branch requires Growth plus its paid add-on or a suitable higher tier.
Growth alone still includes one branch and permits one paid extra branch, for a
maximum of two. Ultimate includes five and may add paid branches. Annual prices,
discounts, add-on billing mechanics, other package contents, and tax treatment
remain open. These prices do not override the closed commercial gate above. A future purchased extra-branch slot becomes usable only after Usefulmade verifies payment and commits the entitlement. Archiving the branch frees capacity but does not automatically cancel or refund that purchase; add-on cancellation, refund, proration, and renewal terms remain undecided. Conversion to a plan with fewer slots than active branches requires the owner to choose which branches to archive or choose enough verified capacity; no branch is archived automatically.

For future automated base-tier changes, an upgrade uses only the difference
between the two monthly software prices, prorated in paise over the actual
remaining current paid period. It takes effect only after Usefulmade verifies
payment and commits the higher organization entitlement. A downgrade or
cancellation is scheduled for the next renewal; current paid access continues
through its stored end. A lower tier needs a verified renewal payment and an
actually resolved active-branch roster at the boundary. These approved timing
rules do not authorize a quote or charge while the commercial gate is closed.

The owner confirmed on 2026-09-27 that Usefulmade is currently not
GST-registered and chose to prepare subscriptions without adding GST. Local
software-amount drafts record ₹0 GST; they are review amounts, not live quotes.
The owner reports Punjab as Usefulmade's operating state, Usefulmade as their
only business, zero current business turnover, and UsefulDesk as the only
intended income-producing product. Confirm the relevant PAN-wide financial-year
turnover, customer geography, possible compulsory-registration circumstances,
and accounting treatment before a paid pilot.
Registration status alone does not settle whether or when Usefulmade may
collect subscription payments. Keep the commercial gate closed, do not call
the service exempt or zero-rated, and do not describe public prices as
GST-inclusive/exclusive until qualified advice establishes the applicable
registration, tax, quote, and receipt treatment.

Meta, Razorpay, banking, and other third-party usage charges remain direct costs
to the customer. Do not promise unlimited provider usage, an uptime SLA, a
percentage-of-collections fee, or functionality that is still deferred.
Starter, Growth, and Ultimate will have no UsefulDesk monthly message-count cap
or UsefulDesk message overage charge at launch. Meta messaging charges apply
separately to each gym; this does not promise free messages or unlimited
delivery capacity. Technical rate limits, abuse controls, and usage monitoring
remain, and Usefulmade's hosting, storage, and support costs still need review.
Starter includes automatic renewal reminders on a standard schedule. Growth
adds custom reminder schedules, bulk campaigns, and configurable automation
rules; Ultimate inherits both tiers' capabilities. Exact standard days and
times are undecided. Starter is not assumed to exclude every automatic send.
All sends still need the gym's connected WhatsApp account and relevant
Approved/synced message template.
Growth and Ultimate are planned to include gym-member Razorpay Payment Links
and AutoPay, subject to each gym's own eligible merchant and mandate readiness.
The gym bears its Razorpay merchant fees under its own terms; Usefulmade's SaaS
merchant remains separate. This does not establish zero Usefulmade operating
cost: support, event processing, storage, and any funded messages remain
unquantified.

The prices and policy examples in `docs/pricing-and-packaging-research.md` are
research candidates, not current public packages. For each pilot, the founder
must approve the exact offer and accounting treatment before a quote is issued.

For every quote:

1. Create a non-secret commercial reference `PP-YYYYMMDD-###`.
2. Record the organization, package, price, tax treatment, start/end timestamps,
   included onboarding, third-party costs, cancellation terms, and quote expiry
   in the private commercial ledger.
3. State that the product is a founder-led paid pilot and that support response
   targets are best-effort, not a contractual SLA.
4. Use the founder's adviser-confirmed accounting process for the quote, SaaS
   invoice or receipt. UsefulDesk gym-member invoices are separate documents.
5. Never place bank details, tax identifiers, customer documents, or full payment
   evidence in Git, GitHub Actions, application audit reasons, or support notes.

## Trial and conversion

The product grants one 14-day full-feature trial to a new verified organization
owner. Signup does not require a tier choice; the approved future conversion flow
asks for Starter, Growth, or Ultimate after expiry. The current expired screen
remains support-only until checkout and tier enforcement ship. The 30-day guided
trial in the pricing research was superseded. A trial extension is exceptional
and must have a founder-approved reason in `/platform-admin`.

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

For future automated billing of verified paid organizations, a failed renewal
will keep the current tier and existing verified branch capacity for exactly
72 hours after that stored end. Failed retries do not move the deadline. No
unpaid tier upgrade or new paid branch slot is available during grace. A
server-verified renewal returns paid access; an intentional cancellation, first
checkout, or expired trial has no renewal grace. This approved future policy
does not change the current manual settlement procedure above or authorize a
manual courtesy extension.

Record every quote, reminder, payment check, access mutation, receipt, and owner
in the private ledger. Never make an unrecorded courtesy extension.

## Cancellation and refund

For cancellation at term end, record the request and simply do not renew. The
manual term expires at its existing timestamp. Use immediate suspension only for
an explicit immediate-cancellation request, abuse/security containment, or a
founder-approved refund decision; it is not the normal end-of-term path.

For UsefulDesk subscription fees, the first verified payment has a full-refund
request window once per customer organization. Use the billing timezone saved
from the paying account's locale with that first payment: its local date is day
0, requests through the end of local day 7 qualify, and local day 8 does not.
Use the recorded request time even if processing occurs later; retries of one
request must use the same claim. Later renewals have no routine partial-month
refund. A normal cancellation stops the next renewal and keeps paid access
through the current term. Correct duplicate or incorrect SaaS charges; review
accidental renewals and serious service failures individually, preserving
applicable legal rights. Direct Meta and other provider charges are separate.
After a provider-confirmed **full first-payment refund**, cancel its next
renewal and end paid operational access at confirmation. Keep the gym's data,
branches, and sign-in, with support and plan-selection recovery. Pending,
failed, partial, or unverified refunds leave access and renewal as they were.
The local pure model does not perform a provider refund, cancel a recurring
provider schedule, or change the production entitlement. Exceptional
corrections still need an individual access decision.

Refunds are manual commercial operations:

1. The founder records the request, reason, amount, tax impact, and decision.
2. Process an approved refund through the original SaaS payment rail or business
   banking process. Do not use UsefulDesk's gym-member Razorpay refund controls.
3. Verify the provider/bank result independently and issue the required external
   credit note or receipt.
4. For a confirmed full first-payment refund, stop renewal and end paid access
   while preserving data and sign-in; record the non-sensitive reason and
   resulting access version. For other approved corrections, record the
   individually agreed access outcome. The automated transaction and provider
   cancellation are not yet implemented, so this step remains founder-run.

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
