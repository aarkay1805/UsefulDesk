// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MembershipPlan } from '@/types';

const plan = {
  id: 'gold',
  name: 'Gold',
  price: 1200,
  duration_days: 30,
  plan_type: 'recurring',
  pricing_options: [
    {
      id: 'gold-month',
      account_id: 'account',
      plan_id: 'gold',
      duration_count: 1,
      duration_unit: 'month',
      price: 1200,
      setup_fee: 0,
      is_active: true,
      sort_order: 0,
      created_at: '',
      updated_at: '',
    },
  ],
} as unknown as MembershipPlan;

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account',
    user: { id: 'user' },
    canEditSettings: true,
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: {
      phoneCountryCode: '+91',
      dateOrder: 'DMY',
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
    },
    fmt: {
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
      number: (value: number) => String(value),
      today: () => '2026-08-16',
    },
  }),
}));

vi.mock('./use-membership-plans', () => ({
  useMembershipPlans: () => ({ plans: [plan], loading: false }),
}));

vi.mock('./use-account-staff', () => ({
  useAccountStaff: () => ({ staff: [], loading: false }),
}));

const emptyResult = { data: [], error: null };
const supabase = {
  from: vi.fn((table: string) => ({
    select: () => ({
      eq: () =>
        table === 'custom_fields'
          ? { order: async () => emptyResult }
          : Promise.resolve(emptyResult),
    }),
  })),
};

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabase }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const { ImportMembersCsvDialog } = await import('./import-members-csv-dialog');

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(cleanup);

describe('ImportMembersCsvDialog candidate continuity', () => {
  it('allows the Resolve issues content to scroll vertically', async () => {
    const user = userEvent.setup();
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    await user.upload(
      input!,
      new window.File(
        window.Array.of(
          'Name,Phone,Plan,Billing option,Start date\nAsha,+919876543210,Legacy Platinum,Monthly,01/08/2026'
        ),
        'members.csv',
        { type: 'text/csv' }
      )
    );

    await user.click(
      await screen.findByRole('button', { name: 'Map manually' })
    );
    await user.click(screen.getByRole('button', { name: 'Preview 1 row' }));

    const resolveContent = await screen.findByRole('region', {
      name: 'Resolve issues content',
    });
    expect(resolveContent.className.split(/\s+/)).toContain('overflow-y-auto');
  });

  it('keeps a grouped resolution when navigating from Confirm back to Resolve issues', async () => {
    const user = userEvent.setup();
    render(
      <ImportMembersCsvDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />
    );
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    await user.upload(
      input!,
      new window.File(
        window.Array.of(
          'Name,Phone,Plan,Billing option,Start date\nAsha,+919876543210,Legacy Platinum,Monthly,01/08/2026'
        ),
        'members.csv',
        { type: 'text/csv' }
      )
    );

    await user.click(
      await screen.findByRole('button', { name: 'Map manually' })
    );
    await user.click(screen.getByRole('button', { name: 'Preview 1 row' }));

    const planSelect = await screen.findByRole('combobox', {
      name: /^Map /,
    });
    planSelect.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Next: Confirm',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );

    await user.click(screen.getByRole('button', { name: 'Next: Confirm' }));
    expect(
      screen.getByText('Review the exact source equation and confirm.')
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(
      screen.queryByRole('combobox', {
        name: /^Map /,
      })
    ).toBeNull();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  });
});
