// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '@/types';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      money: (value: number) => `₹${value}`,
      moneyShort: (value: number) => `₹${value}`,
      today: () => '2026-08-15',
    },
    locale: { currency: 'INR', locale: 'en-IN' },
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

vi.mock('./products-services-picker', () => ({
  ProductsServicesPicker: () => <div>Catalogue picker</div>,
}));

const { ProductServiceSaleDialog } =
  await import('./product-service-sale-dialog');

const membership = {
  id: 'membership-id',
  contact_id: 'contact-id',
  end_date: '2026-09-15',
} as Membership;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: vi.fn(() => 'checkout-idempotency-key'),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProductServiceSaleDialog desktop layout', () => {
  it('groups catalogue and payment as responsive checkout columns', () => {
    render(
      <ProductServiceSaleDialog
        open
        onOpenChange={vi.fn()}
        membership={membership}
        initialSelections={[
          {
            item_id: 'item-id',
            option_id: 'option-id',
            quantity: 1,
            unit_amount: 50,
          },
        ]}
        onSaved={vi.fn()}
      />
    );

    const checkout = screen.getByRole('group', {
      name: 'Purchase checkout',
    });
    const items = within(checkout).getByRole('region', {
      name: 'Products & services',
    });
    const payment = within(checkout).getByRole('complementary', {
      name: 'Payment',
    });

    expect(items.parentElement).toBe(checkout);
    expect(payment.parentElement).toBe(checkout);
    expect(checkout.className).toContain('lg:grid');
    expect(checkout.className).toContain(
      'lg:grid-cols-[minmax(0,5fr)_minmax(20rem,3fr)]'
    );
    expect(payment.className).toContain('lg:sticky');
  });

  it('defers payment and invoice creation until an item is selected', () => {
    render(
      <ProductServiceSaleDialog
        open
        onOpenChange={vi.fn()}
        membership={membership}
        onSaved={vi.fn()}
      />
    );

    expect(screen.queryByRole('complementary', { name: 'Payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create invoice' })).toBeNull();
  });
});
