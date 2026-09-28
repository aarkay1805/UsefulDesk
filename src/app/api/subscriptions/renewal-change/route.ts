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
import { isSubscriptionTier } from '@/lib/subscriptions/plans';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

/** Null tier cancels at term end. Lower tier schedules an owner-reviewed downgrade. */
export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan changes are unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Check the plan change and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 4 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      (fields.targetTier !== null && !isSubscriptionTier(fields.targetTier)) ||
      !Array.isArray(fields.archiveAccountIds) ||
      fields.archiveAccountIds.length > 4 ||
      !fields.archiveAccountIds.every(isBranchAccountId) ||
      new Set(fields.archiveAccountIds).size !==
        fields.archiveAccountIds.length ||
      (fields.targetTier === null && fields.archiveAccountIds.length !== 0)
    ) {
      return NextResponse.json(
        { error: 'Check the plan change and try again' },
        { status: 400 }
      );
    }
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId
    );
    const limit = checkRateLimit(
      `subscription:change:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase.rpc(
      'subscription_schedule_test_renewal_change',
      {
        p_organization_id: fields.organizationId,
        p_request_id: fields.requestId,
        p_target_tier: fields.targetTier,
        p_archive_account_ids: fields.archiveAccountIds,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'This plan change needs review. Contact support.' },
        { status: error.code === '42501' ? 403 : 409 }
      );
    const change = data as {
      organization_id?: string;
      request_id?: string;
      target_tier?: string | null;
    } | null;
    if (
      change?.organization_id !== fields.organizationId ||
      change.request_id !== fields.requestId ||
      change.target_tier !== fields.targetTier
    ) {
      throw new Error('Unexpected Test plan change response');
    }
    return NextResponse.json({ change }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
