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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  const [data, setData] = useState<FinanceOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadFinanceOverview(
          createClient(),
          month,
          locale.timeZone,
          fmt.today()
        );
        if (cancelled) return;
        setData(result);
      } catch (reason) {
        if (cancelled) return;
        setError(
          getErrorMessage(reason, 'Finance overview could not be loaded')
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fmt, locale.timeZone, month, reloadKey, retryKey]);

  function exportOverview() {
    if (!data) return;
    const blob = new Blob([financeOverviewCsv(data)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `finance-overview-${data.period.month}.csv`;
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

      <p className="text-muted-foreground text-sm tabular-nums">
        {data
          ? `${fmt.date(data.period.start)} – ${fmt.date(
              data.period.end
            )} · Compared with ${fmt.month(data.period.previousStart)}`
          : `${fmt.month(`${month}-01`)} financial overview`}
      </p>

      {error ? (
        <Alert variant="destructive">
          <RefreshCw />
          <AlertTitle>Could not load Finance</AlertTitle>
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

          <div className="grid gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <FinanceCashFlowChart
                data={data.trend}
                monthLabel={fmt.month(data.period.start)}
                expenseTrackingAvailable={data.expenseTrackingAvailable}
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
                expenseTrackingAvailable={data.expenseTrackingAvailable}
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
        title="Revenue"
        value={fmt.money(data.revenue.current)}
        icon={Banknote}
        {...(revenueChange === null
          ? { subtitle: 'No prior-month baseline' }
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
      />
      <MetricCard
        title="Expenses"
        value="—"
        icon={ReceiptText}
        subtitle="Available after the expense log is enabled"
      />
      <MetricCard
        title="Profit"
        value="—"
        icon={TrendingUp}
        subtitle="Requires recorded expenses"
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
