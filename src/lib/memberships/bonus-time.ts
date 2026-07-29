/**
 * One-time membership bonus time.
 *
 * Bonus months extend only the first paid period. The selected pricing
 * option remains unchanged, so every renewal still uses its normal duration
 * and price.
 */

import { addDuration } from '@/lib/memberships/expiry';

export const MAX_CONVERSION_BONUS_MONTHS = 120;

export interface OneTimeBonusMonthsQuote {
  /** Expiry produced by the selected pricing option before bonus time. */
  standardEndDate: string | null;
  /** Valid whole bonus months used by the live preview. */
  bonusMonths: number;
  /** Actual first-period expiry after applying the one-time extension. */
  firstPeriodEndDate: string | null;
}

/** Hand-rolled validation, matching the repo's no-Zod form convention. */
export function oneTimeBonusMonthsError(
  enabled: boolean,
  rawValue: string
): string | null {
  if (!enabled) return null;
  if (!rawValue.trim()) return 'Enter the number of bonus months';

  const value = Number(rawValue);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return 'Bonus months must be a whole number';
  }
  if (value <= 0) {
    return 'Bonus months must be greater than zero';
  }
  if (value > MAX_CONVERSION_BONUS_MONTHS) {
    return `Bonus months cannot exceed ${MAX_CONVERSION_BONUS_MONTHS}`;
  }
  return null;
}

/**
 * Extend the standard expiry for a safe live preview. Invalid input leaves
 * the standard expiry untouched; `oneTimeBonusMonthsError` remains the
 * submit-time authority.
 */
export function oneTimeBonusMonthsQuote(
  standardEndDate: string | null,
  enabled: boolean,
  rawValue: string
): OneTimeBonusMonthsQuote {
  const bonusMonths =
    enabled && !oneTimeBonusMonthsError(true, rawValue) ? Number(rawValue) : 0;

  return {
    standardEndDate,
    bonusMonths,
    firstPeriodEndDate:
      standardEndDate && bonusMonths > 0
        ? addDuration(standardEndDate, bonusMonths, 'month')
        : standardEndDate,
  };
}
