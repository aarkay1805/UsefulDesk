# Starter pilot offer and invoice draft — owner review only

**Status: private draft, 29 September 2026.** This is not a payable quote, customer invoice, tax conclusion, or authorization to open Checkout. No approval-ledger row or real payment follows from this document.

The owner can set the price and prepare an ordinary invoice and payment receipt after confirming the supplier facts and tax position. A blanket accountant signoff is not a prerequisite to drafting them. Unresolved registration or special tax circumstances still need a reliable answer before charging a customer.

## Proposed first offer

> **Starter — provisional ₹799 for one month.** Includes one active branch. The owner can use members and plans, memberships and renewals, attendance, manual payment recording, shared WhatsApp chats, and standard renewal reminders. Reminders run 7, 3, and 1 days before expiry after 09:00 in the gym's timezone when WhatsApp and the required message templates are ready. Meta messaging charges are separate. Custom reminder schedules, bulk campaigns, configurable automations, gym-member Payment Links, and AutoPay are not included.

This pilot has no separate numeric member or staff cap. Existing roles and technical limits still apply.

The owner reviews the exact payable amount and terms in a quote lasting 30 minutes, then pays through web Checkout. Access starts only after the payment is captured, independently verified, and committed. The first paid term ends one calendar month after the signed capture event. A capture after quote expiry is held for review; it gives no automatic access or refund. There is no automatic SaaS debit. Renewal is available only after expiry, when the owner reviews a new quote and pays again. Cancelling a paid term stops renewal and leaves access through its paid-through date; cancellation itself does not issue a refund. Reopening after cancellation or refund needs a separate reviewed path. The existing full first-payment refund path applies only to an eligible request and verified complete refund; pending, failed, partial, or mismatched refunds do not end access. The exact customer-facing refund eligibility wording and reference still need owner review.

For the selected UsefulMade / Home office pilot, current complimentary access continues until a verified captured payment commits Starter. It does not end when a quote is shown or Checkout opens. Once replaced by a paid term, access ends at that term's expiry or on an eligible, fully processed first-payment refund; there is no automatic return to complimentary access. This selected organization and the proposed supplier have the same proprietor. Treat it as an internal acceptance candidate, **not** an independent paying customer or a reason to create a self-invoice. A genuine customer invoice requires a real buyer and transaction.

## Conditional ordinary invoice and payment receipt layout

Use this layout only after the supplier's registration status, payable amount, document treatment, and actual customer are confirmed. The fields below are placeholders, not a numbered or issued document.

| Field          | Draft content                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading        | **Invoice / Payment receipt** (ordinary commercial document; not a GST tax invoice)                                                                                                                  |
| Supplier       | `[Proprietor's verified legal name]`, trading as UsefulMade; `[verified business address, Punjab, PIN]`; `[approved contact]`                                                                        |
| Customer       | `[buyer's legal name / organization]`; `[billing address and state]`                                                                                                                                 |
| Document       | Invoice no. `[next sequential number]`; issue date `[date]`; payment receipt ref. `[unique receipt number]`                                                                                          |
| Service        | UsefulDesk Starter subscription; one active branch; service period `[verified capture time]` to `[calendar-month end]`                                                                               |
| Amount         | Software fee ₹799 **provisional**; final gross payable `[approved exact INR amount]`                                                                                                                 |
| Payment        | Razorpay order `[order ID]`; captured payment `[payment ID]`; paid date/time `[verified time]`; amount received `[exact INR amount]`                                                                 |
| Refund, if any | Refund request `[reference]`; Razorpay refund `[refund ID]`; processed date `[verified date]`; amount refunded `[exact INR amount]`; link to the original invoice/receipt. Keep the original record. |

**Tax note for review:** If the proprietor is confirmed unregistered and no registration or other compulsory-charge circumstance applies at the time of supply, proposed wording is: **“GST not charged — supplier unregistered.”** Do not display a GSTIN, a GST tax invoice heading, “0% GST,” “exempt,” or “zero-rated” on that basis. If the facts change, stop this template and review the amount and document before any quote or invoice.

## Facts to settle before a payable offer

1. Confirm the proprietor's legal issuer name and business address against the Udyam certificate; verify PAN identity privately, business state, and whether any GST registration exists or is pending. Do not put the home address or PAN in this tracked draft. Confirm aggregate turnover across **all businesses under the same PAN** for the relevant financial year; “UsefulDesk turnover is zero” alone is insufficient. Check customer geography and any compulsory registration, reverse-charge, or other special circumstance. The owner has reported Punjab, no GST registration, one business, and zero current turnover; those are inputs for review, not a clearance.
2. Decide the exact gross price, whether any third-party charge is separately payable, final cancellation and first-full-refund wording/reference, ordinary invoice and payment receipt format, and the provider-facing sample. Save the approved amount and references in the private offer ledger only after review.
3. Obtain Razorpay approval for the SaaS product and `desk.usefulmade.com` on the existing UsefulMade merchant. Complete shared-merchant signed webhook, refund, and release acceptance. Implement and verify the owner-approved complimentary-to-paid transition for the selected pilot, then obtain separate authorization before any real-money pilot.

The GST Act defines aggregate turnover across persons with the same PAN on an all-India basis ([CGST Act, section 2(6)](https://cbic-gst.gov.in/hindi/CGST-bill-e.html)). Notification 10/2017–Integrated Tax addresses the registration exemption for inter-State taxable service suppliers up to ₹20 lakh aggregate turnover, subject to its stated conditions ([CBIC notification](https://cbic-gst.gov.in/hindi/pdf/integrated-tax/10_2017_IT.pdf)). An unregistered person may not collect GST as tax ([CGST Act, section 32](https://cbic-gst.gov.in/hindi/CGST-bill-e.html)). These sources support the questions and conditional draft above; they do not establish this supplier's final registration position or the exact customer-payable amount.
