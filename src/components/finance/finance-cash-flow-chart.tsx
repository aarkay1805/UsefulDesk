'use client';

import { useState } from 'react';
import { useReducedMotion } from 'motion/react';
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
  CardFooter,
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

// Money in / money out are fixed semantic hues, not the account accent:
// --chart-1 follows the theme, so on the rose accent income rendered in the
// same red as expenses and on amber it sat one hue step away. Emerald/red also
// matches the rest of the finance module (invoice health, collection mix),
// which reads its data marks from the same -500 fill primitives.
const INCOME_FILL = 'var(--color-emerald-500)';
const EXPENSE_FILL = 'var(--color-red-500)';
// The previous month is de-emphasised by mixing toward the card surface rather
// than by fillOpacity: a translucent bar let the dashed grid read straight
// through it, and the mix stays correct in both modes because --card flips.
const PREVIOUS_INCOME_FILL =
  'color-mix(in oklch, var(--color-emerald-500) 55%, var(--card))';
const PREVIOUS_EXPENSE_FILL =
  'color-mix(in oklch, var(--color-red-500) 55%, var(--card))';

function fillFor(tone: 'income' | 'expenses', previous: boolean): string {
  if (tone === 'income') return previous ? PREVIOUS_INCOME_FILL : INCOME_FILL;
  return previous ? PREVIOUS_EXPENSE_FILL : EXPENSE_FILL;
}

// Bars are capped, never sized: at daily grouping a 31-day month leaves ~19px
// per band, so the cap only takes effect once weekly grouping widens the bands.
// barGap 1 (Recharts defaults to 4) is what makes the daily bars legible —
// three 4px gutters ate two thirds of a four-series band. Hue, not whitespace,
// separates the income pair from the expense pair.
const BAR_GAP = 1;
const BAR_CATEGORY_GAP = '12%';
const BAR_RADIUS: [number, number, number, number] = [2, 2, 0, 0];
const Y_AXIS_WIDTH = 56;

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow:
    '0 10px 25px color-mix(in oklch, var(--foreground) 12%, transparent)',
  color: 'var(--popover-foreground)',
  fontSize: 12,
};

const tooltipCursor = { fill: 'var(--foreground)', fillOpacity: 0.06 };

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
        label={previousMonthLabel}
        range={localizedRange(point.previousStart, point.previousEnd, fmt)}
        income={point.previousIncome}
        expenses={point.previousExpenses}
        previous
        fmt={fmt}
      />
      <TooltipPeriod
        label={currentMonthLabel}
        range={localizedRange(point.currentStart, point.currentEnd, fmt)}
        income={point.currentIncome}
        expenses={point.currentExpenses}
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

function Swatch({
  tone,
  previous,
}: {
  tone: 'income' | 'expenses';
  previous: boolean;
}) {
  return (
    <span
      // Square with the bars' own 2px cap, so the key reads as a miniature of
      // the mark it stands for rather than as a generic status dot.
      className="size-2 shrink-0 rounded-xs"
      style={{ backgroundColor: fillFor(tone, previous) }}
    />
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
        <Swatch tone={tone} previous={previous} />
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
    <span className="inline-flex items-center gap-1.5">
      <Swatch tone={tone} previous={previous} />
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
  const reduceMotion = useReducedMotion();
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
  const barAnimation = {
    isAnimationActive: !reduceMotion,
    animationDuration: 420,
    animationEasing: 'ease-out' as const,
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Cash flow · {monthLabel}</CardTitle>
        {/* Below sm the controls take their own row: side by side they
            outgrow a phone-width card, and the card clips its overflow, so
            the Weekly toggle was cut off at the edge. */}
        <CardAction className="col-start-1 row-start-2 mt-1 flex w-full flex-wrap items-center justify-start gap-x-3 gap-y-2 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:w-auto sm:justify-end">
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
      {/* flex-1 + h-full: the card is stretched to its row-mate's height, so
          the plot takes the slack instead of leaving it dead below the axis.
          min-h keeps the same floor when the card stacks and sizes to content. */}
      <CardContent className="flex-1">
        {hasData ? (
          <div
            className="h-full min-h-72 w-full"
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
                barGap={BAR_GAP}
                barCategoryGap={BAR_CATEGORY_GAP}
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
                  tickMargin={8}
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
                  width={Y_AXIS_WIDTH}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => fmt.moneyShort(Number(value))}
                />
                <Tooltip
                  cursor={tooltipCursor}
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
                  // Previous before selected inside each pair, so every band
                  // reads left-to-right as then → now. The four series were
                  // previously ordered current, current, previous, previous,
                  // which put the two halves of each comparison a bar apart.
                  <>
                    <Bar
                      dataKey="previousIncome"
                      name="Previous income"
                      fill={PREVIOUS_INCOME_FILL}
                      radius={BAR_RADIUS}
                      maxBarSize={20}
                      {...barAnimation}
                    />
                    <Bar
                      dataKey="currentIncome"
                      name="Selected income"
                      fill={INCOME_FILL}
                      radius={BAR_RADIUS}
                      maxBarSize={20}
                      {...barAnimation}
                    />
                    <Bar
                      dataKey="previousExpenses"
                      name="Previous expenses"
                      fill={PREVIOUS_EXPENSE_FILL}
                      radius={BAR_RADIUS}
                      maxBarSize={20}
                      {...barAnimation}
                    />
                    <Bar
                      dataKey="currentExpenses"
                      name="Selected expenses"
                      fill={EXPENSE_FILL}
                      radius={BAR_RADIUS}
                      maxBarSize={20}
                      {...barAnimation}
                    />
                  </>
                ) : (
                  <>
                    <Bar
                      dataKey="income"
                      name="Income"
                      fill={INCOME_FILL}
                      radius={BAR_RADIUS}
                      maxBarSize={24}
                      {...barAnimation}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Expenses"
                      fill={EXPENSE_FILL}
                      radius={BAR_RADIUS}
                      maxBarSize={24}
                      {...barAnimation}
                    />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={BarChart3}
            className="h-full min-h-72"
            title="No cash movement in either month"
            hint="Recorded income and expenses will appear here by day for comparison."
          />
        )}
      </CardContent>

      <CardFooter className="text-muted-foreground flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {comparePrevious ? (
          <>
            <LegendItem label="Previous income" tone="income" previous />
            <LegendItem label="Selected income" tone="income" />
            <LegendItem label="Previous expenses" tone="expenses" previous />
            <LegendItem label="Selected expenses" tone="expenses" />
          </>
        ) : (
          <>
            <LegendItem label="Income" tone="income" />
            <LegendItem label="Expenses" tone="expenses" />
          </>
        )}
      </CardFooter>
    </Card>
  );
}
