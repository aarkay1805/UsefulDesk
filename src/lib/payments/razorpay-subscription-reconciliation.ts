import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getRazorpayConnection,
  runRazorpayOperation,
  type RazorpayConnection,
} from './credentials';
import {
  fetchPayment,
  fetchSubscription,
  fetchSubscriptionInvoices,
  toRupees,
  type RazorpayAuthentication,
  type RazorpayPayment,
  type RazorpaySubscription,
  type RazorpaySubscriptionInvoiceCollection,
} from './razorpay';

export interface LocalMandateReconciliationRow {
  id: string;
  account_id: string;
  membership_id: string;
  gateway_subscription_id: string;
  last_applied_paid_count: number;
  provider_reconcile_at?: string | null;
}

interface ReconciliationDependencies {
  getConnection(
    admin: SupabaseClient,
    accountId: string
  ): Promise<RazorpayConnection | null>;
  fetchSubscription(
    authentication: RazorpayAuthentication,
    subscriptionId: string
  ): Promise<RazorpaySubscription>;
  fetchInvoices(
    authentication: RazorpayAuthentication,
    subscriptionId: string
  ): Promise<RazorpaySubscriptionInvoiceCollection>;
  fetchPayment(
    authentication: RazorpayAuthentication,
    paymentId: string
  ): Promise<RazorpayPayment>;
}

export async function reconcileClaimedSubscriptionSource(input: {
  admin: SupabaseClient;
  mandate: LocalMandateReconciliationRow;
  dependencies?: Partial<ReconciliationDependencies>;
}): Promise<{
  providerPaidCount: number;
  localPaidCount: number;
  observed: number;
}> {
  const dependencies: ReconciliationDependencies = {
    getConnection: getRazorpayConnection,
    fetchSubscription,
    fetchInvoices: fetchSubscriptionInvoices,
    fetchPayment,
    ...input.dependencies,
  };
  const localPaidCount = input.mandate.last_applied_paid_count;
  if (!Number.isInteger(localPaidCount) || localPaidCount < 0) {
    throw new Error('Local Razorpay paid_count is invalid');
  }

  const connection = await dependencies.getConnection(
    input.admin,
    input.mandate.account_id
  );
  if (!connection) throw new Error('Razorpay connection is missing');

  const subscription = await runRazorpayOperation(
    input.admin,
    connection,
    (authentication) =>
      dependencies.fetchSubscription(
        authentication,
        input.mandate.gateway_subscription_id
      )
  );
  if (subscription.id !== input.mandate.gateway_subscription_id) {
    throw new Error('Razorpay returned a different subscription');
  }
  const providerPaidCount = subscription.paid_count;
  if (!Number.isInteger(providerPaidCount) || providerPaidCount! < 0) {
    throw new Error('Provider Razorpay paid_count is invalid');
  }
  if (providerPaidCount! < localPaidCount) {
    throw new Error('UsefulDesk is ahead of Razorpay paid_count');
  }
  if (providerPaidCount === localPaidCount) {
    return { providerPaidCount, localPaidCount, observed: 0 };
  }

  const invoices = await runRazorpayOperation(
    input.admin,
    connection,
    (authentication) =>
      dependencies.fetchInvoices(
        authentication,
        input.mandate.gateway_subscription_id
      )
  );
  const paidInvoices = invoices.items
    .filter(
      (invoice) =>
        invoice.subscription_id === input.mandate.gateway_subscription_id &&
        invoice.status === 'paid' &&
        Boolean(invoice.payment_id) &&
        Number.isInteger(invoice.paid_at) &&
        invoice.amount_paid > 0
    )
    .sort((left, right) => left.paid_at! - right.paid_at!);
  if (paidInvoices.length !== providerPaidCount) {
    throw new Error(
      'Razorpay invoice history does not match subscription paid_count'
    );
  }

  let observed = 0;
  for (let index = localPaidCount; index < providerPaidCount; index += 1) {
    const invoice = paidInvoices[index];
    const gatewayPaymentId = invoice.payment_id!;
    const payment = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        dependencies.fetchPayment(authentication, gatewayPaymentId)
    );
    if (
      payment.id !== gatewayPaymentId ||
      payment.status !== 'captured' ||
      payment.captured === false ||
      payment.amount !== invoice.amount_paid ||
      payment.currency !== invoice.currency
    ) {
      throw new Error(
        `Razorpay payment ${gatewayPaymentId} does not match its paid invoice`
      );
    }

    const { error } = await input.admin.rpc(
      'preserve_razorpay_provider_charge_observation',
      {
        p_account_id: input.mandate.account_id,
        p_membership_id: input.mandate.membership_id,
        p_mandate_id: input.mandate.id,
        p_gateway_subscription_id: input.mandate.gateway_subscription_id,
        p_gateway_payment_id: gatewayPaymentId,
        p_gateway_invoice_id: invoice.id,
        p_provider_paid_count: index + 1,
        p_amount: toRupees(payment.amount),
        p_currency: payment.currency,
        p_method: payment.method ?? null,
        p_payment_status: payment.status,
        p_gateway_paid_at: providerTime(
          payment.created_at ?? invoice.paid_at ?? null
        ),
        p_gateway_current_start: providerTime(invoice.billing_start ?? null),
        p_gateway_current_end: providerTime(invoice.billing_end ?? null),
      }
    );
    if (error) {
      throw new Error(
        `preserve Razorpay provider charge observation: ${error.message}`
      );
    }
    observed += 1;
  }

  return { providerPaidCount, localPaidCount, observed };
}

function providerTime(seconds: number | null): string | null {
  if (!Number.isInteger(seconds) || seconds! <= 0) return null;
  return new Date(seconds! * 1000).toISOString();
}
