'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';

import { PageHeaderActions } from '@/components/layout/page-header-actions';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canExportFinance } from '@/lib/auth/roles';
import { shiftFinanceMonth } from '@/lib/finance/overview';

export function FinanceMonthActions({
  month,
  onMonthChange,
  onExport,
  exportDisabled = false,
  exporting = false,
  primaryAction,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  onExport: () => void;
  exportDisabled?: boolean;
  exporting?: boolean;
  primaryAction?: ReactNode;
}) {
  const { account, accountRole } = useAuth();
  const mayExport = accountRole ? canExportFinance(accountRole) : false;

  return (
    <PageHeaderActions>
      <BusinessMonthNavigator
        month={month}
        onMonthChange={onMonthChange}
        accountCreatedAt={account?.created_at}
      />
      <GatedButton
        type="button"
        variant="ghost"
        canAct={mayExport}
        gateReason="export financial data"
        aria-label={
          exporting ? 'Exporting finance data' : 'Export finance data'
        }
        onClick={onExport}
        disabled={exportDisabled || exporting}
      >
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        <span className="hidden sm:inline">
          {exporting ? 'Exporting…' : 'Export'}
        </span>
      </GatedButton>
      {primaryAction}
    </PageHeaderActions>
  );
}

export function BusinessMonthNavigator({
  month,
  onMonthChange,
  accountCreatedAt,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  accountCreatedAt?: string | null;
}) {
  const { fmt } = useLocale();
  const currentMonth = fmt.today().slice(0, 7);
  const accountCreatedYear = accountCreatedAt?.slice(0, 4);
  const earliestMonth = accountCreatedYear
    ? `${accountCreatedYear}-01`
    : currentMonth;

  return (
    <div
      className="flex min-w-0 items-center gap-1 sm:gap-2"
      role="group"
      aria-label="Business reporting month"
    >
      <Button
        type="button"
        variant="outline"
        className="hidden sm:inline-flex"
        disabled={month === currentMonth}
        onClick={() => onMonthChange(currentMonth)}
      >
        Today
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous month"
        disabled={month <= earliestMonth}
        onClick={() => onMonthChange(shiftFinanceMonth(month, -1))}
      >
        <ChevronLeft />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next month"
        disabled={month >= currentMonth}
        onClick={() => onMonthChange(shiftFinanceMonth(month, 1))}
      >
        <ChevronRight />
      </Button>
      <span
        className="text-foreground w-20 shrink-0 truncate px-1 text-sm font-medium tabular-nums sm:w-32 sm:text-base"
        aria-live="polite"
      >
        {fmt.month(`${month}-01`)}
      </span>
    </div>
  );
}
