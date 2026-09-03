import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DATABASE_CRON_SECRET = /^[a-f0-9]{64}$/;

const OPS_PATHS = [
  '/api/follow-ups/cron',
  '/api/automations/cron',
  '/api/flows/cron',
  '/api/whatsapp/webhook',
  '/api/v1/broadcasts/cron',
  '/api/payments/razorpay/recovery/cron',
  '/api/meta/leads/recovery/cron',
  '/api/push/cron',
] as const;

const RENEWAL_PATHS = [
  '/api/renewals/cron',
  '/api/payment-installments/cron',
] as const;

interface DispatchResult {
  path: string;
  status: number;
  ok: boolean;
  body?: unknown;
  error?: string;
}

function responseBody(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value.slice(0, 500);
  }
}

async function dispatch(
  request: Request,
  path: string,
  cronSecret: string
): Promise<DispatchResult> {
  try {
    const response = await fetch(new URL(path, request.url), {
      method: 'GET',
      headers: { 'x-cron-secret': cronSecret },
      cache: 'no-store',
      signal: AbortSignal.timeout(55_000),
    });
    return {
      path,
      status: response.status,
      ok: response.ok,
      body: responseBody(await response.text()),
    };
  } catch (error) {
    return {
      path,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

export async function GET(request: Request) {
  const supplied = request.headers.get('x-database-cron-secret') ?? '';
  if (!DATABASE_CRON_SECRET.test(supplied)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: verified, error: verificationError } =
    await supabaseAdmin().rpc('verify_database_cron_secret', {
      p_secret: supplied,
    });
  if (verificationError || verified !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const group = new URL(request.url).searchParams.get('group');
  const paths =
    group === 'ops' ? OPS_PATHS : group === 'renewals' ? RENEWAL_PATHS : null;
  if (!paths) {
    return NextResponse.json({ error: 'Unknown cron group' }, { status: 400 });
  }

  const cronSecret =
    process.env.AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const results = await Promise.all(
    paths.map((path) => dispatch(request, path, cronSecret))
  );
  const failed = results.filter((result) => !result.ok).length;

  return NextResponse.json(
    { group, dispatched: results.length, failed, results },
    { status: failed > 0 ? 503 : 200 }
  );
}
