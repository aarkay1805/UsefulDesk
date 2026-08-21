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
 * this section. The lead-status ring was removed: "Leads by stage" already
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

  return (
    <section aria-labelledby="business-picture-heading" className="space-y-4">
      <h2
        id="business-picture-heading"
        className="text-foreground text-sm font-semibold"
      >
        The full picture
      </h2>
      {/* The two range-controlled reads sit together, so one 7/30/90 decision
          reads as one row rather than two unrelated widgets. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={conversationRange}
            onRangeChange={handleConversationRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <LeadConversionRating
            data={ratings[ratingRange]}
            loading={ratingLoading && ratings[ratingRange] === null}
            range={ratingRange}
            onRangeChange={handleRatingRangeChange}
          />
        </div>
      </div>
      <LeadFunnel data={leadFunnel} loading={!leadFunnel} />
      <ActivityFeed items={activity} loading={!activity} />
    </section>
  );
}
