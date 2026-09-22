import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
  UnauthorizedError,
} from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSameOriginRequest } from '@/lib/auth/csrf';
import { GYM_NAME_ERROR, normalizeGymName } from '@/lib/auth/gym-name';
import { ProductAccessError } from '@/lib/platform-access/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type CompletionStatus = 'completed' | 'already_complete';

function rpcErrorResponse(error: { code?: string | null }): NextResponse {
  switch (error.code) {
    case '42501':
      return NextResponse.json(
        { error: 'You do not have permission to complete this gym setup.' },
        { status: 403 }
      );
    case '22023':
      return NextResponse.json({ error: GYM_NAME_ERROR }, { status: 400 });
    case '23505':
      return NextResponse.json(
        { error: 'This gym setup cannot be completed automatically.' },
        { status: 409 }
      );
    default:
      console.error('[complete signup] unexpected RPC error:', {
        code: error.code ?? null,
      });
      return NextResponse.json(
        { error: 'Could not complete gym setup. Please try again.' },
        { status: 500 }
      );
  }
}

function isCompletionStatus(value: unknown): value is {
  status: CompletionStatus;
} {
  if (typeof value !== 'object' || value === null) return false;
  const status = (value as Record<string, unknown>).status;
  return status === 'completed' || status === 'already_complete';
}

export async function POST(request: Request) {
  try {
    requireSameOriginRequest(request);

    const url = new URL(request.url);
    const branch = url.searchParams.get('branch');
    if (
      !url.searchParams.has('branch') ||
      url.searchParams.getAll('branch').length !== 1 ||
      !isBranchAccountId(branch)
    ) {
      return NextResponse.json(
        { error: 'A valid branch selection is required.' },
        { status: 400 }
      );
    }

    const context = await getCurrentAccount(branch);
    const limit = checkRateLimit(
      `admin:complete-organization-name:${context.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, 'gymName')
    ) {
      return NextResponse.json({ error: GYM_NAME_ERROR }, { status: 400 });
    }

    const gymName = normalizeGymName((body as Record<string, unknown>).gymName);
    if (!gymName) {
      return NextResponse.json({ error: GYM_NAME_ERROR }, { status: 400 });
    }

    const { data, error } = await context.supabase.rpc(
      'complete_organization_name_setup',
      {
        p_account_id: branch,
        p_gym_name: gymName,
      }
    );
    if (error) return rpcErrorResponse(error);
    if (!isCompletionStatus(data)) {
      console.error('[complete signup] invalid RPC response');
      return NextResponse.json(
        { error: 'Could not complete gym setup. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: data.status });
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      error instanceof ProductAccessError
    ) {
      return toErrorResponse(error);
    }
    console.error('[complete signup] unexpected route error:', {
      kind: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: 'Could not complete gym setup. Please try again.' },
      { status: 500 }
    );
  }
}
