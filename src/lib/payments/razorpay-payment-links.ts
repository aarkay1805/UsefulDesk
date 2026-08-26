import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { PAYMENT_LINK_TEMPLATE_NAME } from './payment-link-constants';

import { getRazorpayConnection, runRazorpayOperation } from './credentials';
import {
  cancelPaymentLink,
  createPaymentLink,
  fetchPayment,
  fetchPaymentLink,
  listPaymentLinksByReference,
  RazorpayError,
  type RazorpayPayment,
  type RazorpayPaymentLink,
} from './razorpay';

export { PAYMENT_LINK_TEMPLATE_NAME };

export type LocalPaymentLinkStatus =
  | 'creating'
  | 'created'
  | 'cancel_requested'
  | 'paid'
  | 'cancelled'
  | 'expired'
  | 'orphaned'
  | 'failed';

export interface LocalPaymentLink {
  id: string;
  account_id: string;
  invoice_id: string;
  revision: number;
  reference_id: string;
  gateway_link_id: string | null;
  expected_amount: number;
  expected_amount_subunits: number;
  currency: 'INR';
  short_url: string | null;
  expires_at: string;
  status: LocalPaymentLinkStatus;
  next_reconcile_at: string | null;
  reconcile_attempt_count: number;
}

interface ReservationResult {
  outcome: 'reused' | 'created_intent' | 'cancellation_required' | 'busy';
  link: LocalPaymentLink;
}

interface InvoiceForLink {
  id: string;
  account_id: string;
  contact_id: string;
  currency: string;
  customer_name_snapshot: string | null;
  member_number_snapshot: number | null;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

export class PaymentLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentLinkConflictError';
  }
}

function exactExpiry(link: LocalPaymentLink): number {
  return Math.floor(new Date(link.expires_at).getTime() / 1000);
}

function notesFor(link: LocalPaymentLink) {
  return {
    usefuldesk_account_id: link.account_id,
    usefuldesk_invoice_id: link.invoice_id,
    usefuldesk_payment_link_id: link.id,
  };
}

function remoteMatchesIntent(
  local: LocalPaymentLink,
  remote: RazorpayPaymentLink
): boolean {
  return (
    remote.reference_id === local.reference_id &&
    remote.amount === local.expected_amount_subunits &&
    remote.currency === local.currency &&
    remote.accept_partial === false &&
    remote.expire_by === exactExpiry(local) &&
    remote.notes?.usefuldesk_account_id === local.account_id &&
    remote.notes?.usefuldesk_invoice_id === local.invoice_id &&
    remote.notes?.usefuldesk_payment_link_id === local.id
  );
}

function browserShape(link: LocalPaymentLink, deduped: boolean) {
  return {
    id: link.id,
    invoiceId: link.invoice_id,
    revision: link.revision,
    shortUrl: link.short_url,
    expiresAt: link.expires_at,
    status: link.status,
    amount: Number(link.expected_amount),
    currency: link.currency,
    deduped,
  };
}

async function finalizeCreatedLink(input: {
  admin: SupabaseClient;
  local: LocalPaymentLink;
  remote: RazorpayPaymentLink;
}): Promise<LocalPaymentLink> {
  if (!remoteMatchesIntent(input.local, input.remote)) {
    throw new Error('Razorpay Payment Link does not match its reserved intent');
  }
  const { data, error } = await input.admin.rpc(
    'finalize_invoice_payment_link',
    {
      p_account_id: input.local.account_id,
      p_link_id: input.local.id,
      p_gateway_link_id: input.remote.id,
      p_short_url: input.remote.short_url,
      p_remote_status: input.remote.status,
      p_remote_amount_subunits: input.remote.amount,
      p_remote_currency: input.remote.currency,
      p_remote_reference_id: input.remote.reference_id,
      p_remote_expires_at: new Date(
        input.remote.expire_by * 1000
      ).toISOString(),
    }
  );
  if (error) throw new Error(`finalize Payment Link: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Payment Link finalization returned no row');
  return row as LocalPaymentLink;
}

async function parkLink(
  admin: SupabaseClient,
  link: LocalPaymentLink,
  status: 'orphaned' | 'failed',
  error: unknown
) {
  const message =
    error instanceof Error ? error.message : 'Unknown provider error';
  await admin.rpc('park_invoice_payment_link', {
    p_account_id: link.account_id,
    p_link_id: link.id,
    p_status: status,
    p_error: message.slice(0, 500),
  });
}

async function findExactRemote(input: {
  admin: SupabaseClient;
  local: LocalPaymentLink;
}) {
  const connection = await getRazorpayConnection(
    input.admin,
    input.local.account_id
  );
  if (!connection) throw new Error('Razorpay connection is unavailable');
  const matches = await runRazorpayOperation(
    input.admin,
    connection,
    (authentication) =>
      listPaymentLinksByReference(authentication, input.local.reference_id)
  );
  const exact = matches.filter((remote) =>
    remoteMatchesIntent(input.local, remote)
  );
  if (exact.length > 1) {
    throw new Error(
      'Razorpay returned more than one link for a unique reference'
    );
  }
  if (matches.length !== exact.length) {
    throw new Error(
      'Razorpay returned a mismatched link for the reserved reference'
    );
  }
  return exact[0] ?? null;
}

export async function createOrReuseInvoicePaymentLink(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  invoiceId: string;
}) {
  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) {
    throw new PaymentLinkConflictError(
      'Connect Razorpay in Settings → Payments before creating a payment link'
    );
  }

  const { data: reservationData, error: reservationError } =
    await input.admin.rpc('reserve_invoice_payment_link', {
      p_account_id: input.accountId,
      p_invoice_id: input.invoiceId,
      p_created_by: input.userId,
    });
  if (reservationError) throw new Error(reservationError.message);
  const reservation = reservationData as ReservationResult;
  if (!reservation?.link)
    throw new Error('Payment Link reservation returned no row');
  if (reservation.outcome === 'reused') {
    return browserShape(reservation.link, true);
  }
  if (reservation.outcome === 'cancellation_required') {
    throw new PaymentLinkConflictError(
      'The previous payment link is being cancelled because the invoice changed. Try again after reconciliation.'
    );
  }
  if (reservation.outcome === 'busy') {
    throw new PaymentLinkConflictError(
      reservation.link.status === 'orphaned'
        ? 'This invoice has a payment link that needs reconciliation review'
        : 'Payment link creation is already in progress. Refresh shortly.'
    );
  }

  const local = reservation.link;
  const { data: invoiceData, error: invoiceError } = await input.admin
    .from('invoices')
    .select(
      'id, account_id, contact_id, currency, customer_name_snapshot, member_number_snapshot, contact:contacts(name, phone, email)'
    )
    .eq('id', local.invoice_id)
    .eq('account_id', local.account_id)
    .single();
  if (invoiceError || !invoiceData) {
    await parkLink(
      input.admin,
      local,
      'failed',
      invoiceError ?? new Error('Invoice missing')
    );
    throw new Error('Invoice details could not be loaded');
  }
  const invoice = invoiceData as unknown as InvoiceForLink;

  let remote: RazorpayPaymentLink;
  try {
    remote = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        createPaymentLink(authentication, {
          amountSubunits: local.expected_amount_subunits,
          currency: 'INR',
          expireBy: exactExpiry(local),
          referenceId: local.reference_id,
          description: `UsefulDesk invoice ${invoice.member_number_snapshot ?? invoice.id.slice(0, 8)}`,
          customer: {
            name:
              invoice.contact?.name ??
              invoice.customer_name_snapshot ??
              undefined,
            contact: invoice.contact?.phone ?? undefined,
            email: invoice.contact?.email ?? undefined,
          },
          notes: notesFor(local),
        })
    );
  } catch (error) {
    try {
      const adopted = await findExactRemote({ admin: input.admin, local });
      if (adopted?.status === 'created') {
        const finalized = await finalizeCreatedLink({
          admin: input.admin,
          local,
          remote: adopted,
        });
        return browserShape(finalized, true);
      }
    } catch (recoveryError) {
      await parkLink(input.admin, local, 'orphaned', recoveryError);
      throw recoveryError;
    }
    const definitive =
      error instanceof RazorpayError &&
      error.status >= 400 &&
      error.status < 500;
    await parkLink(
      input.admin,
      local,
      definitive ? 'failed' : 'orphaned',
      error
    );
    throw error;
  }

  try {
    const finalized = await finalizeCreatedLink({
      admin: input.admin,
      local,
      remote,
    });
    return browserShape(finalized, false);
  } catch (error) {
    await parkLink(input.admin, local, 'orphaned', error);
    throw error;
  }
}

async function localLinkForGateway(
  admin: SupabaseClient,
  accountId: string,
  gatewayLinkId: string
): Promise<LocalPaymentLink> {
  const { data, error } = await admin
    .from('razorpay_payment_links')
    .select('*')
    .eq('account_id', accountId)
    .eq('gateway_link_id', gatewayLinkId)
    .maybeSingle();
  if (error) throw new Error(`load Payment Link: ${error.message}`);
  if (!data) throw new Error(`no Payment Link found for ${gatewayLinkId}`);
  return data as LocalPaymentLink;
}

function paymentBelongsToLink(
  link: RazorpayPaymentLink,
  payment: RazorpayPayment
) {
  return Boolean(
    link.payments?.some((candidate) => candidate.payment_id === payment.id) ||
    payment.payment_link_id === link.id ||
    payment.notes?.payment_link_id === link.id
  );
}

export async function settleVerifiedPaymentLink(input: {
  admin: SupabaseClient;
  accountId: string;
  gatewayLinkId: string;
  gatewayPaymentId: string;
  webhookEventId: string | null;
  partial: boolean;
}) {
  const local = await localLinkForGateway(
    input.admin,
    input.accountId,
    input.gatewayLinkId
  );
  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) throw new Error('Razorpay connection is unavailable');
  const [remoteLink, payment] = await Promise.all([
    runRazorpayOperation(input.admin, connection, (authentication) =>
      fetchPaymentLink(authentication, input.gatewayLinkId)
    ),
    runRazorpayOperation(input.admin, connection, (authentication) =>
      fetchPayment(authentication, input.gatewayPaymentId)
    ),
  ]);
  const providerContractValid =
    remoteMatchesIntent(local, remoteLink) &&
    paymentBelongsToLink(remoteLink, payment);
  const { data, error } = await input.admin.rpc(
    'record_gateway_invoice_payment',
    {
      p_account_id: input.accountId,
      p_payment_link_id: local.id,
      p_webhook_event_id: input.webhookEventId,
      p_gateway_link_id: remoteLink.id,
      p_gateway_payment_id: payment.id,
      p_amount_subunits: payment.amount,
      p_currency: payment.currency,
      p_method: payment.method ?? 'other',
      p_payment_status: payment.status,
      p_payment_captured: payment.captured ?? payment.status === 'captured',
      p_reference_id: remoteLink.reference_id,
      p_provider_contract_valid: providerContractValid,
      p_partial: input.partial,
      p_provider_facts: {
        link_status: remoteLink.status,
        link_amount_paid: remoteLink.amount_paid,
        payment_captured: payment.captured ?? null,
        payment_link_id: payment.payment_link_id ?? null,
        provider_contract_valid: providerContractValid,
      },
    }
  );
  if (error)
    throw new Error(`record Payment Link settlement: ${error.message}`);
  return data as {
    outcome: 'recorded' | 'duplicate' | 'exception';
    payment_id?: string;
  };
}

export async function verifyPaymentLinkTerminal(input: {
  admin: SupabaseClient;
  accountId: string;
  gatewayLinkId: string;
  expectedStatus: 'cancelled' | 'expired';
}) {
  const local = await localLinkForGateway(
    input.admin,
    input.accountId,
    input.gatewayLinkId
  );
  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) throw new Error('Razorpay connection is unavailable');
  const remote = await runRazorpayOperation(
    input.admin,
    connection,
    (authentication) => fetchPaymentLink(authentication, input.gatewayLinkId)
  );
  if (
    !remoteMatchesIntent(local, remote) ||
    remote.status !== input.expectedStatus
  ) {
    throw new Error(
      'Fetched Payment Link terminal facts do not match the signed event'
    );
  }
  const { data, error } = await input.admin.rpc(
    'mark_invoice_payment_link_terminal',
    {
      p_account_id: input.accountId,
      p_link_id: local.id,
      p_gateway_link_id: remote.id,
      p_remote_status: remote.status,
    }
  );
  if (error) throw new Error(`mark Payment Link terminal: ${error.message}`);
  return data === true;
}

async function paidPaymentId(remote: RazorpayPaymentLink): Promise<string> {
  const id = remote.payments?.find(
    (payment) => payment.status === 'captured'
  )?.payment_id;
  if (!id)
    throw new Error('Paid Payment Link has no captured payment identity');
  return id;
}

export async function recoverClaimedPaymentLink(input: {
  admin: SupabaseClient;
  link: LocalPaymentLink;
  recoveryOwner: string;
}) {
  const connection = await getRazorpayConnection(
    input.admin,
    input.link.account_id
  );
  if (!connection) throw new Error('Razorpay connection is unavailable');
  let remote: RazorpayPaymentLink | null = null;

  if (input.link.status === 'creating' || input.link.status === 'orphaned') {
    remote = await findExactRemote({ admin: input.admin, local: input.link });
    if (!remote) {
      await parkLink(
        input.admin,
        input.link,
        'failed',
        new Error('No remote link exists for the reserved reference')
      );
      return 'failed';
    }
    if (remote.status === 'created') {
      await finalizeCreatedLink({
        admin: input.admin,
        local: input.link,
        remote,
      });
      return 'adopted';
    }
    await finalizeCreatedLink({
      admin: input.admin,
      local: input.link,
      remote,
    });
  } else if (input.link.gateway_link_id) {
    remote = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        fetchPaymentLink(authentication, input.link.gateway_link_id!)
    );
    if (!remoteMatchesIntent(input.link, remote)) {
      throw new Error('Fetched Payment Link does not match its local intent');
    }
  }
  if (!remote) throw new Error('Payment Link recovery has no provider entity');

  if (remote.status === 'paid' || remote.status === 'partially_paid') {
    await settleVerifiedPaymentLink({
      admin: input.admin,
      accountId: input.link.account_id,
      gatewayLinkId: remote.id,
      gatewayPaymentId: await paidPaymentId(remote),
      webhookEventId: null,
      partial: remote.status === 'partially_paid',
    });
    return remote.status;
  }
  if (remote.status === 'cancelled' || remote.status === 'expired') {
    await input.admin.rpc('mark_invoice_payment_link_terminal', {
      p_account_id: input.link.account_id,
      p_link_id: input.link.id,
      p_gateway_link_id: remote.id,
      p_remote_status: remote.status,
    });
    return remote.status;
  }
  if (input.link.status === 'cancel_requested') {
    const cancelled = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) => cancelPaymentLink(authentication, remote!.id)
    );
    if (cancelled.status === 'paid' || cancelled.status === 'partially_paid') {
      await settleVerifiedPaymentLink({
        admin: input.admin,
        accountId: input.link.account_id,
        gatewayLinkId: cancelled.id,
        gatewayPaymentId: await paidPaymentId(cancelled),
        webhookEventId: null,
        partial: cancelled.status === 'partially_paid',
      });
      return cancelled.status;
    }
    await input.admin.rpc('mark_invoice_payment_link_terminal', {
      p_account_id: input.link.account_id,
      p_link_id: input.link.id,
      p_gateway_link_id: cancelled.id,
      p_remote_status: cancelled.status,
    });
    return cancelled.status;
  }

  const backoffSeconds = Math.min(
    21_600,
    900 * 2 ** Math.max(0, input.link.reconcile_attempt_count - 1)
  );
  const { error } = await input.admin.rpc(
    'finish_razorpay_payment_link_verification',
    {
      p_account_id: input.link.account_id,
      p_link_id: input.link.id,
      p_recovery_owner: input.recoveryOwner,
      p_remote_status: remote.status,
      p_next_reconcile_seconds: backoffSeconds,
    }
  );
  if (error)
    throw new Error(`finish Payment Link verification: ${error.message}`);
  return 'verified';
}
