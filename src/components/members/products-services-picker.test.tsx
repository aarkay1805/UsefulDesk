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
  {
    id: 'trainer-service-id',
    account_id: 'account-id',
    kind: 'service',
    name: 'Personal training',
    description: null,
    requires_trainer: true,
    is_active: true,
    created_by: 'user-id',
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-15T00:00:00Z',
    catalog_options: [
      {
        id: 'trainer-service-option-id',
        account_id: 'account-id',
        item_id: 'trainer-service-id',
        duration_count: 1,
        duration_unit: 'month',
        standard_price: null,
        is_active: true,
        sort_order: 0,
        created_at: '2026-08-15T00:00:00Z',
        updated_at: '2026-08-15T00:00:00Z',
        trainer_rates: [
          {
            id: 'zara-rate-id',
            account_id: 'account-id',
            trainer_id: 'zara-id',
            catalog_option_id: 'trainer-service-option-id',
            price: 3500,
            is_active: true,
            created_at: '2026-08-15T00:00:00Z',
            updated_at: '2026-08-15T00:00:00Z',
          },
          {
            id: 'anaya-rate-id',
            account_id: 'account-id',
            trainer_id: 'anaya-id',
            catalog_option_id: 'trainer-service-option-id',
            price: 3000,
            is_active: true,
            created_at: '2026-08-15T00:00:00Z',
            updated_at: '2026-08-15T00:00:00Z',
          },
        ],
      },
    ],
  },
];

const trainers = [
  {
    id: 'anaya-id',
    account_id: 'account-id',
    display_name: 'Anaya',
    title: 'Senior trainer',
    linked_user_id: null,
    is_active: true,
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-15T00:00:00Z',
  },
  {
    id: 'zara-id',
    account_id: 'account-id',
    display_name: 'Zara',
    title: null,
    linked_user_id: null,
    is_active: true,
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-15T00:00:00Z',
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
                order: () => Promise.resolve({ data: trainers, error: null }),
              },
      }),
    }),
  }),
}));

const { ProductsServicesPicker } = await import('./products-services-picker');

function CatalogueHarness() {
  const [value, setValue] = useState<CheckoutSelection[]>([]);
  return (
    <>
      <ProductsServicesPicker
        value={value}
        onChange={setValue}
        defaultStartDate="2026-08-15"
        presentation="catalogue"
      />
      <output aria-label="Selections">{JSON.stringify(value)}</output>
    </>
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
    expect(screen.queryByText('Products & services')).toBeNull();
    expect(
      screen.getByText('Item').parentElement?.parentElement?.className
    ).toContain('border');
    expect(
      screen.queryByRole('toolbar', { name: 'Protein powder quantity' })
    ).toBeNull();
    const addProduct = screen.getByRole('button', {
      name: 'Add Protein powder',
    });
    expect(addProduct.className).toContain('w-full');
    expect(addProduct.parentElement?.className).toContain('w-28');
    expect(addProduct.parentElement?.className).toContain('justify-self-end');
    const quantityContainer = addProduct.parentElement;
    fireEvent.click(addProduct);
    const quantityToolbar = screen.getByRole('toolbar', {
      name: 'Protein powder quantity',
    });
    expect(quantityToolbar.className).toContain('w-full');
    expect(quantityToolbar.className).toContain('justify-center');
    expect(quantityToolbar.parentElement).toBe(quantityContainer);

    const increase = screen.getByRole('button', {
      name: 'Increase Protein powder quantity',
    });
    const decrease = screen.getByRole('button', {
      name: 'Decrease Protein powder quantity',
    });

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
    const displayedPrice = screen.getByText('₹1500');
    expect(displayedPrice.nextElementSibling).toBe(adjustPrice);
    expect(screen.queryByText('Adjust price')).toBeNull();
    fireEvent.click(adjustPrice);
    expect(screen.getByText('Unit price')).toBeTruthy();
    expect(screen.getByText('Reason')).toBeTruthy();
  });

  it('caps service quantity at one and reveals the start date after selection', async () => {
    render(<CatalogueHarness />);

    const add = await screen.findByRole('button', {
      name: 'Add Nutrition coaching, 1 month',
    });
    fireEvent.click(add);

    expect(screen.getByText('Starts')).toBeTruthy();
    expect(
      screen.getByRole('status', {
        name: 'Nutrition coaching, 1 month quantity: 1',
      })
    ).toBeTruthy();
    const increase = screen.getByRole('button', {
      name: 'Increase Nutrition coaching, 1 month quantity',
    });
    expect(increase.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(increase);
    expect(
      screen.getByRole('status', {
        name: 'Nutrition coaching, 1 month quantity: 1',
      })
    ).toBeTruthy();
  });

  it('defaults a trainer-priced service to its first eligible trainer', async () => {
    render(<CatalogueHarness />);

    const add = await screen.findByRole('button', {
      name: 'Add Personal training, 1 month',
    });
    const trainer = screen.getByRole('combobox');

    expect(trainer.textContent).toContain('Anaya');
    expect(trainer.textContent).toContain('₹3000');
    expect(add.hasAttribute('disabled')).toBe(false);

    fireEvent.click(add);

    expect(
      JSON.parse(
        screen.getByRole('status', { name: 'Selections' }).textContent || '[]'
      )
    ).toEqual([
      expect.objectContaining({
        option_id: 'trainer-service-option-id',
        trainer_id: 'anaya-id',
        unit_amount: 3000,
      }),
    ]);
  });
});
