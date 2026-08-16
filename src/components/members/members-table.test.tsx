import { describe, expect, it } from 'vitest';

import {
  customerRowCapabilities,
  type MemberCustomerDirectoryRow,
} from '@/lib/memberships/customer-directory';

function row(
  membershipId: string | null
): Pick<MemberCustomerDirectoryRow, 'customer_kind' | 'membership_id'> {
  return {
    customer_kind: membershipId ? 'membership' : 'service',
    membership_id: membershipId,
  };
}

describe('All members row capabilities', () => {
  it('keeps contact-level actions for a service customer', () => {
    expect(customerRowCapabilities(row(null))).toEqual({
      details: true,
      followUp: true,
      addPurchase: true,
      assignment: true,
      notes: true,
      membershipActions: false,
      selectableForMembershipBulkActions: false,
    });
  });

  it('preserves every membership-backed action for a membership customer', () => {
    expect(customerRowCapabilities(row('membership-1'))).toEqual({
      details: true,
      followUp: true,
      addPurchase: true,
      assignment: true,
      notes: true,
      membershipActions: true,
      selectableForMembershipBulkActions: true,
    });
  });
});
