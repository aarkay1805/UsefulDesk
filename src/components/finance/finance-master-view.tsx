'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FinanceExpenses } from '@/components/finance/finance-expenses';
import { FinanceInvoices } from '@/components/finance/finance-invoices';
import { FinanceOverview } from '@/components/finance/finance-overview';
import { FinancePayments } from '@/components/finance/finance-payments';
import { PageHeaderTabs } from '@/components/layout/page-header-actions';
import { OwnerReportsView } from '@/components/reports/owner-reports-view';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { branchHref } from '@/lib/auth/branch-context';
import { useLocale } from '@/hooks/use-locale';
import { financeHref, type FinanceView } from '@/lib/finance/views';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { PaymentPurpose } from '@/types';

const VIEW_LABEL: Record<FinanceView, string> = {
  overview: 'Overview',
  performance: 'Performance',
  invoices: 'Invoices',
  payments: 'Payments',
  expenses: 'Expenses',
};

export const FINANCE_REALTIME_TABLES: Readonly<
  Record<FinanceView, readonly string[]>
> = {
  overview: [
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
  ],
  performance: [],
  invoices: [
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
    'membership_periods',
    'membership_plans',
    'plan_pricing_options',
  ],
  payments: [
    'payments',
    'payment_refunds',
    'contacts',
    'memberships',
    'membership_plans',
  ],
  expenses: ['expenses', 'expense_categories'],
};

export function FinanceMasterView({
  view,
  month: requestedMonth,
  paymentPurposes,
}: {
  view: FinanceView;
  month: string | null;
  paymentPurposes: PaymentPurpose[];
}) {
  const router = useRouter();
  const { fmt } = useLocale();
  const { accountId } = useAuth();
  const month = requestedMonth ?? fmt.today().slice(0, 7);
  const [reloadKey, setReloadKey] = useState(0);
  const keepActiveTabInView = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    node.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);

  useEffect(() => {
    const tables = FINANCE_REALTIME_TABLES[view];
    if (!accountId || tables.length === 0) return;
    const supabase = createClient();
    let timer: number | null = null;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setReloadKey((key) => key + 1), 400);
    };
    let channel = supabase.channel(`finance:${view}:${accountId}`);
    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `account_id=eq.${accountId}`,
        },
        bump
      );
    }
    channel.subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [accountId, view]);

  function changeView(nextView: FinanceView) {
    router.replace(branchHref(financeHref(nextView, month), accountId), {
      scroll: false,
    });
  }

  function changeMonth(nextMonth: string) {
    router.replace(
      branchHref(
        financeHref(
          view,
          nextMonth,
          view === 'payments' ? paymentPurposes : []
        ),
        accountId
      ),
      { scroll: false }
    );
  }

  function changePaymentPurposes(next: PaymentPurpose[]) {
    router.replace(
      branchHref(financeHref('payments', month, next), accountId),
      { scroll: false }
    );
  }

  return (
    <div>
      <PageHeaderTabs>
        <Tabs
          value={view}
          onValueChange={(value) => changeView(value as FinanceView)}
          className="pt-2 pb-0"
        >
          <TabsList variant="line" className="h-auto gap-5 p-0">
            {(
              [
                'overview',
                'performance',
                'invoices',
                'payments',
                'expenses',
              ] as const
            ).map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                ref={value === view ? keepActiveTabInView : undefined}
                className="flex-none px-0.5 pb-2 text-[0.9375rem] group-data-horizontal/tabs:after:bottom-0"
              >
                {VIEW_LABEL[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeaderTabs>

      {view === 'overview' ? (
        <FinanceOverview
          reloadKey={reloadKey}
          month={month}
          onMonthChange={changeMonth}
        />
      ) : view === 'performance' ? (
        <OwnerReportsView month={month} onMonthChange={changeMonth} />
      ) : view === 'invoices' ? (
        <FinanceInvoices
          reloadKey={reloadKey}
          month={month}
          onMonthChange={changeMonth}
        />
      ) : view === 'payments' ? (
        <FinancePayments
          key={month}
          reloadKey={reloadKey}
          month={month}
          paymentPurposes={paymentPurposes}
          onMonthChange={changeMonth}
          onPaymentPurposesChange={changePaymentPurposes}
        />
      ) : (
        <FinanceExpenses
          key={month}
          reloadKey={reloadKey}
          month={month}
          onMonthChange={changeMonth}
        />
      )}
    </div>
  );
}
