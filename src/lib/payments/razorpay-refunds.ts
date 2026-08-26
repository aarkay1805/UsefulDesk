import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getRazorpayConnection, runRazorpayOperation } from './credentials';
import {
  createRefund,
  fetchPayment,
  fetchRefund,
  listPaymentRefunds,
  listRefunds,
  RazorpayError,
  toPaise,
  toRupees,
  type RazorpayPayment,
  type RazorpayRefund,
} from './razorpay';
import {
  getRazorpayProviderMode,
  type RazorpayProviderMode,
} from './razorpay-config';
import type { RefundLineAllocationInput } from './refund-allocation-input';
import { boundedRazorpayError } from './razorpay-oauth';

const REFUND_PAGE_SIZE = 25;

export type RefundDisposition = 'reopen_balance' | 'reduce_charge';
export type LocalRefundStatus =
  'creating' | 'pending' | 'processed' | 'failed' | 'orphaned';

export interface LocalGatewayRefund {
  id: string;
  account_id: string;
  payment_id: string;
  invoice_id: string;
  gateway_refund_id: string | null;
  amount: number;
  currency: string;
  source: 'usefuldesk' | 'razorpay_dashboard';
  disposition: RefundDisposition | null;
  reason: string | null;
  status: LocalRefundStatus;
  idempotency_key: string | null;
  provider_idempotency_key: string | null;
  canonical_request_body: string | null;
  canonical_request_sha256: string | null;
  outbound_owner: string | null;
  outbound_lease_until: string | null;
  next_reconcile_at: string;
  reconcile_attempt_count: number;
  created_at: string;
}

interface LocalGatewayPayment {
  id: string;
  account_id: string;
  invoice_id: string | null;
  gateway_payment_id: string | null;
  amount: number;
  currency?: string | null;
  status: string;
  source: string;
  paid_at: string;
}

interface RefundReservation {
  outcome: 'reserved' | 'reused';
  refund: LocalGatewayRefund;
}

interface ReconciliationState {
  account_id: string;
  provider_mode: RazorpayProviderMode;
  refund_window_from: string;
  refund_window_to: string;
  refund_skip: number;
}

export class RefundConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundConflictError';
  }
}

export function isUsefulDeskRefundId(value: string | null): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

export function shouldSimulateAmbiguousRefundCreate(
  refund: Pick<LocalGatewayRefund, 'reconcile_attempt_count'>
): boolean {
  return (
    getRazorpayProviderMode() === 'test' &&
    process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY === 'true' &&
    process.env.RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE === 'true' &&
    refund.reconcile_attempt_count === 0
  );
}

export function shouldArmRefundWebhookRetryAcceptance(): boolean {
  return (
    getRazorpayProviderMode() === 'test' &&
    process.env.RAZORPAY_PROVIDER_ACCEPTANCE_ONLY === 'true' &&
    process.env.RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE === 'true'
  );
}

function assertRefundRetryAcceptanceConfiguration(): void {
  if (
    process.env.RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE === 'true' &&
    !shouldArmRefundWebhookRetryAcceptance()
  ) {
    throw new RefundConflictError(
      'Refund retry acceptance is available only in the isolated Razorpay Test acceptance deployment.'
    );
  }
  if (
    process.env.RAZORPAY_REFUND_WEBHOOK_RETRY_ACCEPTANCE === 'true' &&
    process.env.RAZORPAY_REFUND_AMBIGUOUS_CREATE_ACCEPTANCE === 'true'
  ) {
    throw new RefundConflictError(
      'Refund retry and ambiguous-create acceptance cannot run together.'
    );
  }
}

async function armRefundWebhookRetryAcceptance(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  refundId: string;
}): Promise<void> {
  if (!shouldArmRefundWebhookRetryAcceptance()) return;
  const { data, error } = await input.admin.rpc(
    'arm_razorpay_refund_retry_acceptance',
    {
      p_account_id: input.accountId,
      p_provider_mode: 'test',
      p_expected_refund_id: input.refundId,
      p_armed_by: input.userId,
      p_ttl_seconds: 600,
    }
  );
  if (error || !data) {
    throw new Error(
      `arm Razorpay refund retry acceptance: ${error?.message ?? 'no acceptance row returned'}`
    );
  }
}

export function canonicalRefundRequest(refund: LocalGatewayRefund): {
  body: string;
  sha256: string;
} {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(refund.id)) {
    throw new Error('UsefulDesk refund identity is not provider-safe');
  }
  const body = JSON.stringify({
    amount: toPaise(Number(refund.amount)),
    receipt: refund.id,
    notes: {
      usefuldesk_refund_id: refund.id,
      usefuldesk_payment_id: refund.payment_id,
      usefuldesk_invoice_id: refund.invoice_id,
    },
  });
  return {
    body,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

function refundBrowserShape(refund: LocalGatewayRefund, deduped: boolean) {
  return {
    id: refund.id,
    paymentId: refund.payment_id,
    invoiceId: refund.invoice_id,
    gatewayRefundId: refund.gateway_refund_id,
    amount: Number(refund.amount),
    currency: refund.currency,
    status: refund.status,
    disposition: refund.disposition,
    reason: refund.reason,
    deduped,
  };
}

async function requireInitialRefundScan(
  admin: SupabaseClient,
  accountId: string
): Promise<void> {
  const { data, error } = await admin
    .from('razorpay_reconciliation_state')
    .select('initial_scan_completed_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`load refund reconciliation: ${error.message}`);
  if (!data?.initial_scan_completed_at) {
    throw new RefundConflictError(
      'Razorpay refund history is still being reconciled. Try again after the recovery run completes.'
    );
  }
}

function remoteMatchesLocal(
  refund: LocalGatewayRefund,
  remoteRefund: RazorpayRefund,
  remotePayment: RazorpayPayment
): boolean {
  return (
    remoteRefund.payment_id === remotePayment.id &&
    remotePayment.id.length > 0 &&
    remoteRefund.amount === toPaise(Number(refund.amount)) &&
    remoteRefund.currency === refund.currency &&
    remoteRefund.receipt === refund.id &&
    remoteRefund.notes?.usefuldesk_refund_id === refund.id &&
    remoteRefund.notes?.usefuldesk_payment_id === refund.payment_id &&
    remoteRefund.notes?.usefuldesk_invoice_id === refund.invoice_id
  );
}

function providerFacts(refund: RazorpayRefund, payment: RazorpayPayment) {
  return {
    refund_id: refund.id,
    payment_id: payment.id,
    refund_status: refund.status,
    payment_status: payment.status,
    payment_captured: payment.captured ?? null,
    payment_amount: payment.amount,
    payment_amount_refunded: payment.amount_refunded ?? null,
    receipt: refund.receipt ?? null,
    speed_requested: refund.speed_requested ?? null,
    speed_processed: refund.speed_processed ?? null,
  };
}

async function finalizeLocalRefund(input: {
  admin: SupabaseClient;
  local: LocalGatewayRefund;
  remoteRefund: RazorpayRefund;
  remotePayment: RazorpayPayment;
}) {
  if (
    !remoteMatchesLocal(input.local, input.remoteRefund, input.remotePayment)
  ) {
    throw new Error('Fetched Razorpay refund does not match its local intent');
  }
  const { data, error } = await input.admin.rpc('finalize_gateway_refund', {
    p_account_id: input.local.account_id,
    p_refund_id: input.local.id,
    p_gateway_refund_id: input.remoteRefund.id,
    p_provider_status: input.remoteRefund.status,
    p_payment_gateway_id: input.remotePayment.id,
    p_amount: toRupees(input.remoteRefund.amount),
    p_currency: input.remoteRefund.currency,
    p_provider_created_at: new Date(
      input.remoteRefund.created_at * 1000
    ).toISOString(),
    p_provider_facts: providerFacts(input.remoteRefund, input.remotePayment),
    p_provider_error:
      input.remoteRefund.status === 'failed'
        ? 'Razorpay marked the refund failed'
        : null,
  });
  if (error) throw new Error(`finalize gateway refund: ${error.message}`);
  return data;
}

async function localPaymentByGatewayId(
  admin: SupabaseClient,
  accountId: string,
  gatewayPaymentId: string
): Promise<LocalGatewayPayment | null> {
  const { data, error } = await admin
    .from('payments')
    .select(
      'id, account_id, invoice_id, gateway_payment_id, amount, status, source, paid_at'
    )
    .eq('account_id', accountId)
    .eq('gateway_payment_id', gatewayPaymentId)
    .maybeSingle();
  if (error) throw new Error(`load gateway payment: ${error.message}`);
  return (data as LocalGatewayPayment | null) ?? null;
}

async function localRefundForRemote(
  admin: SupabaseClient,
  accountId: string,
  remote: RazorpayRefund
): Promise<LocalGatewayRefund | null> {
  const { data: byGateway, error: gatewayError } = await admin
    .from('payment_refunds')
    .select('*')
    .eq('account_id', accountId)
    .eq('gateway_refund_id', remote.id)
    .maybeSingle();
  if (gatewayError)
    throw new Error(`load gateway refund: ${gatewayError.message}`);
  if (byGateway) return byGateway as LocalGatewayRefund;

  const reference =
    remote.receipt ?? remote.notes?.usefuldesk_refund_id ?? null;
  if (!isUsefulDeskRefundId(reference)) return null;
  const { data: byReference, error: referenceError } = await admin
    .from('payment_refunds')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', reference)
    .maybeSingle();
  if (referenceError)
    throw new Error(`load refund by receipt: ${referenceError.message}`);
  return (byReference as LocalGatewayRefund | null) ?? null;
}

export async function finalizeOrImportVerifiedRefund(input: {
  admin: SupabaseClient;
  accountId: string;
  remoteRefund: RazorpayRefund;
  remotePayment?: RazorpayPayment;
}) {
  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) throw new Error('Razorpay connection is unavailable');
  const [refund, payment] = await Promise.all([
    runRazorpayOperation(input.admin, connection, (authentication) =>
      fetchRefund(authentication, input.remoteRefund.id)
    ),
    input.remotePayment
      ? Promise.resolve(input.remotePayment)
      : runRazorpayOperation(input.admin, connection, (authentication) =>
          fetchPayment(authentication, input.remoteRefund.payment_id)
        ),
  ]);
  if (
    refund.id !== input.remoteRefund.id ||
    refund.payment_id !== payment.id ||
    refund.amount <= 0 ||
    refund.amount > payment.amount ||
    refund.currency !== payment.currency
  ) {
    throw new Error('Razorpay refund and parent payment facts do not match');
  }

  const localRefund = await localRefundForRemote(
    input.admin,
    input.accountId,
    refund
  );
  if (localRefund) {
    await finalizeLocalRefund({
      admin: input.admin,
      local: localRefund,
      remoteRefund: refund,
      remotePayment: payment,
    });
    return { outcome: 'finalized' as const, refundId: localRefund.id };
  }

  const localPayment = await localPaymentByGatewayId(
    input.admin,
    input.accountId,
    payment.id
  );
  if (!localPayment) return { outcome: 'unrelated' as const };
  if (refund.status === 'failed') {
    const { error } = await input.admin.rpc('record_gateway_refund_exception', {
      p_account_id: input.accountId,
      p_payment_id: localPayment.id,
      p_gateway_refund_id: refund.id,
      p_reason_code: 'external_refund_failed',
      p_reason_message: 'Razorpay reported an unmatched failed refund.',
      p_provider_facts: providerFacts(refund, payment),
    });
    if (error) throw new Error(`record refund exception: ${error.message}`);
    return { outcome: 'failed_exception' as const };
  }
  if (refund.status !== 'processed') {
    return { outcome: 'pending_external' as const };
  }
  const { data, error } = await input.admin.rpc('import_gateway_refund', {
    p_account_id: input.accountId,
    p_payment_id: localPayment.id,
    p_gateway_refund_id: refund.id,
    p_amount: toRupees(refund.amount),
    p_currency: refund.currency,
    p_provider_status: refund.status,
    p_provider_created_at: new Date(refund.created_at * 1000).toISOString(),
    p_provider_facts: providerFacts(refund, payment),
  });
  if (error) throw new Error(`import gateway refund: ${error.message}`);
  return { outcome: 'imported' as const, result: data };
}

async function allPaymentRefunds(input: {
  admin: SupabaseClient;
  accountId: string;
  gatewayPaymentId: string;
}): Promise<RazorpayRefund[]> {
  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) throw new Error('Razorpay connection is unavailable');
  const found: RazorpayRefund[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        listPaymentRefunds({
          creds: authentication,
          paymentId: input.gatewayPaymentId,
          count: 100,
          skip,
        })
    );
    found.push(...page);
    if (page.length < 100) return found;
  }
}

function findRemoteForLocal(
  local: LocalGatewayRefund,
  refunds: RazorpayRefund[]
): RazorpayRefund | null {
  const matches = refunds.filter(
    (refund) =>
      refund.id === local.gateway_refund_id ||
      refund.receipt === local.id ||
      refund.notes?.usefuldesk_refund_id === local.id
  );
  if (matches.length > 1) {
    throw new Error('More than one Razorpay refund matches the local receipt');
  }
  return matches[0] ?? null;
}

async function deferRefund(
  admin: SupabaseClient,
  local: LocalGatewayRefund,
  owner: string,
  error: unknown
) {
  const { error: deferError } = await admin.rpc(
    'defer_gateway_refund_recovery',
    {
      p_account_id: local.account_id,
      p_refund_id: local.id,
      p_recovery_owner: owner,
      p_error: boundedRazorpayError(error),
    }
  );
  if (deferError)
    throw new Error(`defer gateway refund: ${deferError.message}`);
}

async function definitiveFailure(
  admin: SupabaseClient,
  local: LocalGatewayRefund,
  owner: string,
  error: unknown
) {
  const { error: failError } = await admin.rpc('fail_gateway_refund_request', {
    p_account_id: local.account_id,
    p_refund_id: local.id,
    p_outbound_owner: owner,
    p_error: boundedRazorpayError(error),
  });
  if (failError) throw new Error(`fail gateway refund: ${failError.message}`);
}

async function persistCanonicalRequest(input: {
  admin: SupabaseClient;
  local: LocalGatewayRefund;
  owner: string;
}) {
  const canonical = canonicalRefundRequest(input.local);
  if (
    input.local.canonical_request_body &&
    (input.local.canonical_request_body !== canonical.body ||
      input.local.canonical_request_sha256 !== canonical.sha256)
  ) {
    throw new Error('Stored canonical refund bytes do not match the intent');
  }
  const { data, error } = await input.admin.rpc(
    'store_gateway_refund_request',
    {
      p_account_id: input.local.account_id,
      p_refund_id: input.local.id,
      p_outbound_owner: input.owner,
      p_provider_idempotency_key: input.local.id,
      p_canonical_body: input.local.canonical_request_body ?? canonical.body,
      p_body_sha256: input.local.canonical_request_sha256 ?? canonical.sha256,
    }
  );
  if (error)
    throw new Error(`store canonical refund request: ${error.message}`);
  return data as LocalGatewayRefund;
}

async function sendAndFinalize(input: {
  admin: SupabaseClient;
  local: LocalGatewayRefund;
  owner: string;
  gatewayPaymentId: string;
}) {
  const stored = await persistCanonicalRequest(input);
  const connection = await getRazorpayConnection(
    input.admin,
    stored.account_id
  );
  if (!connection) throw new Error('Razorpay connection is unavailable');
  try {
    const created = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        createRefund({
          creds: authentication,
          paymentId: input.gatewayPaymentId,
          idempotencyKey: stored.id,
          canonicalBody: stored.canonical_request_body!,
        })
    );
    if (shouldSimulateAmbiguousRefundCreate(stored)) {
      console.info(
        '[Razorpay refund acceptance] simulating an ambiguous create response',
        { refundId: stored.id, gatewayRefundId: created.id }
      );
      throw new Error('Test-only simulated ambiguous refund create response');
    }
    const [verifiedRefund, verifiedPayment] = await Promise.all([
      runRazorpayOperation(input.admin, connection, (authentication) =>
        fetchRefund(authentication, created.id)
      ),
      runRazorpayOperation(input.admin, connection, (authentication) =>
        fetchPayment(authentication, input.gatewayPaymentId)
      ),
    ]);
    await finalizeLocalRefund({
      admin: input.admin,
      local: stored,
      remoteRefund: verifiedRefund,
      remotePayment: verifiedPayment,
    });
    return verifiedRefund.status;
  } catch (error) {
    try {
      const refunds = await allPaymentRefunds({
        admin: input.admin,
        accountId: stored.account_id,
        gatewayPaymentId: input.gatewayPaymentId,
      });
      const adopted = findRemoteForLocal(stored, refunds);
      if (adopted) {
        const payment = await runRazorpayOperation(
          input.admin,
          connection,
          (authentication) =>
            fetchPayment(authentication, input.gatewayPaymentId)
        );
        await finalizeLocalRefund({
          admin: input.admin,
          local: stored,
          remoteRefund: adopted,
          remotePayment: payment,
        });
        return adopted.status;
      }
    } catch (recoveryError) {
      await deferRefund(input.admin, stored, input.owner, recoveryError);
      throw recoveryError;
    }
    if (
      error instanceof RazorpayError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      await definitiveFailure(input.admin, stored, input.owner, error);
    } else {
      await deferRefund(input.admin, stored, input.owner, error);
    }
    throw error;
  }
}

export async function requestFullGatewayRefund(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  paymentId: string;
  disposition: RefundDisposition;
  reason: string;
  idempotencyKey: string;
}) {
  assertRefundRetryAcceptanceConfiguration();
  await requireInitialRefundScan(input.admin, input.accountId);
  const connection = await getRazorpayConnection(input.admin, input.accountId);
  if (!connection) throw new RefundConflictError('Razorpay is not connected');
  const owner = randomUUID();
  const { data, error } = await input.admin.rpc('reserve_gateway_refund', {
    p_account_id: input.accountId,
    p_payment_id: input.paymentId,
    p_actor: input.userId,
    p_disposition: input.disposition,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_outbound_owner: owner,
    p_provider_mode: getRazorpayProviderMode(),
  });
  if (error) throw new RefundConflictError(error.message);
  const reservation = data as RefundReservation;
  if (!reservation?.refund)
    throw new Error('Refund reservation returned no row');
  if (reservation.outcome === 'reused') {
    if (reservation.refund.status === 'failed') {
      throw new RefundConflictError(
        'The previous provider request failed. Close and reopen the refund dialog to create a new attempt.'
      );
    }
    return refundBrowserShape(reservation.refund, true);
  }

  const { data: payment, error: paymentError } = await input.admin
    .from('payments')
    .select('gateway_payment_id')
    .eq('id', input.paymentId)
    .eq('account_id', input.accountId)
    .single();
  if (paymentError || !payment?.gateway_payment_id) {
    await definitiveFailure(
      input.admin,
      reservation.refund,
      owner,
      paymentError ?? new Error('Gateway payment identity is missing')
    );
    throw new Error('Gateway payment identity is missing');
  }
  try {
    await armRefundWebhookRetryAcceptance({
      admin: input.admin,
      accountId: input.accountId,
      userId: input.userId,
      refundId: reservation.refund.id,
    });
  } catch (acceptanceError) {
    await definitiveFailure(
      input.admin,
      reservation.refund,
      owner,
      acceptanceError
    );
    throw acceptanceError;
  }
  await sendAndFinalize({
    admin: input.admin,
    local: reservation.refund,
    owner,
    gatewayPaymentId: payment.gateway_payment_id,
  });
  const { data: finalized, error: finalizedError } = await input.admin
    .from('payment_refunds')
    .select('*')
    .eq('id', reservation.refund.id)
    .single();
  if (finalizedError || !finalized)
    throw new Error('Finalized refund could not be loaded');
  return refundBrowserShape(finalized as LocalGatewayRefund, false);
}

export async function classifyImportedGatewayRefund(input: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  refundId: string;
  disposition: RefundDisposition;
  reason: string;
  allocations?: RefundLineAllocationInput[];
}) {
  await requireInitialRefundScan(input.admin, input.accountId);
  const partial = Boolean(input.allocations?.length);
  const { data, error } = await input.admin.rpc(
    partial ? 'resolve_gateway_partial_refund' : 'classify_gateway_refund',
    {
      p_account_id: input.accountId,
      p_refund_id: input.refundId,
      p_actor: input.userId,
      p_disposition: input.disposition,
      p_reason: input.reason,
      ...(partial
        ? {
            p_allocations: input.allocations!.map((allocation) => ({
              invoice_line_id: allocation.invoiceLineId,
              amount: allocation.amount,
            })),
          }
        : {}),
    }
  );
  if (error) throw new RefundConflictError(error.message);
  return data;
}

export async function recoverClaimedGatewayRefund(input: {
  admin: SupabaseClient;
  refund: LocalGatewayRefund;
  recoveryOwner: string;
}) {
  const { data: payment, error } = await input.admin
    .from('payments')
    .select('gateway_payment_id')
    .eq('id', input.refund.payment_id)
    .eq('account_id', input.refund.account_id)
    .single();
  if (error || !payment?.gateway_payment_id)
    throw new Error('Refund recovery payment is missing');
  const refunds = await allPaymentRefunds({
    admin: input.admin,
    accountId: input.refund.account_id,
    gatewayPaymentId: payment.gateway_payment_id,
  });
  const remote = findRemoteForLocal(input.refund, refunds);
  if (remote) {
    const connection = await getRazorpayConnection(
      input.admin,
      input.refund.account_id
    );
    if (!connection) throw new Error('Razorpay connection is unavailable');
    const parent = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        fetchPayment(authentication, payment.gateway_payment_id)
    );
    await finalizeLocalRefund({
      admin: input.admin,
      local: input.refund,
      remoteRefund: remote,
      remotePayment: parent,
    });
    return 'adopted';
  }
  return sendAndFinalize({
    admin: input.admin,
    local: input.refund,
    owner: input.recoveryOwner,
    gatewayPaymentId: payment.gateway_payment_id,
  });
}

export async function initializeRefundReconciliation(input: {
  admin: SupabaseClient;
  providerMode: RazorpayProviderMode;
}) {
  const { data, error } = await input.admin
    .from('account_payment_credentials')
    .select('account_id')
    .eq('gateway', 'razorpay')
    .eq('authentication_mode', 'oauth')
    .eq('provider_mode', input.providerMode)
    .eq('connection_status', 'ready');
  if (error) throw new Error(`load refund merchants: ${error.message}`);
  for (const row of data ?? []) {
    const { error: initializeError } = await input.admin.rpc(
      'initialize_razorpay_refund_reconciliation',
      { p_account_id: row.account_id, p_provider_mode: input.providerMode }
    );
    if (initializeError)
      throw new Error(
        `initialize refund reconciliation: ${initializeError.message}`
      );
  }
  return data?.length ?? 0;
}

async function mapWithConcurrencyFive<T>(
  values: T[],
  task: (value: T) => Promise<void>
) {
  for (let index = 0; index < values.length; index += 5) {
    await Promise.all(values.slice(index, index + 5).map(task));
  }
}

export async function reconcileClaimedRefundWindow(input: {
  admin: SupabaseClient;
  providerMode: RazorpayProviderMode;
  recoveryOwner: string;
}) {
  const { data, error } = await input.admin.rpc(
    'claim_razorpay_refund_reconciliation',
    {
      p_provider_mode: input.providerMode,
      p_recovery_owner: input.recoveryOwner,
      p_lease_seconds: 300,
    }
  );
  if (error) throw new Error(`claim refund reconciliation: ${error.message}`);
  const state = data as ReconciliationState | null;
  // PostgREST serializes a NULL composite return as an object whose fields are
  // all null. That is the RPC's no-work result, not a claimed account.
  if (!state?.account_id) return { claimed: 0, scanned: 0, unrelated: 0 };
  try {
    const connection = await getRazorpayConnection(
      input.admin,
      state.account_id
    );
    if (!connection) throw new Error('Razorpay connection is unavailable');
    const page = await runRazorpayOperation(
      input.admin,
      connection,
      (authentication) =>
        listRefunds({
          creds: authentication,
          from: Math.floor(new Date(state.refund_window_from).getTime() / 1000),
          to: Math.floor(new Date(state.refund_window_to).getTime() / 1000),
          count: REFUND_PAGE_SIZE,
          skip: state.refund_skip,
        })
    );
    let unrelated = 0;
    await mapWithConcurrencyFive(page, async (refund) => {
      const localPayment = await localPaymentByGatewayId(
        input.admin,
        state.account_id,
        refund.payment_id
      );
      if (!localPayment) {
        unrelated += 1;
        return;
      }
      await finalizeOrImportVerifiedRefund({
        admin: input.admin,
        accountId: state.account_id,
        remoteRefund: refund,
      });
    });
    const { error: advanceError } = await input.admin.rpc(
      'advance_razorpay_refund_reconciliation',
      {
        p_account_id: state.account_id,
        p_recovery_owner: input.recoveryOwner,
        p_window_from: state.refund_window_from,
        p_window_to: state.refund_window_to,
        p_expected_skip: state.refund_skip,
        p_page_count: page.length,
        p_unrelated_count: unrelated,
      }
    );
    if (advanceError)
      throw new Error(`advance refund reconciliation: ${advanceError.message}`);
    return { claimed: 1, scanned: page.length, unrelated };
  } catch (caught) {
    const { error: failError } = await input.admin.rpc(
      'fail_razorpay_refund_reconciliation',
      {
        p_account_id: state.account_id,
        p_recovery_owner: input.recoveryOwner,
        p_error: boundedRazorpayError(caught),
      }
    );
    if (failError) {
      throw new Error(
        `${boundedRazorpayError(caught)}; release reconciliation lease: ${failError.message}`
      );
    }
    throw caught;
  }
}
