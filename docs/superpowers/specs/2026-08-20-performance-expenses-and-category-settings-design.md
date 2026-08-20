# Performance Expenses and Expense Category Settings Design

## Goal

Complete the two immediate Business finance follow-ups in order:

1. include general posted-expense totals in the branch-level Performance CSV export; and
2. let account admins manage expense categories from Settings → Payments.

The work must preserve the existing finance ledger, tenant boundary, role model, localization layer, and append-preserving expense history.

## Scope

### Included

- Current- and previous-calendar-month posted expense totals for the selected branch.
- `Expenses` and `Net cash` rows in the All staff Performance CSV summary.
- A Settings → Payments category-management card.
- Add, rename, archive, and restore actions for expense categories.
- Read-only category visibility for agents and viewers.
- Loading, retry, empty, validation, duplicate-name, permission, and silent-write-failure states.
- Tests and the required roadmap and changelog updates.

### Excluded

- Expense totals in the visible Performance dashboard.
- Expense or profit attribution to individual staff.
- Category deletion or reordering.
- General ledger, budgets, recurring scheduling, vendors, or payroll.
- Changes to the Business → Expenses ledger filters or expense-entry workflow.
- New database tables, RLS policies, RPCs, or migrations unless implementation reveals that the existing grants do not support the already-designed admin operations.

## Performance Export Design

### Data boundary

Expenses belong to a branch, not to an assigned staff member. The branch-level Performance loader will fetch posted expenses for the selected and previous calendar months only when the scope is All staff. Individual-staff exports will not include branch-wide expense or net-cash figures because combining them with staff-scoped revenue would imply a false staff profit result.

Organization Performance remains unchanged. Its consolidated export has a separate multi-branch and currency contract and must not silently inherit a selected-branch total.

### Loading

A focused finance helper will:

- derive current and previous month bounds with the existing `financeMonthRange` helper;
- query only `amount`, `occurred_on`, and `status` from `expenses` for the two-month window;
- require `status = 'posted'` at the query boundary;
- reuse the existing posted-expense summarization rule; and
- return `{ current: number, previous: number }`.

The Performance view will load this helper alongside the owner report and paid-social cohort for All staff. A single load failure continues to use the existing Performance recovery state rather than exporting a partial financial summary.

### CSV contract

`ownerReportCsv` will accept an optional finance summary containing current and previous expenses. When present, the Summary section will add:

- `Expenses` with current and previous values; and
- `Net cash` with `revenue - expenses` for current and previous values.

When absent, the export remains byte-compatible with the existing staff-scoped behavior apart from unrelated formatting changes made by repository tooling.

## Expense Category Settings Design

### Placement and hierarchy

The category manager will be a focused card inside the existing Settings → Payments panel, after UPI and Razorpay setup. This follows the finance PRD and avoids adding another Settings rail destination for a small supporting catalogue.

The card will use existing shared primitives only: `Card`, `Button`, `Input`, `Label`, `Dialog`, `DropdownMenu`, `Badge`, `Alert`, and the established settings loading/retry patterns. No shared UI master needs modification.

### List behavior

The client loads all current-tenant `expense_categories`, sorted with active categories first and then by `sort_order` and name. Each row shows the category name and an Archived badge when inactive.

Admins see a row action menu:

- Edit name
- Archive category, when active
- Restore category, when archived

Agents and viewers see the same catalogue without mutation actions plus concise read-only guidance.

An empty catalogue shows a recoverable empty state. Admins may add the first category from that state.

### Mutations

Add and rename use a compact dialog with one labelled name field. Names are trimmed, must be non-empty, and compare case-insensitively against active categories before submission. Add assigns the next `sort_order` after the current maximum. Rename preserves the category identity and ordering.

Archive and restore update `is_active`; referenced expenses remain valid because categories are never deleted. Restore checks for an active case-insensitive name collision before writing. Database uniqueness remains authoritative for concurrent changes.

Every update chains `.select('id')` and treats an empty result as failure because RLS-blocked writes may otherwise appear successful. Insert returns the inserted row. Errors are routed through `getErrorMessage`, with duplicate-name errors translated into plain language. Successful mutations refresh the catalogue and show a concise toast.

### Authorization

The UI gate uses the existing `canManageExpenseCategories(accountRole)` predicate. Database enforcement remains the existing admin+ insert/update RLS on `expense_categories`. No inline role comparison will be introduced.

## Error Handling

- Performance finance data is not silently dropped: a failed expense-total request puts the existing Performance surface into its recoverable error state.
- Category loading exposes an in-card error with Retry.
- Invalid or duplicate names stay in the dialog with an inline message.
- Permission and silent-write failures produce a user-facing error without optimistic list mutation.
- Archive and restore remain recoverable because no category row is deleted.

## Testing

Implementation follows red-green-refactor.

- Finance helper tests prove posted rows are summed, void rows are excluded, and current/previous calendar boundaries are respected.
- Performance CSV tests prove expense and net-cash rows appear when the optional finance summary is supplied and remain absent for staff-scoped exports.
- Category helper tests prove trimming, empty-name rejection, case-insensitive active collisions, archived-name behavior, and next sort-order calculation.
- Component-level tests will cover category loading and mutations where the existing Vitest/React test harness can assert real user-visible behavior without replacing the implementation with mocks.
- Targeted tests run first, followed by TypeScript, ESLint, formatting checks, the relevant broader Vitest suite, and a production build.

## Documentation and Completion

After both items pass verification:

- update `docs/changelog.md` with the shipped Performance export and category-settings behavior;
- update `PRDs/roadmap.md` and `PRDs/finance_master_section.md` so neither item remains pending; and
- record any operational gotcha discovered during implementation.

Item 1 must be implemented and verified before item 2 begins.
