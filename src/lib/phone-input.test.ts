import { describe, expect, it } from 'vitest';

import {
  accountQualifiedPhoneValue,
  nationalPhoneInputValue,
} from './phone-input';

describe('nationalPhoneInputValue', () => {
  it('removes the configured country code from a persisted phone', () => {
    expect(nationalPhoneInputValue('+91 98765 43210', '+91')).toBe(
      '98765 43210'
    );
  });

  it('recognizes a legacy digits-only qualified phone', () => {
    expect(nationalPhoneInputValue('919876543210', '+91')).toBe('9876543210');
  });

  it('does not strip a national number that merely starts with the code', () => {
    expect(nationalPhoneInputValue('9198765432', '+91')).toBe('9198765432');
  });

  it('leaves the value alone when no country code is configured', () => {
    expect(nationalPhoneInputValue('9876543210', '')).toBe('9876543210');
  });
});

describe('accountQualifiedPhoneValue', () => {
  it('adds the configured country code to a national number', () => {
    expect(accountQualifiedPhoneValue('98765 43210', '+91')).toBe(
      '+9198765 43210'
    );
  });

  it('drops a domestic trunk zero when adding the account code', () => {
    expect(accountQualifiedPhoneValue('09876543210', '+91')).toBe(
      '+919876543210'
    );
  });

  it('does not double-prefix explicitly international input', () => {
    expect(accountQualifiedPhoneValue('+919876543210', '+91')).toBe(
      '+919876543210'
    );
  });

  it('normalizes a legacy digits-only qualified phone without doubling it', () => {
    expect(accountQualifiedPhoneValue('919876543210', '+91')).toBe(
      '+919876543210'
    );
  });

  it('treats a ten-digit number starting with 91 as national', () => {
    expect(accountQualifiedPhoneValue('9198765432', '+91')).toBe(
      '+919198765432'
    );
  });
});
