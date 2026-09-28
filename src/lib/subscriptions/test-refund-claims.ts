import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import {
  fetchTestFirstPaymentTime,
  testBillingConfig,
  type TestBillingConfig,
} from './test-provider';

type Claim = {
  organization_id: string;
  request_id: string;
  provider_payment_id: string;
  amount_minor: number;
  state: 'requested';
};
function assertClaim(
  value: unknown,
  organizationId: string,
  paymentId: string
): asserts value is Claim {
  const row = value as Partial<Claim> | null;
  if (
    !row ||
    row.organization_id !== organizationId ||
    row.provider_payment_id !== paymentId ||
    typeof row.request_id !== 'string' ||
    row.state !== 'requested' ||
    !Number.isSafeInteger(row.amount_minor) ||
    (row.amount_minor ?? 0) < 1
  ) {
    throw new Error('Unexpected first-payment refund claim');
  }
}

/** Reserve once. No provider POST, refund settlement, or entitlement mutation. */
export async function reserveTestFirstRefund(
  input: {
    organizationId: string;
    requestId: string;
    actorUserId: string;
    receivedAt: string;
  },
  dependencies: {
    admin?: SupabaseClient;
    config?: TestBillingConfig;
    fetchPaymentTime?: typeof fetchTestFirstPaymentTime;
  } = {}
) {
  const admin = dependencies.admin ?? supabaseAdmin();
  const config = dependencies.config ?? testBillingConfig();
  const { data, error } = await admin.rpc('subscription_test_first_payment', {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
  });
  if (error)
    throw new Error(
      `First Test payment lookup failed (${error.code ?? 'database'})`
    );
  const result = data as {
    payment?: {
      organization_id: string;
      provider_payment_id: string;
      provider_order_id: string;
      provider_merchant_id: string;
      provider_mode: string;
      amount_minor: number;
      currency: string;
    };
    claim?: unknown;
  } | null;
  const payment = result?.payment;
  if (
    !payment ||
    payment.organization_id !== input.organizationId ||
    payment.provider_merchant_id !== config.merchantId ||
    payment.provider_mode !== 'test' ||
    payment.currency !== 'INR' ||
    !Number.isSafeInteger(payment.amount_minor) ||
    payment.amount_minor < 1 ||
    !/^pay_[A-Za-z0-9]+$/.test(payment.provider_payment_id) ||
    !/^order_[A-Za-z0-9]+$/.test(payment.provider_order_id)
  ) {
    throw new Error('First Test payment does not belong to this organization');
  }
  if (result?.claim) {
    assertClaim(
      result.claim,
      input.organizationId,
      payment.provider_payment_id
    );
    return result.claim;
  }
  const received = await admin.rpc('subscription_receive_test_refund_request', {
    p_organization_id: input.organizationId,
    p_request_id: input.requestId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
    p_received_at: input.receivedAt,
  });
  if (received.error)
    throw new Error(
      `Test refund receipt failed (${received.error.code ?? 'database'})`
    );
  const receipt = received.data as {
    organization_id?: string;
    request_id?: string;
    requested_at?: string;
  } | null;
  if (
    receipt?.organization_id !== input.organizationId ||
    !isBranchAccountId(receipt.request_id) ||
    typeof receipt.requested_at !== 'string' ||
    !Number.isFinite(Date.parse(receipt.requested_at))
  ) {
    throw new Error('Unexpected Test refund receipt');
  }
  const paidAt = await (
    dependencies.fetchPaymentTime ?? fetchTestFirstPaymentTime
  )(config, {
    paymentId: payment.provider_payment_id,
    orderId: payment.provider_order_id,
    amountMinor: payment.amount_minor,
  });
  const reserved = await admin.rpc('subscription_reserve_test_first_refund', {
    p_organization_id: input.organizationId,
    p_request_id: receipt.request_id,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
    p_provider_payment_id: payment.provider_payment_id,
    p_paid_at: paidAt,
    p_requested_at: receipt.requested_at,
  });
  if (reserved.error)
    throw new Error(
      `First Test refund request needs review (${reserved.error.code ?? 'database'})`
    );
  assertClaim(reserved.data, input.organizationId, payment.provider_payment_id);
  return reserved.data;
}
