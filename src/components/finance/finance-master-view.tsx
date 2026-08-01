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
    if (!accountId) return;
    const supabase = createClient();
    let timer: number | null = null;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setReloadKey((key) => key + 1), 400);
    };
    const channel = supabase
      .channel(`finance-overview:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments',
          filter: `account_id=eq.${accountId}`,
        },
        bump
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contacts',
          filter: `account_id=eq.${accountId}`,
        },
        bump
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'membership_periods',
          filter: `account_id=eq.${accountId}`,
        },
        bump
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'memberships',
          filter: `account_id=eq.${accountId}`,
        },
        bump
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expenses',
          filter: `account_id=eq.${accountId}`,
        },
        bump
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expense_categories',
          filter: `account_id=eq.${accountId}`,
        },
        bump
      )
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [accountId]);

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
        <OwnerReportsView />
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
