# Purchase payment actions design

## Goal

Make the standalone **Add purchase** checkout read as one continuous payment task by placing its Cancel and **Create invoice** actions inside the Payment card instead of leaving them detached beneath the two-column layout.

This is a layout-only change. Catalogue selection, collection timing, validation, invoice submission, member credit, and ledger behavior remain unchanged.

## Structure and behavior

When at least one item is selected, the Payment card uses the existing shared `CardFooter` beneath its summary and collection controls. The footer's built-in divider and muted surface separate the final actions from the editable payment content while keeping them within the same visual group.

The action order remains Cancel followed by **Create invoice · <total>**. On desktop, the buttons remain aligned to the card's trailing edge. On narrow screens, they retain the established stacked presentation with the primary action first in visual reading order. Loading and disabled states remain unchanged.

Before an item is selected, the Payment card is not rendered. The standalone Cancel action therefore remains available in the page footer for the empty checkout. As soon as the first item is selected and Payment appears, both actions render in the Payment card footer and the detached page footer is removed. There must never be duplicate Cancel or Create invoice actions.

## Component boundaries

- `ProductServiceSaleCheckout` owns the conditional placement because it already owns the selected-item state, Payment card, and form actions.
- `CardFooter` from `src/components/ui/card.tsx` supplies the existing canonical footer treatment. No shared UI primitive is modified.
- `ProductsServicesPicker`, the dedicated purchase page host, and the service-renewal dialog host remain unchanged.

## Accessibility and responsive behavior

The actions remain inside the same `<form>` and keep their current button types, labels, disabled behavior, and DOM order. Moving them into the Payment card does not change form submission or keyboard behavior.

The Payment card continues to follow Products & services in DOM order. Below `lg`, the card stacks after the catalogue and its footer stays attached to it. At `lg` and above, the card remains in the sticky right column, so the payment decision and final actions stay together while the catalogue scrolls.

## Testing

Update the focused checkout component tests first to require:

- With a selected item, Cancel and **Create invoice** are descendants of the Payment region and no detached footer actions remain.
- With no selected item, Payment and **Create invoice** remain hidden while the standalone Cancel action remains reachable.
- Selecting the first item moves the rendered action group into Payment without duplicating either button.
- Existing collection-timing, validation, submission-payload, success, and responsive-grid tests continue to pass.

After the focused test passes, run the relevant TypeScript, lint, formatting, full test, build, and Impeccable layout checks. Verify the supplied purchase URL once at desktop and once at a narrow viewport, fix findings in one bounded pass, and confirm once.

## Documentation

Update `docs/changelog.md` and `PRDs/roadmap.md` in the same implementation change, recording that the standalone purchase checkout now groups its actions with Payment. No roadmap phase or payment-domain status changes.

## Non-goals

- Showing the Payment card before the first item is selected.
- Changing payment calculations, validation, API payloads, or accounting.
- Changing the catalogue, member context, or service-renewal dialog.
- Editing a shared UI master or introducing a new component variant.
