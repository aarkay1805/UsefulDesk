// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '@/types';
import type { ReminderReadiness } from './send-reminder-button';
import { SendReminderButton } from './send-reminder-button';

vi.mock('next/navigation', () => ({
  usePathname: () => '/members',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => value,
      money: (value: number) => String(value),
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const membership: Membership = {
  id: 'membership-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  member_number: 101,
  user_id: 'user-1',
  plan_id: 'plan-1',
  pricing_option_id: 'pricing-option-1',
  start_date: '2026-06-20',
  end_date: '2026-09-20',
  status: 'active',
  fee_amount: 3_999,
  fee_status: 'paid',
  is_trial: false,
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
  contact: {
    id: 'contact-1',
    account_id: 'account-1',
    user_id: 'user-1',
    name: 'Asha Rao',
    phone: '+919876543210',
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
  },
  plan: {
    id: 'plan-1',
    account_id: 'account-1',
    name: 'Quarterly',
    price: 3_999,
    duration_days: 90,
    plan_type: 'recurring',
    is_active: true,
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
  },
};

function readiness(
  overrides: Partial<ReminderReadiness> = {}
): ReminderReadiness {
  return {
    loading: false,
    ready: true,
    reason: null,
    resolution: null,
    templateLanguage: 'en_US',
    templateName: 'gym_membership_renewal',
    ...overrides,
  };
}

describe('SendReminderButton blockers', () => {
  it('explains a missing phone without disabling the Remind trigger', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(
      <SendReminderButton
        membership={{
          ...membership,
          contact: undefined,
        }}
        readiness={readiness()}
      />
    );

    const remind = screen.getByRole('button', { name: 'Remind' });
    expect((remind as HTMLButtonElement).disabled).toBe(false);
    expect(remind.getAttribute('aria-disabled')).toBe('true');
    expect(remind.getAttribute('title')).toBeNull();

    await user.click(remind);

    expect(screen.getByText(/This member has no phone number/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('links a not-ready reminder to the provided template setup resolution', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(
      <SendReminderButton
        membership={membership}
        readiness={readiness({
          ready: false,
          reason: 'Approve the renewal reminder template before sending.',
          resolution: {
            label: 'Open template setup',
            href: '/settings?tab=templates',
          },
        })}
      />
    );

    const remind = screen.getByRole('button', { name: 'Remind' });
    expect((remind as HTMLButtonElement).disabled).toBe(false);
    expect(remind.getAttribute('aria-disabled')).toBe('true');
    expect(remind.getAttribute('title')).toBeNull();

    await user.click(remind);

    const resolution = screen.getByRole('button', {
      name: 'Open template setup',
    });
    expect(resolution.getAttribute('href')).toBe('/settings?tab=templates');
    expect(fetch).not.toHaveBeenCalled();
  });
});
