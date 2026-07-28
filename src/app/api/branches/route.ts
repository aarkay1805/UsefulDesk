import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  toErrorResponse,
  ForbiddenError,
} from '@/lib/auth/account';
import { canManageOrganization } from '@/lib/auth/roles';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase.rpc('my_branch_accounts');
    if (error) {
      console.error('[GET /api/branches] list failed:', error);
      return NextResponse.json(
        { error: 'Failed to load branches' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      selectedAccountId: ctx.accountId,
      branches: data ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(
      `admin:create-branch:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: branchRows, error: branchError } =
      await ctx.supabase.rpc('my_branch_accounts');
    if (branchError) throw branchError;
    const current = (branchRows ?? []).find(
      (branch: { account_id?: string; is_organization_owner?: boolean }) =>
        branch.account_id === ctx.accountId
    );
    if (!current?.is_organization_owner || !canManageOrganization('owner')) {
      throw new ForbiddenError(
        'Only an organization owner can create a branch'
      );
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      legalEntityId?: unknown;
    } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const legalEntityId = body?.legalEntityId;
    if (!name || name.length > 80) {
      return NextResponse.json(
        { error: 'Branch name must be 1 to 80 characters' },
        { status: 400 }
      );
    }
    if (!isBranchAccountId(legalEntityId)) {
      return NextResponse.json(
        { error: 'A valid legal entity is required' },
        { status: 400 }
      );
    }

    const { data: accountId, error } = await ctx.supabase.rpc(
      'create_organization_branch',
      {
        p_organization_id: ctx.account.organizationId,
        p_legal_entity_id: legalEntityId,
        p_name: name,
      }
    );
    if (error) {
      console.error('[POST /api/branches] create failed:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create branch' },
        { status: error.code === '42501' ? 403 : 400 }
      );
    }

    return NextResponse.json(
      {
        accountId,
        readinessState: 'setup',
        credentialsCloned: false,
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
