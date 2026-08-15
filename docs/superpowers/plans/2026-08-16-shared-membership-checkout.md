# Shared Membership Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the fresh Codex task. Do not delegate to subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one database-authoritative membership checkout shared by Add member, lead conversion, trial conversion, and membership renewal, with one-cycle offers, the catalogue table, and optional full or 60/40 collection.

**Architecture:** A pure TypeScript quote/draft module defines the client contract, while one controlled `MembershipCheckoutPanel` renders the canonical right side. Existing hosts keep distinct left context and submit through `/api/member-checkouts`; a Supabase migration derives pricing, offer snapshots, dates, and collection amounts server-side in one idempotent transaction.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 6, Supabase Postgres/RLS/RPCs, Tailwind v4, Base UI/shadcn, Vitest, Testing Library.

## Global Constraints

- Work directly in the existing `main` checkout. Do not create a branch or worktree.
- Before editing the route, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` completely.
- Before UI work, reread `docs/ui-patterns.md`; before billing work, reread `docs/gym-domain.md`.
- Add no dependency or Zod. Do not add or modify a `src/components/ui/` master.
- Agent+ may apply structured membership offers. Catalogue price overrides remain admin+ with a stored reason.
- Offers affect only the membership line and one opened period; they never change the pricing option or catalogue lines.
- Add/lead-convert/trial-convert use first-cycle price. Renewal excludes setup fee.
- Disabled **Collect payment now** creates a due invoice with no payment/promise. Full and 60/40 use combined post-credit cash due.
- Preserve arrears, AutoPay locks, localization, idempotency, append-only ledgers, and payment-purpose attribution.
- Never use `supabase db push`. Apply the migration through the approved Supabase tool and verify it.
- Completion requires `docs/changelog.md` and `PRDs/roadmap.md`.

---

### Task 1: Shared checkout draft and quote

**Files:**
- Create: `src/lib/memberships/checkout.ts`
- Create: `src/lib/memberships/checkout.test.ts`
- Modify: `src/types/index.ts:1199-1204,1360-1368`

**Interfaces:**

```ts
export type MembershipCheckoutMode =
  | 'join'
  | 'convert'
  | 'membership_renewal';
export type MembershipCollectionTiming = 'full' | 'installments';

export interface MembershipCheckoutDraft {
  planId: string;
  optionId: string | null;
  startDate: string;
  discountKind: OneTimeDiscountKind | null;
  discountValue: string;
  bonusMonthsEnabled: boolean;
  bonusMonths: string;
  includeProductsServices: boolean;
  selections: CheckoutSelection[];
  collectNow: boolean;
  collectionTiming: MembershipCollectionTiming;
  paymentMethod: PaymentMethod;
}

export interface MembershipCheckoutQuote {
  listPrice: number;
  discountAmount: number;
  membershipFee: number;
  standardEndDate: string;
  periodEnd: string;
  bonusMonths: number;
  addOnTotal: number;
  invoiceTotal: number;
  creditApplied: number;
  cashDue: number;
  installmentNow: number;
  installmentLater: number;
}

export function createMembershipCheckoutDraft(input: {
  planId?: string | null;
  optionId?: string | null;
  startDate: string;
  paymentMethod?: PaymentMethod;
}): MembershipCheckoutDraft;

export function quoteMembershipCheckout(input: {
  mode: MembershipCheckoutMode;
  option: PlanPricingOption;
  startDate: string;
  discountKind: OneTimeDiscountKind | null;
  discountValue: string;
  bonusMonthsEnabled: boolean;
  bonusMonths: string;
  selections: CheckoutSelection[];
  availableCredit?: number;
}): MembershipCheckoutQuote;
```

- [x] **Step 1: Write failing tests**

```ts
expect(quote({ mode: 'join' }).listPrice).toBe(1200);
expect(quote({ mode: 'convert' }).listPrice).toBe(1200);
expect(quote({ mode: 'membership_renewal' }).listPrice).toBe(1000);

const offered = quote({
  mode: 'membership_renewal',
  discountKind: 'percentage',
  discountValue: '10',
  bonusMonthsEnabled: true,
  bonusMonths: '1',
  selections: [
    { item_id: 'item', option_id: 'option', quantity: 2, unit_amount: 250 },
  ],
  availableCredit: 200,
});
expect(offered).toMatchObject({
  listPrice: 1000,
  discountAmount: 100,
  membershipFee: 900,
  addOnTotal: 500,
  invoiceTotal: 1400,
  cashDue: 1200,
});
expect(offered.installmentNow + offered.installmentLater).toBe(1200);
```

- [x] **Step 2: Verify red**

Run: `npm test -- src/lib/memberships/checkout.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement minimal quote/draft helpers**

```ts
const listPrice =
  input.mode === 'membership_renewal'
    ? renewalFee(input.option)
    : firstCycleFee(input.option);
const discount = oneTimeDiscountQuote(
  listPrice,
  input.discountKind,
  input.discountValue
);
const standardEndDate = optionEndDate(input.startDate, input.option);
const bonus = oneTimeBonusMonthsQuote(
  standardEndDate,
  input.bonusMonthsEnabled,
  input.bonusMonths
);
const addOnTotal = input.selections.reduce(
  (sum, line) =>
    sum + Number(line.unit_amount ?? 0) * Number(line.quantity ?? 1),
  0
);
const invoiceTotal = roundMoney(discount.firstInvoiceTotal + addOnTotal);
const creditApplied = Math.min(
  Math.max(Number(input.availableCredit ?? 0), 0),
  invoiceTotal
);
const cashDue = roundMoney(invoiceTotal - creditApplied);
const installments = installmentAmounts(cashDue);
```

Reuse both existing offer validators. Reject invalid start dates, negative/non-finite catalogue amounts, and non-positive installment halves.

- [x] **Step 4: Verify green**

Run: `npm test -- src/lib/memberships/checkout.test.ts src/lib/memberships/discount.test.ts src/lib/memberships/bonus-time.test.ts src/lib/memberships/installments.test.ts src/lib/memberships/pricing.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/memberships/checkout.ts src/lib/memberships/checkout.test.ts src/types/index.ts
git commit -m "feat: define shared membership checkout model"
```

---

### Task 2: Database-authoritative offers and collection

**Files:**
- Create: `supabase/migrations/20260816120000_shared_membership_checkout.sql`
- Create: `supabase/tests/shared_membership_checkout_acceptance.sql`

**Interfaces:**
- Consumes: existing checkout RPCs, `renew_membership_transaction`, catalogue/credit helpers, installment table, and period offer columns.
- Produces: revoked internal `quote_membership_checkout_offer(UUID,TEXT,UUID,UUID,DATE,TEXT,NUMERIC,INTEGER)` and revised checkout intent:

```json
{
  "membership": {
    "plan_id": "uuid",
    "pricing_option_id": "uuid",
    "period_start": "YYYY-MM-DD",
    "discount_type": "percentage",
    "discount_value": 10,
    "bonus_months": 1
  },
  "collection": {
    "collect_now": true,
    "timing": "full",
    "method": "cash",
    "paid_at": "ISO timestamp"
  }
}
```

- [ ] **Step 1: Write rollback acceptance SQL**

Cover deferred lead conversion, forged-fee rejection, renewal discount/bonus snapshots, post-credit renewal installments, idempotent retry, and authenticated denial of direct legacy renewal RPC. Use explicit assertions:

```sql
IF (
  SELECT count(*) FROM public.payments WHERE invoice_id = v_invoice_id
) <> 0 THEN
  RAISE EXCEPTION 'deferred conversion unexpectedly recorded payment';
END IF;
```

End the fixture script with `ROLLBACK`.

- [ ] **Step 2: Verify acceptance is red before migration**

Run through the approved Supabase SQL connection.

Expected failures: positive-payment conversion guard, forged fee acceptance, and missing renewal installments.

- [ ] **Step 3: Add authoritative quote helper**

```sql
CREATE OR REPLACE FUNCTION public.quote_membership_checkout_offer(
  p_account_id UUID,
  p_mode TEXT,
  p_plan_id UUID,
  p_pricing_option_id UUID,
  p_period_start DATE,
  p_discount_type TEXT,
  p_discount_value NUMERIC,
  p_bonus_months INTEGER
)
RETURNS TABLE(
  list_price NUMERIC,
  discount_amount NUMERIC,
  fee_amount NUMERIC,
  standard_period_end DATE,
  period_end DATE,
  bonus_months INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '';

REVOKE ALL ON FUNCTION public.quote_membership_checkout_offer(
  UUID,TEXT,UUID,UUID,DATE,TEXT,NUMERIC,INTEGER
) FROM PUBLIC, anon, authenticated;
```

Resolve an active account-owned option. Use `price + setup_fee` for join/convert and `price` for renewal. Validate offer math against existing constraints, derive calendar duration, and cap whole bonus months at 120.

- [ ] **Step 4: Recreate join checkout**

`perform_join_checkout` must ignore browser fee/end/snapshot calculations, insert the helper result, and remove the convert-positive-payment requirement. After catalogue and credit:

```sql
SELECT total, credit_applied, balance
INTO v_total, v_credit_applied, v_cash_due
FROM public.invoice_balances
WHERE id = v_invoice_id;

v_collect_now :=
  COALESCE((v_collection->>'collect_now')::BOOLEAN, TRUE);
v_timing := COALESCE(NULLIF(v_collection->>'timing', ''), 'full');
v_collect := CASE
  WHEN NOT v_collect_now OR v_cash_due <= 0 THEN 0
  WHEN v_timing = 'installments' THEN ROUND(v_cash_due * 0.60, 2)
  ELSE v_cash_due
END;
```

Create a promise only when both derived installments are positive.

- [ ] **Step 5: Recreate member checkout**

Preserve sale/service-renewal behavior outside their branch. For existing trial conversion and membership renewal, quote server-side, pass only derived values to `renew_membership_transaction`, and stamp the target period:

```sql
UPDATE public.membership_periods
SET list_price = v_quote.list_price,
    discount_type = NULLIF(v_discount_type, ''),
    discount_value =
      CASE WHEN v_discount_type IS NULL THEN NULL ELSE v_discount_value END,
    discount_amount = v_quote.discount_amount,
    standard_period_end =
      CASE
        WHEN v_quote.bonus_months > 0 THEN v_quote.standard_period_end
        ELSE NULL
      END,
    bonus_months = v_quote.bonus_months
WHERE id = v_period_id;
```

Synchronize invoice-line `list_amount`; keep `unit_amount/line_amount` equal to derived fee. Add deferred/full/installment membership collection from post-credit balance.

- [ ] **Step 6: Generalize installment validation**

```sql
SELECT balance
INTO v_remaining
FROM public.invoice_balances
WHERE id = v_invoice.id;

v_cash_due_before_first := ROUND(v_remaining + v_payment.amount, 2);
v_expected_first := ROUND(v_cash_due_before_first * 0.60, 2);

IF NEW.first_amount <> v_expected_first
  OR NEW.second_amount <>
    ROUND(v_cash_due_before_first - v_expected_first, 2)
  OR v_payment.amount <> NEW.first_amount
  OR NEW.split_percent_now <> 60
THEN
  RAISE EXCEPTION
    'Installment amounts must use the 60/40 post-credit balance split';
END IF;
```

Retain exact account-local paid date plus 28 days and all tenant/reference guards.

- [ ] **Step 7: Revoke direct arbitrary renewal execution**

```sql
REVOKE EXECUTE ON FUNCTION public.renew_membership_transaction(
  UUID,UUID,DATE,DATE,NUMERIC,NUMERIC,TEXT,BOOLEAN,UUID,UUID
) FROM PUBLIC, anon, authenticated;
```

Confirm application code has no direct caller. Owner-executed checkout RPC may call it internally.

- [ ] **Step 8: Apply and verify**

Apply through the approved Supabase migration tool, never `db push`. Run the rollback acceptance SQL. Verify checkout RPC grants and authenticated denial of direct legacy renewal.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260816120000_shared_membership_checkout.sql supabase/tests/shared_membership_checkout_acceptance.sql
git commit -m "feat: enforce shared membership checkout transaction"
```

---

### Task 3: Canonical shared checkout panel

**Files:**
- Create: `src/components/members/membership-checkout-panel.tsx`
- Create: `src/components/members/membership-checkout-panel.test.tsx`
- Modify only if needed for accessibility/test surface: `src/components/members/products-services-picker.tsx:61-78`

**Interface:**

```ts
export interface MembershipCheckoutPanelProps {
  idPrefix: string;
  mode: MembershipCheckoutMode;
  plans: MembershipPlan[];
  plansLoading: boolean;
  value: MembershipCheckoutDraft;
  onChange: (next: MembershipCheckoutDraft) => void;
  availableCredit?: number;
  allowTrial?: boolean;
  startDateEditable: boolean;
  renewalStartExplanation?: string;
}
```

- [ ] **Step 1: Write failing interaction tests**

```tsx
expect(
  screen
    .getAllByRole('heading', { level: 3 })
    .map((node) => node.textContent)
).toEqual([
  'Membership details',
  'Offer discount',
  'Offer bonus months',
  'Products & services',
  'Collect payment now',
]);

await user.click(
  screen.getByRole('checkbox', { name: 'Products & services' })
);
expect(screen.getByTestId('catalogue-table')).toBeVisible();
await user.click(
  screen.getByRole('checkbox', { name: 'Products & services' })
);
expect(currentDraft().selections).toEqual([]);
```

Also test offer resets, hidden payment controls, exact **Collect full amount** copy, installment amounts, renewal fee without setup fee, and zero-due behavior.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/members/membership-checkout-panel.test.tsx`

Expected: FAIL because panel does not exist.

- [ ] **Step 3: Implement shared section composition**

Use `Checkbox` inside each header `Label`, and `Collapse` for Discount, Bonus months, Products & services, and Collect payment now. Render products only with `presentation="catalogue"`.

```tsx
<section className="border-border space-y-4 rounded-lg border p-4">
  <h3>
    <Label htmlFor={`${idPrefix}-discount-enabled`}>
      <Checkbox
        id={`${idPrefix}-discount-enabled`}
        checked={value.discountKind !== null}
        onCheckedChange={(checked) =>
          updateDiscountEnabled(checked === true)
        }
      />
      Offer discount
    </Label>
  </h3>
</section>
```

Immediately after the header, render a `Collapse` whose `open` value is `value.discountKind !== null`. Move the existing discount-kind selector and validated discount-value input from `member-form.tsx:1291-1367` into that collapse, preserving their labels, percentage/fixed choices, and reset behavior. Do the same for the existing validated bonus-month input at `member-form.tsx:1452-1518`. These are ordinary panel internals, not new `src/components/ui/` masters.

- [ ] **Step 4: Render invoice/payment summary**

Show membership list price, discount, final fee, add-ons, invoice total, credit, and cash due. Payment cards use exactly **Collect full amount** and **Part now, part later**. Unchecked payment leaves due summary; zero due shows **No payment required**.

- [ ] **Step 5: Verify green**

Run: `npm test -- src/components/members/membership-checkout-panel.test.tsx src/components/members/products-services-picker.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/members/membership-checkout-panel.tsx src/components/members/membership-checkout-panel.test.tsx src/components/members/products-services-picker.tsx
git commit -m "feat: add shared membership checkout panel"
```

---

### Task 4: Integrate Add member and lead conversion

**Files:**
- Modify: `src/components/members/member-form.tsx:150-330,580-890,1180-1750`
- Create: `src/components/members/member-form.checkout.test.tsx`

- [ ] **Step 1: Write failing host tests**

```tsx
expect(
  screen.getByTestId('shared-membership-checkout')
).toHaveAttribute('data-mode', 'join');

await user.click(
  screen.getByRole('checkbox', { name: 'Collect payment now' })
);
await user.click(
  screen.getByRole('button', { name: /add member|convert to member/i })
);
expect(lastCheckoutBody().collection).toMatchObject({
  collect_now: false,
});
expect(lastCheckoutBody().membership).not.toHaveProperty('fee_amount');
expect(lastCheckoutBody().membership).not.toHaveProperty('period_end');
```

Cover unseeded Add and seeded lead Convert. Assert offer intent is included but calculated values are absent.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/members/member-form.checkout.test.tsx`

Expected: FAIL because `MemberForm` owns old inline checkout.

- [ ] **Step 3: Integrate shared draft/panel**

Keep personal info, dedupe, photo, trial, and edit state. For `isCreate`, use one draft/panel. A free trial hides paid offer/catalogue/payment sections. Do not route Edit membership through checkout.

- [ ] **Step 4: Submit intent-only payload**

```ts
membership: {
  plan_id: draft.planId,
  pricing_option_id: draft.optionId,
  period_start: draft.startDate,
  discount_type: draft.discountKind,
  discount_value:
    draft.discountKind ? Number(draft.discountValue) : null,
  bonus_months:
    draft.bonusMonthsEnabled ? Number(draft.bonusMonths) : 0,
},
selections:
  draft.includeProductsServices ? draft.selections : [],
collection: {
  collect_now: quote.cashDue > 0 && draft.collectNow,
  timing: draft.collectionTiming,
  method: draft.paymentMethod,
  paid_at: new Date().toISOString(),
},
```

Preserve contact creation/attachment and idempotency.

- [ ] **Step 5: Verify green**

Run: `npm test -- src/components/members/member-form.checkout.test.tsx src/lib/memberships/checkout.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/members/member-form.tsx src/components/members/member-form.checkout.test.tsx
git commit -m "refactor: share member creation checkout flow"
```

---

### Task 5: Integrate renewal and trial conversion

**Files:**
- Modify: `src/components/members/renew-membership-dialog.tsx:1-510`
- Modify: `src/components/members/renew-membership-dialog.ui-contract.test.ts:1-60`
- Create: `src/components/members/renew-membership-dialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```ts
expect(dialog).toContain('<MembershipCheckoutPanel');
expect(dialog).not.toContain('Fee for this term');
expect(dialog).not.toContain('onValueChange={setFeeAmount}');
expect(dialog).not.toContain('presentation="catalogue"');
```

Behavioral tests assert renewal mode starts at `max(expiry,today)` and trial-convert mode starts today with first-cycle pricing.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/components/members/renew-membership-dialog.ui-contract.test.ts src/components/members/renew-membership-dialog.test.tsx`

Expected: FAIL because the dialog owns raw fee/add-on/payment controls.

- [ ] **Step 3: Reduce dialog to context plus panel**

Keep the left context, arrears warning, shell/footer, caller lifecycle locks, success/refetch, and idempotency reset. Load the current membership's usable credit from `member_credit_balances` with the same account/member scoping and cancelled-effect pattern used by `product-service-sale-checkout.tsx`, then pass the summed balance as `availableCredit`. Treat a failed credit lookup as a blocking checkout error rather than showing an incorrect collection amount.

```ts
const startDate =
  !isConvert &&
  membership.end_date &&
  daysBetween(fmt.today(), membership.end_date) > 0
    ? membership.end_date
    : fmt.today();
```

Use `convert` for trial conversion and `membership_renewal` for renewal.

- [ ] **Step 4: Submit intent-only renewal**

Send Task 4 shape plus `membership_id`. Send no fee, final end, collection amount, or calculated snapshots. Retain **Trial converted to member** / **Membership renewed**.

- [ ] **Step 5: Verify green**

Run: `npm test -- src/components/members/renew-membership-dialog.ui-contract.test.ts src/components/members/renew-membership-dialog.test.tsx src/components/members/membership-checkout-panel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/members/renew-membership-dialog.tsx src/components/members/renew-membership-dialog.ui-contract.test.ts src/components/members/renew-membership-dialog.test.tsx
git commit -m "refactor: share membership renewal checkout"
```

---

### Task 6: Harden API request validation

**Files:**
- Modify: `src/app/api/member-checkouts/route.ts:1-95`
- Create: `src/app/api/member-checkouts/route.test.ts`
- Modify: `src/types/index.ts:1199-1204,1360-1390`

- [ ] **Step 1: Write failing route tests**

```ts
it('rejects browser-authored fee and final end', async () => {
  const response = await post({
    mode: 'membership_renewal',
    membership: {
      ...validMembership,
      fee_amount: 1,
      period_end: '2026-10-01',
    },
  });
  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it('accepts deferred conversion intent', async () => {
  const response = await post({
    mode: 'convert',
    membership: validMembership,
    collection: {
      collect_now: false,
      timing: 'full',
      method: 'cash',
    },
  });
  expect(response.status).toBe(201);
});
```

Also reject bad discount type, invalid bonus months, bad timing/method, missing plan/option/start, and non-array selections.

- [ ] **Step 2: Verify red**

Run: `npm test -- src/app/api/member-checkouts/route.test.ts`

Expected: FAIL because current validation is shallow.

- [ ] **Step 3: Add explicit no-Zod validation**

Read the pinned Next guide first. Reject calculated financial fields:

```ts
if (
  'fee_amount' in membership ||
  'period_end' in membership ||
  'discount_amount' in membership
) {
  return NextResponse.json(
    {
      error:
        'Membership totals and expiry are calculated by UsefulDesk',
    },
    { status: 400 }
  );
}
```

Continue overriding browser `account_id` with `ctx.accountId`; database remains authoritative.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/app/api/member-checkouts/route.test.ts src/components/members/member-form.checkout.test.tsx src/components/members/renew-membership-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/member-checkouts/route.ts src/app/api/member-checkouts/route.test.ts src/types/index.ts
git commit -m "fix: validate membership checkout intent"
```

---

### Task 7: Full verification and documentation

**Files:**
- Modify: `docs/gym-domain.md`
- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- \
  src/lib/memberships/checkout.test.ts \
  src/lib/memberships/discount.test.ts \
  src/lib/memberships/bonus-time.test.ts \
  src/lib/memberships/installments.test.ts \
  src/components/members/products-services-picker.test.tsx \
  src/components/members/membership-checkout-panel.test.tsx \
  src/components/members/member-form.checkout.test.tsx \
  src/components/members/renew-membership-dialog.ui-contract.test.ts \
  src/components/members/renew-membership-dialog.test.tsx \
  src/app/api/member-checkouts/route.test.ts
```

Expected: PASS without React warnings.

- [ ] **Step 2: Run static checks**

```bash
npm run typecheck
npm run lint -- \
  src/lib/memberships/checkout.ts \
  src/components/members/membership-checkout-panel.tsx \
  src/components/members/member-form.tsx \
  src/components/members/renew-membership-dialog.tsx \
  src/app/api/member-checkouts/route.ts
git diff --check
```

Expected: exit 0.

- [ ] **Step 3: Bounded browser verification**

At desktop and phone widths verify Add deferred, lead-convert offered/full, trial-convert 60/40, early renewal offered, expired renewal, zero cash due, add-on clearing, catalogue states, keyboard/focus, footer/scroll, totals/dates, and refreshed member/invoice data.

- [ ] **Step 4: Update durable docs**

Document canonical Add/Convert/Renew offers, catalogue isolation, deferred payment, post-credit installments, and internal-only legacy renewal RPC in `docs/gym-domain.md`. Add a terse changelog entry and move/update the shipped roadmap item.

- [ ] **Step 5: Run final verification**

```bash
npm test
npm run typecheck
npm run lint
git diff --check
git status --short
```

Expected: all checks pass; only intentional changes remain.

- [ ] **Step 6: Commit docs**

```bash
git add docs/gym-domain.md docs/changelog.md PRDs/roadmap.md
git commit -m "docs: record shared membership checkout"
```

- [ ] **Step 7: Completion review**

Invoke `superpowers:verification-before-completion`, inspect the full implementation commit range, then invoke `superpowers:requesting-code-review`. Address in-scope findings, rerun affected checks, and report migration application plus final commits.
