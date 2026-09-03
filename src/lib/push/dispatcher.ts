import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  backoffMs,
  createExpoPushTransport,
  type ClaimedPushDelivery,
  type ClaimedPushReceipt,
  type ExpoPushOutcome,
  type ExpoPushTransport,
} from './expo-protocol';

const LEASE_SECONDS = 120;
const DEFAULT_CLAIM_LIMIT = 20;
const RECEIPT_LIMIT = 1000;
const MAX_SEND_ATTEMPTS = 8;
const RECEIPT_RETRY_MS = 15 * 60_000;

export interface PushDrainCounts {
  claimed: number;
  ticketed: number;
  delivered: number;
  retried: number;
  failed: number;
  cancelled: number;
  installationsRetired: number;
}

interface DrainDependencies {
  admin: Pick<SupabaseClient, 'rpc'>;
  transport?: ExpoPushTransport;
  workerId?: string;
  claimLimit?: number;
  now?: () => Date;
  random?: () => number;
}

type DbRow = Record<string, unknown>;

function cancelledCount(rows: DbRow[]): number {
  return rows.reduce((largest, row) => {
    const value = row.cancelled_count;
    return typeof value === 'number' &&
      Number.isInteger(value) &&
      value > largest
      ? value
      : largest;
  }, 0);
}

function claimedReceipts(rows: DbRow[]): ClaimedPushReceipt[] {
  return rows.flatMap((row) =>
    typeof row.delivery_id === 'string' &&
    typeof row.expo_ticket_id === 'string' &&
    typeof row.attempt_count === 'number'
      ? [
          {
            deliveryId: row.delivery_id,
            ticketId: row.expo_ticket_id,
            attemptCount: row.attempt_count,
          },
        ]
      : []
  );
}

function claimedDeliveries(rows: DbRow[]): ClaimedPushDelivery[] {
  return rows.flatMap((row) =>
    typeof row.delivery_id === 'string' &&
    typeof row.expo_push_token === 'string' &&
    typeof row.title === 'string' &&
    typeof row.body === 'string' &&
    typeof row.payload === 'object' &&
    row.payload !== null &&
    typeof row.attempt_count === 'number'
      ? [
          {
            deliveryId: row.delivery_id,
            expoPushToken: row.expo_push_token,
            title: row.title,
            body: row.body,
            payload: row.payload as ClaimedPushDelivery['payload'],
            attemptCount: row.attempt_count,
          },
        ]
      : []
  );
}

function at(now: Date, delayMs: number): string {
  return new Date(now.getTime() + delayMs).toISOString();
}

async function settle(
  admin: Pick<SupabaseClient, 'rpc'>,
  input: {
    deliveryId: string;
    workerId: string;
    outcome: 'ticketed' | 'delivered' | 'retry' | 'failed' | 'cancelled';
    ticketId?: string;
    errorCode?: string;
    nextAttemptAt?: string;
    retireInstallation?: boolean;
  }
): Promise<void> {
  const { data, error } = await admin.rpc('settle_push_delivery', {
    p_delivery_id: input.deliveryId,
    p_worker_id: input.workerId,
    p_outcome: input.outcome,
    p_ticket_id: input.ticketId ?? null,
    p_error_code: input.errorCode ?? null,
    p_next_attempt_at: input.nextAttemptAt ?? null,
    p_retire_installation: input.retireInstallation ?? false,
  });
  if (error || data !== true)
    throw new Error('Push delivery settlement failed');
}

function outcomeById(
  outcomes: ExpoPushOutcome[]
): Map<string, ExpoPushOutcome> {
  return new Map(outcomes.map((outcome) => [outcome.deliveryId, outcome]));
}

export async function drainPushDeliveries({
  admin,
  transport = createExpoPushTransport(),
  workerId = randomUUID(),
  claimLimit = DEFAULT_CLAIM_LIMIT,
  now = () => new Date(),
  random = Math.random,
}: DrainDependencies): Promise<PushDrainCounts> {
  const counts: PushDrainCounts = {
    claimed: 0,
    ticketed: 0,
    delivered: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    installationsRetired: 0,
  };

  const receiptClaim = await admin.rpc('claim_push_receipts', {
    p_worker_id: workerId,
    p_limit: RECEIPT_LIMIT,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (receiptClaim.error) throw new Error('Could not claim push receipts');
  const receiptRows = (
    Array.isArray(receiptClaim.data) ? receiptClaim.data : []
  ) as DbRow[];
  const receipts = claimedReceipts(receiptRows);
  counts.cancelled += cancelledCount(receiptRows);
  counts.claimed += receipts.length;

  let receiptOutcomes: ExpoPushOutcome[];
  try {
    receiptOutcomes = await transport.receipts(receipts);
  } catch {
    console.error('[push] receipt transport failed');
    receiptOutcomes = receipts.map((receipt) => ({
      deliveryId: receipt.deliveryId,
      kind: 'retry',
      code: 'provider_unavailable',
    }));
  }
  const receiptResults = outcomeById(receiptOutcomes);
  for (const receipt of receipts) {
    const outcome = receiptResults.get(receipt.deliveryId) ?? {
      deliveryId: receipt.deliveryId,
      kind: 'retry' as const,
      code: 'missing_provider_outcome',
    };
    if (outcome.kind === 'delivered') {
      await settle(admin, {
        deliveryId: receipt.deliveryId,
        workerId,
        outcome: 'delivered',
      });
      counts.delivered += 1;
    } else if (outcome.kind === 'permanent_token') {
      await settle(admin, {
        deliveryId: receipt.deliveryId,
        workerId,
        outcome: 'failed',
        errorCode: outcome.code,
        retireInstallation: true,
      });
      counts.failed += 1;
      counts.installationsRetired += 1;
    } else if (outcome.kind === 'failed') {
      await settle(admin, {
        deliveryId: receipt.deliveryId,
        workerId,
        outcome: 'failed',
        errorCode: outcome.code,
      });
      counts.failed += 1;
    } else {
      await settle(admin, {
        deliveryId: receipt.deliveryId,
        workerId,
        outcome: 'ticketed',
        ticketId: receipt.ticketId,
        errorCode:
          'code' in outcome ? outcome.code : 'unexpected_receipt_outcome',
        nextAttemptAt: at(now(), RECEIPT_RETRY_MS),
      });
      counts.retried += 1;
    }
  }

  const deliveryClaim = await admin.rpc('claim_push_deliveries', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(Math.floor(claimLimit), 1), 100),
    p_lease_seconds: LEASE_SECONDS,
  });
  if (deliveryClaim.error) throw new Error('Could not claim push deliveries');
  const deliveryRows = (
    Array.isArray(deliveryClaim.data) ? deliveryClaim.data : []
  ) as DbRow[];
  const deliveries = claimedDeliveries(deliveryRows);
  counts.cancelled += cancelledCount(deliveryRows);
  counts.claimed += deliveries.length;

  let sendOutcomes: ExpoPushOutcome[];
  try {
    sendOutcomes = await transport.send(deliveries);
  } catch {
    console.error('[push] send transport failed');
    sendOutcomes = deliveries.map((delivery) => ({
      deliveryId: delivery.deliveryId,
      kind: 'retry',
      code: 'provider_unavailable',
    }));
  }
  const sendResults = outcomeById(sendOutcomes);
  for (const delivery of deliveries) {
    const outcome = sendResults.get(delivery.deliveryId) ?? {
      deliveryId: delivery.deliveryId,
      kind: 'retry' as const,
      code: 'missing_provider_outcome',
    };
    if (outcome.kind === 'ticketed') {
      await settle(admin, {
        deliveryId: delivery.deliveryId,
        workerId,
        outcome: 'ticketed',
        ticketId: outcome.ticketId,
        nextAttemptAt: at(now(), RECEIPT_RETRY_MS),
      });
      counts.ticketed += 1;
    } else if (outcome.kind === 'permanent_token') {
      await settle(admin, {
        deliveryId: delivery.deliveryId,
        workerId,
        outcome: 'failed',
        errorCode: outcome.code,
        retireInstallation: true,
      });
      counts.failed += 1;
      counts.installationsRetired += 1;
    } else if (outcome.kind === 'failed') {
      await settle(admin, {
        deliveryId: delivery.deliveryId,
        workerId,
        outcome: 'failed',
        errorCode: outcome.code,
      });
      counts.failed += 1;
    } else if (delivery.attemptCount >= MAX_SEND_ATTEMPTS) {
      await settle(admin, {
        deliveryId: delivery.deliveryId,
        workerId,
        outcome: 'failed',
        errorCode: 'retry_exhausted',
      });
      counts.failed += 1;
    } else {
      await settle(admin, {
        deliveryId: delivery.deliveryId,
        workerId,
        outcome: 'retry',
        errorCode: 'code' in outcome ? outcome.code : 'provider_retry',
        nextAttemptAt: at(now(), backoffMs(delivery.attemptCount, random)),
      });
      counts.retried += 1;
    }
  }

  return counts;
}
