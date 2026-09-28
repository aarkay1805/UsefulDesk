import 'server-only';

import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { canManageSubscriptionBilling } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';

interface BranchIdentity {
  account_id: string;
  organization_id: string;
  is_organization_owner: boolean;
  default_currency: string;
  branch_status: string;
}

/** Identity-only lookup still works after trial expiry. */
export async function requireSubscriptionOwner(
  organizationId: string,
  billingAccountId?: string
) {
  const supabase = await createClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new UnauthorizedError();
  const { data, error } = await supabase.rpc('my_branch_accounts');
  if (error) throw error;
  const branches = (data ?? []) as BranchIdentity[];
  const branch = branches.find(
    (candidate) =>
      candidate.organization_id === organizationId &&
      (!billingAccountId || candidate.account_id === billingAccountId) &&
      candidate.branch_status === 'active' &&
      candidate.default_currency === 'INR' &&
      canManageSubscriptionBilling(
        candidate.is_organization_owner ? 'owner' : null
      )
  );
  if (!branch) throw new ForbiddenError('Only the gym owner can choose a plan');
  return { supabase, userId: userResult.user.id, branch };
}
