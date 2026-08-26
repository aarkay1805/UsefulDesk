import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isRazorpayOAuthEnabled,
  RAZORPAY_OAUTH_REFRESH_WINDOW_MS,
  RAZORPAY_READINESS_FRESHNESS_MS,
  type RazorpayProviderMode,
} from './razorpay-config';
import { boundedRazorpayError } from './razorpay-oauth';
import { verifyStoredRazorpayOAuthReadiness } from './credentials';
import { refreshStoredRazorpayOAuthConnection } from './razorpay-refresh';
import {
  parseRazorpayEvent,
  processClaimedRazorpayWebhook,
  type RazorpayEvent,
} from './razorpay-webhook-processor';
import {
  recoverClaimedPaymentLink,
  type LocalPaymentLink,
} from './razorpay-payment-links';
import {
  initializeRefundReconciliation,
  reconcileClaimedRefundWindow,
  recoverClaimedGatewayRefund,
  type LocalGatewayRefund,
} from './razorpay-refunds';
import {
  reconcileClaimedSubscriptionSource,
  type LocalMandateReconciliationRow,
} from './razorpay-subscription-reconciliation';

const RECOVERY_BATCH_LIMIT = 100;
const SUBSCRIPTION_RECONCILIATION_BATCH_LIMIT = 20;
const RECOVERY_LEASE_SECONDS = 300;

interface RecoveryEventRow {
  event_id: string;
  account_id: string | null;
  payload: unknown;
  created_at: string;
}

interface RefreshScanRow {
  account_id: string;
  oauth_access_expires_at: string;
  merchant_status?: string;
  activation_verified_at?: string | null;
}

interface GatewayChargeExceptionRecoveryRow {
  id: string;
  first_seen_at: string;
}

interface RecoveryDependencies {
  now(): Date;
  owner(): string;
  oauthEnabled(): boolean;
  refundsEnabled(): boolean;
  processClaimed(input: {
    admin: SupabaseClient;
    accountId: string | null;
    eventId: string;
    processingOwner: string;
    event: RazorpayEvent;
    ingress: 'application';
  }): Promise<{ outcome: string }>;
  refreshConnection(input: {
    admin: SupabaseClient;
    accountId: string;
  }): Promise<unknown>;
  verifyReadiness(input: {
    admin: SupabaseClient;
    accountId: string;
  }): Promise<unknown>;
  recoverPaymentLink(input: {
    admin: SupabaseClient;
    link: LocalPaymentLink;
    recoveryOwner: string;
  }): Promise<string>;
  initializeRefunds(input: {
    admin: SupabaseClient;
    providerMode: RazorpayProviderMode;
  }): Promise<number>;
  recoverRefund(input: {
    admin: SupabaseClient;
    refund: LocalGatewayRefund;
    recoveryOwner: string;
  }): Promise<string>;
  reconcileRefunds(input: {
    admin: SupabaseClient;
    providerMode: RazorpayProviderMode;
    recoveryOwner: string;
  }): Promise<{ claimed: number; scanned: number; unrelated: number }>;
  reconcileSubscriptionSource(input: {
    admin: SupabaseClient;
    mandate: LocalMandateReconciliationRow;
  }): Promise<{
    providerPaidCount: number;
    localPaidCount: number;
    observed: number;
  }>;
}

export interface RazorpayRecoveryResult {
  webhooks: {
    claimed: number;
    processed: number;
    failed: number;
    oldestAgeSeconds: number | null;
  };
  chargeExceptions: {
    claimed: number;
    applied: number;
    deferred: number;
    failed: number;
    oldestAgeSeconds: number | null;
  };
  subscriptionReconciliation: {
    claimed: number;
    scanned: number;
    observations: number;
    failed: number;
    oldestAgeSeconds: number | null;
  };
  tokens: {
    disabled: boolean;
    claimed: number;
    refreshed: number;
    readinessVerified: number;
    skippedNotDue: number;
    failed: number;
  };
  paymentLinks: {
    claimed: number;
    reconciled: number;
    failed: number;
    oldestAgeSeconds: number | null;
  };
  refunds: {
    disabled: boolean;
    claimed: number;
    reconciled: number;
    failed: number;
    oldestAgeSeconds: number | null;
  };
  refundReconciliation: {
    disabled: boolean;
    initializedAccounts: number;
    claimed: number;
    scanned: number;
    unrelated: number;
    failed: number;
  };
  notes: string[];
}

export async function runRazorpayRecovery(input: {
  admin: SupabaseClient;
  providerMode: RazorpayProviderMode;
  dependencies?: Partial<RecoveryDependencies>;
}): Promise<RazorpayRecoveryResult> {
  const dependencies: RecoveryDependencies = {
    now: () => new Date(),
    owner: () => randomUUID(),
    oauthEnabled: () => isRazorpayOAuthEnabled(),
    refundsEnabled: () => isRazorpayOAuthEnabled(),
    processClaimed: processClaimedRazorpayWebhook,
    refreshConnection: refreshStoredRazorpayOAuthConnection,
    verifyReadiness: verifyStoredRazorpayOAuthReadiness,
    recoverPaymentLink: recoverClaimedPaymentLink,
    initializeRefunds: initializeRefundReconciliation,
    recoverRefund: recoverClaimedGatewayRefund,
    reconcileRefunds: reconcileClaimedRefundWindow,
    reconcileSubscriptionSource: reconcileClaimedSubscriptionSource,
    ...input.dependencies,
  };
  const result: RazorpayRecoveryResult = {
    webhooks: { claimed: 0, processed: 0, failed: 0, oldestAgeSeconds: null },
    chargeExceptions: {
      claimed: 0,
      applied: 0,
      deferred: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    subscriptionReconciliation: {
      claimed: 0,
      scanned: 0,
      observations: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    tokens: {
      disabled: !dependencies.oauthEnabled(),
      claimed: 0,
      refreshed: 0,
      readinessVerified: 0,
      skippedNotDue: 0,
      failed: 0,
    },
    paymentLinks: {
      claimed: 0,
      reconciled: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    refunds: {
      disabled: !dependencies.refundsEnabled(),
      claimed: 0,
      reconciled: 0,
      failed: 0,
      oldestAgeSeconds: null,
    },
    refundReconciliation: {
      disabled: !dependencies.refundsEnabled(),
      initializedAccounts: 0,
      claimed: 0,
      scanned: 0,
      unrelated: 0,
      failed: 0,
    },
    notes: [],
  };

  const webhookOwner = dependencies.owner();
  const { data: webhookRows, error: webhookError } = await input.admin.rpc(
    'claim_razorpay_webhook_recovery_batch',
    {
      p_provider_mode: input.providerMode,
      p_processing_owner: webhookOwner,
      p_limit: RECOVERY_BATCH_LIMIT,
      p_lease_seconds: RECOVERY_LEASE_SECONDS,
    }
  );
  if (webhookError) {
    throw new Error(`claim Razorpay webhook recovery: ${webhookError.message}`);
  }

  const events = (
    Array.isArray(webhookRows) ? webhookRows : []
  ) as RecoveryEventRow[];
  result.webhooks.claimed = events.length;
  if (events.length) {
    const oldest = Math.min(
      ...events.map((row) => new Date(row.created_at).getTime())
    );
    result.webhooks.oldestAgeSeconds = Math.max(
      0,
      Math.floor((dependencies.now().getTime() - oldest) / 1000)
    );
  }

  for (const row of events) {
    try {
      const event = parseStoredEvent(row.payload);
      const outcome = await dependencies.processClaimed({
        admin: input.admin,
        accountId: row.account_id,
        eventId: row.event_id,
        processingOwner: webhookOwner,
        event,
        ingress: 'application',
      });
      if (outcome.outcome === 'processed') result.webhooks.processed += 1;
      else result.webhooks.failed += 1;
    } catch (error) {
      result.webhooks.failed += 1;
      const errorText = boundedRazorpayError(error);
      result.notes.push(`webhook:${row.event_id}:${errorText}`);
      const { error: failError } = await input.admin.rpc(
        'fail_razorpay_canonical_webhook_event',
        {
          p_event_id: row.event_id,
          p_account_id: row.account_id,
          p_processing_owner: webhookOwner,
          p_error: errorText,
        }
      );
      if (failError) {
        result.notes.push(`webhook:${row.event_id}:fail:${failError.message}`);
      }
    }
  }

  const chargeExceptionOwner = dependencies.owner();
  const { data: chargeExceptionRows, error: chargeExceptionError } =
    await input.admin.rpc('claim_gateway_charge_exception_recovery_batch', {
      p_provider_mode: input.providerMode,
      p_recovery_owner: chargeExceptionOwner,
      p_limit: RECOVERY_BATCH_LIMIT,
      p_lease_seconds: RECOVERY_LEASE_SECONDS,
    });
  if (chargeExceptionError) {
    throw new Error(
      `claim Razorpay charge exception recovery: ${chargeExceptionError.message}`
    );
  }
  const chargeExceptions = (
    Array.isArray(chargeExceptionRows) ? chargeExceptionRows : []
  ) as GatewayChargeExceptionRecoveryRow[];
  result.chargeExceptions.claimed = chargeExceptions.length;
  if (chargeExceptions.length) {
    const oldest = Math.min(
      ...chargeExceptions.map((row) => new Date(row.first_seen_at).getTime())
    );
    result.chargeExceptions.oldestAgeSeconds = Math.max(
      0,
      Math.floor((dependencies.now().getTime() - oldest) / 1000)
    );
  }
  for (const exception of chargeExceptions) {
    try {
      const { data: outcome, error } = await input.admin.rpc(
        'recover_gateway_charge_exception',
        {
          p_exception_id: exception.id,
          p_recovery_owner: chargeExceptionOwner,
        }
      );
      if (error) throw new Error(error.message);
      if (outcome === 'applied') result.chargeExceptions.applied += 1;
      else result.chargeExceptions.deferred += 1;
    } catch (error) {
      result.chargeExceptions.failed += 1;
      const errorText = boundedRazorpayError(error);
      result.notes.push(`charge-exception:${exception.id}:${errorText}`);
      const { error: failError } = await input.admin.rpc(
        'fail_gateway_charge_exception_recovery',
        {
          p_exception_id: exception.id,
          p_recovery_owner: chargeExceptionOwner,
          p_error: errorText,
        }
      );
      if (failError) {
        result.notes.push(
          `charge-exception:${exception.id}:fail:${failError.message}`
        );
      }
    }
  }

  const subscriptionReconciliationOwner = dependencies.owner();
  const {
    data: subscriptionReconciliationRows,
    error: subscriptionReconciliationError,
  } = await input.admin.rpc(
    'claim_razorpay_subscription_reconciliation_batch',
    {
      p_provider_mode: input.providerMode,
      p_recovery_owner: subscriptionReconciliationOwner,
      p_limit: SUBSCRIPTION_RECONCILIATION_BATCH_LIMIT,
      p_lease_seconds: RECOVERY_LEASE_SECONDS,
    }
  );
  if (subscriptionReconciliationError) {
    throw new Error(
      `claim Razorpay subscription reconciliation: ${subscriptionReconciliationError.message}`
    );
  }
  const mandates = (
    Array.isArray(subscriptionReconciliationRows)
      ? subscriptionReconciliationRows
      : []
  ) as LocalMandateReconciliationRow[];
  result.subscriptionReconciliation.claimed = mandates.length;
  if (mandates.length) {
    const oldest = Math.min(
      ...mandates.map((mandate) =>
        new Date(mandate.provider_reconcile_at ?? new Date()).getTime()
      )
    );
    result.subscriptionReconciliation.oldestAgeSeconds = Math.max(
      0,
      Math.floor((dependencies.now().getTime() - oldest) / 1000)
    );
  }
  for (const mandate of mandates) {
    let errorText: string | null = null;
    try {
      const scan = await dependencies.reconcileSubscriptionSource({
        admin: input.admin,
        mandate,
      });
      result.subscriptionReconciliation.scanned += 1;
      result.subscriptionReconciliation.observations += scan.observed;
    } catch (error) {
      errorText = boundedRazorpayError(error);
      result.subscriptionReconciliation.failed += 1;
      result.notes.push(
        `subscription-reconciliation:${mandate.id}:${errorText}`
      );
    }

    const { data: finished, error: finishError } = await input.admin.rpc(
      'finish_razorpay_subscription_reconciliation',
      {
        p_mandate_id: mandate.id,
        p_recovery_owner: subscriptionReconciliationOwner,
        p_error: errorText,
      }
    );
    if (finishError || finished !== true) {
      result.subscriptionReconciliation.failed += errorText ? 0 : 1;
      result.notes.push(
        `subscription-reconciliation:${mandate.id}:finish:${finishError?.message ?? 'lease was not updated'}`
      );
    }
  }

  const linkOwner = dependencies.owner();
  const { data: linkRows, error: linkError } = await input.admin.rpc(
    'claim_razorpay_payment_link_recovery_batch',
    {
      p_provider_mode: input.providerMode,
      p_recovery_owner: linkOwner,
      p_limit: RECOVERY_BATCH_LIMIT,
      p_lease_seconds: RECOVERY_LEASE_SECONDS,
    }
  );
  if (linkError) {
    throw new Error(
      `claim Razorpay Payment Link recovery: ${linkError.message}`
    );
  }
  const links = (Array.isArray(linkRows) ? linkRows : []) as LocalPaymentLink[];
  result.paymentLinks.claimed = links.length;
  if (links.length) {
    const oldest = Math.min(
      ...links.map((link) =>
        new Date(link.next_reconcile_at ?? new Date()).getTime()
      )
    );
    result.paymentLinks.oldestAgeSeconds = Math.max(
      0,
      Math.floor((dependencies.now().getTime() - oldest) / 1000)
    );
  }
  for (const link of links) {
    try {
      await dependencies.recoverPaymentLink({
        admin: input.admin,
        link,
        recoveryOwner: linkOwner,
      });
      result.paymentLinks.reconciled += 1;
    } catch (error) {
      result.paymentLinks.failed += 1;
      result.notes.push(
        `payment-link:${link.id}:${boundedRazorpayError(error)}`
      );
    }
  }

  if (!result.refunds.disabled) {
    try {
      result.refundReconciliation.initializedAccounts =
        await dependencies.initializeRefunds({
          admin: input.admin,
          providerMode: input.providerMode,
        });
    } catch (error) {
      result.refundReconciliation.failed += 1;
      result.notes.push(
        `refund-reconciliation:initialize:${boundedRazorpayError(error)}`
      );
    }

    const refundOwner = dependencies.owner();
    const { data: refundRows, error: refundError } = await input.admin.rpc(
      'claim_gateway_refund_recovery_batch',
      {
        p_provider_mode: input.providerMode,
        p_recovery_owner: refundOwner,
        p_limit: RECOVERY_BATCH_LIMIT,
        p_lease_seconds: RECOVERY_LEASE_SECONDS,
      }
    );
    if (refundError) {
      throw new Error(`claim gateway refund recovery: ${refundError.message}`);
    }
    const refunds = (
      Array.isArray(refundRows) ? refundRows : []
    ) as LocalGatewayRefund[];
    result.refunds.claimed = refunds.length;
    if (refunds.length) {
      const oldest = Math.min(
        ...refunds.map((refund) =>
          new Date(refund.next_reconcile_at ?? refund.created_at).getTime()
        )
      );
      result.refunds.oldestAgeSeconds = Math.max(
        0,
        Math.floor((dependencies.now().getTime() - oldest) / 1000)
      );
    }
    for (const refund of refunds) {
      try {
        await dependencies.recoverRefund({
          admin: input.admin,
          refund,
          recoveryOwner: refundOwner,
        });
        result.refunds.reconciled += 1;
      } catch (error) {
        result.refunds.failed += 1;
        result.notes.push(`refund:${refund.id}:${boundedRazorpayError(error)}`);
      }
    }

    try {
      const window = await dependencies.reconcileRefunds({
        admin: input.admin,
        providerMode: input.providerMode,
        recoveryOwner: dependencies.owner(),
      });
      result.refundReconciliation.claimed = window.claimed;
      result.refundReconciliation.scanned = window.scanned;
      result.refundReconciliation.unrelated = window.unrelated;
    } catch (error) {
      result.refundReconciliation.failed += 1;
      result.notes.push(`refund-reconciliation:${boundedRazorpayError(error)}`);
    }
  }

  if (result.tokens.disabled) return result;

  const tokenOwner = dependencies.owner();
  const { data: tokenRows, error: tokenError } = await input.admin.rpc(
    'claim_razorpay_oauth_refresh_scan_batch',
    {
      p_provider_mode: input.providerMode,
      p_lease_owner: tokenOwner,
      p_limit: RECOVERY_BATCH_LIMIT,
      p_lease_seconds: RECOVERY_LEASE_SECONDS,
    }
  );
  if (tokenError) {
    throw new Error(`claim Razorpay token scan: ${tokenError.message}`);
  }
  const scans = (Array.isArray(tokenRows) ? tokenRows : []) as RefreshScanRow[];
  result.tokens.claimed = scans.length;

  for (const row of scans) {
    let errorText: string | null = null;
    try {
      const expiry = new Date(row.oauth_access_expires_at);
      if (!Number.isFinite(expiry.getTime())) {
        throw new Error('Razorpay OAuth access expiry is invalid');
      }
      if (
        expiry.getTime() - dependencies.now().getTime() <=
        RAZORPAY_OAUTH_REFRESH_WINDOW_MS
      ) {
        await dependencies.refreshConnection({
          admin: input.admin,
          accountId: row.account_id,
        });
        result.tokens.refreshed += 1;
      } else {
        result.tokens.skippedNotDue += 1;
      }
      if (readinessNeedsVerification(row, dependencies.now())) {
        await dependencies.verifyReadiness({
          admin: input.admin,
          accountId: row.account_id,
        });
        result.tokens.readinessVerified += 1;
      }
    } catch (error) {
      errorText = boundedRazorpayError(error);
      result.tokens.failed += 1;
      result.notes.push(`token:${row.account_id}:${errorText}`);
    }

    const { data: finished, error: finishError } = await input.admin.rpc(
      'finish_razorpay_oauth_refresh_scan',
      {
        p_account_id: row.account_id,
        p_lease_owner: tokenOwner,
        p_error: errorText,
      }
    );
    if (finishError || finished !== true) {
      result.tokens.failed += errorText ? 0 : 1;
      result.notes.push(
        `token:${row.account_id}:finish:${finishError?.message ?? 'lease was not updated'}`
      );
    }
  }

  return result;
}

function readinessNeedsVerification(row: RefreshScanRow, now: Date): boolean {
  if (row.merchant_status !== 'unknown') return false;
  if (!row.activation_verified_at) return true;
  const verifiedAt = new Date(row.activation_verified_at).getTime();
  return (
    !Number.isFinite(verifiedAt) ||
    now.getTime() - verifiedAt > RAZORPAY_READINESS_FRESHNESS_MS
  );
}

function parseStoredEvent(payload: unknown): RazorpayEvent {
  return parseRazorpayEvent(JSON.stringify(payload));
}
