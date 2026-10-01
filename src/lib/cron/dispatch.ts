/** The database and Vercel schedulers must dispatch the same worker groups. */
export const OPS_PATHS = [
  '/api/follow-ups/cron',
  '/api/automations/cron',
  '/api/flows/cron',
  '/api/whatsapp/webhook',
  '/api/v1/broadcasts/cron',
  '/api/payments/razorpay/recovery/cron',
  '/api/subscriptions/live-recovery/cron',
  '/api/meta/leads/recovery/cron',
  '/api/push/cron',
  '/api/attendance/reminders/cron',
] as const;

export const RENEWAL_PATHS = [
  '/api/renewals/cron',
  '/api/payment-installments/cron',
  '/api/reminders/cron',
] as const;

export type CronGroup = 'ops' | 'renewals';

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
  origin: string,
  path: string,
  cronSecret: string
): Promise<DispatchResult> {
  try {
    const response = await fetch(new URL(path, origin), {
      method: 'GET',
      headers: { 'x-cron-secret': cronSecret },
      cache: 'no-store',
      // Never forward the internal credential to a redirected destination.
      redirect: 'error',
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

export async function dispatchCronGroup(
  origin: string,
  paths: readonly string[],
  cronSecret: string
) {
  const results = await Promise.all(
    paths.map((path) => dispatch(origin, path, cronSecret))
  );
  return {
    dispatched: results.length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}
