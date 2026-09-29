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
  prepareTestCheckout,
  TestBillingConflict,
} from '@/lib/subscriptions/test-flow';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

const KINDS = new Set(['upgrade', 'addon_purchase', 'restart']);

/** Opens only the exact owner-reviewed, unexpired Test quote. */
export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan payment is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Review the quote and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 3 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      typeof fields.kind !== 'string' ||
      !KINDS.has(fields.kind)
    )
      return NextResponse.json(
        { error: 'Review the quote and try again' },
        { status: 400 }
      );
    const { userId } = await requireSubscriptionOwner(fields.organizationId);
    const limit = checkRateLimit(
      'subscription:advanced-order:' + userId,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const checkout = await prepareTestCheckout({
      organizationId: fields.organizationId,
      requestId: fields.requestId,
      actorUserId: userId,
      kind: fields.kind as 'upgrade' | 'addon_purchase' | 'restart',
    });
    return NextResponse.json({ checkout });
  } catch (error) {
    if (error instanceof TestBillingConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return toErrorResponse(error);
  }
}
