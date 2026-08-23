import 'server-only';

import { randomUUID } from 'node:crypto';

import type { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  processOwnedMetaLeadEvent,
  type LeadgenValue,
} from '@/lib/meta/lead-ingestion';
import { mapWithConcurrency } from '@/lib/meta/recovery-concurrency';

type AdminClient = ReturnType<typeof supabaseAdmin>;

interface RecoveryEventRow {
  event_id: string;
  account_id: string;
  payload: LeadgenValue;
}

export interface MetaRecoveryNote {
  phase: 'events' | 'pages';
  code: string;
}

export interface MetaEventRecoveryResult {
  claimed: number;
  processed: number;
  failed: number;
  busy: number;
  notes: MetaRecoveryNote[];
}

export async function runMetaLeadEventRecovery(args: {
  admin: AdminClient;
  owner?: string;
  limit?: number;
  leaseSeconds?: number;
}): Promise<MetaEventRecoveryResult> {
  const owner = args.owner ?? randomUUID();
  const result: MetaEventRecoveryResult = {
    claimed: 0,
    processed: 0,
    failed: 0,
    busy: 0,
    notes: [],
  };
  const { data, error } = await args.admin.rpc(
    'claim_meta_lead_webhook_recovery_batch',
    {
      p_processing_owner: owner,
      p_limit: Math.min(Math.max(args.limit ?? 25, 1), 25),
      p_lease_seconds: Math.min(Math.max(args.leaseSeconds ?? 300, 30), 300),
    }
  );
  if (error) throw new Error('Meta lead recovery claim failed');

  const rows = (Array.isArray(data) ? data : []) as RecoveryEventRow[];
  result.claimed = rows.length;
  await mapWithConcurrency(rows, 3, async (row) => {
    try {
      await processOwnedMetaLeadEvent({
        admin: args.admin,
        event: {
          eventId: row.event_id,
          accountId: row.account_id,
          payload: row.payload,
        },
        processingOwner: owner,
      });
      result.processed += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1_000)
          : 'Meta lead processing failed';
      const { data: failed, error: failError } = await args.admin.rpc(
        'fail_meta_lead_webhook_event_owned',
        {
          p_event_id: row.event_id,
          p_account_id: row.account_id,
          p_processing_owner: owner,
          p_error: message,
        }
      );
      if (failError || failed !== true) {
        result.busy += 1;
        result.notes.push({ phase: 'events', code: 'lease_not_retained' });
      } else {
        result.failed += 1;
        result.notes.push({ phase: 'events', code: 'processing_failed' });
      }
    }
  });
  return result;
}
