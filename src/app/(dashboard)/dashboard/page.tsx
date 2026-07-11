"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/hooks/use-locale'
import type { LocaleFormatters } from '@/lib/locale/format'
import {
  MessageSquare,
  UserPlus,
  Users,
  Send,
} from 'lucide-react'

import {
  loadActivity,
  loadConversationsSeries,
  loadLeadFunnel,
  loadMetrics,
  loadLeadsDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  LeadFunnelData,
  MetricsBundle,
  LeadsDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { GymMetrics } from '@/components/dashboard/gym-metrics'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { LeadsDonut } from '@/components/dashboard/leads-donut'
import { LeadFunnel } from '@/components/dashboard/lead-funnel'
import { LeadActionLists } from '@/components/dashboard/lead-action-lists'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const { fmt } = useLocale()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [leadsDonut, setLeadsDonut] = useState<LeadsDonutData | null>(null)
  const [leadsDonutLoading, setLeadsDonutLoading] = useState(true)

  const [leadFunnel, setLeadFunnel] = useState<LeadFunnelData | null>(null)
  const [leadFunnelLoading, setLeadFunnelLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadLeadsDonut(db)
      .then((p) => setLeadsDonut(p))
      .catch((err) => console.error('[dashboard] leads donut failed:', err))
      .finally(() => setLeadsDonutLoading(false))

    void loadLeadFunnel(db)
      .then((f) => setLeadFunnel(f))
      .catch((err) => console.error('[dashboard] lead funnel failed:', err))
      .finally(() => setLeadFunnelLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your gym at a glance — renewals, collections, and member activity.
        </p>
      </div>

      {/* Gym owner KPIs */}
      <GymMetrics />

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Active Conversations"
              value={fmt.number(metrics.activeConversations.current)}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(fmt, metrics.activeConversations.previous, 'new today vs yesterday'),
              }}
            />
            <MetricCard
              title="New Contacts Today"
              value={fmt.number(metrics.newContactsToday.current)}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  fmt,
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  'vs yesterday',
                ),
              }}
            />
            <MetricCard
              title="Open Leads"
              value={fmt.number(metrics.openLeads)}
              icon={Users}
              subtitle="not yet members"
            />
            <MetricCard
              title="Messages Sent Today"
              value={fmt.number(metrics.messagesSentToday.current)}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  fmt,
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  'vs yesterday',
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Today's lead work queues — action lists over dashboards. */}
      <LeadActionLists />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <LeadsDonut data={leadsDonut} loading={leadsDonutLoading} />
        </div>
      </div>

      {/* Lead funnel + conversion */}
      <LeadFunnel data={leadFunnel} loading={leadFunnelLoading} />

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(fmt: LocaleFormatters, delta: number, suffix: string): string {
  if (delta === 0) return `No change ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${fmt.number(delta)} ${suffix}`
}
