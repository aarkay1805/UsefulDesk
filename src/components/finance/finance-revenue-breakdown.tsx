import { Banknote } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import type {
  FinanceRevenueBreakdown,
  FinanceRevenueStream,
} from '@/lib/finance/overview';
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
  streams,
  fmt,
}: {
  breakdown: FinanceRevenueBreakdown;
  streams: FinanceRevenueStream[];
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
      <CardContent className="px-0">
        {total > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[31rem]">
              <div className="border-border border-b">
                <div
                  role="row"
                  className="text-muted-foreground mx-4 flex h-10 items-center border border-transparent text-sm font-medium"
                >
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(11rem,1fr)_minmax(4rem,5rem)_minmax(4rem,5rem)_minmax(7rem,8rem)] items-center gap-2">
                    <span className="pl-10">Revenue stream / plan</span>
                    <span className="text-right">Payments</span>
                    <span className="text-right">Share</span>
                    <span className="text-right">Revenue</span>
                  </span>
                </div>
              </div>
              <Accordion multiple>
                {rows.map((row) => {
                  const stream = streams.find(
                    (item) => item.purpose === row.key
                  ) ?? {
                    purpose: row.key,
                    payments: 0,
                    amount: breakdown[row.key],
                    plans: [],
                  };
                  const percent = Math.round((stream.amount / total) * 100);

                  return (
                    <AccordionItem key={row.key} value={row.key}>
                      <AccordionTrigger className="hover:bg-muted/50 rounded-none px-4 hover:no-underline **:data-[slot=accordion-trigger-icon]:absolute **:data-[slot=accordion-trigger-icon]:top-1/2 **:data-[slot=accordion-trigger-icon]:left-4 **:data-[slot=accordion-trigger-icon]:ml-0 **:data-[slot=accordion-trigger-icon]:-translate-y-1/2">
                        <span className="grid min-w-0 flex-1 grid-cols-[minmax(11rem,1fr)_minmax(4rem,5rem)_minmax(4rem,5rem)_minmax(7rem,8rem)] items-center gap-2">
                          <span className="flex min-w-0 items-center gap-2 pl-6 font-medium">
                            <span
                              className={`size-2 shrink-0 rounded-full ${row.dot}`}
                            />
                            <span className="truncate">{row.label}</span>
                          </span>
                          <span className="text-right tabular-nums">
                            {fmt.number(stream.payments)}
                          </span>
                          <span className="text-muted-foreground text-right tabular-nums">
                            {fmt.number(percent)}%
                          </span>
                          <span className="text-right font-medium tabular-nums">
                            {fmt.money(stream.amount)}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        {stream.plans.length > 0 ? (
                          <Table className="table-fixed">
                            <colgroup>
                              <col />
                              <col className="w-20" />
                              <col className="w-20" />
                              <col className="w-32" />
                            </colgroup>
                            <TableBody>
                              {stream.plans.map((plan) => (
                                <TableRow
                                  key={plan.id ?? `${row.key}-unassigned`}
                                >
                                  <TableCell className="pl-14 font-medium">
                                    {plan.name}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {fmt.number(plan.payments)}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-right tabular-nums">
                                    {fmt.number(
                                      Math.round(
                                        (plan.amount / stream.amount) * 100
                                      )
                                    )}
                                    %
                                  </TableCell>
                                  <TableCell className="pr-4 text-right font-medium tabular-nums">
                                    {fmt.money(plan.amount)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <p className="text-muted-foreground py-3 pr-4 pl-14 text-sm">
                            No collections in this revenue stream.
                          </p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          </div>
        ) : (
          <div className="px-4">
            <EmptyState
              icon={Banknote}
              className="min-h-52"
              title="No revenue in this month"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
