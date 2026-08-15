# Dedicated Member Purchase Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move standalone member Add purchase into a dedicated, member-aware page while preserving the service-renewal dialog and the existing checkout/ledger contract.

**Architecture:** Extract the checkout form and submission state into `ProductServiceSaleCheckout`, which is hosted by both the retained renewal dialog and the new purchase page. Pure navigation helpers build and validate route URLs; the page host owns membership loading, capability gating, member context, and return navigation.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Supabase browser client with RLS, Tailwind v4, shared Base UI/shadcn primitives, Vitest, Testing Library.

## Global Constraints

- Preserve all existing uncommitted catalogue and payment-summary work in `product-service-sale-dialog.tsx`, its tests, and `products-services-picker.tsx`.
- Standalone `sale` mode moves to `/members/purchase`; `service_renewal` remains a dialog.
- Preserve `POST /api/member-checkouts`, idempotency, member credit, price overrides, payment validation, toasts, and immutable-ledger behavior.
- The purchase page uses the shared app header and does not render a second page title.
- Return URLs must be relative `/members` URLs; never pass an untrusted URL to `router.push`.
- Do not change `src/components/ui/*`, database schema, migrations, RPCs, RLS, or API routes.
- Update both `docs/changelog.md` and `PRDs/roadmap.md`.

---

### Task 1: Extract the reusable checkout surface

**Files:**

- Create: `src/components/members/product-service-sale-checkout.tsx`
- Create: `src/components/members/product-service-sale-checkout.test.tsx`
- Modify: `src/components/members/product-service-sale-dialog.tsx`
- Modify: `src/components/members/product-service-sale-dialog.test.tsx`

**Interfaces:**

- Produces: `ProductServiceSaleCheckout({ membership, mode, initialSelections, onSaved, onCancel, className? })`.
- Preserves: `ProductServiceSaleDialog` public props for `service_renewal` consumers.
- `onSaved` fires after a successful API response; `onCancel` is disabled while saving.

- [ ] **Step 1: Read the test-quality rules before changing tests**

Read `superpowers/test-driven-development/writing-good-tests.md`. Name the production behavior each test protects before adding assertions.

- [ ] **Step 2: Write a failing checkout-surface test**

Move the existing responsive-layout assertions to a new test that imports `ProductServiceSaleCheckout` and renders it with one initial selection:

```tsx
render(
  <ProductServiceSaleCheckout
    membership={membership}
    initialSelections={[selection]}
    mode="sale"
    onCancel={vi.fn()}
    onSaved={vi.fn()}
  />
);

expect(screen.getByRole('group', { name: 'Purchase checkout' }).className)
  .toContain('lg:grid');
expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
```

Keep the dialog test focused on title/chrome and confirm it renders the extracted checkout in `service_renewal` mode.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npm test -- src/components/members/product-service-sale-checkout.test.tsx src/components/members/product-service-sale-dialog.test.tsx
```

Expected: FAIL because `product-service-sale-checkout.tsx` and its export do not exist.

- [ ] **Step 4: Extract the minimal implementation**

Move state, credit loading, derived totals, `checkout()`, the responsive item/payment composition, and explicit Cancel/Create actions from the dialog into `ProductServiceSaleCheckout`. Keep the existing `ProductsServicesPicker` props and every validation/submission field unchanged.

Reduce `ProductServiceSaleDialog` to `Dialog`/`DialogContent`/header chrome plus:

```tsx
<ProductServiceSaleCheckout
  membership={membership}
  mode={mode}
  initialSelections={initialSelections}
  onCancel={() => onOpenChange(false)}
  onSaved={() => {
    onOpenChange(false);
    onSaved();
  }}
/>
```

The dialog host continues blocking close while checkout is saving through a surface callback or equivalent controlled state.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 test command. Expected: both files PASS with no React warnings.

- [ ] **Step 6: Run focused static checks**

Run ESLint and Prettier check for the four Task 1 files. Resolve only extraction-related findings.

---

### Task 2: Add safe purchase-navigation helpers and wire the member action

**Files:**

- Create: `src/lib/members/member-purchase-navigation.ts`
- Create: `src/lib/members/member-purchase-navigation.test.ts`
- Modify: `src/components/members/member-detail-view.tsx`

**Interfaces:**

- Produces: `buildMemberPurchaseHref(currentHref: string, membershipId: string): string`.
- Produces: `resolveMemberPurchaseReturn(returnTo: string | null | undefined, membershipId: string): string`.
- The builder copies the active `branch` to the purchase route and encodes the current Members path/query as `returnTo` after setting `member`.

- [ ] **Step 1: Write failing pure-helper tests**

Cover these exact behaviors:

```ts
expect(buildMemberPurchaseHref(
  'http://localhost:3000/members?branch=branch-id&view=all',
  'membership-id'
)).toBe(
  '/members/purchase?membership=membership-id&branch=branch-id&returnTo=%2Fmembers%3Fbranch%3Dbranch-id%26view%3Dall%26member%3Dmembership-id'
);

expect(resolveMemberPurchaseReturn('/members?view=all', 'membership-id'))
  .toBe('/members?view=all&member=membership-id');
expect(resolveMemberPurchaseReturn('https://evil.example', 'membership-id'))
  .toBe('/members?member=membership-id');
expect(resolveMemberPurchaseReturn('/finance', 'membership-id'))
  .toBe('/members?member=membership-id');
```

- [ ] **Step 2: Run helper tests and verify RED**

Run `npm test -- src/lib/members/member-purchase-navigation.test.ts`.

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement strict relative Members navigation**

Use `new URL(currentHref)` only for the trusted current browser URL. Build a fresh `URLSearchParams` for `/members/purchase`. Resolve `returnTo` against a fixed placeholder origin, require that origin and pathname `/members`, set `member`, and return only `pathname + search + hash`.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run the Task 2 test command. Expected: PASS.

- [ ] **Step 5: Replace standalone dialog opening with route navigation**

Import `useRouter` from `next/navigation` and `buildMemberPurchaseHref`. Change `openSale()` to:

```ts
router.push(buildMemberPurchaseHref(window.location.href, membership.id));
```

Retain `saleOpen`, `saleInitial`, and `ProductServiceSaleDialog` only for `renewService()`, always passing `mode="service_renewal"`. Remove the now-unreachable standalone sale state branch.

- [ ] **Step 6: Run focused tests and static checks**

Run the helper tests, existing member-related tests, ESLint, and Prettier check for the Task 2 files.

---

### Task 3: Build the member-aware purchase page

**Files:**

- Create: `src/app/(dashboard)/members/purchase/page.tsx`
- Create: `src/app/(dashboard)/members/purchase/member-purchase-page.tsx`
- Create: `src/app/(dashboard)/members/purchase/member-purchase-page.test.tsx`
- Modify: `src/components/layout/header.tsx`

**Interfaces:**

- The server `page.tsx` awaits Next.js 16's `searchParams` promise and passes scalar `membershipId` and `returnTo` props to the client host.
- `MemberPurchasePage({ membershipId, returnTo })` loads `Membership` with `contact:contacts(*)` and `plan:membership_plans(*)`.
- The client host calls `resolveMemberPurchaseReturn` once and uses `router.push(safeReturn)` for Cancel and success.

- [ ] **Step 1: Write a failing page-host test**

Mock `next/navigation`, `useAuth`, locale, Supabase, and `ProductServiceSaleCheckout`. Assert that a successful membership response renders:

```tsx
expect(screen.getByText('Mira Shah')).toBeTruthy();
expect(screen.getByText('+91 90000 00000')).toBeTruthy();
expect(screen.getByText('1007')).toBeTruthy();
expect(screen.getByText('Strength Monthly')).toBeTruthy();
expect(screen.getByText('15 Sep 2026')).toBeTruthy();
expect(screen.getByTestId('purchase-checkout')).toBeTruthy();
```

Add separate tests for missing membership ID, Supabase error/no row, and viewer role. Each must show **Back to members** and must not render checkout.

- [ ] **Step 2: Run the page-host test and verify RED**

Run `npm test -- src/app/(dashboard)/members/purchase/member-purchase-page.test.tsx`.

Expected: FAIL because the page host does not exist.

- [ ] **Step 3: Implement the server page boundary**

Await:

```ts
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const query = await searchParams;
const membershipId = typeof query.membership === 'string' ? query.membership : null;
const returnTo = typeof query.returnTo === 'string' ? query.returnTo : null;
```

Render `MemberPurchasePage` with those scalar props. The dashboard layout remains the authentication boundary.

- [ ] **Step 4: Implement member loading, gating, and context**

Use an inline async IIFE with a `cancelled` guard. Query one membership by id and render explicit loading/error/unauthorized states. Gate checkout with `profileLoading === false`, non-null `accountRole`, and `canSellProductsServices(accountRole)`.

Render member context with `MemberIdentity` plus a compact `<dl>` for **Member ID**, **Plan**, and **Expiry**. Use `fmt.date` and pass the contact avatar URL.

- [ ] **Step 5: Wire cancel and success navigation**

Pass the same `navigateBack` handler to `onCancel` and `onSaved`:

```ts
const safeReturn = resolveMemberPurchaseReturn(returnTo, membershipId ?? '');
const navigateBack = () => router.push(safeReturn);
```

Do not navigate on checkout failure; the surface retains selections for retry.

- [ ] **Step 6: Give the fixed route its app-header title**

Add `'/members/purchase': 'Add purchase'` before the general `/members` entry in `pageTitles`. Do not add a content heading.

- [ ] **Step 7: Run page tests and verify GREEN**

Run the Task 3 test command. Expected: all page-host states PASS.

- [ ] **Step 8: Run focused static checks**

Run ESLint and Prettier check for the four Task 3 files.

---

### Task 4: Document and verify the complete flow

**Files:**

- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Modify if verification finds scoped defects: Task 1–3 implementation/test files only

**Interfaces:**

- Documents the shipped standalone page and retained service-renewal dialog.
- Produces fresh automated and visual evidence for completion.

- [ ] **Step 1: Update shipped documentation**

Revise the existing Add purchase changelog and roadmap entries rather than adding contradictory duplicates. State that standalone purchase is a member-aware page, cancel/success reopen the member profile, and checkout/ledger behavior is unchanged.

- [ ] **Step 2: Load the Impeccable craft floor before final UI edits**

Read `impeccable/reference/craft-floor.md`, then run the layout detector over the changed UI files. Fix only findings within this feature.

- [ ] **Step 3: Run the focused regression suite**

Run all new/changed tests together and confirm zero failures and warnings.

- [ ] **Step 4: Run repository verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

Every command must exit 0 before claiming completion.

- [ ] **Step 5: Perform one bounded browser pass**

At desktop and narrow mobile widths, verify: member context, catalogue/payment layout, item selection, Cancel return, successful return if a safe non-financial fixture is available, invalid-member recovery, and service-renewal dialog availability. Fix all scoped visual defects in one batch and confirm once.

- [ ] **Step 6: Review the final diff**

Confirm the diff preserves pre-existing uncommitted catalogue work, does not touch shared UI masters or financial APIs, and contains the route, reusable checkout, navigation helper, focused tests, and required documentation.
