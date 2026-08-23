import 'server-only';

import { randomUUID } from 'node:crypto';

import type { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  diagnoseAndRepairMetaPage,
  localMetaEncryptionFailure,
  type MetaLeadHealthResult,
} from '@/lib/meta/lead-ads-health';
import type { MetaRecoveryNote } from '@/lib/meta/lead-event-recovery';
import { mapWithConcurrency } from '@/lib/meta/recovery-concurrency';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  getPageLeadAccess,
  getPageLeadgenSubscription,
  subscribePageToLeadgen,
} from '@/lib/whatsapp/meta-api';

type AdminClient = ReturnType<typeof supabaseAdmin>;

export interface ClaimedMetaPage {
  config_id: string;
  account_id: string;
  page_id: string;
  page_access_token: string;
  connected_meta_user_id: string | null;
  credential_generation: number;
}

export interface MetaPageRecoveryResult {
  claimed: number;
  healthy: number;
  repaired: number;
  attention: number;
  failed: number;
  notes: MetaRecoveryNote[];
}

export async function diagnoseClaimedMetaPage(
  row: ClaimedMetaPage
): Promise<MetaLeadHealthResult> {
  const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId || !row.connected_meta_user_id) {
    return {
      kind: 'local_setup_required',
      code: 'local_meta_configuration_missing',
      message: 'UsefulDesk cannot verify this Facebook connection.',
      resolution: 'Reconnect Facebook after the Meta app is configured.',
      humanAction: true,
      transient: false,
    };
  }

  let pageAccessToken: string;
  try {
    pageAccessToken = decrypt(row.page_access_token);
  } catch {
    return localMetaEncryptionFailure();
  }

  return diagnoseAndRepairMetaPage({
    provider: {
      getLeadAccess: (signal) =>
        getPageLeadAccess({
          pageId: row.page_id,
          pageAccessToken,
          userId: row.connected_meta_user_id as string,
          appId,
          signal,
        }),
      getLeadgenSubscription: (signal) =>
        getPageLeadgenSubscription({
          pageId: row.page_id,
          pageAccessToken,
          appId,
          signal,
        }),
      subscribeLeadgen: (signal) =>
        subscribePageToLeadgen({
          pageId: row.page_id,
          pageAccessToken,
          signal,
        }),
    },
  });
}

export async function retainMetaPageHealthResult(args: {
  admin: AdminClient;
  row: ClaimedMetaPage;
  owner: string;
  result: MetaLeadHealthResult;
}): Promise<boolean> {
  const common = {
    p_config_id: args.row.config_id,
    p_account_id: args.row.account_id,
    p_health_owner: args.owner,
    p_credential_generation: args.row.credential_generation,
  };
  if (args.result.kind === 'healthy' || args.result.kind === 'repaired') {
    const { data, error } = await args.admin.rpc(
      'complete_meta_page_health_check',
      {
        ...common,
        p_repaired: args.result.kind === 'repaired',
        p_lead_access_verified: args.result.leadAccessVerified !== false,
      }
    );
    return !error && data === true;
  }
  const { data, error } = await args.admin.rpc('fail_meta_page_health_check', {
    ...common,
    p_error_code: args.result.code ?? 'unknown',
    p_error_resolution:
      args.result.resolution ?? 'Check the Facebook connection again.',
    p_error_message:
      args.result.message ?? 'Meta lead capture health check failed.',
    p_human_action: args.result.humanAction,
    p_transient: args.result.transient,
  });
  return !error && data === true;
}

export async function runMetaPageHealthRecovery(args: {
  admin: AdminClient;
  owner?: string;
  limit?: number;
  leaseSeconds?: number;
  forceConfigId?: string | null;
}): Promise<MetaPageRecoveryResult> {
  const owner = args.owner ?? randomUUID();
  const result: MetaPageRecoveryResult = {
    claimed: 0,
    healthy: 0,
    repaired: 0,
    attention: 0,
    failed: 0,
    notes: [],
  };
  const { data, error } = await args.admin.rpc('claim_meta_page_health_batch', {
    p_health_owner: owner,
    p_limit: Math.min(Math.max(args.limit ?? 10, 1), 10),
    p_lease_seconds: Math.min(Math.max(args.leaseSeconds ?? 300, 30), 300),
    p_force_config_id: args.forceConfigId ?? null,
  });
  if (error) throw new Error('Meta Page health claim failed');

  const rows = (Array.isArray(data) ? data : []) as ClaimedMetaPage[];
  result.claimed = rows.length;
  await mapWithConcurrency(rows, 3, async (row) => {
    const health = await diagnoseClaimedMetaPage(row);
    const retained = await retainMetaPageHealthResult({
      admin: args.admin,
      row,
      owner,
      result: health,
    });
    if (!retained) {
      result.failed += 1;
      result.notes.push({ phase: 'pages', code: 'lease_not_retained' });
    } else if (health.kind === 'healthy') {
      result.healthy += 1;
    } else if (health.kind === 'repaired') {
      result.repaired += 1;
    } else if (health.humanAction) {
      result.attention += 1;
      result.notes.push({ phase: 'pages', code: health.code ?? 'attention' });
    } else {
      result.failed += 1;
      result.notes.push({ phase: 'pages', code: health.code ?? 'transient' });
    }
  });
  return result;
}
