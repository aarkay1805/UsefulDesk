/**
 * One-time membership discounts.
 *
 * The quote only changes the first invoice. Renewal pricing continues to
 * come from the selected plan option, so a conversion offer never leaks into
 * later billing cycles.
 */

export type OneTimeDiscountKind = 'amount' | 'percentage';

export interface OneTimeDiscountQuote {
  /** Regular first-cycle price, including any legacy setup fee. */
  listPrice: number;
  /** Money taken off the first invoice after rounding and capping. */
  discountAmount: number;
  /** Net first invoice total. */
  firstInvoiceTotal: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Quote the net first invoice. Invalid/excess values are safely clamped for
 * live preview; `oneTimeDiscountError` remains the submit-time authority.
 */
export function oneTimeDiscountQuote(
  listPrice: number,
  kind: OneTimeDiscountKind | null,
  rawValue: string | number
): OneTimeDiscountQuote {
  const safeListPrice = roundMoney(Math.max(Number(listPrice) || 0, 0));
  const value = Math.max(Number(rawValue) || 0, 0);
  const requestedDiscount =
    kind === 'percentage'
      ? (safeListPrice * value) / 100
      : kind === 'amount'
        ? value
        : 0;
  const discountAmount = roundMoney(
    Math.min(Math.max(requestedDiscount, 0), safeListPrice)
  );

  return {
    listPrice: safeListPrice,
    discountAmount,
    firstInvoiceTotal: roundMoney(safeListPrice - discountAmount),
  };
}

/** Hand-rolled validation, matching the repo's no-Zod form convention. */
export function oneTimeDiscountError(
  listPrice: number,
  kind: OneTimeDiscountKind | null,
  rawValue: string
): string | null {
  if (!kind) return null;
  if (!rawValue.trim()) return 'Enter a discount value';

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return 'Enter a valid discount value';
  }
  if (value <= 0) {
    return 'Discount must be greater than zero';
  }
  if (kind === 'percentage' && value > 100) {
    return 'Percentage discount cannot exceed 100%';
  }
  if (kind === 'amount' && value > Math.max(Number(listPrice) || 0, 0)) {
    return 'Discount cannot exceed the first invoice price';
  }
  return null;
}
