// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ServiceRenewalActionLists,
  serviceCustomerTarget,
} from './service-renewal-action-lists';

const serviceRow = {
  id: 'service-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  membership_id: null,
  catalog_item_id: 'item-1',
  catalog_option_id: 'option-1',
  trainer_id: null,
  trainer_name: null,
  item_name_snapshot: 'Personal training',
  end_date: '2026-08-24',
  current_renewal_price: 2_500,
  member_name: 'Asha Rao',
  phone: '+919876543210',
  days_until_expiry: 4,
};

let resolveSend!: (response: Response) => void;

const from = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === 'service_renewal_queue') {
      return {
        select: () => ({
          order: async () => ({ data: [serviceRow], error: null }),
        }),
      };
    }
    if (table === 'whatsapp_config') {
      return {
        select: () => ({
          maybeSingle: async () => ({
            data: { status: 'connected' },
            error: null,
          }),
        }),
      };
    }
    if (table === 'message_templates') {
      const query = {
        eq: () => query,
        maybeSingle: async () => ({
          data: { language: 'en_US' },
          error: null,
        }),
      };
      return { select: () => query };
    }
    throw new Error(`Unexpected table ${table}`);
  })
);

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      today: () => '2026-08-20',
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
    },
  }),
}));

vi.mock('@/components/follow-ups/follow-up-button', () => ({
  FollowUpButton: () => <button>Follow up</button>,
}));
vi.mock('@/components/follow-ups/follow-up-dialog', () => ({
  FollowUpDialog: () => null,
}));
vi.mock('./product-service-sale-dialog', () => ({
  ProductServiceSaleDialog: () => null,
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

beforeEach(() => {
  from.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveSend = resolve;
        })
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('service renewal customer target', () => {
  it('opens service-only customer detail with a null membership', () => {
    expect(
      serviceCustomerTarget({ contact_id: 'contact-1', membership_id: null })
    ).toEqual({ contactId: 'contact-1', membershipId: null });
  });

  it('preserves a real membership when the service is attached to one', () => {
    expect(
      serviceCustomerTarget({
        contact_id: 'contact-1',
        membership_id: 'membership-1',
      })
    ).toEqual({ contactId: 'contact-1', membershipId: 'membership-1' });
  });
});

describe('service renewal row actions', () => {
  it('shows progress only on the reminder that is being sent', async () => {
    const user = userEvent.setup();
    render(
      <ServiceRenewalActionLists
        onSelect={vi.fn()}
        reloadKey={0}
        canAct
        sourceControl={null}
      />
    );

    const remind = await screen.findByRole('button', { name: 'Remind' });
    const renew = screen.getByRole('button', { name: 'Renew' });
    await user.click(remind);

    try {
      expect(remind.getAttribute('aria-busy')).toBe('true');
      expect((remind as HTMLButtonElement).disabled).toBe(true);
      expect(remind.querySelector('.animate-spin')).not.toBeNull();
      expect(renew.getAttribute('aria-busy')).toBeNull();
    } finally {
      resolveSend(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    await waitFor(() =>
      expect((remind as HTMLButtonElement).disabled).toBe(false)
    );
  });
});
