# Desktop purchase dialog layout design

## Goal

Make the member-profile **Add purchase** flow easier to scan and complete on desktop by turning the current stacked dialog into a conventional two-column checkout. The left side builds the invoice; the right side reviews the total and records the collection decision.

The existing mobile presentation is intentionally out of scope.

## User path

1. Open **Add purchase** from the member profile.
2. Choose and configure a product or service in the left column.
3. Add it to the invoice and review the selected invoice lines beneath the picker.
4. Review the invoice total, available credit, collection amount, payment method, and remaining balance in the right column.
5. Create the invoice from the persistent dialog footer.

The reading order is therefore **build invoice → review payment → create invoice**.

## Desktop structure

At the desktop breakpoint (`lg` and above), the dialog becomes a wider two-column surface:

- **Left column — Invoice items:** approximately three-fifths of the available width. It contains the existing `ProductsServicesPicker`, including conditional service, trainer, quantity, date, and price-override fields plus the selected line-item list.
- **Right column — Payment:** approximately two-fifths of the width. It contains the existing invoice summary, member-credit deduction, collection amount, payment method, Full/Leave due choices, and remaining-balance message.
- **Header and footer:** span both columns. The footer remains outside the scroll region so Close and Create invoice stay reachable.

The payment card is not rendered until at least one invoice line exists. Once lines exist, it stays visible beside the item builder rather than being pushed below it. At `lg` and above, the payment card is sticky at the top of the dialog's scroll container so the summary remains visible while a long item form or cart scrolls.

The layout uses the existing spacing scale: tight spacing within field groups, standard card spacing within each task, and a larger gutter between the two columns. No decorative treatment or new visual language is introduced.

## Mobile boundary

Below `lg`, preserve the current single-column order and behavior:

1. Invoice items
2. Payment
3. Footer actions

This task does not add a mobile stepper, change mobile footer behavior, introduce a mobile sheet, or otherwise redesign narrow viewports.

## Interaction and data behavior

This is a layout change, not a checkout-domain change.

- Preserve the current `CheckoutSelection[]` state and `POST /api/member-checkouts` request.
- Preserve automatic member-credit application.
- Preserve Full, Leave due, and manually entered partial-payment behavior.
- Preserve payment-method enablement, amount validation, idempotency, success toasts, refresh behavior, and invoice creation semantics.
- Preserve service-renewal mode and its preselected line.
- Do not change database schema, API routes, authorization predicates, or RLS.

## Component boundaries

- `ProductServiceSaleDialog` owns the responsive two-column composition and payment card placement.
- `ProductsServicesPicker` continues to own catalogue loading, conditional item configuration, price overrides, and selected-line management.
- Existing UI primitives (`Dialog`, `Card`, `Select`, `CurrencyInput`, `ChipGroup`, and `Button`) remain the visual sources of truth.
- No shared component under `src/components/ui/` is changed, and no new master component is required.

## Error and extreme states

- Empty catalogue, loading, and catalogue-load error states remain in the left column.
- The Create invoice action remains disabled until at least one item is selected.
- Long carts scroll within the dialog without moving the footer off-screen.
- Long names and option labels must not widen the grid or overlap the payment column.
- Field focus rings retain the existing inner scroll gutter.
- The dialog must remain within the desktop viewport height.

## Verification

- Verify the empty, one-item, multi-item, service-with-trainer, price-override, full-payment, partial-payment, leave-due, and member-credit states at a desktop viewport.
- Confirm the payment summary remains visible and the footer remains reachable with long content.
- Confirm keyboard focus order follows the existing DOM order and every control remains reachable without focus entering hidden or clipped content.
- Confirm the viewport below `lg` retains the current stacked layout.
- Run the targeted tests, TypeScript check, lint for changed files, and Impeccable layout detector.

## Non-goals

- Mobile UX redesign.
- A multi-step wizard.
- Catalogue or trainer-pricing changes.
- Payment or invoice accounting changes.
- Shared UI-master changes.
- Changes to other `ProductsServicesPicker` consumers such as member creation.
