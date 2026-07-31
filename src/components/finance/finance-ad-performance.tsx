import { Target } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { FinanceAdPerformance } from '@/lib/finance/overview';
import type { LocaleFormatters } from '@/lib/locale/format';

export function FinanceAdPerformanceCard({
  performance,
  fmt,
}: {
  performance: FinanceAdPerformance;
  fmt: LocaleFormatters;
}) {
  const conversion =
    performance.conversionRate === null
      ? '—'
      : `${fmt.number(performance.conversionRate)}%`;
  const returnOnSpend =
    performance.returnOnAdSpend === null
      ? '—'
      : `${fmt.number(performance.returnOnAdSpend)}×`;

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Target className="text-muted-foreground size-4" />
          Ad performance
        </CardTitle>
        <CardDescription>
          Instagram, Facebook and automated Meta leads
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">Marketing spend</p>
            <p className="mt-1 text-lg font-medium tabular-nums">
              {fmt.money(performance.adSpend)}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">
              Joining revenue to date
            </p>
            <p className="mt-1 text-lg font-medium tabular-nums">
              {fmt.money(performance.joiningRevenue)}
            </p>
          </div>
        </div>

        <div className="divide-border divide-y">
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">Leads acquired</span>
            <span className="font-medium tabular-nums">
              {fmt.number(performance.leads)}
            </span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">
              Converted members to date
            </span>
            <span className="font-medium tabular-nums">
              {fmt.number(performance.convertedMembers)}
            </span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">
              Conversion to date
            </span>
            <span className="font-medium tabular-nums">{conversion}</span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">
              Return on ad spend
            </span>
            <span className="font-medium tabular-nums">{returnOnSpend}</span>
          </div>
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Historical cohorts keep updating as their leads convert and make their
          joining payment.
        </p>
      </CardContent>
    </Card>
  );
}
