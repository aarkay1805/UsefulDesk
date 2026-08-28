import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  loadDashboardActionDateContext,
  loadDashboardActionSnapshot,
} from '@/lib/dashboard/action-snapshot';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

export async function GET() {
  try {
    // Viewer access is intentional: this boundary consolidates existing
    // branch-readable dashboard queries and performs no mutation. The client
    // returned here is scoped to the selected branch and still enforces RLS.
    const ctx = await getCurrentAccount();
    const dateContext = await loadDashboardActionDateContext(
      ctx.supabase,
      ctx.accountId
    );
    const snapshot = await loadDashboardActionSnapshot(
      ctx.supabase,
      dateContext
    );
    return json(snapshot);
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control']);
    return response;
  }
}
