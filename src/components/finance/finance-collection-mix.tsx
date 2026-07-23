'use client';

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { Banknote } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FinanceCollectionMethod } from '@/lib/finance/overview';
import type { LocaleFormatters } from '@/lib/locale/format';

const METHOD_DETAILS = {
  upi: {
    label: 'UPI',
    color: 'var(--color-blue-500)',
    dot: 'bg-blue-500',
  },
  cash: {
    label: 'Cash',
    color: 'var(--color-emerald-500)',
    dot: 'bg-emerald-500',
  },
  card: {
    label: 'Card',
    color: 'var(--color-amber-500)',
    dot: 'bg-amber-500',
  },
  bank_other: {
    label: 'Bank & other',
    color: 'var(--color-violet-500)',
    dot: 'bg-violet-500',
  },
} as const;

export function FinanceCollectionMixCard({
  methods,
  fmt,
}: {
  methods: FinanceCollectionMethod[];
  fmt: LocaleFormatters;
}) {
  const total = methods.reduce((sum, method) => sum + method.amount, 0);
  const chartRow = Object.fromEntries(
    methods.map((method) => [method.method, method.amount])
  );

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Collection mix</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {total > 0 ? (
          <>
            <div
              className="h-6 w-full"
              role="group"
              aria-label="Collections by payment method"
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                initialDimension={{ width: 520, height: 24 }}
              >
                <BarChart
                  layout="vertical"
                  data={[chartRow]}
                  barSize={14}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide domain={[0, total]} />
                  <YAxis type="category" hide dataKey="name" />
                  {Object.entries(METHOD_DETAILS).map(([key, detail]) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="collections"
                      fill={detail.color}
                      radius={0}
                      isAnimationActive={false}
                    >
                      <Cell fill={detail.color} />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="divide-border divide-y">
              {Object.entries(METHOD_DETAILS).map(([key, detail]) => {
                const method = methods.find((item) => item.method === key);
                const amount = method?.amount ?? 0;
                const percent =
                  total > 0 ? Math.round((amount / total) * 100) : 0;
                return (
                  <div key={key} className="flex items-center gap-2 py-2.5">
                    <span className={`size-2 rounded-full ${detail.dot}`} />
                    <span className="flex-1 font-medium">{detail.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {fmt.number(percent)}%
                    </span>
                    <span className="w-24 text-right font-medium tabular-nums">
                      {fmt.money(amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState
            icon={Banknote}
            className="min-h-52"
            title="No collections in this month"
          />
        )}
      </CardContent>
    </Card>
  );
}
