'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity } from 'lucide-react';
import type { LocaleFormatters } from '@/lib/locale/format';
import type { OwnerReport } from '@/lib/reports/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/dashboard/empty-state';

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow:
    '0 10px 25px color-mix(in oklch, var(--foreground) 12%, transparent)',
  color: 'var(--popover-foreground)',
  fontSize: 12,
};

// Recharts otherwise starts ResponsiveContainer at {-1, -1} until its first
// ResizeObserver callback, producing a console warning during route hydration.
const initialChartDimension = { width: 520, height: 288 };

export function ActivityTrendCard({
  data,
  fmt,
}: {
  data: OwnerReport['trend'];
  fmt: LocaleFormatters;
}) {
  const hasData = data.some(
    (point) => point.visits > 0 || point.newMembers > 0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Member activity</CardTitle>
        <CardDescription>Daily visits and new member joins</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div
            className="h-72 w-full"
            role="group"
            aria-label="Daily attendance and joins chart"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={initialChartDimension}
            >
              <ComposedChart
                accessibilityLayer
                data={data}
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
                  minTickGap={28}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => fmt.dateShort(String(value))}
                />
                <YAxis
                  yAxisId="visits"
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={36}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <YAxis
                  yAxisId="members"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={28}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(value) => fmt.date(String(value))}
                  formatter={(value, name) => [
                    fmt.number(Number(value)),
                    name === 'visits' ? 'Visits' : 'New members',
                  ]}
                />
                <Bar
                  yAxisId="visits"
                  dataKey="visits"
                  name="visits"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
                <Line
                  yAxisId="members"
                  type="monotone"
                  dataKey="newMembers"
                  name="newMembers"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--chart-1)' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            className="h-72"
            title="No member activity in this period"
            hint="Check-ins and new member joins will appear here."
          />
        )}
      </CardContent>
    </Card>
  );
}
