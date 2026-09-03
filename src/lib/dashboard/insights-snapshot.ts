import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAccountLocale } from '@/lib/locale/config';
import { todayInTz } from '@/lib/locale/format';
import { loadLeadSourceRatings } from './lead-conversion-rating';
import {
  loadActivity,
  loadConversationsSeries,
  loadLeadFunnel,
} from './queries';
import type {
  DashboardInsightsRangeDays,
  DashboardInsightsSection,
  DashboardInsightsSnapshot,
} from './types';

export const DASHBOARD_ACTIVITY_PREVIEW_LIMIT = 50;

export interface DashboardInsightsDateContext {
  timeZone: string;
  today: string;
  phoneCountryCode: string;
}

/** Resolve calendar inputs from the selected branch, never from the server. */
export async function loadDashboardInsightsDateContext(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date()
): Promise<DashboardInsightsDateContext> {
  const { data, error } = await db
    .from('accounts')
    .select('timezone, phone_country_code')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Selected branch is unavailable');

  const locale = resolveAccountLocale(data);
  return {
    timeZone: locale.timeZone,
    today: todayInTz(locale.timeZone, now),
    phoneCountryCode: locale.phoneCountryCode,
  };
}

/** Recent work loads on its own request — see `loadDashboardActivity`. */
export async function loadDashboardActivity(
  db: SupabaseClient,
  context: DashboardInsightsDateContext
) {
  return loadActivity(
    db,
    DASHBOARD_ACTIVITY_PREVIEW_LIMIT,
    context.phoneCountryCode
  );
}

/**
 * Run the three independent initial insights behind one browser-visible API
 * request. Rejections stay section-local so one unavailable aggregate does not
 * erase successful cards.
 */
export async function loadDashboardInsightsSnapshot(
  db: SupabaseClient,
  rangeDays: DashboardInsightsRangeDays,
  context: DashboardInsightsDateContext
): Promise<DashboardInsightsSnapshot> {
  const results = await Promise.allSettled([
    loadConversationsSeries(db, rangeDays, context.timeZone, context.today),
    loadLeadSourceRatings(db, rangeDays, context.timeZone, context.today),
    loadLeadFunnel(db, context.timeZone, context.today),
  ] as const);
  const sections: DashboardInsightsSection[] = [
    'conversations',
    'leadRating',
    'leadFunnel',
  ];
  const errors = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    console.error(
      `[dashboard snapshot] ${sections[index]} failed:`,
      result.reason
    );
    return [sections[index]];
  });

  return {
    series: results[0].status === 'fulfilled' ? results[0].value : null,
    rating: results[1].status === 'fulfilled' ? results[1].value : null,
    leadFunnel: results[2].status === 'fulfilled' ? results[2].value : null,
    errors,
  };
}
