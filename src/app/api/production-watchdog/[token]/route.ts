import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { evaluateWatchdogSnapshot } from '@/lib/cron/watchdog';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security/client-ip';

export const runtime = 'nodejs';
export const maxDuration = 30;

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // A separate read-only credential is required. Cron dispatch credentials are
  // never given to an external monitor. Disabled/Preview probes cannot query DB.
  if (
    process.env.VERCEL_ENV !== 'production' ||
    process.env.USEFULDESK_EXTERNAL_MONITOR_ENABLED !== 'true'
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  }
  const { token } = await params;
  const expected = process.env.USEFULDESK_EXTERNAL_MONITOR_TOKEN ?? '';
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    expected === process.env.CRON_SECRET ||
    expected === process.env.AUTOMATION_CRON_SECRET
  ) {
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  }
  const limit = checkRateLimit(`production-watchdog:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.success) {
    const response = rateLimitResponse(limit);
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  }
  try {
    const { data, error } = await supabaseAdmin()
      .rpc('production_watchdog_snapshot')
      .abortSignal(AbortSignal.timeout(15_000));
    if (error)
      return NextResponse.json({ ok: false }, { status: 503, headers });
    const checks = evaluateWatchdogSnapshot(data);
    const ok = checks.every((check) => check.healthy);
    return NextResponse.json(
      { ok, checks },
      { status: ok ? 200 : 503, headers }
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }
}
