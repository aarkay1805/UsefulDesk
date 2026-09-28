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
import { reserveTestFirstRefund } from '@/lib/subscriptions/test-refund-claims';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const receivedAt = new Date().toISOString();
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Refund requests are unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Check the request and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 2 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId)
    ) {
      return NextResponse.json(
        { error: 'Check the request and try again' },
        { status: 400 }
      );
    }
    const { userId } = await requireSubscriptionOwner(fields.organizationId);
    const limit = checkRateLimit(
      `subscription:refund-request:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const claim = await reserveTestFirstRefund({
      organizationId: fields.organizationId,
      requestId: fields.requestId,
      actorUserId: userId,
      receivedAt,
    });
    return NextResponse.json({ claim }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && /needs review/.test(error.message))
      return NextResponse.json(
        { error: 'This refund request needs review. Contact support.' },
        { status: 409 }
      );
    return toErrorResponse(error);
  }
}
