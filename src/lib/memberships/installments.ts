import { istAddDays } from './expiry';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

export const INSTALLMENT_NOW_PERCENT = 60;
export const INSTALLMENT_LATER_PERCENT = 40;
export const INSTALLMENT_SECOND_DUE_DAYS = 28;
export const INSTALLMENT_REMINDER_DAYS_BEFORE = [7, 3, 1, 0] as const;
export const INSTALLMENT_REMINDER_TEMPLATE_NAME =
  TEMPLATE_CONTRACTS.installment_reminder.payload.name;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Split a first invoice without losing a cent to independent rounding.
 * The later amount is always the invoice total minus the rounded 60% now.
 */
export function installmentAmounts(total: number): {
  now: number;
  later: number;
} {
  if (!Number.isFinite(total) || total <= 0) return { now: 0, later: 0 };
  const normalized = roundMoney(total);
  const now = roundMoney(normalized * (INSTALLMENT_NOW_PERCENT / 100));
  return { now, later: roundMoney(normalized - now) };
}

/** The promised second-payment date, measured from the account-local sale day. */
export function installmentSecondDueOn(today: string): string {
  return istAddDays(today, INSTALLMENT_SECOND_DUE_DAYS);
}

/**
 * Exact second-payment dates an hourly reminder run should scan today.
 * A promise gets messages 7, 3, and 1 day before it is due, then on due day.
 */
export function installmentReminderTargets(today: string): {
  daysBefore: number;
  dueOn: string;
}[] {
  return INSTALLMENT_REMINDER_DAYS_BEFORE.map((daysBefore) => ({
    daysBefore,
    dueOn: istAddDays(today, daysBefore),
  }));
}
