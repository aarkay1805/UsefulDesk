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
  toPaise,
  type RazorpayAuthentication,
  type RazorpayPayment,
  type RazorpaySubscription,
  type RazorpaySubscriptionInvoiceCollection,
} from './razorpay';

export type RazorpayChargeResolutionAction = 'apply' | 'ignore';

interface ProviderChargeException {
  id: string;
  account_id: string;
  gateway_subscription_id: string;
  gateway_payment_id: string;
  gateway_invoice_id: string | null;
  provider_paid_count: number | null;
  amount: number;
  currency: string | null;
  status: string;
  reason_code: string;
}

interface ChargeResolutionDependencies {
  loadException(
    admin: SupabaseClient,
    accountId: string,
    exceptionId: string
  ): Promise<ProviderChargeException>;
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

export class RazorpayChargeResolutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RazorpayChargeResolutionConflictError';
  }
}

export async function resolveProviderChargeException(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  exceptionId: string;
  action: RazorpayChargeResolutionAction;
  reason: string;
  dependencies?: Partial<ChargeResolutionDependencies>;
}) {
  const dependencies: ChargeResolutionDependencies = {
    loadException,
    getConnection: getRazorpayConnection,
    fetchSubscription,
    fetchInvoices: fetchSubscriptionInvoices,
    fetchPayment,
    ...input.dependencies,
  };

  if (input.action === 'ignore') {
    return invokeResolution(input.admin, 'ignore', {
      p_account_id: input.accountId,
      p_exception_id: input.exceptionId,
      p_actor: input.userId,
      p_note: input.reason,
    });
  }

  const exception = await dependencies.loadException(
    input.admin,
    input.accountId,
    input.exceptionId
  );
  assertResolvableException(exception);
  const connection = await dependencies.getConnection(
    input.admin,
    input.accountId
  );
  if (!connection) {
    throw new RazorpayChargeResolutionConflictError(
      'Razorpay must be connected before this charge can be revalidated'
    );
  }

  // One operation boundary means an expired grant refreshes once and retries
  // the complete read-only fact set with one consistent authentication value.
  const { subscription, invoices, payment } = await runRazorpayOperation(
    input.admin,
    connection,
    async (authentication) => {
      const subscription = await dependencies.fetchSubscription(
        authentication,
        exception.gateway_subscription_id
      );
      const invoices = await dependencies.fetchInvoices(
        authentication,
        exception.gateway_subscription_id
      );
      const payment = await dependencies.fetchPayment(
        authentication,
        exception.gateway_payment_id
      );
      return { subscription, invoices, payment };
    }
  );
  assertProviderFacts(exception, subscription, invoices, payment);

  return invokeResolution(input.admin, 'apply', {
    p_account_id: input.accountId,
    p_exception_id: input.exceptionId,
    p_actor: input.userId,
    p_note: input.reason,
  });
}

async function loadException(
  admin: SupabaseClient,
  accountId: string,
  exceptionId: string
): Promise<ProviderChargeException> {
  const { data, error } = await admin
    .from('gateway_charge_exceptions')
    .select(
      'id, account_id, gateway_subscription_id, gateway_payment_id, gateway_invoice_id, provider_paid_count, amount, currency, status, reason_code'
    )
    .eq('id', exceptionId)
    .eq('account_id', accountId)
    .eq('gateway', 'razorpay')
    .maybeSingle();
  if (error) {
    throw new Error(`load Razorpay charge exception: ${error.message}`);
  }
  if (!data) {
    throw new RazorpayChargeResolutionConflictError(
      'The Razorpay charge exception no longer exists'
    );
  }
  return data as ProviderChargeException;
}

function assertResolvableException(exception: ProviderChargeException): void {
  if (
    exception.status !== 'open' ||
    exception.reason_code !== 'provider_charge_missing_webhook'
  ) {
    throw new RazorpayChargeResolutionConflictError(
      'This Razorpay charge is no longer eligible for provider revalidation'
    );
  }
  if (
    !exception.gateway_invoice_id ||
    !Number.isInteger(exception.provider_paid_count) ||
    exception.provider_paid_count! < 1 ||
    !Number.isFinite(Number(exception.amount)) ||
    Number(exception.amount) <= 0 ||
    !exception.currency
  ) {
    throw new RazorpayChargeResolutionConflictError(
      'The preserved Razorpay charge is missing required provider facts'
    );
  }
}

function assertProviderFacts(
  exception: ProviderChargeException,
  subscription: RazorpaySubscription,
  invoices: RazorpaySubscriptionInvoiceCollection,
  payment: RazorpayPayment
): void {
  if (
    subscription.id !== exception.gateway_subscription_id ||
    !Number.isInteger(subscription.paid_count) ||
    subscription.paid_count! < exception.provider_paid_count!
  ) {
    throw new RazorpayChargeResolutionConflictError(
      'Razorpay subscription no longer confirms this charge sequence'
    );
  }

  const invoice = invoices.items.find(
    (item) => item.id === exception.gateway_invoice_id
  );
  const expectedPaise = toPaise(Number(exception.amount));
  if (
    !invoice ||
    invoice.subscription_id !== exception.gateway_subscription_id ||
    invoice.payment_id !== exception.gateway_payment_id ||
    invoice.status !== 'paid' ||
    invoice.amount_paid !== expectedPaise ||
    invoice.currency !== exception.currency
  ) {
    throw new RazorpayChargeResolutionConflictError(
      'Razorpay invoice no longer matches the preserved charge'
    );
  }

  if (
    payment.id !== exception.gateway_payment_id ||
    payment.status !== 'captured' ||
    payment.captured === false ||
    payment.amount !== expectedPaise ||
    payment.currency !== exception.currency
  ) {
    throw new RazorpayChargeResolutionConflictError(
      'Razorpay payment no longer matches the preserved charge'
    );
  }
  if (
    (payment.amount_refunded ?? 0) > 0 ||
    payment.refund_status === 'partial' ||
    payment.refund_status === 'full'
  ) {
    throw new RazorpayChargeResolutionConflictError(
      'The Razorpay payment has been refunded and cannot be applied as a full charge'
    );
  }
}

async function invokeResolution(
  admin: SupabaseClient,
  action: RazorpayChargeResolutionAction,
  parameters: {
    p_account_id: string;
    p_exception_id: string;
    p_actor: string;
    p_note: string;
  }
) {
  const { data, error } = await admin.rpc(
    action === 'apply'
      ? 'resolve_razorpay_provider_charge_exception'
      : 'ignore_razorpay_provider_charge_exception',
    parameters
  );
  if (error) {
    throw new RazorpayChargeResolutionConflictError(error.message);
  }
  const result = data as {
    outcome?: string;
    reason_message?: string;
  } | null;
  if (!result?.outcome) {
    throw new Error('Razorpay charge resolution returned an invalid result');
  }
  if (result.outcome === 'blocked') {
    throw new RazorpayChargeResolutionConflictError(
      result.reason_message ??
        'UsefulDesk could not safely apply this Razorpay charge'
    );
  }
  return data;
}
