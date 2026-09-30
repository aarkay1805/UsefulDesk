import { NextResponse } from 'next/server';

import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { liveBillingConfig } from '@/lib/subscriptions/live-provider';
import {
  liveFinancialRecoveryEnabled,
  recoverLiveFinancialObligations,
} from '@/lib/subscriptions/live-recovery';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Protected operator/cron worker. Provider traffic is GET-only; local obligations may be bound/settled. */
export async function POST(request: Request) {
  if (!liveFinancialRecoveryEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!cronSecretConfigured() || !isAuthorizedCronRequest(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const result = await recoverLiveFinancialObligations();
    return NextResponse.json(result, {
      status: result.failed ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Retry later' }, { status: 503 });
  }
}
