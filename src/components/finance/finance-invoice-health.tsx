'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ReceiptText } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FinanceInvoiceHealth } from '@/lib/finance/overview';
import type { LocaleFormatters } from '@/lib/locale/format';

const STATUS_ROWS = [
  {
    key: 'paid',
    label: 'Paid',
    color: 'var(--color-emerald-500)',
    dot: 'bg-emerald-500',
  },
  {
    key: 'partiallyPaid',
    label: 'Partially paid',
    color: 'var(--color-amber-500)',
    dot: 'bg-amber-500',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    color: 'var(--color-red-500)',
    dot: 'bg-red-500',
  },
  {
    key: 'open',
    label: 'Open',
    color: 'var(--muted-foreground)',
    dot: 'bg-muted-foreground',
  },
] as const;

export function FinanceInvoiceHealthCard({
  health,
  fmt,
}: {
  health: FinanceInvoiceHealth;
  fmt: LocaleFormatters;
}) {
  const chartData = STATUS_ROWS.map((row) => ({
    ...row,
    value: health[row.key],
  })).filter((row) => row.value > 0);
  const invoiceCount = chartData.reduce((sum, row) => sum + row.value, 0);

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Invoice health</CardTitle>
      </CardHeader>
      <CardContent>
        {invoiceCount > 0 ? (
          <div className="grid items-center gap-5 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)] xl:grid-cols-1 2xl:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)]">
            <div
              className="h-44 min-w-0"
              role="group"
              aria-label="Invoice status chart"
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                initialDimension={{ width: 180, height: 176 }}
              >
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="58%"
                    outerRadius="82%"
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    {chartData.map((row) => (
                      <Cell key={row.key} fill={row.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      fmt.number(Number(value)),
                      String(name),
                    ]}
                    contentStyle={{
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--popover-foreground)',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="divide-border overflow-hidden rounded-lg border">
              {STATUS_ROWS.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-2 border-b px-3 py-2.5 last:border-b-0"
                >
                  <span className={`size-2 rounded-full ${row.dot}`} />
                  <span className="text-muted-foreground flex-1">
                    {row.label}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt.number(health[row.key])}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2 border-t px-3 py-2.5">
                <span className="bg-muted-foreground size-2 rounded-full" />
                <span className="text-muted-foreground flex-1">
                  Outstanding
                </span>
                <span className="font-medium tabular-nums">
                  {fmt.money(health.outstanding)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={ReceiptText}
            className="min-h-52"
            title="No invoices issued in this month"
          />
        )}
      </CardContent>
    </Card>
  );
}
