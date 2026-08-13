import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { branchSetupRpcErrorResponse } from '@/lib/branches/server';
import {
  isBranchSetupStartMode,
  parseBranchSetupPacks,
  type BranchSetupPreview,
} from '@/lib/branches/setup';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(
      `branch-setup-preview:${ctx.userId}`,
      RATE_LIMITS.branchSetupPreview
    );
    if (!limit.success) return rateLimitResponse(limit);

    const params = new URL(request.url).searchParams;
    const legalEntityId = params.get('legalEntityId');
    const startMode = params.get('startMode');
    const sourceAccountId = params.get('sourceAccountId');
    const parsedPacks = parseBranchSetupPacks(params.getAll('pack'));

    if (!isBranchAccountId(legalEntityId)) {
      return NextResponse.json(
        { error: 'A valid legal entity is required' },
        { status: 400 }
      );
    }
    if (!isBranchSetupStartMode(startMode)) {
      return NextResponse.json(
        { error: 'Start mode must be blank or copy' },
        { status: 400 }
      );
    }
    if (!parsedPacks.ok) {
      return NextResponse.json(
        { error: `Unknown branch setup pack: ${String(parsedPacks.invalid)}` },
        { status: 400 }
      );
    }
    if (
      (startMode === 'blank' &&
        (sourceAccountId !== null || parsedPacks.packs.length > 0)) ||
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
      'preview_organization_branch_setup',
      {
        p_organization_id: ctx.account.organizationId,
        p_legal_entity_id: legalEntityId,
        p_start_mode: startMode,
        p_source_account_id:
          startMode === 'copy' ? (sourceAccountId as string) : null,
        p_packs: parsedPacks.packs,
      }
    );
    if (error) {
      return branchSetupRpcErrorResponse(
        error,
        'Failed to preview branch setup'
      );
    }
    return NextResponse.json(data as BranchSetupPreview);
  } catch (error) {
    return toErrorResponse(error);
  }
}
