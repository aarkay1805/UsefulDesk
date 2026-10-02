import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import {
  liveBillingConfig,
  liveRefundsEnabled,
  liveCustomerRefundsEnabled,
} from '@/lib/subscriptions/live-provider';
import {
  LiveRefundReviewRequired,
  prepareLiveFullRefund,
} from '@/lib/subscriptions/live-refunds';

export const runtime = 'nodejs';

/** No UI calls this route; environment and database refund gates are off. */
export async function POST(request: Request) {
  if (!liveRefundsEnabled() && !liveCustomerRefundsEnabled())
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
        { error: 'Invalid Live refund' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 2 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.refundRequestId) ||
      (fields.organizationId === config.pilotOrganizationId
        ? !liveRefundsEnabled()
        : !liveCustomerRefundsEnabled())
    )
      return NextResponse.json(
        { error: 'Invalid Live refund' },
        { status: 400 }
      );
    const { userId } = await requireSubscriptionOwner(fields.organizationId);
    const limit = checkRateLimit(
      `subscription:live-refund:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const result = await prepareLiveFullRefund({
      refundRequestId: fields.refundRequestId,
      organizationId: fields.organizationId,
      actorUserId: userId,
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof LiveRefundReviewRequired)
      return NextResponse.json(
        { error: 'Live refund needs review' },
        { status: 409 }
      );
    return toErrorResponse(error);
  }
}
