import type { PaymentPurpose } from '@/types';

export type FinanceView = 'overview' | 'invoices' | 'payments' | 'expenses';

const PAYMENT_PURPOSES: PaymentPurpose[] = [
  'joining',
  'renewal',
  'due',
  'other',
];

export function parseFinanceView(value: unknown): FinanceView {
  return value === 'invoices' || value === 'payments' || value === 'expenses'
    ? value
    : 'overview';
}

export function parseFinanceMonth(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return null;
  }
  return value;
}

export function parseFinancePaymentPurposes(value: unknown): PaymentPurpose[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values.filter((item): item is PaymentPurpose =>
        PAYMENT_PURPOSES.includes(item as PaymentPurpose)
      )
    )
  );
}

export function financeHref(
  view: FinanceView,
  month?: string,
  paymentPurposes: PaymentPurpose[] = []
): string {
  const params = new URLSearchParams({ view });
  if (month) params.set('month', month);
  if (view === 'payments') {
    for (const purpose of paymentPurposes) params.append('purpose', purpose);
  }
  return `/finance?${params.toString()}`;
}
