'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import type { LocaleFormatters } from '@/lib/locale/format';
import {
  alignFinanceCashFlowTrends,
  financeCashFlowHasMovement,
  type FinanceCashFlowComparisonPoint,
  type FinanceTrendPoint,
} from '@/lib/finance/overview';

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

interface CurrentChartPoint extends FinanceTrendPoint {
  endDate: string;
}

function currentTrend(
  data: FinanceTrendPoint[],
  grouping: Grouping
): CurrentChartPoint[] {
  if (grouping === 'daily') {
    return data.map((point) => ({ ...point, endDate: point.date }));
  }
  const result: CurrentChartPoint[] = [];
  for (let index = 0; index < data.length; index += 7) {
    const days = data.slice(index, index + 7);
    result.push({
      date: days[0].date,
      endDate: days.at(-1)?.date ?? days[0].date,
      income: days.reduce((sum, day) => sum + day.income, 0),
      expenses: days.reduce((sum, day) => sum + day.expenses, 0),
    });
  }
  return result;
}

function localizedRange(
  start: string | null,
  end: string | null,
  fmt: LocaleFormatters
): string {
  if (!start || !end) return 'No matching date';
  return start === end
    ? fmt.date(start)
    : `${fmt.date(start)} – ${fmt.date(end)}`;
}

function CurrentCashFlowTooltip({
  active,
  payload,
  fmt,
}: Pick<TooltipContentProps<number, string>, 'active' | 'payload'> & {
  fmt: LocaleFormatters;
}) {
  const point = payload[0]?.payload as CurrentChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div style={tooltipStyle} className="min-w-48 space-y-2 p-3">
      <p className="font-medium">
        {localizedRange(point.date, point.endDate, fmt)}
      </p>
      <TooltipValue
        label="Income"
        value={point.income}
        tone="income"
        fmt={fmt}
      />
      <TooltipValue
        label="Expenses"
        value={point.expenses}
        tone="expenses"
        fmt={fmt}
      />
    </div>
  );
}

function ComparisonCashFlowTooltip({
  active,
  payload,
  currentMonthLabel,
  previousMonthLabel,
  fmt,
}: Pick<TooltipContentProps<number, string>, 'active' | 'payload'> & {
  currentMonthLabel: string;
  previousMonthLabel: string;
  fmt: LocaleFormatters;
}) {
  const point = payload[0]?.payload as
    FinanceCashFlowComparisonPoint | undefined;
  if (!active || !point) return null;
  return (
    <div style={tooltipStyle} className="min-w-60 space-y-3 p-3">
      <TooltipPeriod
        label={currentMonthLabel}
        range={localizedRange(point.currentStart, point.currentEnd, fmt)}
        income={point.currentIncome}
        expenses={point.currentExpenses}
        fmt={fmt}
      />
      <TooltipPeriod
        label={previousMonthLabel}
        range={localizedRange(point.previousStart, point.previousEnd, fmt)}
        income={point.previousIncome}
        expenses={point.previousExpenses}
        previous
        fmt={fmt}
      />
    </div>
  );
}

function TooltipPeriod({
  label,
  range,
  income,
  expenses,
  previous = false,
  fmt,
}: {
  label: string;
  range: string;
  income: number;
  expenses: number;
  previous?: boolean;
  fmt: LocaleFormatters;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{range}</p>
      </div>
      <TooltipValue
        label="Income"
        value={income}
        tone="income"
        previous={previous}
        fmt={fmt}
      />
      <TooltipValue
        label="Expenses"
        value={expenses}
        tone="expenses"
        previous={previous}
        fmt={fmt}
      />
    </div>
  );
}

function TooltipValue({
  label,
  value,
  tone,
  previous = false,
  fmt,
}: {
  label: string;
  value: number;
  tone: 'income' | 'expenses';
  previous?: boolean;
  fmt: LocaleFormatters;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground inline-flex items-center gap-1.5">
        <span
          className="size-2 rounded-sm"
          style={{
            backgroundColor:
              tone === 'income' ? 'var(--chart-1)' : 'var(--color-red-500)',
            opacity: previous ? 0.35 : 1,
          }}
        />
        {label}
      </span>
      <span className="tabular-nums">{fmt.money(value)}</span>
    </div>
  );
}

function LegendItem({
  label,
  tone,
  previous = false,
}: {
  label: string;
  tone: 'income' | 'expenses';
  previous?: boolean;
}) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5">
      <span
        className="size-2 rounded-sm"
        style={{
          backgroundColor:
            tone === 'income' ? 'var(--chart-1)' : 'var(--color-red-500)',
          opacity: previous ? 0.35 : 1,
        }}
      />
      {label}
    </span>
  );
}

export function FinanceCashFlowChart({
  data,
  previousData,
  comparisonThroughDay,
  monthLabel,
  previousMonthLabel,
  fmt,
}: {
  data: FinanceTrendPoint[];
  previousData: FinanceTrendPoint[];
  comparisonThroughDay: number | null;
  monthLabel: string;
  previousMonthLabel: string;
  fmt: LocaleFormatters;
}) {
  const [grouping, setGrouping] = useState<Grouping>('daily');
  const [comparePrevious, setComparePrevious] = useState(false);
  const chartData: Array<Record<string, string | number | null>> =
    comparePrevious
      ? alignFinanceCashFlowTrends(
          data,
          previousData,
          grouping,
          comparisonThroughDay
        ).map((point) => ({ ...point }))
      : currentTrend(data, grouping).map((point) => ({ ...point }));
  const comparisonDayCount = Math.min(
    comparisonThroughDay ?? Math.max(data.length, previousData.length),
    Math.max(data.length, previousData.length)
  );
  const hasData = financeCashFlowHasMovement(data, previousData);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Cash flow · {monthLabel}</CardTitle>
        <CardAction className="flex items-center gap-3">
          <label className="text-foreground flex items-center gap-2 text-sm">
            <Checkbox
              checked={comparePrevious}
              onCheckedChange={setComparePrevious}
            />
            <span>Compare previous month</span>
          </label>
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
        {hasData ? (
          <div
            className="h-72 w-full"
            role="group"
            aria-label={`${grouping === 'daily' ? 'Daily' : 'Weekly'} cash flow chart${comparePrevious ? ' comparing the selected and previous months' : ''}`}
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
                  dataKey={comparePrevious ? 'ordinal' : 'date'}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => {
                    if (!comparePrevious) {
                      return grouping === 'daily'
                        ? String(Number(String(value).slice(-2)))
                        : fmt.dateShort(String(value));
                    }
                    const day = Number(value);
                    return grouping === 'daily'
                      ? String(day)
                      : `${day}–${Math.min(day + 6, comparisonDayCount)}`;
                  }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => fmt.moneyShort(Number(value))}
                />
                <Tooltip
                  content={(props) =>
                    comparePrevious ? (
                      <ComparisonCashFlowTooltip
                        {...props}
                        currentMonthLabel={monthLabel}
                        previousMonthLabel={previousMonthLabel}
                        fmt={fmt}
                      />
                    ) : (
                      <CurrentCashFlowTooltip {...props} fmt={fmt} />
                    )
                  }
                />
                {comparePrevious ? (
                  <>
                    <Bar
                      dataKey="currentIncome"
                      name="Selected income"
                      fill="var(--chart-1)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={16}
                    />
                    <Bar
                      dataKey="currentExpenses"
                      name="Selected expenses"
                      fill="var(--color-red-500)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={12}
                    />
                    <Bar
                      dataKey="previousIncome"
                      name="Previous income"
                      fill="var(--chart-1)"
                      fillOpacity={0.35}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={16}
                    />
                    <Bar
                      dataKey="previousExpenses"
                      name="Previous expenses"
                      fill="var(--color-red-500)"
                      fillOpacity={0.35}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={12}
                    />
                  </>
                ) : (
                  <>
                    <Bar
                      dataKey="income"
                      name="Income"
                      fill="var(--chart-1)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={22}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Expenses"
                      fill="var(--color-red-500)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={14}
                    />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={BarChart3}
            className="h-72"
            title="No cash movement in either month"
            hint="Recorded income and expenses will appear here by day for comparison."
          />
        )}

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <LegendItem
            label={comparePrevious ? 'Selected income' : 'Income'}
            tone="income"
          />
          <LegendItem
            label={comparePrevious ? 'Selected expenses' : 'Expenses'}
            tone="expenses"
          />
          {comparePrevious ? (
            <>
              <LegendItem label="Previous income" tone="income" previous />
              <LegendItem label="Previous expenses" tone="expenses" previous />
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
