import type { ExpenseCategory } from '@/types';

export const EXPENSE_CATEGORY_DUPLICATE_MESSAGE =
  'An active category with this name already exists.';

export function validateExpenseCategoryName(
  name: string,
  categories: ExpenseCategory[],
  excludeId?: string
): string | null {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return 'Enter a category name.';

  const duplicate = categories.some(
    (category) =>
      category.is_active &&
      category.id !== excludeId &&
      category.name.trim().toLocaleLowerCase() === normalized
  );
  return duplicate ? EXPENSE_CATEGORY_DUPLICATE_MESSAGE : null;
}

export function nextExpenseCategorySortOrder(
  categories: ExpenseCategory[]
): number {
  return (
    categories.reduce(
      (highest, category) => Math.max(highest, category.sort_order),
      0
    ) + 1
  );
}
