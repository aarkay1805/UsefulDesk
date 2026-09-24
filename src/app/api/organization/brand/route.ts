import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { GYM_NAME_ERROR, normalizeGymName } from '@/lib/auth/gym-name';
import { canEditOrganizationBrandName } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function PATCH(request: Request) {
  try {
    requireSameOriginRequest(request);
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(
      `admin:organization-brand:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: branches, error: branchError } =
      await ctx.supabase.rpc('my_branch_accounts');
    if (branchError) throw branchError;
    const selected = (
      (branches ?? []) as Array<{
        account_id: string;
        organization_id: string;
        is_organization_owner: boolean;
      }>
    ).find((branch) => branch.account_id === ctx.accountId);
    if (
      !selected ||
      selected.organization_id !== ctx.account.organizationId ||
      !canEditOrganizationBrandName(
        selected.is_organization_owner ? 'owner' : null
      )
    ) {
      throw new ForbiddenError(
        'Only an organization owner can change the gym brand'
      );
    }

    const body = (await request.json().catch(() => null)) as unknown;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, 'name')
    ) {
      return NextResponse.json({ error: GYM_NAME_ERROR }, { status: 400 });
    }
    const brandName = normalizeGymName((body as { name: unknown }).name);
    if (!brandName) {
      return NextResponse.json({ error: GYM_NAME_ERROR }, { status: 400 });
    }

    const { data, error } = await ctx.supabase.rpc(
      'save_organization_brand_name',
      { p_account_id: ctx.accountId, p_brand_name: brandName }
    );
    if (error) {
      if (error.code === '42501') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === '22023') {
        return NextResponse.json({ error: GYM_NAME_ERROR }, { status: 400 });
      }
      console.error('[organization brand] save failed:', {
        code: error.code ?? null,
      });
      return NextResponse.json(
        { error: 'Could not save the gym brand. Try again.' },
        { status: 500 }
      );
    }
    if (typeof data !== 'string') {
      console.error('[organization brand] invalid RPC response');
      return NextResponse.json(
        { error: 'Could not save the gym brand. Try again.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ name: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
