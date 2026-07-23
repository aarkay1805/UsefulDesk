'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ReceiptText, WalletCards } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { FinanceOverview } from '@/components/finance/finance-overview';
import { PageHeaderTabs } from '@/components/layout/page-header-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/hooks/use-locale';
import { financeHref, type FinanceView } from '@/lib/finance/views';
import { createClient } from '@/lib/supabase/client';

const VIEW_LABEL: Record<FinanceView, string> = {
  overview: 'Overview',
  invoices: 'Invoices',
  payments: 'Payments',
  expenses: 'Expenses',
};

const PLACEHOLDER = {
  invoices: {
    icon: FileText,
    title: 'Invoices is the next Finance tab',
    hint: 'The account-wide issued-invoice master will be implemented from the approved mockup.',
  },
  payments: {
    icon: WalletCards,
    title: 'Finance payment analysis is coming next',
    hint: 'Operational dues and payment recording remain available under Members → Payments.',
  },
  expenses: {
    icon: ReceiptText,
    title: 'Expense tracking is not enabled yet',
    hint: 'The expense ledger will unlock expense, profit, and unified transaction figures on Overview.',
  },
} as const;

export function FinanceMasterView({
  view,
  month: requestedMonth,
}: {
  view: FinanceView;
  month: string | null;
}) {
  const router = useRouter();
  const { fmt } = useLocale();
  const month = requestedMonth ?? fmt.today().slice(0, 7);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let timer: number | null = null;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setReloadKey((key) => key + 1), 400);
    };
    const channel = supabase
      .channel('finance-overview')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        bump
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'membership_periods' },
        bump
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships' },
        bump
      )
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  function changeView(nextView: FinanceView) {
    router.replace(financeHref(nextView, month), { scroll: false });
  }

  function changeMonth(nextMonth: string) {
    router.replace(financeHref(view, nextMonth), { scroll: false });
  }

  const placeholder = view === 'overview' ? null : PLACEHOLDER[view];

  return (
    <div>
      <PageHeaderTabs>
        <Tabs
          value={view}
          onValueChange={(value) => changeView(value as FinanceView)}
          className="pt-2 pb-0"
        >
          <TabsList variant="line" className="h-auto gap-5 p-0">
            {(['overview', 'invoices', 'payments', 'expenses'] as const).map(
              (value) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex-none px-0.5 pb-2 text-[0.9375rem] group-data-horizontal/tabs:after:bottom-0"
                >
                  {VIEW_LABEL[value]}
                </TabsTrigger>
              )
            )}
          </TabsList>
        </Tabs>
      </PageHeaderTabs>

      {view === 'overview' ? (
        <FinanceOverview
          reloadKey={reloadKey}
          month={month}
          onMonthChange={changeMonth}
        />
      ) : placeholder ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={placeholder.icon}
              title={placeholder.title}
              hint={placeholder.hint}
              className="min-h-80"
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
