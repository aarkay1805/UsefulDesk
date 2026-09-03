'use client';

import { useEffect, useState } from 'react';

import type {
  ActivityItem,
  DashboardActivityResponse,
} from '@/lib/dashboard/types';
import { ActivityFeed } from './activity-feed';

/**
 * Recent work's own data boundary.
 *
 * The feed used to ride the insights snapshot, which is gated behind an
 * IntersectionObserver because those charts sit far below the fold. The feed
 * does not any more: it shares a row with the uncontacted-lead queue in the
 * action half of the page, so it has to load when that row loads. Deferring it
 * there would leave a pulsing card beside a populated one at first paint.
 *
 * The load runs through an inline async IIFE with a `cancelled` guard —
 * `react-hooks/set-state-in-effect` is enforced, so a state-setting wrapper
 * called straight from the effect is not an option.
 */
export function DeferredActivityFeed() {
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/dashboard/insights?view=activity', {
          cache: 'no-store',
        });
        const body = (await response.json()) as DashboardActivityResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? 'Could not load recent work');
        }
        if (!cancelled) setActivity(body.activity);
      } catch (error) {
        console.error('[dashboard] recent work failed:', error);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ActivityFeed
      items={activity}
      loading={!activity && !failed}
      failed={failed}
    />
  );
}
