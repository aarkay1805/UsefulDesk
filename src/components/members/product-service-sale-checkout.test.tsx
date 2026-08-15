// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckoutSelection, Membership } from '@/types';

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
  ProductsServicesPicker: ({
    onChange,
  }: {
    onChange: (value: CheckoutSelection[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            item_id: 'item-id',
            option_id: 'option-id',
            quantity: 1,
            unit_amount: 50,
          },
        ])
      }
    >
      Add catalogue item
    </button>
  ),
}));

const { ProductServiceSaleCheckout } =
  await import('./product-service-sale-checkout');

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

describe('ProductServiceSaleCheckout', () => {
  it('keeps invoice building, payment, and actions in one responsive checkout', () => {
    render(
      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        initialSelections={[
          {
            item_id: 'item-id',
            option_id: 'option-id',
            quantity: 1,
            unit_amount: 50,
          },
        ]}
        onCancel={vi.fn()}
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
    const paymentFooter = payment.querySelector('[data-slot="card-footer"]');
    expect(paymentFooter).toBeTruthy();
    expect(paymentFooter?.className).toContain('sm:justify-start');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const createInvoice = screen.getByRole('button', {
      name: /Create invoice.*₹50/,
    });
    expect(payment.contains(cancel)).toBe(true);
    expect(payment.contains(createInvoice)).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: /Create invoice.*₹50/ })
    ).toHaveLength(1);
  });

  it('reveals payment only after the first item is selected', () => {
    render(
      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const checkout = screen.getByRole('group', {
      name: 'Purchase checkout',
    });
    expect(checkout.className).toContain('lg:grid');
    expect(checkout.className).toContain(
      'lg:grid-cols-[minmax(0,5fr)_minmax(20rem,3fr)]'
    );
    expect(screen.queryByRole('complementary', { name: 'Payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create invoice' })).toBeNull();
    const emptyCancel = screen.getByRole('button', { name: 'Cancel' });
    expect(checkout.contains(emptyCancel)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add catalogue item' }));

    const payment = screen.getByRole('complementary', { name: 'Payment' });
    expect(
      payment.contains(screen.getByRole('button', { name: 'Cancel' }))
    ).toBe(true);
    expect(
      payment.contains(
        screen.getByRole('button', { name: /Create invoice.*₹50/ })
      )
    ).toBe(true);
  });

  it('can defer cancellation to the page chrome', () => {
    render(
      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        showCancel={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add catalogue item' }));

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('can make the invoice action span its payment card', () => {
    render(
      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        initialSelections={[
          {
            item_id: 'item-id',
            option_id: 'option-id',
            quantity: 1,
            unit_amount: 50,
          },
        ]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        showCancel={false}
        submitFullWidth
      />
    );

    expect(
      screen.getByRole('button', { name: /Create invoice.*₹50/ }).className
    ).toContain('w-full');
  });

  it('enables collection details only when collecting now', () => {
    render(
      <ProductServiceSaleCheckout
        membership={membership}
        mode="sale"
        initialSelections={[
          {
            item_id: 'item-id',
            option_id: 'option-id',
            quantity: 1,
            unit_amount: 50,
          },
        ]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const collectNow = screen.getByRole('radio', { name: 'Collect now' });
    const collectLater = screen.getByRole('radio', {
      name: 'Collect later',
    });

    expect(collectLater.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Payment method' })
    ).toBeNull();
    expect(screen.queryByText('Leave due')).toBeNull();
    expect(screen.queryByText('Full ₹50')).toBeNull();

    fireEvent.click(collectNow);

    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    const method = screen.getByRole('combobox', {
      name: 'Payment method',
    }) as HTMLButtonElement;
    expect(collectNow.getAttribute('aria-checked')).toBe('true');
    expect(amount.disabled).toBe(false);
    expect(amount.value).toBe('50');
    expect(method.disabled).toBe(false);

    fireEvent.click(collectLater);

    expect(collectLater.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Payment method' })
    ).toBeNull();
  });
});
