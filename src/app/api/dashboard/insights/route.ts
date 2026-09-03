import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  loadDashboardActivity,
  loadDashboardInsightsDateContext,
  loadDashboardInsightsSnapshot,
} from '@/lib/dashboard/insights-snapshot';
import { loadLeadSourceRatings } from '@/lib/dashboard/lead-conversion-rating';
import { loadConversationsSeries } from '@/lib/dashboard/queries';
import type { DashboardInsightsRangeDays } from '@/lib/dashboard/types';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
};

type InsightsView = 'initial' | 'conversations' | 'lead-rating' | 'activity';

/** Views whose result does not vary with the 7/30/90 range control. */
const RANGE_FREE_VIEWS: InsightsView[] = ['initial', 'activity'];

function isInsightsView(value: string): value is InsightsView {
  return (
    value === 'initial' ||
    value === 'conversations' ||
    value === 'lead-rating' ||
    value === 'activity'
  );
}

function rangeDays(value: string | null): DashboardInsightsRangeDays | null {
  const numeric = Number(value);
  return numeric === 7 || numeric === 30 || numeric === 90 ? numeric : null;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedView = url.searchParams.get('view') ?? 'initial';
    if (!isInsightsView(requestedView)) {
      return json({ error: 'Invalid dashboard insights view' }, 400);
    }
    const requestedRange = RANGE_FREE_VIEWS.includes(requestedView)
      ? 30
      : rangeDays(url.searchParams.get('range'));
    if (requestedRange == null) {
      return json(
        { error: 'Dashboard insights range must be 7, 30, or 90' },
        400
      );
    }

    // getCurrentAccount resolves the selected branch from the tab-local
    // request context and returns an RLS-scoped server client. Viewer access is
    // sufficient because this endpoint only replaces reads the dashboard
    // already allowed every branch member to perform.
    const ctx = await getCurrentAccount();
    const dateContext = await loadDashboardInsightsDateContext(
      ctx.supabase,
      ctx.accountId
    );

    if (requestedView === 'initial') {
      const snapshot = await loadDashboardInsightsSnapshot(
        ctx.supabase,
        requestedRange,
        dateContext
      );
      return json(snapshot);
    }
    if (requestedView === 'activity') {
      const activity = await loadDashboardActivity(ctx.supabase, dateContext);
      return json({ activity });
    }
    if (requestedView === 'conversations') {
      const series = await loadConversationsSeries(
        ctx.supabase,
        requestedRange,
        dateContext.timeZone,
        dateContext.today
      );
      return json({ series });
    }

    const rating = await loadLeadSourceRatings(
      ctx.supabase,
      requestedRange,
      dateContext.timeZone,
      dateContext.today
    );
    return json({ rating });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control']);
    return response;
  }
}
