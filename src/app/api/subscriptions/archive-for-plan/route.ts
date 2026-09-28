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
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan selection is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Choose branches to archive' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 2 ||
      !isBranchAccountId(fields.organizationId) ||
      !Array.isArray(fields.accountIds) ||
      fields.accountIds.length < 1 ||
      fields.accountIds.length > 4 ||
      !fields.accountIds.every(isBranchAccountId) ||
      new Set(fields.accountIds).size !== fields.accountIds.length
    ) {
      return NextResponse.json(
        { error: 'Choose branches to archive' },
        { status: 400 }
      );
    }
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId
    );
    const limit = checkRateLimit(
      `subscription:archive:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase.rpc(
      'subscription_archive_branches_for_conversion',
      {
        p_organization_id: fields.organizationId,
        p_account_ids: fields.accountIds,
      }
    );
    if (error) {
      if (error.code === '22023' || error.code === '55000')
        return NextResponse.json(
          { error: 'Branch list changed. Check it and try again.' },
          { status: 409 }
        );
      throw error;
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      (data as { archived_count?: unknown }).archived_count !==
        fields.accountIds.length
    ) {
      return NextResponse.json(
        { error: 'Could not archive branches. Try again.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ result: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
