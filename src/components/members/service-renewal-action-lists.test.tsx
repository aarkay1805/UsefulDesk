import { describe, expect, it } from 'vitest';

import { serviceCustomerTarget } from './service-renewal-action-lists';

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
