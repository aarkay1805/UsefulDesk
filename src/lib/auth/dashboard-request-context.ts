import { cache } from 'react';
import { headers } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { BRANCH_HEADER } from '@/lib/auth/branch-context';
import {
  ForbiddenError,
  UnauthorizedError,
  type AccountContext,
} from '@/lib/auth/account';
import {
  loadDashboardAuthBootstrap,
  type DashboardAuthBootstrap,
} from '@/lib/auth/dashboard-bootstrap';
import { isAccountRole } from '@/lib/auth/roles';
import type { DashboardActionDateContext } from '@/lib/dashboard/action-snapshot';
import { measureDashboardStage } from '@/lib/dashboard/timing';
import { resolveAccountLocale } from '@/lib/locale/config';
import { todayInTz } from '@/lib/locale/format';
import { createClient } from '@/lib/supabase/server';

export interface DashboardAuthorizedAccount extends AccountContext {
  dateContext: DashboardActionDateContext;
}

export interface DashboardRequestContext {
  user: User;
  bootstrap: DashboardAuthBootstrap;
  account: DashboardAuthorizedAccount | null;
}

async function loadDashboardRequestContext(): Promise<DashboardRequestContext> {
  const sessionClient = await createClient();
  const {
    data: { user },
    error,
  } = await measureDashboardStage('auth.user', () =>
    sessionClient.auth.getUser()
  );
  if (error || !user) throw new UnauthorizedError();

  const requestHeaders = await headers();
  const bootstrap = await measureDashboardStage('auth.bootstrap', () =>
    loadDashboardAuthBootstrap(
      sessionClient,
      user.id,
      requestHeaders.get(BRANCH_HEADER)
    )
  );

  const accountRow = bootstrap.account;
  const profile = bootstrap.profile;
  const selectedAccountId = profile?.account_id;
  const selectedRole = profile?.account_role;
  const isAuthorizedSelection =
    bootstrap.branchAccessError === null &&
    accountRow !== null &&
    selectedAccountId === accountRow.id &&
    isAccountRole(selectedRole) &&
    accountRow.branch_status !== 'archived';

  if (!isAuthorizedSelection || !accountRow || !selectedRole) {
    return { user, bootstrap, account: null };
  }

  // This client carries the selected branch into Supabase's request headers,
  // so every streamed section remains constrained by the same RLS context the
  // bootstrap just authorized through my_branch_accounts().
  const supabase = (await createClient(accountRow.id)) as SupabaseClient;
  const locale = resolveAccountLocale(accountRow);

  return {
    user,
    bootstrap,
    account: {
      supabase,
      userId: user.id,
      accountId: accountRow.id,
      role: selectedRole,
      account: {
        id: accountRow.id,
        name: accountRow.name,
        organizationId: accountRow.organization_id,
        legalEntityId: accountRow.legal_entity_id,
        branchStatus: accountRow.branch_status,
        readinessState: accountRow.readiness_state,
      },
      dateContext: {
        timeZone: locale.timeZone,
        today: todayInTz(locale.timeZone),
      },
    },
  };
}

/** One promise per React server request, shared by layout and page sections. */
export const getDashboardRequestContext = cache(loadDashboardRequestContext);

export function requireDashboardAccountContext(
  context: DashboardRequestContext
): DashboardAuthorizedAccount {
  if (!context.account) {
    throw new ForbiddenError('Could not load selected branch context');
  }
  return context.account;
}
