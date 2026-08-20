# Performance Expenses and Expense Category Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-wide posted expense totals to the All staff Performance CSV, then add admin-managed expense categories under Settings → Payments.

**Architecture:** A focused finance loader reuses the existing month and expense-summary contracts and feeds an optional CSV finance summary only for All staff. A separate pure category helper owns name validation, active-collision detection, and ordering while a client settings card owns Supabase loading/mutations and shared-primitives UI.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 6, Supabase JS 2, Tailwind v4, Base UI/shadcn primitives, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-20-performance-expenses-and-category-settings-design.md`

## Global Constraints

- Implement and verify item 1 before starting item 2.
- Expenses are branch-wide and appear only in the All staff branch Performance export.
- Organization Performance is unchanged.
- Only posted expenses contribute; void expenses never contribute.
- Category management lives in Settings → Payments and uses the existing `expense_categories` table and admin+ capability/RLS.
- Never delete categories; archive and restore them.
- Every RLS-sensitive update must chain `.select('id')` and reject an empty row result.
- Reuse existing UI masters without editing or restyling them.
- Update `docs/changelog.md`, `PRDs/roadmap.md`, and `PRDs/finance_master_section.md` when both items ship.

---

### Task 1: Posted Expense Totals and Performance CSV Contract

**Files:**

- Modify: `src/lib/finance/overview.ts`
- Modify: `src/lib/finance/overview.test.ts`
- Modify: `src/lib/reports/reporting.ts`
- Modify: `src/lib/reports/reporting.test.ts`

**Interfaces:**

- Produces: `FinanceExpenseTotals = { current: number; previous: number }`
- Produces: `loadFinanceExpenseTotals(db, month): Promise<FinanceExpenseTotals>`
- Changes: `ownerReportCsv(report, adPerformance?, expenseTotals?)`

- [ ] **Step 1: Write failing finance helper tests**

Add a loader test using a query double whose terminal result contains posted current/previous rows and a void row. Assert the helper queries the two-month bounds and returns literal totals `{ current: 1500, previous: 700 }`. The production regression caught is including void rows or assigning a boundary row to the wrong month.

- [ ] **Step 2: Run the finance helper test and verify RED**

Run: `npm test -- src/lib/finance/overview.test.ts`

Expected: FAIL because `loadFinanceExpenseTotals` is not exported.

- [ ] **Step 3: Implement the focused expense-total loader**

Export the totals type and loader. Derive the period with `financeMonthRange(month)`, select only the expense summary fields, constrain posted status and `[previousStart, nextStart)`, and pass rows to `summarizeFinanceExpenses`:

```ts
export interface FinanceExpenseTotals {
  current: number;
  previous: number;
}

export async function loadFinanceExpenseTotals(
  db: SupabaseClient,
  month: string
): Promise<FinanceExpenseTotals> {
  const period = financeMonthRange(month);
  const { data, error } = await db
    .from('expenses')
    .select('id, occurred_on, amount, description, method, status, created_at')
    .eq('status', 'posted')
    .gte('occurred_on', period.previousStart)
    .lt('occurred_on', period.nextStart);
  if (error) throw error;
  const summary = summarizeFinanceExpenses(
    (data ?? []) as FinanceOverviewExpenseRow[],
    period
  );
  return { current: summary.current, previous: summary.previous };
}
```

- [ ] **Step 4: Run the finance helper test and verify GREEN**

Run: `npm test -- src/lib/finance/overview.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Performance CSV tests**

Extend the CSV test with literal expense totals and assert:

```ts
expect(csv).toContain('Expenses,1500,700');
expect(csv).toContain('Net cash,-1500,-700');
expect(ownerReportCsv(report)).not.toContain('Expenses,');
expect(ownerReportCsv(report)).not.toContain('Net cash,');
```

Use a report fixture with known nonzero revenue when asserting net cash in the final test so the expected subtraction is hand-derived.

- [ ] **Step 6: Run the reporting test and verify RED**

Run: `npm test -- src/lib/reports/reporting.test.ts`

Expected: FAIL because `ownerReportCsv` does not accept or render expense totals.

- [ ] **Step 7: Extend the optional CSV finance summary**

Import `FinanceExpenseTotals`, add the optional third argument, and append `Expenses` and `Net cash` rows immediately after Revenue collected only when totals are present.

- [ ] **Step 8: Run both focused suites and verify GREEN**

Run: `npm test -- src/lib/finance/overview.test.ts src/lib/reports/reporting.test.ts`

Expected: PASS with zero failures.

### Task 2: All Staff Performance Integration

**Files:**

- Modify: `src/components/reports/owner-reports-view.tsx`

**Interfaces:**

- Consumes: `loadFinanceExpenseTotals(db, month)`
- Consumes: `ownerReportCsv(report, adPerformance, expenseTotals)`

- [ ] **Step 1: Extend the cached snapshot**

Add `expenseTotals: FinanceExpenseTotals | null` to `PerformanceSnapshot`.

- [ ] **Step 2: Load only for All staff**

Add a third `Promise.all` entry:

```ts
selectedStaffUserId
  ? Promise.resolve(null)
  : loadFinanceExpenseTotals(db, selectedMonth);
```

Store the returned totals with the report and ad-performance data.

- [ ] **Step 3: Pass totals to export**

Read the cached `expenseTotals` and call:

```ts
ownerReportCsv(report, adPerformance, expenseTotals);
```

No totals exist in staff-scoped snapshots, so their CSV contract remains unchanged.

- [ ] **Step 4: Verify item 1 before moving on**

Run:

```bash
npm test -- src/lib/finance/overview.test.ts src/lib/reports/reporting.test.ts
npm run typecheck
npm run lint -- src/components/reports/owner-reports-view.tsx src/lib/finance/overview.ts src/lib/reports/reporting.ts
```

Expected: all commands exit 0. Do not start Task 3 until they do.

### Task 3: Expense Category Domain Helpers and Settings Card

**Files:**

- Create: `src/lib/finance/expense-categories.ts`
- Create: `src/lib/finance/expense-categories.test.ts`
- Create: `src/components/settings/expense-categories-card.tsx`
- Modify: `src/components/settings/deals-settings.tsx`

**Interfaces:**

- Produces: `validateExpenseCategoryName(name, categories, excludeId?): string | null`
- Produces: `nextExpenseCategorySortOrder(categories): number`
- Produces: `ExpenseCategoriesCard`

- [ ] **Step 1: Write failing pure helper tests**

Use literal `ExpenseCategory` rows and assert:

- whitespace-only names return `Enter a category name.`;
- `rent` collides with active `Rent` case-insensitively;
- the edited row can keep its own name via `excludeId`;
- an archived duplicate does not block adding a new active category;
- sort order returns one greater than the maximum, or `1` for an empty list.

- [ ] **Step 2: Run the category helper test and verify RED**

Run: `npm test -- src/lib/finance/expense-categories.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement minimal pure helpers**

Normalize with `trim().toLocaleLowerCase()` only for comparison. Preserve the trimmed display name for persistence. Active rows alone participate in collision checks.

- [ ] **Step 4: Run the category helper test and verify GREEN**

Run: `npm test -- src/lib/finance/expense-categories.test.ts`

Expected: PASS.

- [ ] **Step 5: Build the settings card using existing primitives**

Create a client component that:

- loads all categories with `loadExpenseCategories(db, true)` in a cancellable async effect;
- derives admin access through `canManageExpenseCategories(accountRole)`;
- shows active rows before archived rows;
- exposes Add and Edit through one controlled Dialog;
- exposes Archive/Restore through the row DropdownMenu;
- disables submission until a non-empty change exists;
- reports validation inline and other failures through `getErrorMessage`/toast;
- translates SQLSTATE `23505` into `An active category with this name already exists.`;
- refreshes with a nonce after success;
- chains `.select('id')` on updates and rejects empty results; and
- renders explicit loading, retry, empty, and read-only states.

- [ ] **Step 6: Mount the card under Settings → Payments**

Import and render `<ExpenseCategoriesCard />` after `<RazorpaySettingsCard />` in `DealsSettings`.

- [ ] **Step 7: Verify item 2**

Run:

```bash
npm test -- src/lib/finance/expense-categories.test.ts src/lib/auth/roles.test.ts
npm run typecheck
npm run lint -- src/components/settings/expense-categories-card.tsx src/components/settings/deals-settings.tsx src/lib/finance/expense-categories.ts
```

Expected: all commands exit 0.

### Task 4: Documentation and Full Verification

**Files:**

- Modify: `docs/changelog.md`
- Modify: `PRDs/roadmap.md`
- Modify: `PRDs/finance_master_section.md`

**Interfaces:** None.

- [ ] **Step 1: Update shipped documentation**

Add a terse changelog entry naming the Performance export and Settings files. Replace the roadmap's immediate pending language with shipped language. Mark expense-category settings and the Performance export integration built in the finance PRD while leaving unrelated invoice, AutoPay, GST, and acceptance-matrix work untouched.

- [ ] **Step 2: Format changed files**

Run Prettier only on changed TypeScript, TSX, Markdown, and test files.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
git diff --check
```

Expected: every command exits 0 with zero test failures, type errors, lint errors/warnings, formatting differences, build errors, or whitespace errors.

- [ ] **Step 4: Review the final diff against the spec**

Confirm All staff-only finance export behavior, organization exclusion, posted-only totals, admin/read-only category behavior, no category deletion, documentation completeness, and absence of unrelated changes.
