import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  LiveOrderReviewRequired,
  prepareLiveCheckout,
} from '@/lib/subscriptions/live-orders';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import {
  liveBillingConfig,
  liveOrdersEnabled,
  liveSettlementsEnabled,
} from '@/lib/subscriptions/live-provider';

export const runtime = 'nodejs';

/** No UI calls this route; both environment and database charge gates are off. */
export async function POST(request: Request) {
  if (!liveOrdersEnabled() || !liveSettlementsEnabled())
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let config;
  try {
    config = liveBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    requireSameOriginRequest(request);
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Invalid Live order' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 2 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      fields.organizationId !== config.pilotOrganizationId
    )
      return NextResponse.json(
        { error: 'Invalid Live order' },
        { status: 400 }
      );
    const { userId } = await requireSubscriptionOwner(fields.organizationId);
    const limit = checkRateLimit(
      `subscription:live-order:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const checkout = await prepareLiveCheckout({
      requestId: fields.requestId,
      organizationId: fields.organizationId,
      actorUserId: userId,
    });
    return NextResponse.json({ checkout });
  } catch (error) {
    if (error instanceof LiveOrderReviewRequired)
      return NextResponse.json(
        { error: 'Live order needs review' },
        { status: 409 }
      );
    return toErrorResponse(error);
  }
}
