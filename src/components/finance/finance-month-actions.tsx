'use client';

import { useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';

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
import { financeMonthOptions, shiftFinanceMonth } from '@/lib/finance/overview';

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
  const { accountRole } = useAuth();
  const { fmt } = useLocale();
  const currentMonth = fmt.today().slice(0, 7);
  const mayExport = accountRole ? canExportFinance(accountRole) : false;
  const monthOptions = useMemo(() => {
    const options = financeMonthOptions(currentMonth);
    return options.includes(month) ? options : [month, ...options];
  }, [currentMonth, month]);

  return (
    <PageHeaderActions>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous month"
          onClick={() => onMonthChange(shiftFinanceMonth(month, -1))}
        >
          <ChevronLeft />
        </Button>
        <Select
          value={month}
          onValueChange={(value) => value && onMonthChange(value)}
        >
          <SelectTrigger aria-label="Finance month" className="w-36 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {monthOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {fmt.month(`${option}-01`)}
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
  );
}
