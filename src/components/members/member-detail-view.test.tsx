import { describe, expect, it } from 'vitest';

import { SERVICE_CUSTOMER_SECTIONS } from './service-customer-detail-view';

describe('service customer detail', () => {
  it('keeps contact-backed service, billing, and follow-up sections', () => {
    expect(SERVICE_CUSTOMER_SECTIONS).toEqual(['products', 'billing', 'notes']);
  });
});
