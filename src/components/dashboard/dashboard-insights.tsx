'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import {
  loadActivity,
  loadConversationsSeries,
  loadLeadFunnel,
} from '@/lib/dashboard/queries';
import { loadLeadSourceRatings } from '@/lib/dashboard/lead-conversion-rating';
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  LeadFunnelData,
  LeadSourceRatingData,
} from '@/lib/dashboard/types';
import { useLocale } from '@/hooks/use-locale';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { LeadConversionRating } from '@/components/dashboard/lead-conversion-rating';
import { LeadFunnel } from '@/components/dashboard/lead-funnel';

type RangeDays = 7 | 30 | 90;

/**
 * Historical reading, not today's work — the action queues all live above
 * these cards. The lead-status ring was removed: "Leads by stage" already
 * groups the same lead_status buckets and adds how long leads sit in each,
 * so the ring only restated counts the bars already carried.
 */
export function DashboardInsights() {
  const { fmt, locale } = useLocale();
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
    const db = createClient();

    void loadConversationsSeries(db, 30)
      .then((next) => {
        if (!cancelled) {
          setSeries((current) => ({ ...current, 30: next }));
        }
      })
      .catch((error) =>
        console.error('[dashboard] conversation insights failed:', error)
      )
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });
    void loadLeadSourceRatings(db, 30, locale.timeZone, fmt.today())
      .then((next) => {
        if (!cancelled) {
          setRatings((current) => ({ ...current, 30: next }));
        }
      })
      .catch((error) =>
        console.error('[dashboard] lead rating insights failed:', error)
      )
      .finally(() => {
        if (!cancelled) setRatingLoading(false);
      });
    void loadLeadFunnel(db)
      .then((next) => {
        if (!cancelled) setLeadFunnel(next);
      })
      .catch((error) =>
        console.error('[dashboard] funnel insights failed:', error)
      );
    void loadActivity(db, 50)
      .then((next) => {
        if (!cancelled) setActivity(next);
      })
      .catch((error) =>
        console.error('[dashboard] activity insights failed:', error)
      );

    return () => {
      cancelled = true;
    };
  }, [fmt, locale.timeZone]);

  const handleConversationRangeChange = useCallback(
    (nextRange: RangeDays) => {
      setConversationRange(nextRange);
      if (series[nextRange] !== null) return;
      setSeriesLoading(true);
      loadConversationsSeries(createClient(), nextRange)
        .then((next) =>
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
        loadLeadSourceRatings(
          createClient(),
          nextRange,
          locale.timeZone,
          fmt.today()
        )
          .then((next) =>
            setRatings((current) => ({ ...current, [nextRange]: next }))
          )
          .catch((error) =>
            console.error('[dashboard] lead rating insights failed:', error)
          )
          .finally(() => setRatingLoading(false));
      }
    },
    [fmt, locale.timeZone, ratings]
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
