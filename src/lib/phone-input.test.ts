import { describe, expect, it } from 'vitest';

import {
  accountQualifiedPhoneDisplayValue,
  accountQualifiedPhoneValue,
  nationalPhoneInputValue,
} from './phone-input';

describe('accountQualifiedPhoneDisplayValue', () => {
  it('adds a plus to a digits-only qualified phone using the country numbering plan', () => {
    expect(accountQualifiedPhoneDisplayValue('6512345678', '+65')).toBe(
      '+6512345678'
    );
  });

  it('adds the account code to a national phone that begins with the same digits', () => {
    expect(accountQualifiedPhoneDisplayValue('1555000044', '+1')).toBe(
      '+11555000044'
    );
  });

  it('adds the account code to a national phone', () => {
    expect(accountQualifiedPhoneDisplayValue('9876543210', '+91')).toBe(
      '+919876543210'
    );
  });

  it('drops a domestic trunk zero while adding the account code', () => {
    expect(accountQualifiedPhoneDisplayValue('09876543210', '+91')).toBe(
      '+919876543210'
    );
  });

  it('presents an international 00 prefix with a plus', () => {
    expect(accountQualifiedPhoneDisplayValue('00447700900123', '+91')).toBe(
      '+447700900123'
    );
  });

  it('preserves invalid source text instead of disguising it', () => {
    expect(accountQualifiedPhoneDisplayValue('not-a-phone', '+91')).toBe(
      'not-a-phone'
    );
  });

  it('falls back safely for an unlisted configured dial code', () => {
    expect(accountQualifiedPhoneDisplayValue('4915123456789', '+49')).toBe(
      '+4915123456789'
    );
  });

  it('qualifies a national number for an unlisted configured dial code', () => {
    expect(accountQualifiedPhoneDisplayValue('15123456789', '+49')).toBe(
      '+4915123456789'
    );
  });
});

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

  it('uses the configured numbering plan for shorter qualified phones', () => {
    expect(nationalPhoneInputValue('6512345678', '+65')).toBe('12345678');
  });

  it('preserves a North American national number beginning with one', () => {
    expect(nationalPhoneInputValue('1555000044', '+1')).toBe('1555000044');
  });

  it('splits a qualified phone for an unlisted configured dial code', () => {
    expect(nationalPhoneInputValue('4915123456789', '+49')).toBe('15123456789');
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

  it('preserves the configured legacy country code in emitted values', () => {
    expect(accountQualifiedPhoneValue('9876543210', '91')).toBe('919876543210');
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

  it('does not double-prefix a shorter Singapore qualified phone', () => {
    expect(accountQualifiedPhoneValue('6512345678', '+65')).toBe('+6512345678');
  });

  it('qualifies a North American national number beginning with one', () => {
    expect(accountQualifiedPhoneValue('1555000044', '+1')).toBe('+11555000044');
  });

  it('does not double-prefix an unlisted configured dial code', () => {
    expect(accountQualifiedPhoneValue('4915123456789', '+49')).toBe(
      '+4915123456789'
    );
  });

  it('treats a ten-digit number starting with 91 as national', () => {
    expect(accountQualifiedPhoneValue('9198765432', '+91')).toBe(
      '+919198765432'
    );
  });
});
