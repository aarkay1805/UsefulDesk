// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Membership,
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

const membership: Membership = {
  id: 'membership',
  account_id: 'account',
  contact_id: 'contact',
  member_number: 42,
  user_id: 'user',
  plan_id: 'plan',
  pricing_option_id: 'option',
  start_date: '2026-07-16',
  end_date: '2026-09-01',
  status: 'active',
  fee_amount: 1_200,
  fee_status: 'paid',
  is_trial: false,
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
  contact: {
    id: 'contact',
    account_id: 'account',
    user_id: 'user',
    phone: '+919876543210',
    name: 'Member',
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
  },
  plan,
};

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
      today: () => '2026-08-16',
    },
    locale: { currency: 'INR', locale: 'en-IN', weekStart: 1 },
  }),
}));

vi.mock('./use-membership-plans', () => ({
  useMembershipPlans: () => ({ plans: [plan], loading: false }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('./membership-checkout-panel', () => ({
  MembershipCheckoutPanel: ({
    mode,
    value,
    onChange,
    availableCredit,
  }: {
    mode: MembershipCheckoutMode;
    value: MembershipCheckoutDraft;
    onChange: (next: MembershipCheckoutDraft) => void;
    availableCredit: number;
  }) => (
    <div
      data-testid="shared-membership-checkout"
      data-mode={mode}
      data-start={value.startDate}
      data-credit={availableCredit}
    >
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            planId: 'plan',
            optionId: 'option',
            discountKind: 'amount',
            discountValue: '100',
            bonusMonthsEnabled: true,
            bonusMonths: '1',
          })
        }
      >
        Configure renewal
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

const creditResult = vi.fn().mockResolvedValue({
  data: [{ balance: 300 }, { balance: 100 }],
  error: null,
});
const supabase = {
  from: vi.fn(() => ({
    select: () => ({
      eq: () => ({ eq: creditResult }),
    }),
  })),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

const { RenewMembershipDialog } = await import('./renew-membership-dialog');

function lastBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('Checkout was not called');
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  creditResult.mockResolvedValue({
    data: [{ balance: 300 }, { balance: 100 }],
    error: null,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
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

describe('RenewMembershipDialog shared checkout host', () => {
  it.each([
    {
      variant: 'renew' as const,
      mode: 'membership_renewal',
      start: '2026-09-01',
      button: 'Renew membership',
    },
    {
      variant: 'convert' as const,
      mode: 'convert',
      start: '2026-08-16',
      button: 'Convert trial to member',
    },
  ])(
    'uses authoritative context for $variant',
    async ({ variant, mode, start, button }) => {
      const user = userEvent.setup();
      render(
        <RenewMembershipDialog
          open
          onOpenChange={vi.fn()}
          membership={membership}
          onSaved={vi.fn()}
          variant={variant}
        />
      );

      const panel = await screen.findByTestId('shared-membership-checkout');
      await waitFor(() =>
        expect(panel.getAttribute('data-credit')).toBe('400')
      );
      expect(panel.getAttribute('data-mode')).toBe(mode);
      expect(panel.getAttribute('data-start')).toBe(start);

      await user.click(
        screen.getByRole('button', { name: 'Configure renewal' })
      );
      await user.click(
        screen.getByRole('checkbox', { name: 'Collect payment now' })
      );
      await user.click(screen.getByRole('button', { name: button }));

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const body = lastBody();
      expect(body.membership_id).toBe('membership');
      expect(body.membership).toEqual({
        plan_id: 'plan',
        pricing_option_id: 'option',
        period_start: start,
        discount_type: 'amount',
        discount_value: 100,
        bonus_months: 1,
      });
      expect(body.membership).not.toHaveProperty('fee_amount');
      expect(body.membership).not.toHaveProperty('period_end');
      expect(body.collection).toMatchObject({
        collect_now: false,
        timing: 'full',
        method: 'cash',
      });
      expect(body.collection).not.toHaveProperty('amount');
    }
  );

  it('blocks checkout when usable credit cannot be loaded', async () => {
    creditResult.mockResolvedValueOnce({
      data: null,
      error: { message: 'credit unavailable' },
    });
    const user = userEvent.setup();
    render(
      <RenewMembershipDialog
        open
        onOpenChange={vi.fn()}
        membership={membership}
        onSaved={vi.fn()}
      />
    );

    const submit = await screen.findByRole('button', {
      name: 'Renew membership',
    });
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(true));
    await user.click(submit);
    expect(fetch).not.toHaveBeenCalled();
  });
});
