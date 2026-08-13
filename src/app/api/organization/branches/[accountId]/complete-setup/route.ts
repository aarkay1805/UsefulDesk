import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { canCompleteBranchSetup } from '@/lib/auth/roles';
import { branchSetupRpcErrorResponse } from '@/lib/branches/server';
import type { BranchSetupCompletionResult } from '@/lib/branches/setup';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    requireSameOriginRequest(request);
    const { accountId } = await params;
    if (!isBranchAccountId(accountId)) {
      throw new ForbiddenError('Invalid branch');
    }

    const ctx = await getCurrentAccount();
    if (ctx.accountId !== accountId || !canCompleteBranchSetup(ctx.role)) {
      throw new ForbiddenError('Selected branch admin access is required');
    }

    const limit = checkRateLimit(
      `admin:complete-branch-setup:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      body === null ||
      body.configurationReviewed !== true ||
      Object.keys(body).length !== 1
    ) {
      return NextResponse.json(
        { error: 'Configuration review acknowledgement is required' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase.rpc(
      'complete_organization_branch_setup',
      {
        p_account_id: accountId,
        p_configuration_reviewed: true,
      }
    );
    if (error) {
      return branchSetupRpcErrorResponse(
        error,
        'Failed to complete branch setup'
      );
    }

    return NextResponse.json(data as BranchSetupCompletionResult);
  } catch (error) {
    return toErrorResponse(error);
  }
}
