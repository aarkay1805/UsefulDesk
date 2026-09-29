# Advanced subscription transactions — Test implementation contract

**Status (29 September 2026):** the default-off local Test implementation now
includes owner review, frozen quotes, canonical order claims, verified
upgrade/add-on/restart commits, owner-reviewed paid-slot renewal or
cancellation with the base charge, and durable late refund/renewal review
holds. A disposable full-schema SQL transaction
exercised synthetic captured payments and rolled back. No advanced provider
charge or Production migration was made. Commercial and Starter reminder
policy approval still block every payable advanced order.

## Shared Test order and verification boundary

Use the separate Usefulmade Test credentials and the existing
`createTestOrder`, `recoverTestOrder`, `fetchTestOrder`,
`verifyTestCheckoutSignature`, and `fetchCapturedTestPayment` adapter.
Keep the existing non-Production environment gate and private disabled
database switch. Gym merchant credentials and gym-member mandate/payment
tables must never enter these transactions.

1. The owner records a review. It freezes organization, owner, billing account,
   requested tier or one-slot action, source term start/end/tier, access
   version, active roster, exact archive IDs, and any accepted Starter
   reminder reset/version. A replay of the same request ID returns only the
   identical review. A different tenant or payload gets a conflict.
2. **After policy approval**, a separate quote transaction locks the
   organization and checks that the review still describes the current term,
   owner role, billing branch, active roster, purchased slots, and schedule.
   It freezes one payable INR paise amount, tax/receipt treatment, quote
   expiry, merchant ID, review ID, and one canonical receipt. No client
   amount or tax field is authoritative. A zero, expired, or changed quote
   cannot create a provider order.
3. Claim the quote in the database **before** provider I/O. One claimed
   receipt may have only one order. If order creation times out, look up that
   exact receipt with matching organization/request notes; zero or multiple
   matches are review-held. Never issue a second POST for an ambiguous
   receipt. Bind the exact order ID to the claim before exposing Checkout.
4. Checkout confirmation requires its order/payment HMAC. Webhooks require
   raw-body HMAC and exact Test merchant account ID. Both paths perform a
   fresh provider GET for captured state, exact order, INR currency and paise
   amount, then call the same service-only commit RPC. A browser return,
   screenshot, failed or authorized-only payment grants nothing.
5. The commit RPC locks the organization first, then the claim, grant/access,
   and accounts in stable order. It rechecks quote expiry, source term/tier/
   access version, owner role, exact roster, merchant/order/payment/amount,
   and unresolved refund/order work. It writes payment evidence and the
   entitlement or slot effect in one transaction. The payment and order IDs
   are unique across base, renewal, and advanced ledgers. An exact replay
   returns the original result; a different payment, amount, merchant, tenant
   or order for a verified claim is a conflict.
6. If a captured payment arrives after quote expiry or another stale check,
   persist the provider evidence as a review-required exception and
   acknowledge a genuine webhook only after that record is durable. Do not
   grant access, create a replacement order, issue an automatic refund, or
   retry the same failing commit forever. An operator resolves money movement
   separately.

Only an existing failed **paid renewal** can create the fixed 72-hour grace.
Failure of an upgrade, add-on, or restart leaves the previous access and
capacity unchanged.

## Effect-specific commits

### Base upgrade

Calculate the positive difference between approved listed monthly base prices
over the remaining actual paid period in INR paise, half-up. Freeze that amount
at the approved owner-reviewed quote time. On verified payment within the
source term and quote lifetime, update the current grant tier and
`organization_product_access.version` together. Preserve the original
period start and paid-through end. A late capture is review-held. An upgrade
from Growth with an existing paid slot to Ultimate needs an explicit
redundant-slot treatment before its quote can open.

### Paid branch slot

Growth can hold at most one verified purchased slot; Starter holds none.
Ultimate's additional slots are paid, without an assumed organization-wide
maximum. A purchase commits one verified slot linked to its payment, source
term, and expiry; a pending or failed attempt contributes zero. The active
branch trigger counts **included plus verified** slots only. Archiving a
branch frees active capacity without mutating or refunding a slot.

At renewal, purchased slots require the approved renewal charge and exact
owner-reviewed retained/archive roster. `subscription_review_test_paid_slot_renewal`
freezes the source slot IDs and cancellation IDs. The existing renewal order
then charges the base plus ₹499 for each retained slot. Cancellation removes
capacity at the paid renewal boundary only if that roster fits; selected
archives and capacity change occur in the same organization-locked
verified-renewal transaction.
No automatic archive or routine refund is inferred. The first-payment
full-refund policy includes an add-on only if it was part of that actual first
payment.

### Restart after cancellation or full first-payment refund

A restart has one canonical recoverable order and begins a fresh monthly term
only at verified payment. It does not create a trial, delete branches, or
create another first-payment refund opportunity. Require the ended cancelled
term or confirmed full refund, no unresolved prior payment/refund, and the
owner's exact retained/archive roster. The verified commit applies the
archives and new term atomically.

The grant now has a distinct current-term generation/status and immutable
generation history. The original first payment and refund remain unchanged;
the billing panel reads `current_term_refunded_at` so a verified restart shows
the new term. The first-payment claim remains unique per organization.

## Required acceptance before any payable Test order

- SQL: concurrent quote/claim and branch create/restore; stale version, tier,
  period, roster, owner, schedule, and purchased-slot changes; exact and
  conflicting payment replay; rollback after a late failure; tenant isolation.
- Provider: genuine captured/failed attempts, Checkout loss and receipt
  recovery, delayed/duplicate/out-of-order signed webhooks, provider and
  database outages, stale captured-payment review, and no second order.
- Product: owner review before charge, Starter reminder reset, add-on
  cancellation/redundant slots, branch archive preservation, refund/restart
  history, and web/native/API/RLS/background access consistency.

**Owner decisions still required:** quote lifetime/repricing; add-on
proration, renewal, cancellation and refund mechanics; restart terms;
Starter reminder cadence; exact tax/receipt and commercial readiness.
The 15-minute quote, actual-term ₹499 add-on proration, renewal-boundary
slot cancellation, and fresh-term restart in `PRDs/roadmap.md` remain
proposals implemented only behind the disabled gate. Genuine advanced Test
capture/webhook, outage/recovery, and native acceptance remain open.
