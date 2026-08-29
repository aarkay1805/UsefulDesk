// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMembershipCheckoutDraft } from '@/lib/memberships/checkout';
import type {
  MembershipCheckoutDraft,
  MembershipCheckoutMode,
  MembershipPlan,
} from '@/types';

const catalogue = [
  {
    id: 'product',
    account_id: 'account',
    kind: 'merchandise',
    name: 'Protein powder',
    description: '1 kg',
    requires_trainer: false,
    is_active: true,
    created_by: 'user',
    created_at: '2026-08-16T00:00:00Z',
    updated_at: '2026-08-16T00:00:00Z',
    catalog_options: [
      {
        id: 'product-option',
        account_id: 'account',
        item_id: 'product',
        duration_count: null,
        duration_unit: null,
        standard_price: 250,
        is_active: true,
        sort_order: 0,
        created_at: '2026-08-16T00:00:00Z',
        updated_at: '2026-08-16T00:00:00Z',
        trainer_rates: [],
      },
    ],
  },
];

const plan: MembershipPlan = {
  id: 'plan',
  account_id: 'account',
  name: 'Monthly',
  price: 1_000,
  duration_days: 30,
  plan_type: 'recurring',
  is_active: true,
  created_at: '2026-08-16T00:00:00Z',
  updated_at: '2026-08-16T00:00:00Z',
  pricing_options: [
    {
      id: 'option',
      account_id: 'account',
      plan_id: 'plan',
      duration_count: 1,
      duration_unit: 'month',
      price: 1_000,
      setup_fee: 200,
      is_active: true,
      sort_order: 0,
      created_at: '2026-08-16T00:00:00Z',
      updated_at: '2026-08-16T00:00:00Z',
    },
  ],
};

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account', accountRole: 'owner' }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
      today: () => '2026-08-16',
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

const { MembershipCheckoutPanel } = await import('./membership-checkout-panel');

let latestDraft: MembershipCheckoutDraft;

function Harness({
  mode = 'join',
  availableCredit = 200,
}: {
  mode?: MembershipCheckoutMode;
  availableCredit?: number;
}) {
  const [draft, setDraft] = useState(() =>
    createMembershipCheckoutDraft({
      planId: 'plan',
      optionId: 'option',
      startDate: '2026-08-16',
    })
  );
  return (
    <MembershipCheckoutPanel
      idPrefix="test"
      mode={mode}
      plans={[plan]}
      plansLoading={false}
      value={draft}
      onChange={(next) => {
        latestDraft = next;
        setDraft(next);
      }}
      availableCredit={availableCredit}
      startDateEditable={mode !== 'membership_renewal'}
    />
  );
}

beforeEach(() => {
  latestDraft = createMembershipCheckoutDraft({
    planId: 'plan',
    optionId: 'option',
    startDate: '2026-08-16',
  });
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('scrollTo', () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MembershipCheckoutPanel', () => {
  it('renders the canonical section order and clears catalogue selections when hidden', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The term itself carries no heading — the hosting dialog's title already
    // names it, and a section heading restating it was the redundant one.
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((node) => node.textContent)
    ).toEqual([
      'Offer discount',
      'Offer bonus months',
      'Products & services',
      'Collect payment now',
    ]);
    expect(screen.queryByText('Membership details')).toBeNull();

    await user.click(
      screen.getByRole('checkbox', { name: 'Products & services' })
    );
    await waitFor(() => {
      expect(screen.getByTestId('catalogue-table')).toBeTruthy();
    });
    await user.click(
      screen.getByRole('button', { name: 'Add Protein powder' })
    );
    expect(latestDraft.selections).toHaveLength(1);

    await user.click(
      screen.getByRole('checkbox', { name: 'Products & services' })
    );
    expect(latestDraft.includeProductsServices).toBe(false);
    expect(latestDraft.selections).toEqual([]);
  });

  it('resets discount and bonus drafts when their sections are disabled', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const discountToggle = screen.getByRole('checkbox', {
      name: 'Offer discount',
    });
    await user.click(discountToggle);
    const discountPercentage = screen.getByRole('spinbutton', {
      name: 'Discount percentage',
    });
    await user.clear(discountPercentage);
    await user.type(discountPercentage, '10');
    expect(latestDraft.discountKind).toBe('percentage');
    expect(latestDraft.discountValue).toBe('10');
    await user.click(discountToggle);
    expect(latestDraft.discountKind).toBeNull();
    expect(latestDraft.discountValue).toBe('');

    const bonusToggle = screen.getByRole('checkbox', {
      name: 'Offer bonus months',
    });
    await user.click(bonusToggle);
    const bonusMonths = screen.getByRole('spinbutton', {
      name: 'Bonus months',
    });
    await user.clear(bonusMonths);
    await user.type(bonusMonths, '2');
    expect(latestDraft.bonusMonths).toBe('2');
    await user.click(bonusToggle);
    expect(latestDraft.bonusMonthsEnabled).toBe(false);
    expect(latestDraft.bonusMonths).toBe('');
  });

  it('defaults enabled bonus time to one month and keeps collection available', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole('checkbox', { name: 'Offer bonus months' })
    );

    expect(latestDraft.bonusMonthsEnabled).toBe(true);
    expect(latestDraft.bonusMonths).toBe('1');
    expect(
      screen
        .getByRole('button', { name: '+1 month' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByRole('spinbutton', { name: 'Bonus months' })
        .getAttribute('placeholder')
    ).toBeNull();

    const collectNow = screen.getByRole('checkbox', {
      name: 'Collect payment now',
    });
    expect(collectNow.hasAttribute('disabled')).toBe(false);
    expect(collectNow.getAttribute('aria-checked')).toBe('true');
  });

  it('surfaces cleared bonus time where it blocks collection', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole('checkbox', { name: 'Offer bonus months' })
    );
    const bonusMonths = screen.getByRole('spinbutton', {
      name: 'Bonus months',
    });
    await user.clear(bonusMonths);

    expect(bonusMonths.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter the number of bonus months')).toBeTruthy();
    expect(
      screen
        .getByRole('checkbox', { name: 'Collect payment now' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      screen.getByText(
        'Complete the bonus months above to calculate the amount due.'
      )
    ).toBeTruthy();
  });

  it('defaults an enabled percentage discount to 10% and keeps collection available', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('checkbox', { name: 'Offer discount' }));

    expect(latestDraft.discountKind).toBe('percentage');
    expect(latestDraft.discountValue).toBe('10');
    expect(
      screen.getByRole('button', { name: '10%' }).getAttribute('aria-pressed')
    ).toBe('true');

    const collectNow = screen.getByRole('checkbox', {
      name: 'Collect payment now',
    });
    expect(collectNow.hasAttribute('disabled')).toBe(false);
    expect(collectNow.getAttribute('aria-checked')).toBe('true');
  });

  it('surfaces a missing fixed discount where it blocks collection', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('checkbox', { name: 'Offer discount' }));
    await user.click(screen.getByRole('button', { name: 'Fixed amount' }));

    const discountAmount = screen.getByRole('textbox', {
      name: 'Discount amount',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(discountAmount);
    });
    expect(discountAmount.getAttribute('placeholder')).toBeNull();
    expect(discountAmount.getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getByText('Enter a discount amount to continue.')
    ).toBeTruthy();

    expect(
      screen
        .getByRole('checkbox', { name: 'Collect payment now' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      screen.getByText(
        'Complete the discount above to calculate the amount due.'
      )
    ).toBeTruthy();
  });

  it('hides collection controls when deferred while keeping the new invoice due', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(
      screen.getByRole('radio', { name: /Collect full amount/ })
    ).toBeTruthy();
    await user.click(
      screen.getByRole('checkbox', { name: 'Collect payment now' })
    );

    expect(latestDraft.collectNow).toBe(false);
    expect(latestDraft.collectionTiming).toBe('full');
    await waitFor(() => {
      expect(
        screen.queryByRole('radio', { name: /Collect full amount/ })
      ).toBeNull();
    });
    expect(screen.getByText('Amount due')).toBeTruthy();
    expect(screen.getAllByText('₹1000').length).toBeGreaterThan(0);
  });

  it('shows exact full/installment choices from the combined post-credit balance', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText('Collect full amount')).toBeTruthy();
    const installments = screen.getByRole('radio', {
      name: /Part now, part later/,
    });
    await user.click(installments);

    expect(latestDraft.collectionTiming).toBe('installments');
    expect(installments.closest('label')?.textContent).toContain(
      '₹600 now, then ₹400 on 2026-09-13'
    );
    expect(
      screen.getByRole('combobox', { name: "Today's payment method" })
    ).toBeTruthy();
  });

  it('uses renewal price without the setup fee', () => {
    render(<Harness mode="membership_renewal" />);

    expect(screen.getByText('Membership fee')).toBeTruthy();
    expect(screen.getAllByText('₹1000').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹1200')).toBeNull();
  });

  it('shows one settled figure when no discount, add-on, or credit moves it', async () => {
    const user = userEvent.setup();
    render(<Harness availableCredit={0} />);

    // list price === invoice total === cash due, so the intermediate subtotals
    // would have repeated the same number under three different labels.
    expect(screen.queryByText('Membership fee')).toBeNull();
    expect(screen.queryByText('Invoice total')).toBeNull();
    expect(screen.queryByText('Final membership fee')).toBeNull();
    expect(screen.getByText('Cash due')).toBeTruthy();

    // A discount makes the arithmetic real, so the line items come back.
    await user.click(screen.getByRole('checkbox', { name: 'Offer discount' }));
    await waitFor(() => {
      expect(screen.getByText('Membership fee')).toBeTruthy();
    });
    expect(screen.getByText('Discount')).toBeTruthy();
    expect(screen.getByText('−₹120')).toBeTruthy();
    expect(screen.getAllByText('₹1080').length).toBeGreaterThan(0);
  });

  it('shows no payment controls when credit leaves zero cash due', () => {
    render(<Harness availableCredit={2_000} />);

    expect(screen.getByText('No payment required')).toBeTruthy();
    expect(
      screen.queryByRole('radio', { name: /Collect full amount/ })
    ).toBeNull();
    expect(
      screen.queryByRole('combobox', { name: "Today's payment method" })
    ).toBeNull();
  });

  it('keeps full collection but hides 60/40 when rounding cannot produce two positive installments', () => {
    render(<Harness availableCredit={1_199.99} />);

    expect(
      screen.getByRole('radio', { name: /Collect full amount/ })
    ).toBeTruthy();
    expect(
      screen.queryByRole('radio', { name: /Part now, part later/ })
    ).toBeNull();
  });
});
