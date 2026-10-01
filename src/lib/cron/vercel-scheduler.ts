import { NextResponse } from 'next/server';

import { isAuthorizedVercelCronRequest } from '@/lib/cron/auth';
import {
  dispatchCronGroup,
  OPS_PATHS,
  RENEWAL_PATHS,
  type CronGroup,
} from '@/lib/cron/dispatch';

function configuredOrigin(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export async function runVercelCron(request: Request, group: CronGroup) {
  // Registration alone cannot send work. Preview/local deployments cannot opt in.
  // This public disabled response contains no configuration or worker evidence.
  if (
    process.env.VERCEL_ENV !== 'production' ||
    process.env.USEFULDESK_VERCEL_CRONS_ENABLED !== 'true'
  ) {
    return NextResponse.json({
      group,
      dispatched: 0,
      failed: 0,
      skipped: 'disabled',
    });
  }

  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!isAuthorizedVercelCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use operator configuration, never the incoming Host/forwarded headers.
  const origin = configuredOrigin();
  const secret = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!origin || !secret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const result = await dispatchCronGroup(
    origin,
    group === 'ops' ? OPS_PATHS : RENEWAL_PATHS,
    secret
  );
  return NextResponse.json(
    {
      group,
      dispatched: result.dispatched,
      failed: result.failed,
      // Platform responses carry only counts and fixed worker paths/statuses.
      results: result.results.map(({ path, status, ok }) => ({
        path,
        status,
        ok,
      })),
    },
    { status: result.failed > 0 ? 503 : 200 }
  );
}
