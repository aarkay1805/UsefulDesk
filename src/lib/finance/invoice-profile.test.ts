import { describe, expect, it } from 'vitest';

import {
  normalizeInvoiceProfile,
  validateInvoiceProfile,
  type InvoiceProfileInput,
} from './invoice-profile';

const validProfile: InvoiceProfileInput = {
  business_name: 'Useful Gym',
  legal_name: 'Useful Fitness Private Limited',
  address_line1: '12 Market Road',
  address_line2: 'Near Metro Station',
  city: 'Bengaluru',
  state: 'Karnataka',
  postal_code: '560001',
  country: 'India',
  phone: '+91 987 654 3210',
  email: 'owner@usefulgym.in',
};

describe('invoice profile normalization and validation', () => {
  it('trims fields, lowercases email, and preserves an ordinary phone value', () => {
    expect(
      normalizeInvoiceProfile({
        ...validProfile,
        business_name: '  Useful Gym  ',
        phone: '  +91 987 654 3210  ',
        email: '  OWNER@USEFULGYM.IN  ',
      })
    ).toEqual({
      ...validProfile,
      phone: '+91 987 654 3210',
      email: 'owner@usefulgym.in',
    });
  });

  it('requires trimmed seller identity fields', () => {
    expect(
      validateInvoiceProfile({
        ...validProfile,
        business_name: ' ',
        address_line1: '\t',
        city: '',
        country: '  ',
      })
    ).toEqual({
      business_name: 'Business name is required.',
      address_line1: 'Address line 1 is required.',
      city: 'City is required.',
      country: 'Country is required.',
    });
  });

  it('rejects syntactically invalid optional email', () => {
    expect(validateInvoiceProfile(validProfile)).toEqual({});
    expect(validateInvoiceProfile({ ...validProfile, email: 'bad@' })).toEqual({
      email: 'Enter a valid email address.',
    });
  });

  it('accepts account and legal-entity prefill values', () => {
    expect(
      validateInvoiceProfile({
        ...validProfile,
        business_name: 'Northside Fitness',
        legal_name: 'Northside Fitness Private Limited',
        country: 'India',
      })
    ).toEqual({});
  });
});
