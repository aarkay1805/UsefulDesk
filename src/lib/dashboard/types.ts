// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  /** Contacts without a membership — the current lead pool. */
  openLeads: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface LeadStatusSlice {
  key: string
  label: string
  color: string
  count: number
}

export interface LeadsDonutData {
  slices: LeadStatusSlice[]
  total: number
}

export interface LeadFunnelStage {
  key: string
  label: string
  color: string
  count: number
  /** Average days leads have sat in this status. Null = no leads. */
  avgDays: number | null
}

export interface LeadSourcePerf {
  key: string
  label: string
  leads: number
  members: number
  /** members / (leads + members), 0–1. Null when the source has no rows. */
  rate: number | null
}

export interface LeadFunnelData {
  stages: LeadFunnelStage[]
  totalLeads: number
  /** Memberships created this calendar month = leads converted. */
  convertedThisMonth: number
  /** All-time members / (leads + members). Null when no contacts. */
  conversionRate: number | null
  topSources: LeadSourcePerf[]
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}
