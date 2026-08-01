import { describe, expect, it } from 'vitest';
import {
  configuredSelectionPrice,
  proportionalAllocation,
  serviceEndDate,
} from './products-services';

describe('serviceEndDate', () => {
  it('keeps month durations calendar accurate', () => {
    expect(
      serviceEndDate('2026-01-31', {
        duration_count: 1,
        duration_unit: 'month',
      })
    ).toBe('2026-02-28');
  });
});

describe('configuredSelectionPrice', () => {
  it('requires an explicit trainer-duration rate without a fallback', () => {
    const item = { requires_trainer: true };
    const option = { standard_price: null };
    expect(configuredSelectionPrice(item, option, 'junior', [])).toBeNull();
    expect(
      configuredSelectionPrice(item, option, 'junior', [
        { trainer_id: 'junior', price: 3000, is_active: true },
      ])
    ).toBe(3000);
  });

  it('uses the option price for a fixed-price service or merchandise', () => {
    expect(
      configuredSelectionPrice(
        { requires_trainer: false },
        { standard_price: 1250 },
        null,
        []
      )
    ).toBe(1250);
  });
});

describe('proportionalAllocation', () => {
  it('uses deterministic largest-remainder rounding to the paise', () => {
    expect(proportionalAllocation(1, [1, 1, 1])).toEqual([0.34, 0.33, 0.33]);
  });

  it('never allocates more than a line balance and sums exactly', () => {
    const result = proportionalAllocation(72.31, [100, 50, 25]);
    expect(result.reduce((sum, value) => sum + value, 0)).toBeCloseTo(72.31, 2);
    result.forEach((value, index) =>
      expect(value).toBeLessThanOrEqual([100, 50, 25][index])
    );
  });

  it('rejects an overpayment', () => {
    expect(() => proportionalAllocation(10.01, [10])).toThrow();
  });
});
