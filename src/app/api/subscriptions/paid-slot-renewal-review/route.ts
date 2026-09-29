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

/** Fixes the exact paid slots and branches for the next Test renewal. */
export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Slot renewal is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Choose slots and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 4 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      !Array.isArray(fields.cancelSlotIds) ||
      !Array.isArray(fields.archiveAccountIds) ||
      fields.cancelSlotIds.some((id) => !isBranchAccountId(id)) ||
      fields.archiveAccountIds.some((id) => !isBranchAccountId(id)) ||
      new Set(fields.cancelSlotIds).size !== fields.cancelSlotIds.length ||
      new Set(fields.archiveAccountIds).size !== fields.archiveAccountIds.length
    )
      return NextResponse.json(
        { error: 'Choose slots and try again' },
        { status: 400 }
      );
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId
    );
    const limit = checkRateLimit(
      `subscription:slot-renewal:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase.rpc(
      'subscription_review_test_paid_slot_renewal',
      {
        p_organization_id: fields.organizationId,
        p_request_id: fields.requestId,
        p_cancel_slot_ids: fields.cancelSlotIds,
        p_archive_account_ids: fields.archiveAccountIds,
      }
    );
    if (error) {
      if (error.code === '42501')
        return NextResponse.json(
          { error: 'Only the gym owner can review slots' },
          { status: 403 }
        );
      if (['22023', '23505', '55000'].includes(error.code ?? ''))
        return NextResponse.json(
          { error: 'The slot choice needs a new review' },
          { status: 409 }
        );
      throw error;
    }
    if (
      !data ||
      data.organization_id !== fields.organizationId ||
      data.request_id !== fields.requestId
    )
      throw new Error('Unexpected slot renewal response');
    return NextResponse.json(
      { review: data },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
