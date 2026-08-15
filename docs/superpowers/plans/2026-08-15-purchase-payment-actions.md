# Purchase Payment Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the standalone purchase checkout's Cancel and Create invoice actions inside the Payment card whenever that card is visible.

**Architecture:** Keep the existing form, checkout state, and submission path intact. `ProductServiceSaleCheckout` conditionally renders one shared action fragment: inside the existing `CardFooter` when selections exist, or as a Cancel-only standalone footer while the checkout is empty.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, shared `Card`/`CardFooter`/`Button` primitives, Vitest, Testing Library.

## Global Constraints

- Do not modify payment calculations, validation, API payloads, credit handling, or ledger behavior.
- Do not change `ProductsServicesPicker`, the dedicated purchase page host, or the service-renewal dialog host.
- Reuse `CardFooter` from `src/components/ui/card.tsx`; do not modify any shared UI master.
- Keep action order Cancel then Create invoice in DOM order, with the primary action first in narrow-screen visual order.
- Keep one standalone Cancel action reachable while no item is selected; never render duplicate actions.
- Update both `docs/changelog.md` and `PRDs/roadmap.md` in the same implementation change.

---

### Task 1: Group checkout actions with Payment

**Files:**

- Modify: `src/components/members/product-service-sale-checkout.test.tsx`
- Modify: `src/components/members/product-service-sale-checkout.tsx`

**Interfaces:**

- Consumes: `ProductServiceSaleCheckout(props: ProductServiceSaleCheckoutProps)` and `CardFooter` from `@/components/ui/card`.
- Produces: unchanged component props and checkout payload; selected-state actions become descendants of the `aside[aria-label="Payment"]` region.

- [ ] **Step 1: Write the failing selected-state placement test**

In `product-service-sale-checkout.test.tsx`, strengthen `keeps invoice building, payment, and actions in one responsive checkout` after locating `payment`:

```tsx
const cancel = screen.getByRole('button', { name: 'Cancel' });
const createInvoice = screen.getByRole('button', {
  name: /Create invoice.*₹50/,
});

expect(payment.contains(cancel)).toBe(true);
expect(payment.contains(createInvoice)).toBe(true);
expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
expect(
  screen.getAllByRole('button', { name: /Create invoice.*₹50/ })
).toHaveLength(1);
```

In `reveals payment only after the first item is selected`, retain the existing empty-state assertions, assert the lone Cancel remains outside `checkout`, and after adding the item assert both buttons are inside Payment:

```tsx
const emptyCancel = screen.getByRole('button', { name: 'Cancel' });
expect(checkout.contains(emptyCancel)).toBe(false);

fireEvent.click(screen.getByRole('button', { name: 'Add catalogue item' }));

const payment = screen.getByRole('complementary', { name: 'Payment' });
expect(payment.contains(screen.getByRole('button', { name: 'Cancel' }))).toBe(
  true
);
expect(
  payment.contains(screen.getByRole('button', { name: /Create invoice.*₹50/ }))
).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/components/members/product-service-sale-checkout.test.tsx
```

Expected: FAIL because the selected-state Cancel and Create invoice buttons are siblings after the checkout scroll region, not descendants of Payment.

- [ ] **Step 3: Implement the minimal CardFooter placement**

In `product-service-sale-checkout.tsx`, import `CardFooter` with the existing card parts:

```tsx
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
```

Inside the selected-state Payment `Card`, add `CardFooter` after `CardContent` and move the existing Cancel and Create invoice buttons into it:

```tsx
<CardFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-start">
  <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
    Cancel
  </Button>
  <Button type="submit" disabled={saving || !!collectAmountError}>
    {saving ? <Loader2 className="size-4 animate-spin" /> : null}
    {saving ? (
      'Creating invoice…'
    ) : (
      <>
        Create invoice
        <span className="tabular-nums">· {fmt.money(total)}</span>
      </>
    )}
  </Button>
</CardFooter>
```

Replace the detached footer with a Cancel-only footer rendered only when `selections.length === 0`:

```tsx
{
  selections.length === 0 ? (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        disabled={saving}
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  ) : null;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/components/members/product-service-sale-checkout.test.tsx
```

Expected: all tests in the file pass with no warnings.

- [ ] **Step 5: Format and inspect the focused diff**

Run:

```bash
npx prettier --write src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx
git diff --check
git diff -- src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx
```

Expected: formatting succeeds, `git diff --check` exits 0, and the diff contains only placement/test changes.

### Task 2: Record and verify the shipped layout

**Files:**

- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Verify: `src/components/members/product-service-sale-checkout.tsx`
- Verify: `src/components/members/product-service-sale-checkout.test.tsx`

**Interfaces:**

- Consumes: the selected-state CardFooter behavior from Task 1.
- Produces: current shipped-status documentation and fresh automated/rendered verification evidence.

- [ ] **Step 1: Update shipped documentation**

Add a terse newest-first changelog section describing that the dedicated purchase checkout now keeps Cancel and Create invoice inside Payment when items are selected, while empty checkout Cancel access and payment behavior remain unchanged. Extend the existing purchase-checkout engineering-maintenance entry in `PRDs/roadmap.md` with the same shipped behavior; do not create a new roadmap phase.

- [ ] **Step 2: Run focused static and UI checks**

Run:

```bash
npx eslint src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx
npx prettier --check src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx docs/changelog.md PRDs/roadmap.md docs/superpowers/plans/2026-08-15-purchase-payment-actions.md
npm run typecheck
node .agents/skills/impeccable/scripts/detect.mjs --json --scope layout src/components/members/product-service-sale-checkout.tsx
```

Expected: all commands exit 0 and the detector returns `[]`.

- [ ] **Step 3: Run the full automated verification**

Run:

```bash
npm test
npm run build
```

Expected: the full Vitest suite passes and the production Next.js build exits 0.

- [ ] **Step 4: Verify the rendered purchase page in one bounded pass**

At the supplied `/members/purchase?...` URL, inspect desktop and narrow viewports. Confirm the selected-state buttons appear once inside Payment, desktop leading alignment is intact, narrow buttons stack with Create invoice visually first, and the sticky/scroll behavior remains usable. If defects appear, fix them as one batch and perform at most one confirmation pass.

- [ ] **Step 5: Review the final diff and commit**

Run:

```bash
git diff --check
git status --short
git diff -- src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx docs/changelog.md PRDs/roadmap.md docs/superpowers/plans/2026-08-15-purchase-payment-actions.md
git add src/components/members/product-service-sale-checkout.tsx src/components/members/product-service-sale-checkout.test.tsx docs/changelog.md PRDs/roadmap.md docs/superpowers/plans/2026-08-15-purchase-payment-actions.md
git commit -m "Place purchase actions in payment card"
```

Expected: only the five planned files are staged and the commit succeeds.
