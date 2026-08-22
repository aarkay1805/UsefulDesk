// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact, Membership, MessageTemplate } from '@/types';

const canonicalTemplate: MessageTemplate = {
  id: 'template-1',
  account_id: 'account-1',
  user_id: 'user-1',
  name: 'gym_membership_renewal',
  category: 'Marketing',
  language: 'en_US',
  body_text:
    'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.',
  status: 'APPROVED',
  created_at: '2026-08-22T00:00:00Z',
};

const paymentDueTemplate: MessageTemplate = {
  ...canonicalTemplate,
  id: 'template-payment-due',
  name: 'gym_payment_due',
  category: 'Utility',
  body_text:
    'Hi {{1}}, a payment of {{2}} for your {{3}} membership is still pending. Please clear it to keep your access active. Reply here for a payment link or any help.',
};

const serviceRenewalTemplate: MessageTemplate = {
  ...canonicalTemplate,
  id: 'template-service-renewal',
  name: 'gym_service_renewal',
  body_text:
    'Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of {{4}} will continue this service. Use the buttons below to respond.',
};

const contact: Contact = {
  id: 'contact-1',
  account_id: 'account-1',
  user_id: 'user-1',
  phone: '+919876543210',
  name: 'Asha Rao',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const membership = {
  id: 'membership-1',
  account_id: 'account-1',
  contact_id: contact.id,
  member_number: 1001,
  user_id: 'user-1',
  plan_id: 'plan-1',
  pricing_option_id: 'option-1',
  start_date: '2026-06-20',
  end_date: '2026-09-20',
  status: 'active',
  fee_amount: 3_999,
  fee_status: 'paid',
  is_trial: false,
  created_at: '2026-06-20T00:00:00Z',
  updated_at: '2026-06-20T00:00:00Z',
  contact,
  plan: {
    id: 'plan-1',
    account_id: 'account-1',
    name: 'Quarterly',
    price: 3_999,
    duration_days: 90,
    plan_type: 'recurring',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  pricing_option: {
    id: 'option-1',
    account_id: 'account-1',
    plan_id: 'plan-1',
    duration_count: 3,
    duration_unit: 'month',
    price: 3_999,
    setup_fee: 0,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
} satisfies Membership;

const templateResult = vi.fn();
const membershipResult = vi.fn();
const invoiceResult = vi.fn();
const invoiceQuery = {
  eq: vi.fn(),
  gt: vi.fn(),
  order: invoiceResult,
};
invoiceQuery.eq.mockReturnValue(invoiceQuery);
invoiceQuery.gt.mockReturnValue(invoiceQuery);
const serviceResult = vi.fn();
const serviceQuery = {
  eq: vi.fn(),
  in: vi.fn(),
  order: serviceResult,
};
serviceQuery.eq.mockReturnValue(serviceQuery);
serviceQuery.in.mockReturnValue(serviceQuery);

const supabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
  },
  from: vi.fn((table: string) => {
    if (table === 'message_templates') {
      return {
        select: () => ({
          eq: () => ({ order: templateResult }),
        }),
      };
    }
    if (table === 'memberships') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: membershipResult }),
        }),
      };
    }
    if (table === 'invoice_balances') {
      return {
        select: () => invoiceQuery,
      };
    }
    if (table === 'member_service_details') {
      return {
        select: () => serviceQuery,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => (value === '2026-09-20' ? '20 Sep 2026' : value),
      money: (value: number) => `₹${value.toLocaleString('en-IN')}`,
    },
  }),
}));

const { TemplatePicker } = await import('./template-picker');

function renderPicker(template = canonicalTemplate) {
  templateResult.mockResolvedValue({ data: [template], error: null });
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    contact,
  };
  render(<TemplatePicker {...props} />);
  return props;
}

beforeEach(() => {
  templateResult.mockReset();
  templateResult.mockResolvedValue({ data: [canonicalTemplate], error: null });
  membershipResult.mockReset();
  membershipResult.mockResolvedValue({ data: membership, error: null });
  invoiceResult.mockReset();
  invoiceResult.mockResolvedValue({
    data: [
      {
        id: '12345678-aaaa-bbbb-cccc-123456789012',
        contact_id: contact.id,
        state: 'open',
        issued_at: '2026-08-20',
        currency: 'INR',
        collectible_balance: 2_700,
      },
    ],
    error: null,
  });
  serviceResult.mockReset();
  serviceResult.mockResolvedValue({
    data: [
      {
        id: 'service-1',
        contact_id: contact.id,
        item_name_snapshot: 'Personal training',
        end_date: '2026-09-20',
        current_renewal_price: 2_500,
        derived_status: 'active',
      },
    ],
    error: null,
  });
  supabase.from.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TemplatePicker', () => {
  it('presents canonical templates using their business title and purpose', async () => {
    renderPicker();

    expect(
      await screen.findByRole('button', { name: /Membership renewal/i })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Invite an existing member to continue an ending membership.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('gym_membership_renewal')).toBeNull();
  });

  it('opens a ready-to-send review with membership values filled automatically', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(
      await screen.findByRole('button', { name: /Membership renewal/i })
    );

    expect(
      await screen.findByText(
        'Hi Asha Rao, your Quarterly membership ends on 20 Sep 2026. Renewing at the current price of ₹3,999 will continue your membership. Use the buttons below to respond.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Ready to send using Asha Rao’s membership details.')
    ).toBeTruthy();
    expect(screen.queryByLabelText('Member name')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Send template',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));

    expect(
      ((await screen.findByLabelText('Member name')) as HTMLInputElement).value
    ).toBe('Asha Rao');
    expect((screen.getByLabelText('Plan name') as HTMLInputElement).value).toBe(
      'Quarterly'
    );
    expect(
      (screen.getByLabelText('Membership end date') as HTMLInputElement).value
    ).toBe('20 Sep 2026');
    expect(
      (screen.getByLabelText('Current renewal price') as HTMLInputElement).value
    ).toBe('₹3,999');
  });

  it('names a retired provider-approved template without presenting it as current', async () => {
    renderPicker({
      ...canonicalTemplate,
      id: 'legacy-template',
      name: 'gym_renewal_reminder',
      body_text:
        "Hi {{1}}, your {{2}} membership expires on {{3}}. Renew now to keep your training on track — the renewal fee is {{4}}. Reply here and we'll help you renew.",
    });

    expect(
      await screen.findByRole('button', {
        name: /Legacy membership renewal/i,
      })
    ).toBeTruthy();
    expect(screen.getByText('Legacy')).toBeTruthy();
  });

  it('fills a payment reminder when exactly one open invoice is available', async () => {
    const user = userEvent.setup();
    renderPicker(paymentDueTemplate);

    await user.click(
      await screen.findByRole('button', { name: /Payment due/i })
    );

    expect(
      await screen.findByText(
        'Hi Asha Rao, a payment of ₹2,700 for your Quarterly membership is still pending. Please clear it to keep your access active. Reply here for a payment link or any help.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Ready to send using Asha Rao’s latest open invoice.')
    ).toBeTruthy();
    expect(screen.queryByLabelText('Due amount')).toBeNull();
  });

  it('fills a service renewal when exactly one renewable service is available', async () => {
    const user = userEvent.setup();
    renderPicker(serviceRenewalTemplate);

    await user.click(
      await screen.findByRole('button', { name: /Service renewal/i })
    );

    expect(
      await screen.findByText(
        'Hi Asha Rao, your Personal training service ends on 20 Sep 2026. Renewing at the current price of ₹2,500 will continue this service. Use the buttons below to respond.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Ready to send using Asha Rao’s renewable service.')
    ).toBeTruthy();
    expect(screen.queryByLabelText('Service name')).toBeNull();
  });

  it('uses meaningful labels instead of raw provider variables for custom templates', async () => {
    const user = userEvent.setup();
    renderPicker({
      ...canonicalTemplate,
      id: 'custom-template',
      name: 'appointment_follow_up',
      body_text: 'Hello {{1}}, this is about {{2}}.',
    });

    await user.click(
      await screen.findByRole('button', { name: /Appointment follow up/i })
    );

    expect(
      screen.getByText(
        'Hello [Message detail 1], this is about [Message detail 2].'
      )
    ).toBeTruthy();
    expect(screen.getByLabelText('Message detail 1')).toBeTruthy();
    expect(screen.queryByText(/\{\{1\}\}/)).toBeNull();
  });
});
