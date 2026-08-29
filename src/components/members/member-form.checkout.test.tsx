// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MembershipCheckoutDraft,
  MembershipCheckoutMode,
  MembershipPlan,
} from '@/types';

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
  useAuth: () => ({ accountId: 'account', user: { id: 'user' } }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
      today: () => '2026-08-16',
      phone: (value?: string | null) => value ?? '',
    },
    locale: {
      currency: 'INR',
      locale: 'en-IN',
      measurementSystem: 'metric',
      phoneCountryCode: '+91',
      weekStart: 1,
    },
  }),
}));

vi.mock('@/hooks/use-lead-field-options', () => ({
  useLeadFieldOptions: () => ({
    genders: [],
    genderLabel: (value: string) => value,
  }),
}));

vi.mock('./use-membership-plans', () => ({
  useMembershipPlans: () => ({
    plans: [plan],
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn().mockResolvedValue(null),
  isExactMatch: vi.fn().mockReturnValue(false),
  isUniqueViolation: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/memberships/lookup', () => ({
  membershipIdForContact: vi.fn().mockResolvedValue(null),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('./membership-checkout-panel', () => ({
  MembershipCheckoutPanel: ({
    mode,
    value,
    onChange,
  }: {
    mode: MembershipCheckoutMode;
    value: MembershipCheckoutDraft;
    onChange: (next: MembershipCheckoutDraft) => void;
  }) => (
    <div data-testid="shared-membership-checkout" data-mode={mode}>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            planId: 'plan',
            optionId: 'option',
            discountKind: 'percentage',
            discountValue: '10',
            bonusMonthsEnabled: true,
            bonusMonths: '2',
            includeProductsServices: true,
            selections: [
              {
                item_id: 'product',
                option_id: 'product-option',
                quantity: 1,
                unit_amount: 250,
                start_date: '2026-08-16',
                trainer_id: null,
              },
            ],
          })
        }
      >
        Configure offer
      </button>
      <label>
        <input
          type="checkbox"
          checked={value.collectNow}
          onChange={(event) =>
            onChange({ ...value, collectNow: event.target.checked })
          }
        />
        Collect payment now
      </label>
    </div>
  ),
}));

vi.mock('./products-services-picker', () => ({
  ProductsServicesPicker: () => <div>Legacy catalogue picker</div>,
}));

const insertSingle = vi.fn().mockResolvedValue({
  data: { id: 'contact' },
  error: null,
});
const rpc = vi.fn().mockResolvedValue({ data: 'event-1', error: null });

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc,
    from: (table: string) => ({
      insert: () => ({
        select: () => ({
          single: table === 'contacts' ? insertSingle : vi.fn(),
        }),
      }),
      select: () => ({
        eq: () => ({ single: vi.fn().mockResolvedValue({ data: null }) }),
      }),
      update: () => ({
        eq: () => ({
          select: vi.fn().mockResolvedValue({ data: [{ id: 'contact' }] }),
        }),
      }),
    }),
  }),
}));

const { MemberForm } = await import('./member-form');

function checkoutBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('Checkout was not called');
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ member_number: 42 }),
    })
  );
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('MemberForm shared checkout host', () => {
  it.each([
    { label: 'Add member', seedContact: { phone: '+919876543210' } },
    {
      label: 'Convert to member',
      seedContact: { id: 'lead', name: 'Lead', phone: '+919876543210' },
    },
  ])('submits intent only for $label', async ({ label, seedContact }) => {
    const user = userEvent.setup();
    render(
      <MemberForm
        open
        onOpenChange={vi.fn()}
        seedContact={seedContact}
        onSaved={vi.fn()}
      />
    );

    const panel = await screen.findByTestId('shared-membership-checkout');
    expect(panel.getAttribute('data-mode')).toBe(
      label === 'Add member' ? 'join' : 'convert'
    );

    await user.click(screen.getByRole('button', { name: 'Configure offer' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Collect payment now' })
    );
    await user.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = checkoutBody();
    expect(body.membership).toEqual({
      plan_id: 'plan',
      pricing_option_id: 'option',
      period_start: '2026-08-16',
      discount_type: 'percentage',
      discount_value: 10,
      bonus_months: 2,
    });
    expect(body.membership).not.toHaveProperty('fee_amount');
    expect(body.membership).not.toHaveProperty('period_end');
    expect(body.membership).not.toHaveProperty('discount_amount');
    expect(body.collection).toMatchObject({
      collect_now: false,
      timing: 'full',
      method: 'cash',
    });
    expect(body.collection).not.toHaveProperty('amount');
    expect(body.selections).toHaveLength(1);
  });

  it('does not collect WhatsApp consent during member creation', async () => {
    const user = userEvent.setup();
    render(
      <MemberForm
        open
        onOpenChange={vi.fn()}
        seedContact={{ phone: '+919876543210' }}
        onSaved={vi.fn()}
      />
    );

    await screen.findByTestId('shared-membership-checkout');
    expect(
      screen.queryByRole('checkbox', { name: /WhatsApp opt-in/ })
    ).toBeNull();
    expect(screen.queryByLabelText(/Consent evidence/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Configure offer' }));
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(rpc).not.toHaveBeenCalled();
  });
});
