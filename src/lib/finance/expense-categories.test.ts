import { describe, expect, it } from 'vitest';

import type { ExpenseCategory } from '@/types';
import {
  nextExpenseCategorySortOrder,
  validateExpenseCategoryName,
} from './expense-categories';

const categories: ExpenseCategory[] = [
  {
    id: 'rent',
    account_id: 'account-1',
    name: 'Rent',
    is_active: true,
    sort_order: 2,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'legacy-rent',
    account_id: 'account-1',
    name: 'Legacy rent',
    is_active: false,
    sort_order: 8,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
];

describe('expense category helpers', () => {
  it('rejects an empty trimmed name', () => {
    expect(validateExpenseCategoryName('   ', categories)).toBe(
      'Enter a category name.'
    );
  });

  it('rejects a case-insensitive active duplicate', () => {
    expect(validateExpenseCategoryName(' rent ', categories)).toBe(
      'An active category with this name already exists.'
    );
  });

  it('allows an edited category to keep its own name', () => {
    expect(
      validateExpenseCategoryName(' Rent ', categories, 'rent')
    ).toBeNull();
  });

  it('allows a name used only by an archived category', () => {
    expect(validateExpenseCategoryName(' legacy RENT ', categories)).toBeNull();
  });

  it('places a new category after the highest existing sort order', () => {
    expect(nextExpenseCategorySortOrder(categories)).toBe(9);
    expect(nextExpenseCategorySortOrder([])).toBe(1);
  });
});
