import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { requireSubscriptionOwner } from '@/lib/subscriptions/owner';
import {
  testBillingEnabled,
  testRefundsEnabled,
} from '@/lib/subscriptions/test-provider';
export async function GET(request: Request) {
  if (!testBillingEnabled())
    return NextResponse.json(
      { error: 'Test billing is unavailable' },
      { status: 404 }
    );
  try {
    const organizationId = new URL(request.url).searchParams.get(
      'organizationId'
    );
    if (!isBranchAccountId(organizationId))
      return NextResponse.json({ error: 'Choose a gym' }, { status: 400 });
    const { supabase } = await requireSubscriptionOwner(organizationId);
    const { data, error } = await supabase.rpc(
      'subscription_test_billing_snapshot',
      { p_organization_id: organizationId }
    );
    if (error) throw error;
    if (!data || data.organization_id !== organizationId)
      throw new Error('Invalid Test billing snapshot');
    return NextResponse.json(
      {
        billing: {
          ...data,
          refunds_enabled:
            data.refunds_enabled === true && testRefundsEnabled(),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
