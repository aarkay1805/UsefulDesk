'use client';

import { useEffect, useState } from 'react';
import {
  Banknote,
  CalendarClock,
  ReceiptText,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { FinanceCashFlowChart } from '@/components/finance/finance-cash-flow-chart';
import { FinanceCollectionMixCard } from '@/components/finance/finance-collection-mix';
import { FinanceInvoiceHealthCard } from '@/components/finance/finance-invoice-health';
import { FinanceMonthActions } from '@/components/finance/finance-month-actions';
import { FinanceRecentTransactionsCard } from '@/components/finance/finance-recent-transactions';
import { FinanceRevenueBreakdownCard } from '@/components/finance/finance-revenue-breakdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import {
  financeOverviewCsv,
  loadFinanceOverview,
  type FinanceOverviewData,
} from '@/lib/finance/overview';
import { relativeChange } from '@/lib/reports/reporting';
import { createClient } from '@/lib/supabase/client';

export function FinanceOverview({
  reloadKey,
  month,
  onMonthChange,
}: {
  reloadKey: number;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { fmt, locale } = useLocale();
  const { accountId } = useAuth();
  const [data, setData] = useState<FinanceOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadFinanceOverview(
          createClient(),
          accountId,
          month,
          locale.timeZone,
          fmt.today()
        );
        if (cancelled) return;
        setData(result);
      } catch (reason) {
        if (cancelled) return;
        setError(
          getErrorMessage(reason, 'Business overview could not be loaded')
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, fmt, locale.timeZone, month, reloadKey, retryKey]);

  function exportOverview() {
    if (!data) return;
    const blob = new Blob([financeOverviewCsv(data)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `business-overview-${data.period.month}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <FinanceMonthActions
        month={month}
        onMonthChange={onMonthChange}
        onExport={exportOverview}
        exportDisabled={!data || loading}
      />

      {error ? (
        <Alert variant="destructive">
          <RefreshCw />
          <AlertTitle>Could not load overview</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="destructive-ghost"
            className="mt-2 w-fit"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            <RefreshCw /> Retry
          </Button>
        </Alert>
      ) : null}

      {loading || !data ? (
        <FinanceOverviewSkeleton />
      ) : (
        <>
          <FinanceMetricGrid data={data} fmt={fmt} />

          <FinanceRevenueBreakdownCard
            breakdown={data.revenueBreakdown}
            streams={data.revenueStreams}
            month={month}
            accountId={accountId}
            fmt={fmt}
            onChanged={() => setRetryKey((key) => key + 1)}
          />

          <div className="grid gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <FinanceCashFlowChart
                data={data.trend}
                previousData={data.previousTrend}
                comparisonThroughDay={data.comparisonThroughDay}
                monthLabel={fmt.month(data.period.start)}
                previousMonthLabel={fmt.month(data.period.previousStart)}
                fmt={fmt}
              />
            </div>
            <div className="xl:col-span-2">
              <FinanceInvoiceHealthCard health={data.invoiceHealth} fmt={fmt} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <FinanceCollectionMixCard
                methods={data.collectionMethods}
                fmt={fmt}
              />
            </div>
            <div className="xl:col-span-3">
              <FinanceRecentTransactionsCard
                transactions={data.recentTransactions}
                fmt={fmt}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FinanceMetricGrid({
  data,
  fmt,
}: {
  data: FinanceOverviewData;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  const revenueChange = relativeChange(
    data.revenue.current,
    data.revenue.previous
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        title="Net collections"
        value={fmt.money(data.revenue.current)}
        icon={Banknote}
        {...(revenueChange === null
          ? {}
          : {
              delta: {
                sign: revenueChange,
                label:
                  revenueChange === 0
                    ? 'No change vs previous month'
                    : `${revenueChange > 0 ? '+' : ''}${fmt.number(
                        Math.round(revenueChange * 10) / 10
                      )}% vs previous month`,
              },
            })}
        subtitle={`${fmt.money(data.revenue.grossCurrent ?? data.revenue.current)} gross − ${fmt.money(data.revenue.refundsCurrent ?? 0)} refunds`}
      />
      <MetricCard
        title="Expenses"
        value={fmt.money(data.expenses.current)}
        icon={ReceiptText}
        subtitle="Posted expenses this month"
      />
      <MetricCard
        title="Profit"
        value={fmt.money(data.profit.current)}
        icon={TrendingUp}
        subtitle="Revenue minus posted expenses"
      />
      <MetricCard
        title="Next month projected"
        value={fmt.money(data.projection.amount)}
        icon={CalendarClock}
        subtitle={`Based on ${fmt.number(
          data.projection.renewals
        )} active renewals`}
      />
    </div>
  );
}

function FinanceOverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-80 xl:col-span-3" />
        <Skeleton className="h-80 xl:col-span-2" />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-[25rem] xl:col-span-3" />
        <Skeleton className="h-[25rem] xl:col-span-2" />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72 xl:col-span-3" />
      </div>
    </div>
  );
}
