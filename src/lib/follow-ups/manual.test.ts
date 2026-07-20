import { describe, expect, it } from 'vitest';

import type { Membership } from '@/types';
import {
  defaultManualFollowUpReason,
  manualFollowUpReasonForWrite,
} from './manual';

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'membership-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    member_number: 1001,
    user_id: 'user-1',
    plan_id: null,
    start_date: '2026-07-01',
    end_date: '2026-08-31',
    status: 'active',
    fee_amount: 1_000,
    fee_status: 'paid',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('manual follow-up reasons', () => {
  it('always stores the neutral sentinel for leads', () => {
    expect(manualFollowUpReasonForWrite(false, 'renewal')).toBe('other');
  });

  it('keeps an explicitly selected member reason', () => {
    expect(manualFollowUpReasonForWrite(true, 'inactive')).toBe('inactive');
  });

  it('derives a contextual default for members', () => {
    expect(
      defaultManualFollowUpReason(
        membership({ is_trial: true }),
        undefined,
        '2026-07-19'
      )
    ).toBe('trial');
  });

  it('uses the neutral default when creating a lead task', () => {
    expect(
      defaultManualFollowUpReason(undefined, undefined, '2026-07-19')
    ).toBe('other');
  });
});
