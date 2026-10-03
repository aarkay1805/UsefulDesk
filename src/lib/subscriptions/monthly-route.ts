import 'server-only';

import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { getErrorMessage } from '@/lib/errors';
import {
  liveBillingConfig,
  liveMonthlyCheckoutEnabled,
  liveSettlementsEnabled,
  type LiveBillingConfig,
} from './live-provider';

export const MONTHLY_REVIEW_AGAIN =
  'Your details changed. Review the offers again or contact support.';

/** Reread runtime containment at every endpoint's existing mutation/response boundary. */
export function monthlyInitiationOpen() {
  if (!liveMonthlyCheckoutEnabled() || !liveSettlementsEnabled()) return false;
  try {
    liveBillingConfig();
    return true;
  } catch {
    return false;
  }
}

export function monthlyRouteJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function monthlyRpcError(error: { code?: string }, fallback: string) {
  if (error.code === '42501')
    return monthlyRouteJson({ error: 'Only the gym owner can do this' }, 403);
  if (['22023', '23505', '55000', '40001'].includes(error.code ?? ''))
    return monthlyRouteJson({ error: MONTHLY_REVIEW_AGAIN }, 409);
  // Database details never become customer copy.
  return monthlyRouteJson(
    { error: getErrorMessage({ code: error.code }, fallback) },
    500
  );
}

/** Shared closed-default gate, safe exception mapping and uncached response policy. */
export function monthlyRoute(
  fallback: string,
  handler: (
    request: Request,
    config: LiveBillingConfig
  ) => Promise<NextResponse>
) {
  return async (request: Request) => {
    let response: NextResponse;
    if (!monthlyInitiationOpen()) {
      response = monthlyRouteJson({ error: 'Not found' }, 404);
    } else {
      const config = liveBillingConfig();
      try {
        response = await handler(request, config);
      } catch (error) {
        const classified = toErrorResponse(error);
        const safe = await classified.json();
        response = monthlyRouteJson(
          { error: getErrorMessage({ message: safe.error }, fallback) },
          classified.status
        );
      }
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}
