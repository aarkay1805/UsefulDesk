import { Banknote } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { FinanceRevenueBreakdown } from '@/lib/finance/overview';
import type { LocaleFormatters } from '@/lib/locale/format';
import type { PaymentPurpose } from '@/types';

const PURPOSE_ROWS: Array<{
  key: PaymentPurpose;
  label: string;
  dot: string;
}> = [
  { key: 'joining', label: 'New memberships', dot: 'bg-blue-500' },
  { key: 'renewal', label: 'Renewals', dot: 'bg-emerald-500' },
  { key: 'due', label: 'Due payments recovered', dot: 'bg-amber-500' },
  { key: 'other', label: 'Other collections', dot: 'bg-muted-foreground' },
];

export function FinanceRevenueBreakdownCard({
  breakdown,
  fmt,
}: {
  breakdown: FinanceRevenueBreakdown;
  fmt: LocaleFormatters;
}) {
  const total = Object.values(breakdown).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const rows = PURPOSE_ROWS.filter(
    (row) => row.key !== 'other' || breakdown.other > 0
  );

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Revenue breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {total > 0 ? (
          <div className="space-y-4">
            {rows.map((row) => {
              const amount = breakdown[row.key];
              const percent = Math.round((amount / total) * 100);
              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${row.dot}`} />
                    <span className="flex-1 font-medium">{row.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {fmt.number(percent)}%
                    </span>
                    <span className="w-28 text-right font-medium tabular-nums">
                      {fmt.money(amount)}
                    </span>
                  </div>
                  <Progress
                    value={amount}
                    max={total}
                    aria-label={`${row.label}: ${fmt.number(percent)}% of revenue`}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Banknote}
            className="min-h-52"
            title="No revenue in this month"
          />
        )}
      </CardContent>
    </Card>
  );
}
