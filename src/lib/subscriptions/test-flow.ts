import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { isBranchAccountId } from '@/lib/auth/branch-context';
import { isSubscriptionTier, SUBSCRIPTION_PLANS } from './plans';
import {
  createTestOrder,
  fetchCapturedTestPayment,
  fetchTestOrder,
  testBillingConfig,
  verifyTestCheckoutSignature,
  type TestBillingConfig,
} from './test-provider';

export class TestBillingConflict extends Error {}

function assertIntent(value: unknown): asserts value is {
  request_id: string;
  organization_id: string;
  provider_order_id?: string;
  tier: keyof typeof SUBSCRIPTION_PLANS;
  amount_minor: number;
  currency: 'INR';
  state?: string;
  action?: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Test plan intent');
  const row = value as Record<string, unknown>;
  if (
    !isBranchAccountId(row.request_id) ||
    !isBranchAccountId(row.organization_id) ||
    !isSubscriptionTier(row.tier) ||
    row.amount_minor !==
      SUBSCRIPTION_PLANS[row.tier].monthlySoftwareInr * 100 ||
    row.currency !== 'INR'
  ) {
    throw new Error('Test plan intent does not match approved base price');
  }
}

type Admin = SupabaseClient;

/** One claimed Test order per intent; ambiguous provider responses require recovery. */
export async function prepareTestCheckout(
  input: {
    organizationId: string;
    requestId: string;
    actorUserId: string;
  },
  dependencies: {
    admin?: Admin;
    config?: TestBillingConfig;
    createOrder?: typeof createTestOrder;
    fetchOrder?: typeof fetchTestOrder;
  } = {}
) {
  const admin = dependencies.admin ?? supabaseAdmin();
  const config = dependencies.config ?? testBillingConfig();
  const { data, error } = await admin.rpc('subscription_claim_test_order', {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_provider_merchant_id: config.merchantId,
  });
  if (error)
    throw new Error(`Test order claim failed (${error.code ?? 'database'})`);
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    (data as { action?: string }).action === 'recovery'
  ) {
    throw new TestBillingConflict(
      'The plan order needs review. Contact support.'
    );
  }
  assertIntent(data);
  if (
    data.request_id !== input.requestId ||
    data.organization_id !== input.organizationId
  )
    throw new Error('Test order claim returned another organization');

  let orderId: string;
  if (data.action === 'bound' && typeof data.provider_order_id === 'string') {
    const order = await (dependencies.fetchOrder ?? fetchTestOrder)(config, {
      orderId: data.provider_order_id,
      requestId: input.requestId,
      amountMinor: data.amount_minor,
    });
    orderId = order.id;
  } else if (data.action === 'create') {
    const order = await (dependencies.createOrder ?? createTestOrder)(config, {
      requestId: input.requestId,
      organizationId: input.organizationId,
      amountMinor: data.amount_minor,
    });
    orderId = order.id;
    const bound = await admin.rpc('subscription_bind_test_order', {
      p_request_id: input.requestId,
      p_provider_order_id: order.id,
      p_provider_merchant_id: config.merchantId,
    });
    if (bound.error)
      throw new TestBillingConflict(
        'The plan order needs review. Contact support.'
      );
  } else {
    throw new Error('Invalid Test order claim state');
  }
  return {
    requestId: input.requestId,
    organizationId: input.organizationId,
    tier: data.tier,
    amountMinor: data.amount_minor,
    currency: 'INR' as const,
    orderId,
    keyId: config.keyId,
  };
}

/** Signed Checkout or signed webhook plus a fresh provider GET precedes DB commit. */
export async function confirmTestPayment(
  input: {
    orderId: string;
    paymentId: string;
    source: 'checkout' | 'webhook';
    checkoutSignature?: string;
    expectedOrganizationId?: string;
    expectedRequestId?: string;
  },
  dependencies: {
    admin?: Admin;
    config?: TestBillingConfig;
    fetchPayment?: typeof fetchCapturedTestPayment;
  } = {}
) {
  const admin = dependencies.admin ?? supabaseAdmin();
  const config = dependencies.config ?? testBillingConfig();
  const { data, error } = await admin.rpc(
    'subscription_test_intent_for_order',
    {
      p_provider_order_id: input.orderId,
      p_provider_merchant_id: config.merchantId,
    }
  );
  if (error)
    throw new Error(
      `Bound Test order lookup failed (${error.code ?? 'database'})`
    );
  assertIntent(data);
  if (
    data.provider_order_id !== input.orderId ||
    (input.expectedOrganizationId &&
      data.organization_id !== input.expectedOrganizationId) ||
    (input.expectedRequestId && data.request_id !== input.expectedRequestId)
  ) {
    throw new Error(
      'Test payment does not belong to this organization and intent'
    );
  }
  if (
    input.source === 'checkout' &&
    !verifyTestCheckoutSignature(
      data.provider_order_id,
      input.paymentId,
      input.checkoutSignature ?? null,
      config
    )
  ) {
    throw new Error('Invalid Test checkout signature');
  }
  // A committed intent is immutable. A late duplicate after a later refund
  // must not recreate access or fail indefinitely because the provider now
  // reports an amount_refunded value.
  if (data.state !== 'verified') {
    await (dependencies.fetchPayment ?? fetchCapturedTestPayment)(config, {
      paymentId: input.paymentId,
      orderId: data.provider_order_id,
      amountMinor: data.amount_minor,
    });
  }
  const { data: committed, error: commitError } = await admin.rpc(
    'subscription_commit_test_initial_payment',
    {
      p_request_id: data.request_id,
      p_provider_order_id: data.provider_order_id,
      p_provider_payment_id: input.paymentId,
      p_provider_merchant_id: config.merchantId,
      p_amount_minor: data.amount_minor,
      p_currency: 'INR',
      p_verified_at: new Date().toISOString(),
    }
  );
  if (commitError)
    throw new Error(
      `Test payment commit failed (${commitError.code ?? 'database'})`
    );
  const grant = (
    committed as {
      grant?: {
        organization_id?: string;
        source_intent_id?: string;
        first_provider_payment_id?: string;
      };
    } | null
  )?.grant;
  if (
    grant?.organization_id !== data.organization_id ||
    grant.source_intent_id !== data.request_id ||
    grant.first_provider_payment_id !== input.paymentId
  ) {
    throw new Error('Test payment commit returned another grant');
  }
  return {
    organizationId: data.organization_id,
    requestId: data.request_id,
    tier: data.tier,
    paymentId: input.paymentId,
  };
}
