// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-id',
    accountRole: 'owner',
    profileLoading: false,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (resolve: (value: { data: []; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return builder;
    },
  }),
}));

const { ExpenseCategoriesCard } = await import('./expense-categories-card');

afterEach(cleanup);

describe('ExpenseCategoriesCard', () => {
  it('shows one add action when the editable category list is empty', async () => {
    render(<ExpenseCategoriesCard />);

    await screen.findByText('No expense categories yet');
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: 'Add category' })
      ).toHaveLength(1);
    });
  });
});
