'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertCircle, Building2, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { branchHref } from '@/lib/auth/branch-context';
import { financeHref } from '@/lib/finance/views';
import { financeMonthRange } from '@/lib/finance/overview';
import { formatCurrency } from '@/lib/currency';
import { useLocale } from '@/hooks/use-locale';
import { BusinessMonthNavigator } from '@/components/finance/finance-month-actions';
import { PageHeaderActions } from '@/components/layout/page-header-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

interface OrganizationBranchSummary {
  accountId: string;
  branchName: string;
  legalEntityId: string;
  legalEntityName: string;
  currency: string;
  status: string;
  revenue: number;
  newMembers: number;
  visits: number;
}

interface OrganizationReport {
  ok: boolean;
  reason?: string;
  currencyPolicy: 'separate_totals';
  branches: OrganizationBranchSummary[];
  currencyTotals: Array<{ currency: string; revenue: number }>;
}

export function OrganizationReportsView({
  organizationId,
  month,
  onMonthChange,
  accountCreatedAt,
  onShowSelectedBranch,
}: {
  organizationId: string;
  month: string;
  onMonthChange: (month: string) => void;
  accountCreatedAt?: string | null;
  onShowSelectedBranch: () => void;
}) {
  const { fmt, locale } = useLocale();
  const [nonce, setNonce] = useState(0);
  const requestKey = `${organizationId}:${month}:${nonce}`;
  const [result, setResult] = useState<{
    key: string;
    report: OrganizationReport | null;
    error: string | null;
  }>({ key: '', report: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const range = financeMonthRange(month);
        const { data, error: rpcError } = await createClient().rpc(
          'organization_report_summary',
          {
            p_organization_id: organizationId,
            p_start_date: range.start,
            p_end_date: range.end,
          }
        );
        if (cancelled) return;
        const next = data as OrganizationReport;
        setResult({
          key: requestKey,
          report: !rpcError && next?.ok ? next : null,
          error: rpcError
            ? rpcError.message
            : !next?.ok
              ? 'Organization owner access is required.'
              : null,
        });
      } catch (reason) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          report: null,
          error:
            reason instanceof Error
              ? reason.message
              : 'Could not load organization reporting.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, organizationId, requestKey]);

  const loading = result.key !== requestKey;
  const report = loading ? null : result.report;
  const error = loading ? null : result.error;

  const totalNewMembers =
    report?.branches.reduce((sum, branch) => sum + branch.newMembers, 0) ?? 0;
  const totalVisits =
    report?.branches.reduce((sum, branch) => sum + branch.visits, 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeaderActions>
        <BusinessMonthNavigator
          month={month}
          onMonthChange={onMonthChange}
          accountCreatedAt={accountCreatedAt}
        />
        <Select
          value="organization"
          onValueChange={(value) => {
            if (value === 'branch') onShowSelectedBranch();
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
      </PageHeaderActions>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load consolidated performance</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button
            size="sm"
            variant="destructive-ghost"
            onClick={() => setNonce((value) => value + 1)}
            className="mt-2 w-fit"
          >
            <RefreshCw /> Retry
          </Button>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {loading ? '—' : (report?.branches.length ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New members</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {loading ? '—' : fmt.number(totalNewMembers)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Visits</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {loading ? '—' : fmt.number(totalVisits)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by currency</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {report?.currencyTotals.map((total) => (
            <div key={total.currency}>
              <p className="text-muted-foreground text-xs">{total.currency}</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(total.revenue, total.currency, locale.locale)}
              </p>
            </div>
          ))}
          {!loading && report?.currencyTotals.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No revenue recorded.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branch breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Legal entity</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>New members</TableHead>
                <TableHead>Visits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report?.branches.map((branch) => (
                <TableRow key={branch.accountId}>
                  <TableCell>
                    <Link
                      href={branchHref(
                        financeHref('performance', month),
                        branch.accountId
                      )}
                      className="text-primary-text inline-flex items-center gap-2 font-medium"
                    >
                      <Building2 className="size-4" />
                      {branch.branchName}
                    </Link>
                  </TableCell>
                  <TableCell>{branch.legalEntityName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatCurrency(
                      branch.revenue,
                      branch.currency,
                      locale.locale
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {fmt.number(branch.newMembers)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {fmt.number(branch.visits)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
