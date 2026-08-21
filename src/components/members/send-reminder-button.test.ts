import { describe, expect, it } from 'vitest';

import type { Membership } from '@/types';
import { buildMembershipRenewalParams } from './send-reminder-button';

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
});
