'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Download,
  FlaskConical,
  Footprints,
  RefreshCw,
  ShieldAlert,
  Target,
  UserPlus,
  UserRoundX,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import {
  loadOwnerReport,
  ownerReportCsv,
  relativeChange,
  reportDateRange,
} from '@/lib/reports/reporting';
import type {
  OwnerReport,
  ReportMetric,
  ReportRangeDays,
} from '@/lib/reports/types';
import { humaniseKey } from '@/lib/leads/field-options';
import { PageHeaderActions } from '@/components/layout/page-header-actions';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ActivityTrendCard, RevenueTrendCard } from './report-trend-card';

const REPORT_RANGES: Array<{ value: ReportRangeDays; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

type ReportCache = Record<ReportRangeDays, OwnerReport | null>;

export function OwnerReportsView() {
  const { fmt, locale } = useLocale();
  const [rangeDays, setRangeDays] = useState<ReportRangeDays>(30);
  const [reports, setReports] = useState<ReportCache>({
    7: null,
    30: null,
    90: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchReport = useCallback(
    (days: ReportRangeDays) => {
      const id = ++requestId.current;
      const dateRange = reportDateRange(fmt.today(), days);
      void loadOwnerReport(createClient(), dateRange, locale.timeZone)
        .then((nextReport) => {
          setReports((current) => ({ ...current, [days]: nextReport }));
          if (requestId.current === id) setError(null);
        })
        .catch((reason: unknown) => {
          if (requestId.current !== id) return;
          const message =
            reason instanceof Error
              ? reason.message
              : 'The owner report could not be loaded.';
          setError(message);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    },
    [fmt, locale.timeZone]
  );

  useEffect(() => {
    fetchReport(30);
    return () => {
      requestId.current += 1;
    };
  }, [fetchReport]);

  const report = reports[rangeDays];

  function handleRangeChange(value: ReportRangeDays | null) {
    if (!value) return;
    setRangeDays(value);
    if (reports[value]) {
      requestId.current += 1;
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchReport(value);
  }

  function retry() {
    setLoading(true);
    setError(null);
    fetchReport(rangeDays);
  }

  function exportReport() {
    if (!report) return;
    const blob = new Blob([ownerReportCsv(report)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `owner-report-${report.period.start}-to-${report.period.end}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <PageHeaderActions>
        <Select<ReportRangeDays>
          value={rangeDays}
          onValueChange={handleRangeChange}
        >
          <SelectTrigger aria-label="Report period" className="w-36 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {REPORT_RANGES.map((range) => (
              <SelectItem key={range.value} value={range.value}>
                {range.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          onClick={exportReport}
          disabled={!report || loading}
        >
          <Download />
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
      </PageHeaderActions>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">
            Revenue, retention, attendance, and acquisition in one owner view.
          </p>
          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
            {report
              ? `${fmt.date(report.period.start)} – ${fmt.date(report.period.end)}`
              : `Performance for the last ${rangeDays} days`}
            {' · '}attention counts are live as of today
          </p>
        </div>
        {report && (
          <Badge variant="neutral" className="tabular-nums">
            {fmt.number(report.metrics.newMembers.activeTotal)} active members
          </Badge>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load owner reporting</AlertTitle>
          <AlertDescription>{friendlyReportError(error)}</AlertDescription>
          <Button
            size="sm"
            variant="destructive-ghost"
            onClick={retry}
            className="mt-2 w-fit"
          >
            <RefreshCw /> Retry
          </Button>
        </Alert>
      )}

      <KpiGrid report={report} loading={loading} fmt={fmt} />

      {report && !loading ? (
        <>
          <div className="grid gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <AttentionCard report={report} fmt={fmt} />
            </div>
            <div className="xl:col-span-2">
              <CollectionsCard report={report} fmt={fmt} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <RevenueTrendCard data={report.trend} fmt={fmt} />
            <ActivityTrendCard data={report.trend} fmt={fmt} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <PlanPerformanceCard report={report} fmt={fmt} />
            <SourcePerformanceCard report={report} fmt={fmt} />
          </div>
        </>
      ) : !error ? (
        <ReportBodySkeleton />
      ) : null}
    </div>
  );
}

function KpiGrid({
  report,
  loading,
  fmt,
}: {
  report: OwnerReport | null;
  loading: boolean;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  if (loading || !report) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        title="Revenue collected"
        value={fmt.money(report.metrics.revenue.current)}
        icon={Banknote}
        {...comparisonProps(report.metrics.revenue, fmt)}
      />
      <MetricCard
        title="New members"
        value={fmt.number(report.metrics.newMembers.current)}
        icon={UserPlus}
        {...comparisonProps(report.metrics.newMembers, fmt)}
      />
      <MetricCard
        title="Attendance visits"
        value={fmt.number(report.metrics.visits.current)}
        icon={Footprints}
        {...comparisonProps(report.metrics.visits, fmt)}
      />
      <MetricCard
        title="Lead conversion"
        value={`${fmt.number(report.metrics.conversion.current)}%`}
        icon={Target}
        delta={pointDelta(
          report.metrics.conversion.current,
          report.metrics.conversion.previous,
          fmt
        )}
      />
    </div>
  );
}

function comparisonProps(
  metric: ReportMetric,
  fmt: ReturnType<typeof useLocale>['fmt']
): { delta?: { sign: number; label: string }; subtitle?: string } {
  const change = relativeChange(metric.current, metric.previous);
  if (change === null) return { subtitle: 'No prior-period baseline' };
  if (change === 0) {
    return { delta: { sign: 0, label: 'No change vs previous period' } };
  }
  return {
    delta: {
      sign: change,
      label: `${change > 0 ? '+' : ''}${fmt.number(
        Math.round(change * 10) / 10
      )}% vs previous period`,
    },
  };
}

function pointDelta(
  current: number,
  previous: number,
  fmt: ReturnType<typeof useLocale>['fmt']
) {
  const change = Math.round((current - previous) * 10) / 10;
  return {
    sign: change,
    label:
      change === 0
        ? 'No change vs previous period'
        : `${change > 0 ? '+' : ''}${fmt.number(change)} pts vs previous period`,
  };
}

function AttentionCard({
  report,
  fmt,
}: {
  report: OwnerReport;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  const items = [
    {
      label: 'Renewals due',
      detail: 'Recurring plans ending in the next 7 days',
      value: report.attention.renewalsDue,
      icon: CalendarClock,
      href: '/members?view=renewals',
      badge: '7 days',
    },
    {
      label: 'Outstanding dues',
      detail: fmt.money(report.attention.outstandingAmount),
      value: report.attention.outstandingDues,
      icon: CircleDollarSign,
      href: '/members?view=payments',
    },
    {
      label: 'Inactive members',
      detail: 'No visit for 10+ days, including never visited',
      value: report.attention.inactiveMembers,
      icon: UserRoundX,
      href: '/members?view=renewals',
    },
    {
      label: 'Churn risk',
      detail: 'Active members carrying a churn-risk flag',
      value: report.attention.churnRisk,
      icon: ShieldAlert,
      href: '/members?view=all',
    },
    {
      label: 'Trial follow-ups',
      detail: 'Trials expired or ending within 3 days',
      value: report.attention.trialFollowups,
      icon: FlaskConical,
      href: '/members?view=trials',
    },
    {
      label: 'Failed mandates',
      detail: 'AutoPay mandates without an active replacement',
      value: report.attention.failedMandates,
      icon: CreditCard,
      href: '/members?view=payments',
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>Live operating queues for today</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="hover:bg-muted/60 focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-lg p-2.5 transition-colors outline-none focus-visible:ring-2"
          >
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <item.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-foreground truncate text-sm font-medium">
                  {item.label}
                </span>
                {item.badge && <Badge variant="neutral">{item.badge}</Badge>}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {item.detail}
              </span>
            </span>
            <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
              {fmt.number(item.value)}
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function CollectionsCard({
  report,
  fmt,
}: {
  report: OwnerReport;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  const total = report.collectionMethods.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Collection mix</CardTitle>
        <CardDescription>Paid revenue by payment method</CardDescription>
        <CardAction>
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {fmt.money(total)}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {report.collectionMethods.length > 0 ? (
          report.collectionMethods.map((item) => (
            <div key={item.method} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground font-medium">
                  {collectionMethodLabel(item.method)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {fmt.money(item.amount)} · {fmt.number(item.payments)}
                </span>
              </div>
              <Progress value={item.amount} max={total} />
            </div>
          ))
        ) : (
          <EmptyState
            icon={Banknote}
            title="No collections in this period"
            className="min-h-44"
          />
        )}

        {report.collectionSources.length > 0 && (
          <div className="border-border flex flex-wrap gap-2 border-t pt-4">
            {report.collectionSources.map((source) => (
              <Badge key={source.source} variant="neutral">
                {source.source === 'auto' ? 'AutoPay' : 'Manual'}{' '}
                <span className="tabular-nums">{fmt.money(source.amount)}</span>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanPerformanceCard({
  report,
  fmt,
}: {
  report: OwnerReport;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Plan performance</CardTitle>
        <CardDescription>
          Membership, collections, and usage by plan
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {report.plans.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Plan</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="pr-4 text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="max-w-44 truncate pl-4 font-medium">
                    {plan.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(plan.activeMembers)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(plan.newMembers)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(plan.visits)}
                  </TableCell>
                  <TableCell className="pr-4 text-right font-medium tabular-nums">
                    {fmt.money(plan.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-4">
            <EmptyState
              title="No plan activity in this period"
              hint="Active plans and their results will appear here."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SourcePerformanceCard({
  report,
  fmt,
}: {
  report: OwnerReport;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Lead source performance</CardTitle>
        <CardDescription>
          Acquisition cohort for the selected period
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {report.sources.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="pr-4 text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.sources.map((source) => (
                <TableRow key={source.source}>
                  <TableCell className="max-w-48 truncate pl-4 font-medium">
                    {source.label}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(source.leads)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(source.members)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Badge variant="info" className="tabular-nums">
                      {fmt.number(source.conversionRate)}%
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-4">
            <EmptyState
              icon={Target}
              title="No acquired leads in this period"
              hint="New leads and their conversions will appear here."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportBodySkeleton() {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-96 xl:col-span-3" />
        <Skeleton className="h-96 xl:col-span-2" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </>
  );
}

function collectionMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    bank: 'Bank transfer',
    other: 'Other',
  };
  return labels[method] ?? humaniseKey(method);
}

function friendlyReportError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('owner_report') ||
    lower.includes('schema cache') ||
    lower.includes('pgrst202')
  ) {
    return 'The reporting database function is not available yet. Apply the latest Supabase migration, then retry.';
  }
  return message;
}
