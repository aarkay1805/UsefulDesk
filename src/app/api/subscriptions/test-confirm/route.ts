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
import { confirmTestPayment } from '@/lib/subscriptions/test-flow';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan payment is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Could not confirm the payment' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 5 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      typeof fields.orderId !== 'string' ||
      !/^order_[A-Za-z0-9]+$/.test(fields.orderId) ||
      typeof fields.paymentId !== 'string' ||
      !/^pay_[A-Za-z0-9]+$/.test(fields.paymentId) ||
      typeof fields.signature !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(fields.signature)
    ) {
      return NextResponse.json(
        { error: 'Could not confirm the payment' },
        { status: 400 }
      );
    }
    const { userId } = await requireSubscriptionOwner(fields.organizationId);
    const limit = checkRateLimit(
      `subscription:test-confirm:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const result = await confirmTestPayment({
      source: 'checkout',
      expectedOrganizationId: fields.organizationId,
      expectedRequestId: fields.requestId,
      orderId: fields.orderId,
      paymentId: fields.paymentId,
      checkoutSignature: fields.signature,
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (
      error instanceof Error &&
      /signature|captured payment|does not belong/.test(error.message)
    )
      return NextResponse.json(
        { error: 'Payment is not confirmed yet. Try again.' },
        { status: 409 }
      );
    return toErrorResponse(error);
  }
}
