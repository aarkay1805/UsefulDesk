# Desktop Purchase Dialog Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the member-profile Add purchase dialog into a desktop two-column checkout while preserving the existing stacked layout and checkout behavior below `lg`.

**Architecture:** `ProductServiceSaleDialog` remains the checkout owner. Its existing item picker and payment card become semantic siblings inside one responsive grid; only `lg` adds columns and a sticky payment summary. No data, API, shared UI primitive, or `ProductsServicesPicker` behavior changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Base UI/shadcn primitives, Vitest, Testing Library.

## Global Constraints

- Apply the two-column layout only at `lg` and above.
- Preserve the current single-column mobile/tablet order and checkout interactions below `lg`.
- Do not edit `src/components/ui/*`.
- Preserve the checkout API, credit application, payment choices, service renewal, validation, idempotency, toasts, and refresh behavior.
- Keep the footer outside the scroll region and preserve the focus-ring gutter.
- Update both `docs/changelog.md` and `PRDs/roadmap.md`.

---

### Task 1: Add the desktop checkout composition

**Files:**
- Create: `src/components/members/product-service-sale-dialog.test.tsx`
- Modify: `src/components/members/product-service-sale-dialog.tsx:185-341`

**Interfaces:**
- Consumes: existing `ProductServiceSaleDialog` props and `CheckoutSelection[]` state.
- Produces: a `role="group"` named `Purchase checkout` whose labelled item `section` and payment `aside` become a two-column grid at `lg`.

- [ ] **Step 1: Write the failing component test**

Create a jsdom test that mocks only account, locale, and database boundaries and replaces `ProductsServicesPicker` with inert labelled content. Render the real dialog with one initial selection and assert:

```tsx
const checkout = screen.getByRole('group', { name: 'Purchase checkout' });
const items = within(checkout).getByRole('region', { name: 'Invoice items' });
const payment = within(checkout).getByRole('complementary', { name: 'Payment' });

expect(items.parentElement).toBe(checkout);
expect(payment.parentElement).toBe(checkout);
expect(checkout.className).toContain('lg:grid');
expect(checkout.className).toContain(
  'lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]'
);
expect(payment.className).toContain('lg:sticky');
```

This catches flattening the desktop checkout back into a stack or moving payment outside the shared checkout region.

- [ ] **Step 2: Run the focused test and verify RED**

Run `npm test -- src/components/members/product-service-sale-dialog.test.tsx`.

Expected: FAIL because the semantic wrappers and desktop grid classes do not exist.

- [ ] **Step 3: Implement the responsive layout**

Expand `DialogContent` only at desktop:

```tsx
<DialogContent className="flex max-h-[min(92vh,780px)] flex-col sm:max-w-2xl lg:max-w-[min(960px,calc(100vw-2rem))]">
```

Keep the existing scroller, then add:

```tsx
<div
  role="group"
  aria-label="Purchase checkout"
  className="space-y-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)] lg:items-start lg:gap-5 lg:space-y-0"
>
  <section aria-label="Invoice items" className="min-w-0">
    <ProductsServicesPicker
      value={selections}
      onChange={setSelections}
      membershipEnd={membership.end_date}
      defaultStartDate={fmt.today()}
      title="Invoice items"
      description="Add one or more products or services to this invoice."
    />
  </section>
</div>
```

Inside the same grid, wrap the existing conditional payment `Card` block from lines 212–337 with `<aside aria-label="Payment" className="min-w-0 lg:sticky lg:top-0">`. Keep the complete `Card`, including every amount row, field, chip, message, and handler, byte-for-byte inside that wrapper. Do not change the footer.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `npm test -- src/components/members/product-service-sale-dialog.test.tsx`.

Expected: PASS with no jsdom warnings.

- [ ] **Step 5: Run focused static checks**

Run:

```bash
npx eslint src/components/members/product-service-sale-dialog.tsx src/components/members/product-service-sale-dialog.test.tsx
npx prettier --check src/components/members/product-service-sale-dialog.tsx src/components/members/product-service-sale-dialog.test.tsx
```

Expected: both commands exit 0.

### Task 2: Document and verify the shipped layout

**Files:**
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

**Interfaces:**
- Consumes: the responsive layout from Task 1.
- Produces: documentation recording the desktop checkout improvement and mobile non-goal.

- [ ] **Step 1: Update product documentation**

Add a terse changelog entry naming `src/components/members/product-service-sale-dialog.tsx`. Update the appropriate Built/Shipped section of `PRDs/roadmap.md`. Both entries must say desktop uses item-builder and payment-summary columns while mobile remains stacked.

- [ ] **Step 2: Run the Impeccable layout detector**

Run:

```bash
node .agents/skills/impeccable/scripts/detect.mjs --json --scope layout src/components/members/product-service-sale-dialog.tsx src/components/members/product-service-sale-dialog.test.tsx
```

Expected: `[]`, or findings are resolved before continuing.

- [ ] **Step 3: Verify the rendered flow in one bounded browser pass**

At desktop, verify empty, one-item, full-payment, partial-payment, leave-due, and footer reachability states. Confirm picker left, Payment right and sticky, and no grid overlap.

Below `lg`, confirm the existing stacked order remains Invoice items → Payment → footer. Do not redesign mobile defects.

- [ ] **Step 4: Fix defects in one batch, then confirm once**

Apply only fixes required by the desktop spec. Re-run the focused test and repeat the desktop/mobile visual confirmation once.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

Expected: every command exits 0 with zero failures or formatting differences.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git status --short
git diff -- src/components/members/product-service-sale-dialog.tsx src/components/members/product-service-sale-dialog.test.tsx docs/changelog.md PRDs/roadmap.md
```

Confirm only the approved layout, regression test, and required documentation changed.
