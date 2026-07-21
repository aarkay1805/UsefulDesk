import { describe, expect, it } from 'vitest';

import { oneTimeDiscountError, oneTimeDiscountQuote } from './discount';

describe('oneTimeDiscountQuote', () => {
  it('applies a fixed discount to the first invoice', () => {
    expect(oneTimeDiscountQuote(1_500, 'amount', '250')).toEqual({
      listPrice: 1_500,
      discountAmount: 250,
      firstInvoiceTotal: 1_250,
    });
  });

  it('rounds percentage discounts to money precision', () => {
    expect(oneTimeDiscountQuote(999, 'percentage', '12.5')).toEqual({
      listPrice: 999,
      discountAmount: 124.88,
      firstInvoiceTotal: 874.12,
    });
  });

  it('returns the regular first invoice when no discount is selected', () => {
    expect(oneTimeDiscountQuote(1_250, null, '')).toEqual({
      listPrice: 1_250,
      discountAmount: 0,
      firstInvoiceTotal: 1_250,
    });
  });

  it('caps the live preview at a free first invoice', () => {
    expect(oneTimeDiscountQuote(1_000, 'percentage', '150')).toEqual({
      listPrice: 1_000,
      discountAmount: 1_000,
      firstInvoiceTotal: 0,
    });
  });
});

describe('oneTimeDiscountError', () => {
  it('requires a positive value for a selected discount', () => {
    expect(oneTimeDiscountError(1_000, 'amount', '')).toBe(
      'Enter a discount value'
    );
    expect(oneTimeDiscountError(1_000, 'amount', '0')).toBe(
      'Discount must be greater than zero'
    );
  });

  it('rejects percentage and amount discounts above their limits', () => {
    expect(oneTimeDiscountError(1_000, 'percentage', '100.01')).toBe(
      'Percentage discount cannot exceed 100%'
    );
    expect(oneTimeDiscountError(1_000, 'amount', '1000.01')).toBe(
      'Discount cannot exceed the first invoice price'
    );
  });

  it('rejects non-numeric and non-finite values', () => {
    expect(oneTimeDiscountError(1_000, 'percentage', 'not-a-number')).toBe(
      'Enter a valid discount value'
    );
    expect(oneTimeDiscountError(1_000, 'percentage', 'Infinity')).toBe(
      'Enter a valid discount value'
    );
  });

  it('accepts a full one-time discount', () => {
    expect(oneTimeDiscountError(1_000, 'percentage', '100')).toBeNull();
    expect(oneTimeDiscountError(1_000, 'percentage', '99.99')).toBeNull();
    expect(oneTimeDiscountError(1_000, 'amount', '1000')).toBeNull();
  });
});
