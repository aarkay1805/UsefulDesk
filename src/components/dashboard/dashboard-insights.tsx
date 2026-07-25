'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { createClient } from '@/lib/supabase/client';
import {
  loadActivity,
  loadConversationsSeries,
  loadLeadFunnel,
  loadLeadsDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries';
import { loadLeadSourceRatings } from '@/lib/dashboard/lead-conversion-rating';
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  LeadFunnelData,
  LeadsDonutData,
  LeadSourceRatingData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types';
import { useLocale } from '@/hooks/use-locale';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { LeadConversionRating } from '@/components/dashboard/lead-conversion-rating';
import { LeadFunnel } from '@/components/dashboard/lead-funnel';
import { LeadsDonut } from '@/components/dashboard/leads-donut';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';

type RangeDays = 7 | 30 | 90;

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
  const [leadsDonut, setLeadsDonut] = useState<LeadsDonutData | null>(null);
  const [leadFunnel, setLeadFunnel] = useState<LeadFunnelData | null>(null);
  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(
    null
  );
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
    void loadLeadsDonut(db)
      .then((next) => {
        if (!cancelled) setLeadsDonut(next);
      })
      .catch((error) =>
        console.error('[dashboard] pipeline insights failed:', error)
      );
    void loadLeadFunnel(db)
      .then((next) => {
        if (!cancelled) setLeadFunnel(next);
      })
      .catch((error) =>
        console.error('[dashboard] funnel insights failed:', error)
      );
    void loadResponseTime(db)
      .then((next) => {
        if (!cancelled) setResponseTime(next);
      })
      .catch((error) =>
        console.error('[dashboard] response insights failed:', error)
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
    <section className="border-border bg-card rounded-xl border">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-foreground text-sm font-semibold">
            Insights &amp; recent activity
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Lead funnel, source, conversation, response, and activity analysis
          </p>
        </div>
        <Link
          href="/reports"
          className="text-primary-text hidden shrink-0 text-xs font-medium hover:underline sm:block"
        >
          Owner reports
        </Link>
      </div>

      <div className="border-border space-y-4 border-t p-5">
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
            <LeadsDonut data={leadsDonut} loading={!leadsDonut} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="h-full lg:col-span-3">
            <ResponseTimeChart data={responseTime} loading={!responseTime} />
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
      </div>
    </section>
  );
}
