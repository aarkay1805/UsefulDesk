# Shared membership checkout design

## Goal

Give **Add member**, **Convert to member**, and **Renew membership** one canonical membership-checkout experience. The person or membership context on the left remains specific to the task; the complete membership, offer, add-on, invoice, and collection decision on the right must look and behave the same.

This removes the raw renewal-fee override, replaces it with structured one-cycle offers, moves every creation flow to the newer products-and-services catalogue table, and makes deferred collection an explicit invoice outcome.

## Audience and outcome

Owners, admins, and front-desk agents use these flows while enrolling or renewing a member at reception. They must be able to:

1. select the membership plan and billing option;
2. optionally apply a one-cycle discount or bonus-time offer;
3. optionally add products and services;
4. decide whether to collect now; and
5. create one reconciled invoice and membership period in one transaction.

Success means the three tasks share the same reading order and controls, while their left-side context and lifecycle rules remain truthful.

## Selected approach

Create a shared, controlled membership-checkout module rather than duplicating JSX or turning the entire `MemberForm` into a renewal form.

The shared module owns the right-panel presentation and a shared checkout draft/calculation contract. Each host supplies its mode (`join`, `convert`, or `membership_renewal`), left-side context, initial dates, selected membership when applicable, and completion behavior. Mode-specific policy determines the regular fee and period start; it does not fork the visual structure.

This boundary deliberately keeps contact creation, contact editing, deduplication, profile photos, and current-membership presentation outside the shared checkout module.

## Dialog composition

All three flows keep the existing large split-dialog shell, fixed header/footer, responsive scroll containment, and mobile stacking.

### Left panel

- **Add member:** the new person's editable basic details.
- **Convert a lead to member:** the existing lead's editable basic details.
- **Convert an existing trial:** member identity plus the current trial context; this remains hosted by the renewal dialog but uses the same paid-checkout panel.
- **Renew membership:** member identity plus current plan, current expiry, current fee, and any outstanding prior-invoice balance.

The renewal warning must state that old balances remain on their original invoices. Renewal must never silently settle, merge, or replace arrears.

### Right panel

The shared panel always uses this order:

1. **Membership details**
2. **Offer discount**
3. **Offer bonus months**
4. **Products & services**
5. **Collect payment now**

The order is the same on desktop and mobile.

## Membership details

The canonical `PlanOptionPicker` selects the plan and pricing option. The selected option remains the durable pricing identity; an offer never creates or substitutes a pricing option.

- Add and Convert allow the user to choose the membership start date.
- Renew derives the next start as the later of the current expiry and account-local today. Early renewal therefore preserves unused time, and a lapsed membership restarts today.
- Add and Convert use `firstCycleFee(option)`, including any retained legacy setup fee.
- Renew uses `renewalFee(option)` and must never rebill a setup fee.
- The standard period end is derived from the selected option and mode-specific start date.
- The displayed expiry updates from the standard period end plus any enabled bonus months.

Renewal has no editable fee field. The server/database derives the regular fee from the selected pricing option and validates the offer against it.

## One-cycle offers

Discount and bonus time are independent, optional sections. Each section uses a checkbox in its header and progressive disclosure matching the established conversion treatment. Both default off and reset their draft values when turned off.

Front-desk agents, admins, and owners may apply these structured offers. They are not arbitrary price overrides and do not require an override reason. The invoice and period retain their configured-value and offer snapshots, while invoice creation already records the acting user.

### Offer discount

- Supports Percentage and Fixed amount.
- Reuses the current presets, validation, rounding, and live regular-price/discount/final-membership-fee breakdown.
- Applies only to the membership line, never to products or services.
- May reduce the membership fee to zero but may not make it negative.
- Stores `list_price`, `discount_type`, `discount_value`, and `discount_amount` on the newly created membership period/invoice compatibility surface.

### Offer bonus months

- Reuses the current positive-whole-month validation, presets, maximum, and live regular-expiry/bonus/final-expiry breakdown.
- Extends only the membership period created by this checkout.
- Stores `standard_period_end` and `bonus_months` on that period.

For Add and Convert, “one cycle” means the first paid membership cycle. For Renew, it means the single new period opened by that renewal. The following renewal starts after the bonus-adjusted actual expiry but returns to the selected option's normal fee and duration.

Example: a one-month ₹1,000 renewal with a 10% discount and one bonus month creates one ₹900 membership line and one two-month membership period. The next renewal is ₹1,000 for one month, beginning after the two-month period ends.

## Products & services

Products & services becomes a checkbox-header progressive-disclosure section in all three flows. It defaults off.

When enabled, it uses `ProductsServicesPicker` with the newer `catalogue` presentation:

- one table-style list of active catalogue options;
- inline trainer selection and trainer-specific price readiness;
- Add and quantity controls;
- service start date and calculated service end;
- warning when a service runs beyond membership expiry; and
- existing admin-only, reasoned catalogue price adjustment.

Turning the section off immediately clears every selected catalogue line so hidden items cannot be submitted. Membership discount and bonus rules never alter catalogue line prices or service durations.

Catalogue loading, empty, and error states stay inside the expanded section. Because add-ons are optional, a catalogue failure must not block a membership-only checkout after the user turns the section off.

## Invoice summary and member credit

The shared calculation presents, when applicable:

- regular membership fee;
- membership discount;
- final membership fee;
- products/services subtotal;
- combined invoice total;
- member credit applied; and
- cash amount due.

Member credit continues to apply through the existing oldest-credit transaction rule and never changes the recorded list price or discount. Collection choices operate on the cash amount remaining after credit, not on the pre-credit invoice total.

Existing arrears are informational only and are excluded from this new invoice summary.

## Collect payment now

Payment becomes a checkbox-header progressive-disclosure section shared by all three modes. It defaults on when the cash amount due is positive.

### Unchecked

- The checkout records no payment.
- No installment promise is created.
- The complete post-credit balance remains due on the new invoice.
- The user may later collect through the normal invoice payment flow or create a Razorpay Payment Link.
- Convert is allowed to complete with zero immediate collection; the current database rule requiring a positive conversion payment is removed.

### Checked

The section exposes two radio-card choices:

1. **Collect full amount** — collects the complete cash balance today.
2. **Part now, part later** — collects the existing fixed 60% today and leaves 40% due exactly 28 account-local calendar days later, with no fee.

The payment-method field is labelled **Today's payment method** and appears after the choice. The installment choice shows both amounts and the exact second due date. The existing claim-first installment reminder process continues to work from the live invoice balance.

The fixed 60/40 split applies to the complete cash balance of the combined invoice after member credit, not only to the membership line. Renewal invoices become valid installment-plan parents under the same validation and reminder contract as joining invoices.

If the cash amount due is zero, the section shows that no payment is required and does not create a zero-value payment or installment promise.

## Transaction and validation contract

`POST /api/member-checkouts` remains the canonical agent-gated boundary for Add, Convert, and Renew. Every checkout remains one idempotent database transaction.

The common payload carries intent and snapshots, not an authoritative arbitrary fee:

- plan and pricing-option identity;
- mode-specific period start;
- discount kind/value;
- bonus months;
- catalogue selections;
- whether collection is enabled;
- full or installment timing when enabled;
- payment method and timestamp; and
- idempotency key.

The database must independently:

1. resolve the selected option within the account and plan;
2. derive first-cycle or renewal list price by mode;
3. validate and calculate the discount;
4. derive standard and bonus-adjusted period ends;
5. create or advance the membership and period;
6. create the combined immutable invoice and line snapshots;
7. apply available member credit;
8. validate the collection choice against the remaining balance;
9. create either no payment, one full payment, or the exact 60/40 payment and promise; and
10. return the reconciled invoice result.

No agent-controlled request may bypass these calculations with a replacement membership fee or arbitrary installment amount. Catalogue price overrides retain their separate admin-plus-reason checks.

Retries with the same idempotency key return the original result without creating another period, invoice, payment, service, credit allocation, or installment promise.

## Authorization and lifecycle boundaries

- Agent+ may add, convert, renew, apply structured membership offers, select catalogue items, and record collection.
- Catalogue price overrides remain admin+ and require a stored reason and actor.
- Viewer remains read-only.
- Existing UI and database guards for active/pending/creating/paused/orphaned AutoPay mandates continue to block manual renewal and other provider-coupled lifecycle mutations.
- This work does not change authored-content, payment-correction, refund, or settings permissions.

## Responsive and accessibility behavior

- Preserve the current large-dialog title hierarchy, fixed footer, and scroll-contained body.
- Desktop uses the existing left-context/right-task split; mobile stacks left context before the shared checkout panel.
- Section checkboxes use the canonical `Checkbox` and `Label` treatment and remain keyboard-operable through their whole label.
- Revealed content uses the established `Collapse` primitive where animated disclosure is appropriate.
- Radio choices expose their selected state and retain complete amount/date descriptions.
- Money uses locale formatting and tabular numerals; dates use account-local formatters.
- Loading, invalid, disabled, and server-error states retain focus and expose actionable messages.
- Turning a section off must remove its hidden values from both visible summaries and the submitted payload.

## Errors and edge cases

- A selected option archived before submit fails transactionally with a clear availability error.
- Invalid, zero-negative, excessive, or malformed discount values block submission in the field and again in the database.
- Bonus months must be a positive whole number within the existing maximum and must round-trip with its standard period end.
- A catalogue item, option, trainer, or trainer fee that becomes unavailable fails without creating a partial membership checkout.
- A collection cannot exceed the live post-credit invoice balance.
- A 60/40 choice is unavailable when currency rounding cannot produce two positive installments.
- Turning payment off after choosing installments clears the payment timing draft and creates no promise.
- Turning products/services off clears selections and their price-adjustment drafts.
- Prior membership arrears remain unchanged after success.
- An idempotent retry after a lost response returns the committed checkout.

## Component boundaries

Expected implementation boundaries are:

- a shared membership-checkout panel for the canonical right-side section composition;
- a shared controlled draft/calculation layer for membership offer, catalogue, invoice, credit, and payment state;
- the existing `PlanOptionPicker`, `ProductsServicesPicker`, discount helpers, bonus-time helpers, installment helpers, and UI primitives;
- mode-specific left panels and completion behavior in the Add/Convert and Renew hosts; and
- one database-authoritative checkout transaction per mode through the existing API boundary.

Do not add a new `src/components/ui/` primitive or modify a shared UI master for this work. If implementation discovers that no existing primitive can express a required interaction, stop for explicit product agreement rather than creating a page-specific substitute.

## Verification

### Pure and component tests

- Add, Convert, and Renew render the same ordered right-panel sections.
- Each checkbox reveals and clears its owned state.
- All creation modes use the catalogue table presentation.
- Renew derives regular price without setup fee and has no raw fee input.
- Discount affects only the membership subtotal.
- Bonus changes only membership expiry.
- Credit changes cash due without changing invoice total or offer snapshots.
- Collect full amount and 60/40 use the post-credit combined balance.
- Unchecked collection submits zero payment intent.
- Zero cash due creates neither a payment nor an installment promise.

### Database and integration tests

- Join, Convert, and Renew validate option ownership, price, discount, bonus, and dates independently of browser values.
- Convert and Renew can create a fully due invoice with no payment.
- Each mode can create a full collection or exact 60/40 promise transactionally.
- Renewal offer snapshots appear on the new period/invoice and do not change the pricing option.
- The next renewal after a discounted/bonus period returns to normal option price/duration from actual expiry.
- Products/services, credit allocations, payment allocations, and installment totals reconcile exactly.
- Agent offers succeed; agent catalogue price overrides fail; admin reasoned catalogue overrides succeed.
- Idempotent retries create no duplicates.
- AutoPay lifecycle locks still reject manual renewal.

### Product verification

- Exercise typical and long-content states on desktop and mobile for all three hosts.
- Verify keyboard order, focus visibility, disclosure semantics, validation announcements, footer reachability, and scroll containment.
- Run targeted Vitest coverage, TypeScript, lint for changed files, and the Impeccable detector.
- Apply any required migration through the approved Supabase migration tool, never `supabase db push`, and verify the resulting functions, constraints, policies, and transactional behavior.
- Update `docs/changelog.md` and `PRDs/roadmap.md` with the implemented result before declaring the feature complete.

## Non-goals

- Merging the three left-side contexts.
- Editing personal information during renewal.
- Recurring discounts or permanently changing a pricing option.
- Discounting catalogue items through the membership-offer controls.
- Automatically creating or sending a Razorpay Payment Link.
- Changing AutoPay mandate pricing or lifecycle behavior.
- Merging old arrears into a new membership invoice.
- Adding arbitrary installment percentages, dates, or fees.
- Replacing the existing plan editor, catalogue, invoice detail, or later-payment surfaces.
