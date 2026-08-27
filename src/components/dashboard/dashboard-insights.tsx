'use client';

import { useCallback, useEffect, useState } from 'react';

import type {
  ActivityItem,
  ConversationsSeriesPoint,
  DashboardInsightsRangeDays,
  DashboardInsightsSnapshot,
  LeadFunnelData,
  LeadSourceRatingData,
} from '@/lib/dashboard/types';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { LeadConversionRating } from '@/components/dashboard/lead-conversion-rating';
import { LeadFunnel } from '@/components/dashboard/lead-funnel';

type RangeDays = DashboardInsightsRangeDays;

async function loadInsightsResponse<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? 'Could not load dashboard insights');
  }
  return body;
}

/**
 * Historical reading, not today's work — the action queues all live above
 * these cards. The lead-status ring was removed: "Leads by stage" already
 * groups the same lead_status buckets and adds how long leads sit in each,
 * so the ring only restated counts the bars already carried.
 */
export function DashboardInsights() {
  const [conversationRange, setConversationRange] = useState<RangeDays>(30);
  const [ratingRange, setRatingRange] = useState<RangeDays>(30);
  const [series, setSeries] = useState<
    Record<RangeDays, ConversationsSeriesPoint[] | null>
  >({
    7: null,
    30: null,
    90: null,
  });
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [ratings, setRatings] = useState<
    Record<RangeDays, LeadSourceRatingData | null>
  >({
    7: null,
    30: null,
    90: null,
  });
  const [ratingLoading, setRatingLoading] = useState(true);
  const [leadFunnel, setLeadFunnel] = useState<LeadFunnelData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadInsightsResponse<DashboardInsightsSnapshot>(
      '/api/dashboard/insights?view=initial'
    )
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot.series) {
          setSeries((current) => ({ ...current, 30: snapshot.series }));
        }
        if (snapshot.rating) {
          setRatings((current) => ({ ...current, 30: snapshot.rating }));
        }
        if (snapshot.leadFunnel) setLeadFunnel(snapshot.leadFunnel);
        if (snapshot.activity) setActivity(snapshot.activity);
        for (const section of snapshot.errors) {
          console.error(`[dashboard] ${section} insights failed`);
        }
      })
      .catch((error) =>
        console.error('[dashboard] insight snapshot failed:', error)
      )
      .finally(() => {
        if (!cancelled) {
          setSeriesLoading(false);
          setRatingLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConversationRangeChange = useCallback(
    (nextRange: RangeDays) => {
      setConversationRange(nextRange);
      if (series[nextRange] !== null) return;
      setSeriesLoading(true);
      loadInsightsResponse<{ series: ConversationsSeriesPoint[] }>(
        `/api/dashboard/insights?view=conversations&range=${nextRange}`
      )
        .then(({ series: next }) =>
          setSeries((current) => ({ ...current, [nextRange]: next }))
        )
        .catch((error) =>
          console.error('[dashboard] conversation insights failed:', error)
        )
        .finally(() => setSeriesLoading(false));
    },
    [series]
  );

  const handleRatingRangeChange = useCallback(
    (nextRange: RangeDays) => {
      setRatingRange(nextRange);
      if (ratings[nextRange] === null) {
        setRatingLoading(true);
        loadInsightsResponse<{ rating: LeadSourceRatingData }>(
          `/api/dashboard/insights?view=lead-rating&range=${nextRange}`
        )
          .then(({ rating: next }) =>
            setRatings((current) => ({ ...current, [nextRange]: next }))
          )
          .catch((error) =>
            console.error('[dashboard] lead rating insights failed:', error)
          )
          .finally(() => setRatingLoading(false));
      }
    },
    [ratings]
  );

  // No wrapper heading: each card below already names itself, so a grouping
  // level above them ("The full picture") added a heading without adding
  // meaning. The fragment lets each card inherit the page's section spacing.
  return (
    <>
      {/* Two peer sections sharing a row: one 7/30/90 decision reads as one
          row rather than two unrelated widgets. Each is its own grid item, so
          each keeps its own heading — no wrapper heading over the pair. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 lg:grid-cols-5">
        <ConversationsChart
          className="lg:col-span-3"
          series={series}
          loading={seriesLoading}
          range={conversationRange}
          onRangeChange={handleConversationRangeChange}
        />
        <LeadConversionRating
          className="lg:col-span-2"
          data={ratings[ratingRange]}
          loading={ratingLoading && ratings[ratingRange] === null}
          range={ratingRange}
          onRangeChange={handleRatingRangeChange}
        />
      </div>
      <LeadFunnel data={leadFunnel} loading={!leadFunnel} />
      <ActivityFeed items={activity} loading={!activity} />
    </>
  );
}
