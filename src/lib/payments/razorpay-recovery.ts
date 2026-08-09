import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isRazorpayOAuthEnabled,
  RAZORPAY_OAUTH_REFRESH_WINDOW_MS,
  type RazorpayProviderMode,
} from './razorpay-config';
import { boundedRazorpayError } from './razorpay-oauth';
import { refreshStoredRazorpayOAuthConnection } from './razorpay-refresh';
import {
  parseRazorpayEvent,
  processClaimedRazorpayWebhook,
  type RazorpayEvent,
} from './razorpay-webhook-processor';

const RECOVERY_BATCH_LIMIT = 100;
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
}

interface RecoveryDependencies {
  now(): Date;
  owner(): string;
  oauthEnabled(): boolean;
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
}

export interface RazorpayRecoveryResult {
  webhooks: {
    claimed: number;
    processed: number;
    failed: number;
    oldestAgeSeconds: number | null;
  };
  tokens: {
    disabled: boolean;
    claimed: number;
    refreshed: number;
    skippedNotDue: number;
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
    processClaimed: processClaimedRazorpayWebhook,
    refreshConnection: refreshStoredRazorpayOAuthConnection,
    ...input.dependencies,
  };
  const result: RazorpayRecoveryResult = {
    webhooks: { claimed: 0, processed: 0, failed: 0, oldestAgeSeconds: null },
    tokens: {
      disabled: !dependencies.oauthEnabled(),
      claimed: 0,
      refreshed: 0,
      skippedNotDue: 0,
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

function parseStoredEvent(payload: unknown): RazorpayEvent {
  return parseRazorpayEvent(JSON.stringify(payload));
}
