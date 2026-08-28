'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CircleDollarSign,
  Download,
  RefreshCw,
  Target,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import { durationLabel } from '@/lib/memberships/pricing';
import {
  loadBranchPerformanceSnapshot,
  ownerReportCsv,
  relativeChange,
} from '@/lib/reports/reporting';
import type { OwnerReport, ReportMetric } from '@/lib/reports/types';
import {
  PageHeaderActions,
  PageHeaderLeading,
} from '@/components/layout/page-header-actions';
import { SourceIcon } from '@/components/leads/source-icon';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Skeleton, SkeletonCard } from '@/components/dashboard/skeleton';
import { TableSkeleton } from '@/components/table/table-skeleton';
import { EmptyState } from '@/components/dashboard/empty-state';
import { FinanceAdPerformanceCard } from '@/components/finance/finance-ad-performance';
import { BusinessMonthNavigator } from '@/components/finance/finance-month-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/user-avatar';
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
import { ActivityTrendCard } from './report-trend-card';
import { useAuth } from '@/hooks/use-auth';
import { canExportFinance } from '@/lib/auth/roles';
import { OrganizationReportsView } from './organization-reports-view';
import { financeMonthRange } from '@/lib/finance/overview';
import {
  performanceReportCache,
  reportCacheKey,
  reportCacheScope,
} from './owner-reports-cache';

const ALL_STAFF = 'all';

export function OwnerReportsView({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { fmt, locale } = useLocale();
  const {
    user,
    account,
    accountId,
    accountRole,
    organizationId,
    isOrganizationOwner,
  } = useAuth();
  const mayExport = accountRole ? canExportFinance(accountRole) : false;
  const [reportScope, setReportScope] = useState<'branch' | 'organization'>(
    'branch'
  );
  const { staff, loading: staffLoading } = useAccountStaff();
  const [staffUserId, setStaffUserId] = useState<string | null>(null);
  const cacheScope =
    user?.id && accountId ? reportCacheScope(user.id, accountId) : null;
  const cacheKey =
    user?.id && accountId
      ? reportCacheKey(
          user.id,
          accountId,
          locale.timeZone,
          month,
          staffUserId
        )
      : null;
  const [, setCacheVersion] = useState(0);
  const [loading, setLoading] = useState(
    () =>
      !cacheScope ||
      !cacheKey ||
      !performanceReportCache.peek(cacheScope, cacheKey)
  );
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchReport = useCallback(
    (
      selectedMonth: string,
      selectedStaffUserId: string | null,
      { force = false }: { force?: boolean } = {}
    ) => {
      if (!user?.id || !accountId) return;
      const id = ++requestId.current;
      const dateRange = financeMonthRange(selectedMonth);
      const selectedCacheScope = reportCacheScope(user.id, accountId);
      const selectedCacheKey = reportCacheKey(
        user.id,
        accountId,
        locale.timeZone,
        selectedMonth,
        selectedStaffUserId
      );
      void performanceReportCache
        .load(
          selectedCacheScope,
          selectedCacheKey,
          () => {
            const db = createClient();
            return loadBranchPerformanceSnapshot(
              db,
              accountId,
              selectedMonth,
              dateRange,
              locale.timeZone,
              selectedStaffUserId
            );
          },
          { force }
        )
        .then(() => {
          if (requestId.current !== id) return;
          setCacheVersion((version) => version + 1);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (requestId.current !== id) return;
          const message =
            reason instanceof Error
              ? reason.message
              : 'Performance could not be loaded.';
          setError(message);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    },
    [accountId, locale.timeZone, user?.id]
  );

  useEffect(() => {
    if (!user?.id || !accountId || reportScope === 'organization') return;
    fetchReport(month, staffUserId);
    return () => {
      requestId.current += 1;
    };
  }, [
    accountId,
    fetchReport,
    month,
    reportScope,
    staffUserId,
    user?.id,
  ]);

  const snapshot =
    cacheScope && cacheKey
      ? performanceReportCache.peek(cacheScope, cacheKey)
      : null;
  const report = snapshot?.report ?? null;
  const adPerformance = snapshot?.adPerformance ?? null;
  const expenseTotals = snapshot?.expenseTotals ?? null;

  function handleMonthChange(nextMonth: string) {
    setLoading(
      !user?.id ||
        !accountId ||
        !performanceReportCache.peek(
          reportCacheScope(user.id, accountId),
          reportCacheKey(
            user.id,
            accountId,
            locale.timeZone,
            nextMonth,
            staffUserId
          )
        )
    );
    setError(null);
    onMonthChange(nextMonth);
  }

  function handleStaffChange(value: string | null) {
    if (!value) return;
    const nextStaffUserId = value === ALL_STAFF ? null : value;
    setLoading(
      !user?.id ||
        !accountId ||
        !performanceReportCache.peek(
          reportCacheScope(user.id, accountId),
          reportCacheKey(
            user.id,
            accountId,
            locale.timeZone,
            month,
            nextStaffUserId
          )
        )
    );
    setError(null);
    setStaffUserId(nextStaffUserId);
  }

  function retry() {
    setLoading(true);
    fetchReport(month, staffUserId, { force: true });
  }

  function exportReport() {
    if (!report) return;
    const blob = new Blob(
      [ownerReportCsv(report, adPerformance, expenseTotals)],
      {
        type: 'text/csv;charset=utf-8',
      }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `performance-${report.period.start}-to-${report.period.end}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (reportScope === 'organization' && organizationId && isOrganizationOwner) {
    return (
      <OrganizationReportsView
        organizationId={organizationId}
        month={month}
        onMonthChange={handleMonthChange}
        accountCreatedAt={account?.created_at}
        onShowSelectedBranch={() => setReportScope('branch')}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeaderLeading>
        <BusinessMonthNavigator
          month={month}
          onMonthChange={handleMonthChange}
          accountCreatedAt={account?.created_at}
        />
      </PageHeaderLeading>
      <PageHeaderActions>
        {isOrganizationOwner ? (
          <Select
            value={reportScope}
            onValueChange={(value) => {
              if (value === 'branch' || value === 'organization') {
                setReportScope(value);
              }
            }}
          >
            <SelectTrigger aria-label="Performance scope" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="branch">Selected branch</SelectItem>
              <SelectItem value="organization">All branches</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={staffUserId ?? ALL_STAFF}
          onValueChange={handleStaffChange}
        >
          <SelectTrigger
            aria-label="Staff member"
            className="w-16 sm:w-40"
            disabled={staffLoading}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={ALL_STAFF}>
              <UsersRound className="text-muted-foreground" />
              <span>All staff</span>
            </SelectItem>
            {staff.map((member) => (
              <SelectItem key={member.user_id} value={member.user_id}>
                <UserAvatar
                  name={member.full_name}
                  src={member.avatar_url}
                  size="sm"
                />
                <span>{member.full_name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <GatedButton
          variant="ghost"
          canAct={mayExport}
          gateReason="export financial data"
          onClick={exportReport}
          disabled={!report || loading}
        >
          <Download />
          <span className="hidden sm:inline">Export CSV</span>
        </GatedButton>
      </PageHeaderActions>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load performance</AlertTitle>
          <AlertDescription>{friendlyReportError(error)}</AlertDescription>
          <Button
            size="sm"
            variant="destructive-ghost"
            onClick={retry}
            loading={loading}
            className="mt-2 w-fit"
          >
            <RefreshCw /> Retry
          </Button>
        </Alert>
      )}

      <KpiGrid report={report} loading={loading} fmt={fmt} />

      {report && !loading ? (
        <>
          <ActivityTrendCard data={report.trend} fmt={fmt} />

          <PlanPerformanceCard report={report} fmt={fmt} />

          <div className="grid gap-4 xl:grid-cols-5">
            <div className={adPerformance ? 'xl:col-span-3' : 'xl:col-span-5'}>
              <SourcePerformanceCard report={report} fmt={fmt} />
            </div>
            {adPerformance ? (
              <div className="xl:col-span-2">
                <FinanceAdPerformanceCard
                  performance={adPerformance}
                  fmt={fmt}
                />
              </div>
            ) : null}
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
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <MetricCard
        title="New members"
        value={fmt.number(report.metrics.newMembers.current)}
        icon={UserPlus}
        {...comparisonProps(report.metrics.newMembers, fmt)}
      />
      <MetricCard
        title="Average Sale Price"
        value={fmt.money(report.metrics.averageSalePrice.current)}
        icon={CircleDollarSign}
        {...comparisonProps(report.metrics.averageSalePrice, fmt)}
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

function PlanPerformanceCard({
  report,
  fmt,
}: {
  report: OwnerReport;
  fmt: ReturnType<typeof useLocale>['fmt'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan performance</CardTitle>
        <CardDescription>
          Membership, collections, and usage by plan
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {report.plans.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[29rem]">
              <div className="border-border border-b">
                <div
                  role="row"
                  className="text-muted-foreground mx-4 flex h-10 items-center border border-transparent text-sm font-medium"
                >
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(8rem,1fr)_minmax(3.75rem,4.5rem)_minmax(3.5rem,4rem)_minmax(3.75rem,4rem)_minmax(6rem,7rem)] items-center gap-2">
                    <span className="pl-6">Plan</span>
                    <span className="text-right">Active</span>
                    <span className="text-right">New</span>
                    <span className="text-right">Visits</span>
                    <span className="text-right">Revenue</span>
                  </span>
                </div>
              </div>
              <Accordion multiple>
                {report.plans.map((plan) => (
                  <AccordionItem key={plan.id} value={plan.id}>
                    <AccordionTrigger className="hover:bg-muted/50 rounded-none px-4 hover:no-underline **:data-[slot=accordion-trigger-icon]:absolute **:data-[slot=accordion-trigger-icon]:top-1/2 **:data-[slot=accordion-trigger-icon]:left-4 **:data-[slot=accordion-trigger-icon]:ml-0 **:data-[slot=accordion-trigger-icon]:-translate-y-1/2">
                      <span className="grid min-w-0 flex-1 grid-cols-[minmax(8rem,1fr)_minmax(3.75rem,4.5rem)_minmax(3.5rem,4rem)_minmax(3.75rem,4rem)_minmax(6rem,7rem)] items-center gap-2">
                        <span className="truncate pl-6 font-medium">
                          {plan.name}
                        </span>
                        <span className="text-right tabular-nums">
                          {fmt.number(plan.activeMembers)}
                        </span>
                        <span className="text-right tabular-nums">
                          {fmt.number(plan.newMembers)}
                        </span>
                        <span className="text-right tabular-nums">
                          {fmt.number(plan.visits)}
                        </span>
                        <span className="text-right font-medium tabular-nums">
                          {fmt.money(plan.revenue)}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {plan.billingOptions.length > 0 ? (
                        <Table className="table-fixed">
                          <colgroup>
                            <col />
                            <col className="w-20" />
                            <col className="w-[4.5rem]" />
                            <col className="w-[4.5rem]" />
                            <col className="w-[7.5rem]" />
                          </colgroup>
                          <TableBody>
                            {plan.billingOptions.map((option) => (
                              <TableRow
                                key={option.id ?? `${plan.id}-unassigned`}
                              >
                                <TableCell className="pl-10">
                                  <span className="block font-medium">
                                    {option.durationCount && option.durationUnit
                                      ? durationLabel(
                                          option.durationCount,
                                          option.durationUnit
                                        )
                                      : 'Unassigned billing option'}
                                  </span>
                                  {option.price !== null && (
                                    <span className="text-muted-foreground block text-xs tabular-nums">
                                      {fmt.money(option.price)} standard fee
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {fmt.number(option.activeMembers)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {fmt.number(option.newMembers)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {fmt.number(option.visits)}
                                </TableCell>
                                <TableCell className="pr-4 text-right font-medium tabular-nums">
                                  {fmt.money(option.revenue)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-muted-foreground py-3 pr-4 pl-10 text-sm">
                          No billing options are available for this plan.
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
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
      <CardHeader>
        <CardTitle>Lead source performance</CardTitle>
        <CardDescription>
          Acquisition cohort for the selected period
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {report.sources.length > 0 ? (
          <Table className="min-w-[30rem] table-fixed">
            <colgroup>
              <col />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-[7.5rem]" />
              <col className="w-24" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="pr-4 text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.sources.map((source) => (
                <TableRow key={source.source}>
                  <TableCell className="max-w-48 pl-4 font-medium">
                    <span className="flex min-w-0 items-center gap-2">
                      <SourceIcon source={source.source} label={source.label} />
                      <span className="truncate">{source.label}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(source.leads)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.number(source.members)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {fmt.money(source.revenue)}
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
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-96 xl:col-span-3" />
        <div className="border-border bg-card overflow-hidden rounded-xl border xl:col-span-2">
          <div className="border-border border-b px-4 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-56 max-w-full" />
          </div>
          <TableSkeleton
            className="min-w-[30rem] table-fixed"
            label="Loading lead source performance"
            rows={6}
            columns={[
              { label: 'Source', variant: 'identity' },
              { label: 'Leads', headClassName: 'text-right' },
              { label: 'Members', headClassName: 'text-right' },
              { label: 'Revenue', headClassName: 'text-right' },
              { label: 'Conversion', headClassName: 'text-right' },
            ]}
          />
        </div>
      </div>
    </>
  );
}

function friendlyReportError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('owner_report') ||
    lower.includes('schema cache') ||
    lower.includes('pgrst202')
  ) {
    return 'The performance database function is not available yet. Apply the latest Supabase migration, then retry.';
  }
  return message;
}
