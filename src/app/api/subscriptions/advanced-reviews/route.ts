import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  rateLimitResponse,
  RATE_LIMITS,
  checkRateLimit,
} from '@/lib/rate-limit';
import { isSubscriptionTier } from '@/lib/subscriptions/plans';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import { testBillingEnabled } from '@/lib/subscriptions/test-provider';

const KINDS = new Set(['upgrade', 'addon_purchase', 'addon_cancel', 'restart']);

/** Records an owner review. No response from this route is a payable quote. */
export async function POST(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Plan review is unavailable' },
      { status: 404 }
    );
  try {
    requireSameOriginRequest(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Check the plan and try again' },
        { status: 400 }
      );
    const fields = body as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 9 ||
      !isBranchAccountId(fields.organizationId) ||
      !isBranchAccountId(fields.requestId) ||
      !isBranchAccountId(fields.accountId) ||
      typeof fields.kind !== 'string' ||
      !KINDS.has(fields.kind) ||
      !isSubscriptionTier(fields.targetTier) ||
      typeof fields.requestedSlots !== 'number' ||
      !Number.isSafeInteger(fields.requestedSlots) ||
      fields.requestedSlots < 0 ||
      fields.requestedSlots > 1 ||
      typeof fields.starterReminderResetAccepted !== 'boolean' ||
      (fields.starterReminderPolicyVersion !== null &&
        (typeof fields.starterReminderPolicyVersion !== 'string' ||
          !fields.starterReminderPolicyVersion.trim() ||
          fields.starterReminderPolicyVersion.length > 128)) ||
      (fields.starterReminderResetAccepted
        ? fields.targetTier !== 'starter' ||
          fields.starterReminderPolicyVersion === null
        : fields.starterReminderPolicyVersion !== null) ||
      !Array.isArray(fields.archiveAccountIds) ||
      fields.archiveAccountIds.some((id) => !isBranchAccountId(id)) ||
      new Set(fields.archiveAccountIds).size !== fields.archiveAccountIds.length
    ) {
      return NextResponse.json(
        { error: 'Check the plan and try again' },
        { status: 400 }
      );
    }
    const { supabase, userId } = await requireSubscriptionOwner(
      fields.organizationId,
      fields.accountId
    );
    const limit = checkRateLimit(
      `subscription:advanced-review:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { data, error } = await supabase.rpc(
      'subscription_create_test_advanced_review',
      {
        p_organization_id: fields.organizationId,
        p_request_id: fields.requestId,
        p_billing_account_id: fields.accountId,
        p_kind: fields.kind,
        p_target_tier: fields.targetTier,
        p_requested_slots: fields.requestedSlots,
        p_archive_account_ids: fields.archiveAccountIds,
        p_starter_reminder_reset_accepted: fields.starterReminderResetAccepted,
        p_starter_reminder_policy_version: fields.starterReminderPolicyVersion,
      }
    );
    if (error) {
      if (error.code === '42501')
        return NextResponse.json(
          { error: 'Only the gym owner can review this change' },
          { status: 403 }
        );
      if (['22023', '23505', '55000'].includes(error.code ?? ''))
        return NextResponse.json(
          { error: 'This change needs a new review' },
          { status: 409 }
        );
      throw error;
    }
    if (
      !data ||
      data.organization_id !== fields.organizationId ||
      data.request_id !== fields.requestId ||
      data.state !== 'awaiting_policy'
    )
      throw new Error('Unexpected subscription review response');
    return NextResponse.json(
      { review: data },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
