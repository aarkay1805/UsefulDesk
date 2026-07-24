'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
} from 'lucide-react';

import { PageHeaderActions } from '@/components/layout/page-header-actions';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canExportFinance } from '@/lib/auth/roles';
import {
  financeYearOptions,
  shiftFinanceMonth,
} from '@/lib/finance/overview';

const MONTH_VALUES = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, '0')
);

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
  const { fmt } = useLocale();
  const currentMonth = fmt.today().slice(0, 7);
  const selectedYear = month.slice(0, 4);
  const selectedMonth = month.slice(5, 7);
  const mayExport = accountRole ? canExportFinance(accountRole) : false;
  const yearOptions = useMemo(
    () => financeYearOptions(currentMonth, account?.created_at, month),
    [account?.created_at, currentMonth, month]
  );
  const earliestMonth = `${yearOptions.at(-1)}-01`;

  function changeYear(year: string) {
    const nextMonth = `${year}-${selectedMonth}`;
    onMonthChange(nextMonth > currentMonth ? currentMonth : nextMonth);
  }

  function changeMonth(monthValue: string) {
    const nextMonth = `${selectedYear}-${monthValue}`;
    if (nextMonth <= currentMonth) onMonthChange(nextMonth);
  }

  return (
    <Fragment>
      <PageHeaderActions>
        <GatedButton
          type="button"
          variant="ghost"
          canAct={mayExport}
          gateReason="export financial data"
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

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Finance reporting month"
      >
        <div className="flex max-w-full items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous month"
            disabled={month <= earliestMonth}
            onClick={() => onMonthChange(shiftFinanceMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <Select
            value={selectedMonth}
            onValueChange={(value) => value && changeMonth(value)}
          >
            <SelectTrigger
              aria-label="Finance month"
              className="w-24 sm:w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {MONTH_VALUES.map((monthValue) => {
                const option = `${selectedYear}-${monthValue}`;
                return (
                  <SelectItem
                    key={monthValue}
                    value={monthValue}
                    disabled={option > currentMonth}
                  >
                    {fmt.monthName(`${selectedYear}-${monthValue}-01`)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select
            value={selectedYear}
            onValueChange={(value) => value && changeYear(value)}
          >
            <SelectTrigger aria-label="Finance year" className="w-20 sm:w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {yearOptions.map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next month"
            disabled={month >= currentMonth}
            onClick={() => onMonthChange(shiftFinanceMonth(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={month === currentMonth}
          onClick={() => onMonthChange(currentMonth)}
        >
          <CalendarDays />
          Current month
        </Button>
      </div>
    </Fragment>
  );
}
