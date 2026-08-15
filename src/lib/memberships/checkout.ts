import {
  oneTimeBonusMonthsError,
  oneTimeBonusMonthsQuote,
} from '@/lib/memberships/bonus-time';
import {
  oneTimeDiscountError,
  oneTimeDiscountQuote,
} from '@/lib/memberships/discount';
import { installmentAmounts } from '@/lib/memberships/installments';
import {
  firstCycleFee,
  optionEndDate,
  renewalFee,
} from '@/lib/memberships/pricing';
import type {
  CheckoutSelection,
  MembershipCheckoutDraft,
  MembershipCheckoutMode,
  MembershipCheckoutQuote,
  MembershipDiscountType,
  PaymentMethod,
  PlanPricingOption,
} from '@/types';

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function createMembershipCheckoutDraft(input: {
  planId?: string | null;
  optionId?: string | null;
  startDate: string;
  paymentMethod?: PaymentMethod;
}): MembershipCheckoutDraft {
  return {
    planId: input.planId ?? '',
    optionId: input.optionId ?? null,
    startDate: input.startDate,
    discountKind: null,
    discountValue: '',
    bonusMonthsEnabled: false,
    bonusMonths: '',
    includeProductsServices: false,
    selections: [],
    collectNow: true,
    collectionTiming: 'full',
    paymentMethod: input.paymentMethod ?? 'cash',
  };
}

function catalogueTotal(selections: CheckoutSelection[]): number {
  return selections.reduce((sum, line) => {
    const amount = Number(line.unit_amount ?? 0);
    const quantity = Number(line.quantity ?? 1);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Catalogue amounts must be valid non-negative numbers');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Catalogue quantities must be valid positive numbers');
    }
    return sum + amount * quantity;
  }, 0);
}

export function quoteMembershipCheckout(input: {
  mode: MembershipCheckoutMode;
  option: PlanPricingOption;
  startDate: string;
  discountKind: MembershipDiscountType | null;
  discountValue: string;
  bonusMonthsEnabled: boolean;
  bonusMonths: string;
  selections: CheckoutSelection[];
  availableCredit?: number;
}): MembershipCheckoutQuote {
  if (!isCalendarDate(input.startDate)) {
    throw new Error('Enter a valid start date');
  }

  const listPrice =
    input.mode === 'membership_renewal'
      ? renewalFee(input.option)
      : firstCycleFee(input.option);
  const discountError = oneTimeDiscountError(
    listPrice,
    input.discountKind,
    input.discountValue
  );
  if (discountError) throw new Error(discountError);

  const bonusError = oneTimeBonusMonthsError(
    input.bonusMonthsEnabled,
    input.bonusMonths
  );
  if (bonusError) throw new Error(bonusError);

  const discount = oneTimeDiscountQuote(
    listPrice,
    input.discountKind,
    input.discountValue
  );
  const standardEndDate = optionEndDate(input.startDate, input.option);
  const bonus = oneTimeBonusMonthsQuote(
    standardEndDate,
    input.bonusMonthsEnabled,
    input.bonusMonths
  );
  const addOnTotal = roundMoney(catalogueTotal(input.selections));
  const invoiceTotal = roundMoney(
    discount.firstInvoiceTotal + addOnTotal
  );
  const rawCredit = Number(input.availableCredit ?? 0);
  const availableCredit = Number.isFinite(rawCredit)
    ? Math.max(rawCredit, 0)
    : 0;
  const creditApplied = roundMoney(
    Math.min(availableCredit, invoiceTotal)
  );
  const cashDue = roundMoney(invoiceTotal - creditApplied);
  const installments = installmentAmounts(cashDue);
  const installmentsAvailable =
    installments.now > 0 && installments.later > 0;

  return {
    listPrice: discount.listPrice,
    discountAmount: discount.discountAmount,
    membershipFee: discount.firstInvoiceTotal,
    standardEndDate,
    periodEnd: bonus.firstPeriodEndDate ?? standardEndDate,
    bonusMonths: bonus.bonusMonths,
    addOnTotal,
    invoiceTotal,
    creditApplied,
    cashDue,
    installmentNow: installments.now,
    installmentLater: installments.later,
    installmentsAvailable,
  };
}
