import { NextResponse } from 'next/server';

import { cronSecretConfigured, isAuthorizedCronRequest } from '@/lib/cron/auth';
import { drainPushDeliveries } from '@/lib/push/dispatcher';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await drainPushDeliveries({ claimLimit: 100 }));
  } catch {
    console.error(
      '[push-cron] delivery drain failed',
      'dispatcher_unavailable'
    );
    return NextResponse.json(
      { error: 'Push delivery unavailable' },
      { status: 503 }
    );
  }
}
