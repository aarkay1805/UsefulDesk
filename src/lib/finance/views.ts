export type FinanceView = 'overview' | 'invoices' | 'payments' | 'expenses';

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

export function financeHref(view: FinanceView, month?: string): string {
  const params = new URLSearchParams({ view });
  if (month) params.set('month', month);
  return `/finance?${params.toString()}`;
}
