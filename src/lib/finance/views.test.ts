import { describe, expect, it } from 'vitest';

import { financeHref, parseFinanceMonth, parseFinanceView } from './views';

describe('finance views', () => {
  it('accepts known views and falls back to the overview', () => {
    expect(parseFinanceView('invoices')).toBe('invoices');
    expect(parseFinanceView('payments')).toBe('payments');
    expect(parseFinanceView('expenses')).toBe('expenses');
    expect(parseFinanceView('overview')).toBe('overview');
    expect(parseFinanceView('collections')).toBe('overview');
    expect(parseFinanceView(undefined)).toBe('overview');
  });

  it('accepts canonical month keys only', () => {
    expect(parseFinanceMonth('2026-07')).toBe('2026-07');
    expect(parseFinanceMonth('2026-13')).toBeNull();
    expect(parseFinanceMonth('July 2026')).toBeNull();
    expect(parseFinanceMonth(undefined)).toBeNull();
  });

  it('builds stable deep links', () => {
    expect(financeHref('overview')).toBe('/finance?view=overview');
    expect(financeHref('invoices', '2026-07')).toBe(
      '/finance?view=invoices&month=2026-07'
    );
  });
});
