import { describe, expect, it } from 'vitest';

import { FINANCE_REALTIME_TABLES } from './finance-master-view';

describe('Finance realtime invalidation', () => {
  it('subscribes Overview to every table that can change its snapshot', () => {
    expect(FINANCE_REALTIME_TABLES.overview).toEqual([
      'payments',
      'payment_refunds',
      'invoices',
      'invoice_lines',
      'payment_allocations',
      'payment_refund_allocations',
      'invoice_credit_allocations',
      'invoice_adjustment_allocations',
      'contacts',
      'memberships',
      'membership_plans',
      'plan_pricing_options',
      'expenses',
    ]);
    expect(FINANCE_REALTIME_TABLES.overview).not.toContain(
      'expense_categories'
    );
    expect(FINANCE_REALTIME_TABLES.overview).not.toContain(
      'membership_periods'
    );
  });

  it("does not refresh unrelated Finance tabs for another tab's writes", () => {
    expect(FINANCE_REALTIME_TABLES.payments).not.toContain('expenses');
    expect(FINANCE_REALTIME_TABLES.payments).not.toContain('invoices');
    expect(FINANCE_REALTIME_TABLES.expenses).toEqual([
      'expenses',
      'expense_categories',
    ]);
    expect(FINANCE_REALTIME_TABLES.performance).toEqual([]);
  });

  it('retains invoice and payment detail invalidation dependencies', () => {
    expect(FINANCE_REALTIME_TABLES.invoices).toContain('membership_periods');
    expect(FINANCE_REALTIME_TABLES.invoices).toContain('payment_refunds');
    expect(FINANCE_REALTIME_TABLES.invoices).toContain('payment_allocations');
    expect(FINANCE_REALTIME_TABLES.invoices).toContain(
      'payment_refund_allocations'
    );
    expect(FINANCE_REALTIME_TABLES.invoices).toContain(
      'invoice_adjustment_allocations'
    );
    expect(FINANCE_REALTIME_TABLES.invoices).not.toContain(
      'plan_pricing_options'
    );
    expect(FINANCE_REALTIME_TABLES.payments).toContain('payment_refunds');
    expect(FINANCE_REALTIME_TABLES.payments).toContain('membership_plans');
  });
});
