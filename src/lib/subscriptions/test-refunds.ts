import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import {
  createTestFullRefund,
  recoverTestFullRefund,
  fetchTestFullRefund,
  testBillingConfig,
  type TestBillingConfig,
  type TestRefundFacts,
  type VerifiedTestRefund,
} from './test-provider';

type Dependencies = {
  admin?: SupabaseClient;
  config?: TestBillingConfig;
  createRefund?: typeof createTestFullRefund;
  recoverRefund?: typeof recoverTestFullRefund;
  fetchRefund?: typeof fetchTestFullRefund;
};
type Context = {
  action?: string;
  claim: {
    request_id: string;
    organization_id: string;
    provider_payment_id: string;
    provider_merchant_id: string;
    amount_minor: number;
    currency: string;
  };
  execution: { provider_refund_id: string | null; confirmed_at: string | null };
  provider_order_id: string;
};
function factsFor(
  value: unknown,
  config: TestBillingConfig
): { context: Context; facts: TestRefundFacts } {
  const context = value as Context | null;
  const claim = context?.claim;
  if (
    !context?.execution ||
    !claim ||
    !isBranchAccountId(claim.request_id) ||
    !isBranchAccountId(claim.organization_id) ||
    claim.provider_merchant_id !== config.merchantId ||
    claim.currency !== 'INR' ||
    !Number.isSafeInteger(claim.amount_minor) ||
    claim.amount_minor < 1 ||
    !/^pay_[A-Za-z0-9]+$/.test(claim.provider_payment_id) ||
    !/^order_[A-Za-z0-9]+$/.test(context.provider_order_id)
  )
    throw new Error('Invalid Test refund context');
  return {
    context,
    facts: {
      requestId: claim.request_id,
      organizationId: claim.organization_id,
      paymentId: claim.provider_payment_id,
      orderId: context.provider_order_id,
      amountMinor: claim.amount_minor,
    },
  };
}
async function applyRefund(
  admin: SupabaseClient,
  config: TestBillingConfig,
  facts: TestRefundFacts,
  refund: VerifiedTestRefund
) {
  const args = {
    p_request_id: facts.requestId,
    p_provider_merchant_id: config.merchantId,
    p_provider_payment_id: facts.paymentId,
    p_provider_refund_id: refund.id,
    p_amount_minor: facts.amountMinor,
    p_currency: 'INR',
  };
  const observed = await admin.rpc('subscription_observe_test_refund', {
    ...args,
    p_status: refund.status,
  });
  if (observed.error)
    throw new Error(
      `Test refund observation failed (${observed.error.code ?? 'database'})`
    );
  if (refund.status !== 'processed')
    return { status: refund.status, confirmed: false };
  const committed = await admin.rpc(
    'subscription_commit_test_full_refund',
    args
  );
  if (committed.error)
    throw new Error(
      `Confirmed Test refund needs review (${committed.error.code ?? 'database'})`
    );
  const execution = committed.data as {
    request_id?: string;
    provider_refund_id?: string;
    confirmed_at?: string;
  } | null;
  if (
    execution?.request_id !== facts.requestId ||
    execution.provider_refund_id !== refund.id ||
    !execution.confirmed_at
  )
    throw new Error('Invalid confirmed Test refund');
  return { status: 'processed', confirmed: true };
}
/** DB claims at most one POST. Every uncertain retry performs GET recovery only. */
export async function executeTestFirstRefund(
  input: { organizationId: string; actorUserId: string },
  dependencies: Dependencies = {}
) {
  const admin = dependencies.admin ?? supabaseAdmin();
  const config = dependencies.config ?? testBillingConfig();
  const claimed = await admin.rpc('subscription_claim_test_refund', {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
  });
  if (claimed.error)
    throw new Error(
      `Test refund claim failed (${claimed.error.code ?? 'database'})`
    );
  const { context, facts } = factsFor(claimed.data, config);
  if (facts.organizationId !== input.organizationId)
    throw new Error('Test refund belongs to another organization');
  if (context.action === 'confirmed' && context.execution.confirmed_at)
    return { status: 'processed', confirmed: true };
  let refundId = context.execution.provider_refund_id;
  if (!refundId) {
    if (context.action !== 'create' && context.action !== 'recovery')
      throw new Error('Invalid Test refund action');
    const result = await (
      context.action === 'create'
        ? (dependencies.createRefund ?? createTestFullRefund)
        : (dependencies.recoverRefund ?? recoverTestFullRefund)
    )(config, facts);
    if (!result)
      throw new Error('Test refund needs review. No second refund was issued.');
    // Bind immediately even if a later GET or access commit fails.
    const bound = await admin.rpc('subscription_observe_test_refund', {
      p_request_id: facts.requestId,
      p_provider_merchant_id: config.merchantId,
      p_provider_payment_id: facts.paymentId,
      p_provider_refund_id: result.id,
      p_amount_minor: facts.amountMinor,
      p_currency: 'INR',
      p_status: result.status,
    });
    if (bound.error) throw new Error('Test refund needs recovery');
    refundId = result.id;
  }
  const refund = await (dependencies.fetchRefund ?? fetchTestFullRefund)(
    config,
    facts,
    refundId
  );
  return applyRefund(admin, config, facts, refund);
}
/** Called only after raw webhook HMAC and exact Test merchant checks. */
export async function confirmTestRefund(
  input: { paymentId: string; refundId: string },
  dependencies: Dependencies = {}
) {
  const admin = dependencies.admin ?? supabaseAdmin();
  const config = dependencies.config ?? testBillingConfig();
  const found = await admin.rpc('subscription_test_refund_for_payment', {
    p_provider_payment_id: input.paymentId,
    p_provider_merchant_id: config.merchantId,
  });
  if (found.error) throw new Error('Test refund lookup failed');
  if (!found.data) return; // An unrelated merchant refund cannot change a SaaS grant.
  const { context, facts } = factsFor(found.data, config);
  if (
    facts.paymentId !== input.paymentId ||
    (context.execution.provider_refund_id &&
      context.execution.provider_refund_id !== input.refundId)
  )
    throw new Error('Test refund identity mismatch');
  const refund = await (dependencies.fetchRefund ?? fetchTestFullRefund)(
    config,
    facts,
    input.refundId
  );
  return applyRefund(admin, config, facts, refund);
}
