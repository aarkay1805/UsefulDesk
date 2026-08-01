'use client';

import { useState } from 'react';
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
import { weeklyActivityTrend } from '@/lib/reports/activity-trend';
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
import { EmptyState } from '@/components/dashboard/empty-state';

type Grouping = 'daily' | 'weekly';

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
  const [grouping, setGrouping] = useState<Grouping>('daily');
  const chartData = grouping === 'daily' ? data : weeklyActivityTrend(data);
  const hasData = data.some(
    (point) => point.visits > 0 || point.newMembers > 0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Member activity</CardTitle>
        <CardAction>
          <Toolbar aria-label="Member activity grouping">
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
      <CardContent>
        {hasData ? (
          <div
            className="h-72 w-full"
            role="group"
            aria-label={`${grouping === 'daily' ? 'Daily' : 'Weekly'} attendance and joins chart`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={initialChartDimension}
            >
              <ComposedChart
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
                    String(Number(String(value).slice(-2)))
                  }
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
                  labelFormatter={(value) =>
                    grouping === 'daily'
                      ? fmt.date(String(value))
                      : `Week of ${fmt.date(String(value))}`
                  }
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
