import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '@/types';
import {
  buildMembershipRenewalParams,
  sendRenewalReminder,
} from './send-reminder-button';

const h = vi.hoisted(() => ({
  row: null as Membership | null,
  filters: [] as unknown[][],
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          h.filters.push(args);
          return query;
        },
        maybeSingle: () => Promise.resolve({ data: h.row, error: null }),
      };
      return query;
    },
  }),
}));
afterEach(() => vi.unstubAllGlobals());

describe('membership renewal template parameters', () => {
  it('builds the exact localized contract order', () => {
    const membership = {
      contact: { name: '  Asha Rao  ' },
      plan: { name: 'Quarterly' },
      end_date: '2026-09-20',
      fee_amount: 3_999,
    } as Membership;

    expect(
      buildMembershipRenewalParams(membership, {
        date: (value: string) => `DATE:${value}`,
        money: (value: number) => `MONEY:${value}`,
      })
    ).toEqual(['Asha Rao', 'Quarterly', 'DATE:2026-09-20', 'MONEY:3999']);
  });
  it('quotes the selected current option rather than the historical first-cycle fee', () => {
    const membership = {
      account_id: 'account-1',
      plan_id: 'plan-1',
      pricing_option_id: 'option-1',
      contact: { name: 'Asha' },
      plan: { name: 'Monthly', is_active: true },
      pricing_option: {
        id: 'option-1',
        account_id: 'account-1',
        plan_id: 'plan-1',
        price: 1200,
        setup_fee: 300,
        is_active: true,
      },
      end_date: '2026-10-10',
      fee_amount: 1500,
    } as Membership;
    expect(
      buildMembershipRenewalParams(membership, {
        date: (value) => String(value),
        money: (value) => String(value),
      })
    ).toEqual(['Asha', 'Monthly', '2026-10-10', '1200']);
  });

  it('does not invent a price for an unavailable bound option', () => {
    const membership = {
      account_id: 'account-1',
      plan_id: 'plan-1',
      pricing_option_id: 'option-1',
      plan: { name: 'Monthly', is_active: true },
      pricing_option: null,
      end_date: '2026-10-10',
      fee_amount: 1500,
    } as Membership;
    expect(() =>
      buildMembershipRenewalParams(membership, {
        date: (value) => String(value),
        money: (value) => String(value),
      })
    ).toThrow(/price/i);
  });
});

describe('manual membership reminder current facts', () => {
  it('reloads the same branch membership before sending its current price', async () => {
    h.filters = [];
    const initial = {
      id: 'membership-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      plan_id: 'plan-1',
      pricing_option_id: 'option-1',
      end_date: '2026-10-10',
      fee_amount: 1500,
    } as Membership;
    h.row = {
      ...initial,
      contact: { name: 'Asha' },
      plan: { name: 'Monthly', is_active: true },
      pricing_option: {
        id: 'option-1',
        account_id: 'account-1',
        plan_id: 'plan-1',
        price: 1300,
        is_active: true,
      },
    } as Membership;
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await sendRenewalReminder(
      initial,
      {
        ready: true,
        templateName: 'gym_membership_renewal',
        templateLanguage: 'en_US',
      } as never,
      {
        date: (value: string | Date) => String(value),
        money: (value: number) => String(value),
      } as never
    );
    expect(h.filters).toContainEqual(['account_id', 'account-1']);
    expect(h.filters).toContainEqual(['id', 'membership-1']);
    expect(JSON.parse(fetch.mock.calls[0][1].body).template_params).toEqual([
      'Asha',
      'Monthly',
      '2026-10-10',
      '1300',
    ]);
  });

  it('sends nothing when the selected membership cannot be reloaded', async () => {
    h.row = null;
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await expect(
      sendRenewalReminder(
        {
          id: 'membership-1',
          account_id: 'account-1',
          contact_id: 'contact-1',
          fee_amount: 1000,
        } as Membership,
        {} as never,
        {
          date: (value: string | Date) => String(value),
          money: (value: number) => String(value),
        } as never
      )
    ).rejects.toThrow(/member/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
