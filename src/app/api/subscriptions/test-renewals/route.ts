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
import { prepareTestCheckout } from '@/lib/subscriptions/test-flow';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

export const runtime = 'nodejs';

/** Owner initiated Test renewal; never a recurring debit or Production offer. */
export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan renewal is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Check the renewal and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 3 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      !isBranchAccountId(fields.accountId)
    ) {
      return NextResponse.json(
        { error: 'Check the renewal and try again' },
        { status: 400 }
      );
    }
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      `subscription:renew:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase.rpc(
      'subscription_create_test_renewal_intent',
      {
        p_organization_id: fields.organizationId,
        p_request_id: fields.requestId,
        p_billing_account_id: fields.accountId,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'This renewal needs review. Contact support.' },
        { status: error.code === '42501' ? 403 : 409 }
      );
    const intent = data as {
      organization_id?: string;
      request_id?: string;
      kind?: string;
    } | null;
    if (
      intent?.organization_id !== fields.organizationId ||
      !isBranchAccountId(intent.request_id) ||
      intent.kind !== 'renewal'
    ) {
      throw new Error('Unexpected Test renewal response');
    }
    const checkout = await prepareTestCheckout({
      organizationId: fields.organizationId,
      requestId: intent.request_id,
      actorUserId: userId,
      kind: 'renewal',
    });
    return NextResponse.json({ checkout }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
