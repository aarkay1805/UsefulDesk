import { describe, expect, it } from 'vitest';

import {
  MAX_CONVERSION_BONUS_MONTHS,
  oneTimeBonusMonthsError,
  oneTimeBonusMonthsQuote,
} from './bonus-time';

describe('oneTimeBonusMonthsQuote', () => {
  it('extends only the standard first-period expiry', () => {
    expect(oneTimeBonusMonthsQuote('2027-01-29', true, '2')).toEqual({
      standardEndDate: '2027-01-29',
      bonusMonths: 2,
      firstPeriodEndDate: '2027-03-29',
    });
  });

  it('uses calendar-accurate month clamping', () => {
    expect(
      oneTimeBonusMonthsQuote('2027-01-31', true, '1').firstPeriodEndDate
    ).toBe('2027-02-28');
  });

  it('keeps the normal expiry when the offer is disabled or invalid', () => {
    expect(oneTimeBonusMonthsQuote('2027-01-29', false, '2')).toEqual({
      standardEndDate: '2027-01-29',
      bonusMonths: 0,
      firstPeriodEndDate: '2027-01-29',
    });
    expect(
      oneTimeBonusMonthsQuote('2027-01-29', true, '1.5').firstPeriodEndDate
    ).toBe('2027-01-29');
  });
});

describe('oneTimeBonusMonthsError', () => {
  it('requires positive whole months when enabled', () => {
    expect(oneTimeBonusMonthsError(true, '')).toBe(
      'Enter the number of bonus months'
    );
    expect(oneTimeBonusMonthsError(true, '0')).toBe(
      'Bonus months must be greater than zero'
    );
    expect(oneTimeBonusMonthsError(true, '1.5')).toBe(
      'Bonus months must be a whole number'
    );
  });

  it('caps implausibly large conversion offers', () => {
    expect(
      oneTimeBonusMonthsError(true, String(MAX_CONVERSION_BONUS_MONTHS + 1))
    ).toBe(`Bonus months cannot exceed ${MAX_CONVERSION_BONUS_MONTHS}`);
  });

  it('does not validate a disabled offer', () => {
    expect(oneTimeBonusMonthsError(false, '')).toBeNull();
  });
});
