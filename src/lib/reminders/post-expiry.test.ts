import { describe, expect, it } from 'vitest';

import { isExpiredRenewalCandidate } from './policy';
import { selectPostExpiryMilestone, shouldEscalatePostExpiry } from './post-expiry';

describe('post-expiry policy', () => {
  it('derives expiry from the current date and never chases frozen, cancelled, non-renewable, or AutoPay cycles', () => {
    expect(isExpiredRenewalCandidate({ status: 'active', endDate: '2026-09-10', today: '2026-09-11', renewable: true })).toBe(true);
    expect(isExpiredRenewalCandidate({ status: 'frozen', endDate: '2026-09-10', today: '2026-09-11', renewable: true })).toBe(false);
    expect(isExpiredRenewalCandidate({ status: 'cancelled', endDate: '2026-09-10', today: '2026-09-11', renewable: true })).toBe(false);
    expect(isExpiredRenewalCandidate({ status: 'active', endDate: '2026-09-10', today: '2026-09-11', renewable: false })).toBe(false);
    expect(isExpiredRenewalCandidate({ status: 'active', endDate: '2026-09-10', today: '2026-09-11', renewable: true, activeAutoPay: true })).toBe(false);
  });

  it('selects only the latest unhandled +1/+3/+7 milestone and does not backfill before activation', () => {
    expect(selectPostExpiryMilestone({ endDate: '2026-09-10', today: '2026-09-13', activatedOn: '2026-09-01', handledKeys: [], catchUpDays: 2 })).toEqual({ key: 'expired-3', offsetDays: 3 });
    expect(selectPostExpiryMilestone({ endDate: '2026-09-10', today: '2026-09-13', activatedOn: '2026-09-14', handledKeys: [], catchUpDays: 2 })).toBeNull();
  });

  it('escalates only once the final unanswered delivery exists', () => {
    expect(shouldEscalatePostExpiry({ milestoneKey: 'expired-7', state: 'accepted', hasCustomerReply: false })).toBe(true);
    expect(shouldEscalatePostExpiry({ milestoneKey: 'expired-7', state: 'accepted', hasCustomerReply: true })).toBe(false);
    expect(shouldEscalatePostExpiry({ milestoneKey: 'expired-3', state: 'accepted', hasCustomerReply: false })).toBe(false);
  });
});
