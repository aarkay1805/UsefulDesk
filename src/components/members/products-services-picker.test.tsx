// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckoutSelection } from '@/types';

const catalogue = [
  {
    id: 'product-id',
    account_id: 'account-id',
    kind: 'merchandise',
    name: 'Protein powder',
    description: 'Chocolate, 1 kg',
    requires_trainer: false,
    is_active: true,
    created_by: 'user-id',
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-15T00:00:00Z',
    catalog_options: [
      {
        id: 'product-option-id',
        account_id: 'account-id',
        item_id: 'product-id',
        duration_count: null,
        duration_unit: null,
        standard_price: 1500,
        is_active: true,
        sort_order: 0,
        created_at: '2026-08-15T00:00:00Z',
        updated_at: '2026-08-15T00:00:00Z',
        trainer_rates: [],
      },
    ],
  },
  {
    id: 'service-id',
    account_id: 'account-id',
    kind: 'service',
    name: 'Nutrition coaching',
    description: null,
    requires_trainer: false,
    is_active: true,
    created_by: 'user-id',
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-15T00:00:00Z',
    catalog_options: [
      {
        id: 'service-option-id',
        account_id: 'account-id',
        item_id: 'service-id',
        duration_count: 1,
        duration_unit: 'month',
        standard_price: 2000,
        is_active: true,
        sort_order: 0,
        created_at: '2026-08-15T00:00:00Z',
        updated_at: '2026-08-15T00:00:00Z',
        trainer_rates: [],
      },
    ],
  },
];

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-id', accountRole: 'owner' }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
      today: () => '2026-08-15',
    },
    locale: {
      currency: 'INR',
      locale: 'en-IN',
      weekStart: 1,
    },
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === 'catalog_items'
            ? Promise.resolve({ data: catalogue, error: null })
            : {
                order: () => Promise.resolve({ data: [], error: null }),
              },
      }),
    }),
  }),
}));

const { ProductsServicesPicker } = await import('./products-services-picker');

function CatalogueHarness() {
  const [value, setValue] = useState<CheckoutSelection[]>([]);
  return (
    <ProductsServicesPicker
      value={value}
      onChange={setValue}
      defaultStartDate="2026-08-15"
      presentation="catalogue"
    />
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProductsServicesPicker catalogue layout', () => {
  it('shows all catalogue rows and changes merchandise quantity in place', async () => {
    render(<CatalogueHarness />);

    await waitFor(() => {
      expect(screen.getByText('Protein powder')).toBeTruthy();
      expect(screen.getByText('Nutrition coaching')).toBeTruthy();
    });

    expect(screen.getByText('Item')).toBeTruthy();
    expect(screen.getByText('Price')).toBeTruthy();
    expect(
      screen.getByRole('toolbar', { name: 'Protein powder quantity' })
    ).toBeTruthy();

    const increase = screen.getByRole('button', {
      name: 'Increase Protein powder quantity',
    });
    const decrease = screen.getByRole('button', {
      name: 'Decrease Protein powder quantity',
    });

    fireEvent.click(increase);
    expect(
      screen.getByRole('status', { name: 'Protein powder quantity: 1' })
    ).toBeTruthy();

    fireEvent.click(increase);
    expect(
      screen.getByRole('status', { name: 'Protein powder quantity: 2' })
    ).toBeTruthy();

    fireEvent.click(decrease);
    expect(
      screen.getByRole('status', { name: 'Protein powder quantity: 1' })
    ).toBeTruthy();

    const adjustPrice = screen.getByRole('button', {
      name: 'Adjust price for Protein powder',
    });
    expect(screen.queryByText('Adjust price')).toBeNull();
    fireEvent.click(adjustPrice);
    expect(screen.getByText('Unit price')).toBeTruthy();
    expect(screen.getByText('Reason')).toBeTruthy();
  });

  it('caps service quantity at one and reveals the start date after selection', async () => {
    render(<CatalogueHarness />);

    const increase = await screen.findByRole('button', {
      name: 'Increase Nutrition coaching, 1 month quantity',
    });
    fireEvent.click(increase);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Increase Nutrition coaching, 1 month quantity',
      })
    );
    expect(screen.getByText('Starts')).toBeTruthy();
    expect(
      screen.getByRole('status', {
        name: 'Nutrition coaching, 1 month quantity: 1',
      })
    ).toBeTruthy();
  });
});
