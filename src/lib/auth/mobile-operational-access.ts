import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

import {
  ForbiddenError,
  type AccountContext,
  UnauthorizedError,
  requireOperationalAccess,
} from '@/lib/auth/account';
import { BRANCH_HEADER, isBranchAccountId } from '@/lib/auth/branch-context';
import { canSendMessages, isAccountRole } from '@/lib/auth/roles';

export interface MobileOperationalAccessDependencies {
  createSupabaseClient: typeof createClient;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function bearerToken(authorization: string | null): string {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
  if (!match) throw new UnauthorizedError();
  return match[1];
}

/**
 * Creates the request-local mobile authorization resolver. Its dependencies
 * are injected so the bearer validation and RLS-bound account lookup can be
 * exercised without a networked Supabase project.
 */
export function createMobileOperationalAccess(
  dependencies: MobileOperationalAccessDependencies = {
    createSupabaseClient: createClient,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
) {
  async function requireMobileOperationalAccess(
    request: NextRequest | Request
  ): Promise<AccountContext> {
    const accessToken = bearerToken(request.headers.get('authorization'));
    const accountId = request.headers.get(BRANCH_HEADER);
    if (!isBranchAccountId(accountId)) {
      throw new ForbiddenError('An explicit branch context is required');
    }

    // Validate with Auth rather than trusting an unverified JWT claim.
    const authClient = dependencies.createSupabaseClient(
      dependencies.supabaseUrl,
      dependencies.supabaseAnonKey
    );
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(accessToken);
    if (userError || !user) throw new UnauthorizedError();

    // Every subsequent read carries both the validated bearer and the selected
    // branch. This lets database RLS independently enforce identity + tenancy.
    const supabase = dependencies.createSupabaseClient(
      dependencies.supabaseUrl,
      dependencies.supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            [BRANCH_HEADER]: accountId,
          },
        },
      }
    ) as SupabaseClient;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) {
      throw new ForbiddenError('Could not load account context');
    }
    if (!profile) {
      throw new ForbiddenError('Profile is not linked to an account');
    }

    const { data: membership, error: membershipError } = await supabase
      .from('account_memberships')
      .select('role')
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) {
      throw new ForbiddenError('Could not load branch context');
    }
    if (!membership || !isAccountRole(membership.role)) {
      throw new ForbiddenError('You do not have access to this branch');
    }

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select(
        'id, name, organization_id, legal_entity_id, branch_status, readiness_state'
      )
      .eq('id', accountId)
      .maybeSingle();
    if (accountError) {
      throw new ForbiddenError('Could not load account context');
    }
    if (!account) {
      throw new ForbiddenError('Profile is not linked to an account');
    }
    if (account.branch_status !== 'active') {
      throw new ForbiddenError('This branch is not active');
    }
    if (!canSendMessages(membership.role)) {
      throw new ForbiddenError('This action requires operational access');
    }

    return {
      supabase,
      userId: user.id,
      accountId,
      role: membership.role,
      account: {
        id: account.id,
        name: account.name,
        organizationId: account.organization_id,
        legalEntityId: account.legal_entity_id,
        branchStatus: account.branch_status,
        readinessState: account.readiness_state,
      },
    };
  }

  return { requireMobileOperationalAccess };
}

export const { requireMobileOperationalAccess } =
  createMobileOperationalAccess();

/**
 * Keeps browser callers on their cookie session while routing every presented
 * Authorization header through the strict mobile bearer path. A malformed
 * bearer value therefore cannot fall back to cookie authorization.
 */
export async function requireSendOperationalAccess(
  request: NextRequest | Request
): Promise<AccountContext> {
  if (request.headers.get('authorization') === null) {
    return requireOperationalAccess();
  }
  return requireMobileOperationalAccess(request);
}
