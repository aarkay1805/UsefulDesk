'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import type { LocaleFormatters } from '@/lib/locale/format';
import type { FinanceTrendPoint } from '@/lib/finance/overview';

type Grouping = 'daily' | 'weekly';

const initialChartDimension = { width: 720, height: 288 };

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow:
    '0 10px 25px color-mix(in oklch, var(--foreground) 12%, transparent)',
  color: 'var(--popover-foreground)',
  fontSize: 12,
};

function weeklyTrend(data: FinanceTrendPoint[]): FinanceTrendPoint[] {
  const result: FinanceTrendPoint[] = [];
  for (let index = 0; index < data.length; index += 7) {
    const days = data.slice(index, index + 7);
    result.push({
      date: days[0].date,
      income: days.reduce((sum, day) => sum + day.income, 0),
      expenses: days.some((day) => day.expenses !== null)
        ? days.reduce((sum, day) => sum + (day.expenses ?? 0), 0)
        : null,
    });
  }
  return result;
}

export function FinanceCashFlowChart({
  data,
  monthLabel,
  expenseTrackingAvailable,
  fmt,
}: {
  data: FinanceTrendPoint[];
  monthLabel: string;
  expenseTrackingAvailable: boolean;
  fmt: LocaleFormatters;
}) {
  const [grouping, setGrouping] = useState<Grouping>('daily');
  const chartData = grouping === 'daily' ? data : weeklyTrend(data);
  const hasData = data.some(
    (point) => point.income > 0 || (point.expenses ?? 0) > 0
  );

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Cash flow · {monthLabel}</CardTitle>
        <CardAction>
          <Toolbar aria-label="Cash flow grouping">
            <ToolbarToggleGroup<Grouping>
              value={[grouping]}
              onValueChange={(values) => values[0] && setGrouping(values[0])}
            >
              <ToolbarToggleItem value="daily">Daily</ToolbarToggleItem>
              <ToolbarToggleItem value="weekly">Weekly</ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <span className="bg-primary size-2 rounded-sm" />
            Income
          </span>
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-red-500" />
            Expenses
            {!expenseTrackingAvailable ? ' · not tracked yet' : ''}
          </span>
        </div>

        {hasData ? (
          <div
            className="h-72 w-full"
            role="group"
            aria-label={`${grouping === 'daily' ? 'Daily' : 'Weekly'} cash flow chart`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={initialChartDimension}
            >
              <BarChart
                accessibilityLayer
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) =>
                    grouping === 'daily'
                      ? String(Number(String(value).slice(-2)))
                      : fmt.dateShort(String(value))
                  }
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => fmt.moneyShort(Number(value))}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(value) =>
                    grouping === 'daily'
                      ? fmt.date(String(value))
                      : `Week of ${fmt.date(String(value))}`
                  }
                  formatter={(value, name) => [
                    fmt.money(Number(value)),
                    name === 'income' ? 'Income' : 'Expenses',
                  ]}
                />
                <Bar
                  dataKey="income"
                  name="income"
                  fill="var(--chart-1)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                />
                {expenseTrackingAvailable ? (
                  <Bar
                    dataKey="expenses"
                    name="expenses"
                    fill="var(--color-red-500)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={14}
                  />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={BarChart3}
            className="h-72"
            title="No cash movement in this month"
            hint="Recorded membership payments will appear here by day."
          />
        )}
      </CardContent>
    </Card>
  );
}
