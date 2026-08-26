import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getRazorpayConnection, runRazorpayOperation } from './credentials';
import {
  cancelSubscription,
  fetchSubscription,
  type RazorpaySubscription,
} from './razorpay';

interface LocalMandate {
  id: string;
  account_id: string;
  gateway: string;
  status: string;
  gateway_subscription_id: string | null;
}

export class MandateCancellationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MandateCancellationConflictError';
  }
}

export class MandateCancellationUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MandateCancellationUnavailableError';
  }
}

function terminalStatus(
  subscription: RazorpaySubscription
): 'revoked' | 'expired' | null {
  if (subscription.status === 'cancelled') return 'revoked';
  if (
    subscription.status === 'completed' ||
    subscription.status === 'expired'
  ) {
    return 'expired';
  }
  return null;
}

async function finalizeCancellation(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  mandateId: string;
  gatewaySubscriptionId: string;
  subscription: RazorpaySubscription;
  reason: string;
}) {
  const localStatus = terminalStatus(input.subscription);
  if (!localStatus) {
    throw new MandateCancellationUnavailableError(
      'Razorpay did not confirm that auto-pay is cancelled'
    );
  }
  if (input.subscription.id !== input.gatewaySubscriptionId) {
    throw new MandateCancellationUnavailableError(
      'Razorpay returned a different subscription identity'
    );
  }

  const { data, error } = await input.admin.rpc(
    'finalize_razorpay_mandate_cancellation',
    {
      p_account_id: input.accountId,
      p_mandate_id: input.mandateId,
      p_gateway_subscription_id: input.gatewaySubscriptionId,
      p_provider_status: input.subscription.status,
      p_local_status: localStatus,
      p_actor: input.userId,
      p_reason: input.reason,
    }
  );
  if (error || data !== true) {
    throw new Error(
      `finalize Razorpay mandate cancellation: ${error?.message ?? 'mandate was not updated'}`
    );
  }

  return {
    outcome: 'cancelled' as const,
    mandateId: input.mandateId,
    status: localStatus,
    providerStatus: input.subscription.status,
  };
}

export async function cancelRazorpayMandate(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  mandateId: string;
  reason: string;
}) {
  const { data, error } = await input.admin
    .from('payment_mandates')
    .select('id, account_id, gateway, status, gateway_subscription_id')
    .eq('id', input.mandateId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (error) throw new Error(`load mandate: ${error.message}`);
  if (!data) {
    throw new MandateCancellationConflictError(
      'The auto-pay mandate was not found in this account'
    );
  }

  const mandate = data as LocalMandate;
  if (['revoked', 'expired', 'failed'].includes(mandate.status)) {
    return {
      outcome: 'already_terminal' as const,
      mandateId: mandate.id,
      status: mandate.status,
    };
  }
  if (mandate.gateway !== 'razorpay' || !mandate.gateway_subscription_id) {
    throw new MandateCancellationConflictError(
      'This auto-pay setup has no cancellable Razorpay subscription'
    );
  }

  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) {
    throw new MandateCancellationConflictError(
      'Reconnect Razorpay before cancelling this auto-pay mandate'
    );
  }

  const fetchRemote = () =>
    runRazorpayOperation(input.admin, connection, (authentication) =>
      fetchSubscription(authentication, mandate.gateway_subscription_id!)
    );
  let remote: RazorpaySubscription;
  try {
    remote = await fetchRemote();
  } catch (error) {
    throw new MandateCancellationUnavailableError(
      'Razorpay could not verify this subscription. No local mandate state was changed; retry safely.',
      { cause: error }
    );
  }
  if (terminalStatus(remote)) {
    return finalizeCancellation({
      ...input,
      gatewaySubscriptionId: mandate.gateway_subscription_id,
      subscription: remote,
    });
  }

  try {
    remote = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        cancelSubscription(
          authentication,
          mandate.gateway_subscription_id!,
          false
        )
    );
  } catch (error) {
    // A timeout can happen after Razorpay accepted the cancellation. Re-read
    // the provider before surfacing a retry so UsefulDesk can converge safely.
    try {
      remote = await fetchRemote();
      if (terminalStatus(remote)) {
        return finalizeCancellation({
          ...input,
          gatewaySubscriptionId: mandate.gateway_subscription_id,
          subscription: remote,
        });
      }
    } catch {
      // Preserve the original cancellation failure as the useful cause.
    }
    throw new MandateCancellationUnavailableError(
      'Razorpay could not confirm the cancellation. No local mandate state was changed; retry safely.',
      { cause: error }
    );
  }

  return finalizeCancellation({
    ...input,
    gatewaySubscriptionId: mandate.gateway_subscription_id,
    subscription: remote,
  });
}
