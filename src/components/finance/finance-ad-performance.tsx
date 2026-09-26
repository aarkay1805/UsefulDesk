import { CircleHelp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
      <CardHeader>
        <CardTitle>Ad performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">Money spent on ads</p>
            <p className="mt-1 text-lg font-medium tabular-nums">
              {fmt.money(performance.adSpend)}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-muted-foreground text-xs">
              Joining fees received so far
            </p>
            <p className="mt-1 text-lg font-medium tabular-nums">
              {fmt.money(performance.joiningRevenue)}
            </p>
          </div>
        </div>

        <div className="divide-border divide-y">
          <div className="flex items-center gap-3 py-2.5">
            <div className="flex-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    delay={350}
                    render={
                      <button
                        type="button"
                        aria-label="About enquiries from ads"
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex cursor-help items-center gap-1.5 rounded-sm text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      />
                    }
                  >
                    <span>Enquiries from ads</span>
                    <CircleHelp aria-hidden="true" className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Enquiries from Instagram and Facebook ads
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <span className="font-medium tabular-nums">
              {fmt.number(performance.leads)}
            </span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">
              Joined as members so far
            </span>
            <span className="font-medium tabular-nums">
              {fmt.number(performance.convertedMembers)}
            </span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">
              Joined so far (%)
            </span>
            <span className="font-medium tabular-nums">{conversion}</span>
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="text-muted-foreground flex-1">
              Money earned for every 1 spent
            </span>
            <span className="font-medium tabular-nums">{returnOnSpend}</span>
          </div>
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Older months keep updating when their enquiries join and pay.
        </p>
      </CardContent>
    </Card>
  );
}
