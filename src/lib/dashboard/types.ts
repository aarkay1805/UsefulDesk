// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export type DashboardInsightsRangeDays = 7 | 30 | 90;

export type DashboardInsightsSection =
  'conversations' | 'leadRating' | 'leadFunnel';

export interface ConversationsSeriesPoint {
  day: string; // YYYY-MM-DD local
  incoming: number;
  outgoing: number;
}

export interface LeadFunnelStage {
  key: string;
  label: string;
  color: string;
  count: number;
  /** Average days leads have sat in this status. Null = no leads. */
  avgDays: number | null;
}

export interface LeadSourcePerf {
  key: string;
  label: string;
  leads: number;
  members: number;
  /** members / (leads + members), 0–1. Null when the source has no rows. */
  rate: number | null;
}

export interface LeadFunnelData {
  stages: LeadFunnelStage[];
  totalLeads: number;
  /** Memberships created this calendar month = leads converted. */
  convertedThisMonth: number;
  /** All-time members / (leads + members). Null when no contacts. */
  conversionRate: number | null;
  /** All-time contacts that became members — the numerator behind `conversionRate`. */
  convertedTotal: number;
  topSources: LeadSourcePerf[];
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number;
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null;
  samples: number;
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[];
  thisWeekAvg: number | null;
  lastWeekAvg: number | null;
}

export type LeadRatingMetricKey =
  | 'memberConversion'
  | 'trialBooking'
  | 'humanResponse'
  | 'followUp'
  | 'positiveOutcome';

export interface LeadRatingMetric {
  key: LeadRatingMetricKey;
  label: string;
  /** Share of the headline rating, expressed as a percentage. */
  weight: number;
  /** Explicit benchmark the observed rate is scored against. */
  target: number;
  /** Observed success rate, 0–100. Null means there was no measurable sample. */
  actual: number | null;
  /** min(actual / target, 1) × 100. Null is never coerced to zero. */
  normalized: number | null;
  successes: number;
  sample: number;
}

export type LeadRatingConfidence =
  'insufficient' | 'low' | 'directional' | 'strong';

export interface LeadSourceRating {
  key: string;
  label: string;
  cohortSize: number;
  /** Weighted score, 0–100. Null until all five weighted metrics are measurable. */
  rating: number | null;
  metrics: LeadRatingMetric[];
  confidence: LeadRatingConfidence;
  /** Smallest denominator among the five component metrics. */
  confidenceSample: number;
}

export interface LeadSourceRatingData {
  rangeDays: 7 | 30 | 90;
  period: {
    start: string;
    end: string;
  };
  /** Unified operational rating across every lead, including unknown source. */
  allLeads: LeadSourceRating;
  /** Optional source-specific drill-downs. */
  sources: LeadSourceRating[];
  totalCohort: number;
}

export type ActivityKind = 'message' | 'broadcast' | 'automation' | 'contact';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string;
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string;
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string;
}

/**
 * Bounded initial payload returned by the dashboard insights API. Raw message,
 * contact, membership, and follow-up histories never cross into browser code.
 * A null section is independently unavailable and does not discard successful
 * siblings, matching the dashboard's former per-card loading posture.
 */
export interface DashboardInsightsSnapshot {
  series: ConversationsSeriesPoint[] | null;
  rating: LeadSourceRatingData | null;
  leadFunnel: LeadFunnelData | null;
  errors: DashboardInsightsSection[];
}

/**
 * Recent work reads on its own request. It no longer rides the insights
 * snapshot because it no longer sits with the insights: the feed moved up
 * beside the uncontacted-lead queue, so it must load when that row loads
 * rather than when the reader scrolls the charts into view.
 */
export interface DashboardActivityResponse {
  activity: ActivityItem[];
}
