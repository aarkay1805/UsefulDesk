import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { hasBranchSetupPrerequisite } from '@/lib/branches/setup';
import type { OnboardingRawStatus } from '@/lib/onboarding/steps';
import { getRazorpayConnectionStatus } from '@/lib/payments/credentials';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // The browser only mounts this provider for users with the matching
    // capability, but the route repeats that boundary authoritatively.
    const ctx = await requireSettingsAccess();
    const db = ctx.supabase;
    const admin = supabaseAdmin();

    const [
      config,
      template,
      plans,
      memberships,
      paymentCredentials,
      payments,
      team,
      invites,
    ] = await Promise.allSettled([
      db.from('whatsapp_config').select('status').maybeSingle(),
      db
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('name', TEMPLATE_CONTRACTS.membership_renewal.payload.name),
      db
        .from('membership_plans')
        .select('is_active, pricing_options:plan_pricing_options(is_active)')
        .eq('is_active', true),
      db.from('memberships').select('id', { count: 'exact', head: true }),
      getRazorpayConnectionStatus(admin, ctx.accountId),
      db
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'paid'),
      db.rpc('list_account_members', { p_account_id: ctx.accountId }),
      db
        .from('account_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString()),
    ]);

    const status: OnboardingRawStatus = {
      whatsappConnected:
        config.status === 'fulfilled' &&
        config.value.data?.status === 'connected',
      templateApproved:
        template.status === 'fulfilled' &&
        !template.value.error &&
        evaluateTemplateReadiness(
          template.value.data ?? [],
          'membership_renewal',
          'en_US'
        ).ready,
      hasActivePlanPricing:
        plans.status === 'fulfilled' &&
        !plans.value.error &&
        hasBranchSetupPrerequisite(plans.value.data ?? []),
      membershipCount:
        memberships.status === 'fulfilled' ? (memberships.value.count ?? 0) : 0,
      razorpayConnected:
        paymentCredentials.status === 'fulfilled' &&
        paymentCredentials.value.configured,
      paidPaymentCount:
        payments.status === 'fulfilled' ? (payments.value.count ?? 0) : 0,
      teamSize:
        team.status === 'fulfilled' &&
        !team.value.error &&
        Array.isArray(team.value.data)
          ? team.value.data.length
          : null,
      pendingInvites:
        invites.status === 'fulfilled' && !invites.value.error
          ? (invites.value.count ?? 0)
          : null,
    };

    return NextResponse.json({ status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
