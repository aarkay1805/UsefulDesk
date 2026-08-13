import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  toErrorResponse,
  ForbiddenError,
} from '@/lib/auth/account';
import { canManageOrganization } from '@/lib/auth/roles';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import {
  isBranchSetupStartMode,
  parseBranchSetupPacks,
  type BranchSetupCreationResult,
} from '@/lib/branches/setup';
import { branchSetupRpcErrorResponse } from '@/lib/branches/server';
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
    const current = (
      (data ?? []) as Array<{
        account_id: string;
        is_organization_owner: boolean;
      }>
    ).find((branch) => branch.account_id === ctx.accountId);

    let legalEntities: Array<{
      id: string;
      name: string;
      defaultCurrency: string;
    }> = [];
    if (
      canManageOrganization(current?.is_organization_owner ? 'owner' : null)
    ) {
      const { data: entityRows, error: entityError } = await ctx.supabase
        .from('legal_entities')
        .select('id, name, default_currency')
        .eq('organization_id', ctx.account.organizationId)
        .is('archived_at', null)
        .order('name');
      if (entityError) {
        console.error(
          '[GET /api/branches] legal entities failed:',
          entityError
        );
        return NextResponse.json(
          { error: 'Failed to load branches' },
          { status: 500 }
        );
      }
      legalEntities = (entityRows ?? []).map((entity) => ({
        id: entity.id,
        name: entity.name,
        defaultCurrency: entity.default_currency,
      }));
    }

    return NextResponse.json({
      selectedAccountId: ctx.accountId,
      branches: data ?? [],
      legalEntities,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);
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
    if (
      !canManageOrganization(current?.is_organization_owner ? 'owner' : null)
    ) {
      throw new ForbiddenError(
        'Only an organization owner can create a branch'
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
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

    const isNewRequest =
      body !== null &&
      ['requestId', 'startMode', 'sourceAccountId', 'packs'].some((key) =>
        Object.hasOwn(body, key)
      );

    if (!isNewRequest) {
      const { data: accountId, error } = await ctx.supabase.rpc(
        'create_organization_branch',
        {
          p_organization_id: ctx.account.organizationId,
          p_legal_entity_id: legalEntityId,
          p_name: name,
        }
      );
      if (error) {
        return branchSetupRpcErrorResponse(error, 'Failed to create branch');
      }

      return NextResponse.json(
        {
          accountId,
          readinessState: 'setup',
          credentialsCloned: false,
        },
        { status: 201 }
      );
    }

    const requestId = body?.requestId;
    const startMode = body?.startMode;
    const sourceAccountId = body?.sourceAccountId;
    const rawPacks = body?.packs;
    if (!isBranchAccountId(requestId)) {
      return NextResponse.json(
        { error: 'A valid request ID is required' },
        { status: 400 }
      );
    }
    if (!isBranchSetupStartMode(startMode)) {
      return NextResponse.json(
        { error: 'Start mode must be blank or copy' },
        { status: 400 }
      );
    }
    if (!Array.isArray(rawPacks)) {
      return NextResponse.json(
        { error: 'Packs must be an array' },
        { status: 400 }
      );
    }
    const parsedPacks = parseBranchSetupPacks(rawPacks);
    if (!parsedPacks.ok) {
      return NextResponse.json(
        { error: `Unknown branch setup pack: ${String(parsedPacks.invalid)}` },
        { status: 400 }
      );
    }
    if (
      (startMode === 'blank' &&
        (sourceAccountId !== undefined || parsedPacks.packs.length > 0)) ||
      (startMode === 'copy' &&
        (!isBranchAccountId(sourceAccountId) || parsedPacks.packs.length === 0))
    ) {
      return NextResponse.json(
        {
          error:
            startMode === 'blank'
              ? 'Blank branch setup cannot include a source or packs'
              : 'Copy branch setup requires a source and at least one pack',
        },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase.rpc(
      'create_organization_branch_from_setup',
      {
        p_request_id: requestId,
        p_organization_id: ctx.account.organizationId,
        p_legal_entity_id: legalEntityId,
        p_name: name,
        p_start_mode: startMode,
        p_source_account_id:
          startMode === 'copy' ? (sourceAccountId as string) : null,
        p_packs: parsedPacks.packs,
      }
    );
    if (error) {
      return branchSetupRpcErrorResponse(error, 'Failed to create branch');
    }

    const result = data as BranchSetupCreationResult;
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
