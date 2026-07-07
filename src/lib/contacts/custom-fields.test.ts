import { describe, expect, it } from 'vitest';

import {
  customFieldInputType,
  formatCustomFieldValue,
} from './custom-fields';

describe('customFieldInputType', () => {
  it('maps field types to HTML input types', () => {
    expect(customFieldInputType('number')).toBe('number');
    expect(customFieldInputType('currency')).toBe('number');
    expect(customFieldInputType('date')).toBe('date');
    expect(customFieldInputType('email')).toBe('email');
    expect(customFieldInputType('phone')).toBe('tel');
    expect(customFieldInputType('url')).toBe('url');
    expect(customFieldInputType('text')).toBe('text');
    expect(customFieldInputType(undefined)).toBe('text');
  });
});

describe('formatCustomFieldValue', () => {
  it('formats currency in the account currency, not hardcoded USD', () => {
    expect(formatCustomFieldValue('1500', 'currency', 'INR')).toContain('₹');
    expect(formatCustomFieldValue('1500', 'currency', 'INR')).not.toContain(
      '$',
    );
    expect(formatCustomFieldValue('1500', 'currency', 'EUR')).toContain('€');
  });

  it('falls back to the app default currency when none is passed', () => {
    // DEFAULT_CURRENCY is USD — legacy callers keep working.
    expect(formatCustomFieldValue('1500', 'currency')).toContain('$');
  });

  it('returns the raw value when a currency value is not numeric', () => {
    expect(formatCustomFieldValue('about 5k', 'currency', 'INR')).toBe(
      'about 5k',
    );
  });

  it('formats numbers with grouping and leaves text-like types verbatim', () => {
    expect(formatCustomFieldValue('1234567', 'number')).toBe(
      new Intl.NumberFormat().format(1234567),
    );
    expect(formatCustomFieldValue('hello', 'text')).toBe('hello');
    expect(formatCustomFieldValue('a@b.c', 'email')).toBe('a@b.c');
  });

  it('formats valid dates and passes junk through', () => {
    expect(formatCustomFieldValue('2026-01-15', 'date')).toBe('Jan 15, 2026');
    expect(formatCustomFieldValue('not-a-date', 'date')).toBe('not-a-date');
  });
});
