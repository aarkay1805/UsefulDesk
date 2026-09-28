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
import { executeTestFirstRefund } from '@/lib/subscriptions/test-refunds';
import { testRefundsEnabled } from '@/lib/subscriptions/test-provider';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!testRefundsEnabled())
    return NextResponse.json(
      { error: 'Test refunds are unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !isBranchAccountId((body as Record<string, unknown>).organizationId)
    )
      return NextResponse.json(
        { error: 'Check the refund and try again' },
        { status: 400 }
      );
    const { organizationId } = body as { organizationId: string };
    const { userId } = await requireSubscriptionOwner(organizationId);
    const limit = checkRateLimit(
      `subscription:refund:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    return NextResponse.json({
      refund: await executeTestFirstRefund({
        organizationId,
        actorUserId: userId,
      }),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /needs review|needs recovery/.test(error.message)
    )
      return NextResponse.json(
        { error: 'The refund needs review. Check again or contact support.' },
        { status: 409 }
      );
    return toErrorResponse(error);
  }
}
