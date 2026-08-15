# Dedicated member purchase page design

## Goal

Replace the member profile's nested **Add purchase** dialog with a dedicated checkout page. The page must keep the selected member unmistakable, preserve the current Members view as the return destination, and leave the transactional checkout contract unchanged.

Service renewal remains in its existing dialog. This change applies only to the standalone **Add purchase** action.

## User path

1. Staff open a member profile and choose **Add purchase**.
2. UsefulDesk navigates to `/members/purchase?membership=<id>` and carries a validated, members-only return destination.
3. The page shows compact member context above the checkout: avatar, name, phone, Member ID, current plan, and expiry.
4. Staff select catalogue items, configure service details where needed, and choose how much to collect.
5. On success, or when they cancel, UsefulDesk returns to the prior Members branch/view with `member=<id>` so the same member profile reopens.

The flow is therefore **confirm member → build invoice → review payment → create invoice → return to member**.

## Route and navigation

The new client route is `/members/purchase`, with the membership identifier in the `membership` query parameter. A fixed route is preferred to a dynamic segment because the shared app header can map it directly to **Add purchase** without adding dynamic-title infrastructure.

The member profile action builds a return URL from the current same-origin Members URL, preserving existing query parameters such as `branch` and `view`, then sets `member=<membership id>`. The purchase route accepts only relative `/members` destinations; missing, external, or malformed values fall back to `/members?member=<membership id>`. The return destination is used for Cancel and successful checkout.

The member profile closes naturally when navigation leaves the Members route. Returning with the `member` parameter reuses the existing Members-page deep-link behavior to reopen the profile.

## Page structure

The authenticated app shell owns the page title. `/members/purchase` maps to **Add purchase** in the shared header, and the page content does not repeat that heading.

Inside the page:

- A compact member-context strip uses the existing person primitives and shows avatar, name, phone, Member ID, current plan, and localized expiry.
- The checkout follows the existing responsive composition: catalogue/invoice items first and the payment summary second, side by side on desktop and stacked on narrow screens.
- Cancel and **Create invoice** remain the only footer actions. The create action keeps the total visible when items are selected.
- No decorative dashboard content, extra navigation, or duplicate member summary is added.

Loading, inaccessible-member, and missing-member states occupy the same bounded page region. Errors explain that the member could not be loaded and offer **Back to members**.

## Component boundaries

The current `ProductServiceSaleDialog` contains both checkout behavior and dialog chrome. Split it into:

- A reusable purchase-checkout surface that owns selections, credit loading, payment fields, validation, submission, and the responsive catalogue/payment composition.
- A thin dialog host retained for `service_renewal`, supplying its initial selection and close behavior.
- A page host that loads the membership, renders member context, and supplies cancel/success navigation.

The checkout surface continues to use `ProductsServicesPicker` and existing UI primitives. No component under `src/components/ui/` changes, and no new shared primitive is introduced.

## Data and authorization

The page loads the requested membership with its contact, plan, and pricing context through the authenticated Supabase browser client. Existing RLS remains the tenant boundary. The UI also keeps the existing `canSellProductsServices` capability gate; an unauthorized or inaccessible request does not expose checkout controls.

Checkout still posts once to `POST /api/member-checkouts` with mode `sale`, the existing selections and collection shape, and one per-mount idempotency key. Automatic member credit, price-override rules, payment allocation, immutable invoice history, toasts, and error handling remain unchanged.

No database schema, migration, RPC, API route, RLS policy, or financial calculation changes.

## State and failure handling

- The page waits for a valid membership identifier before loading.
- Member and credit loads show explicit progress and recoverable failure states.
- Checkout submission disables navigation actions that could double-submit while the request is in flight.
- API failures leave the page and its selections intact so staff can retry.
- Success clears the checkout through unmounting and navigates to the retained member context.
- Browser Back remains valid because entering the page is a normal route transition.

## Testing

Focused tests cover:

- The member profile **Add purchase** action builds the dedicated route with membership and safe return context.
- The purchase page loads and renders the correct compact member context.
- Invalid, missing, inaccessible, and unauthorized member states do not render checkout controls.
- Cancel and successful checkout navigate to the retained Members destination with the member profile reopened.
- The extracted checkout surface preserves its current submission payload, validation, credit, payment, and responsive-layout behavior.
- Service renewal continues to render through the dialog host with its initial selection.

After focused tests, run TypeScript, lint, formatting, the full test suite, the Impeccable detector, and one bounded desktop/mobile browser verification pass.

## Documentation

Update `docs/changelog.md` and `PRDs/roadmap.md` in the same implementation change. The entries must state that standalone Add purchase moved to a member-aware page while service renewal and all checkout/ledger behavior remain unchanged.

## Non-goals

- Moving service renewal to a page.
- Redesigning catalogue, trainer pricing, credit, or payment behavior.
- Opening the newly created invoice after checkout.
- Adding draft persistence across refreshes.
- Adding a general dynamic page-title system.
- Changing member-detail, invoice, or payment domain models.
