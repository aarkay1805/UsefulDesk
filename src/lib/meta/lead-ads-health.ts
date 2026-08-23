import type { MetaPageLeadAccess } from '@/lib/whatsapp/meta-api';
import { MetaGraphError } from '@/lib/whatsapp/meta-api';

export type MetaLeadHealthKind =
  | 'healthy'
  | 'repaired'
  | 'transient'
  | 'reconnect_required'
  | 'meta_setup_required'
  | 'local_setup_required';

export interface MetaLeadHealthResult {
  kind: MetaLeadHealthKind;
  code: string | null;
  message: string | null;
  resolution: string | null;
  humanAction: boolean;
  transient: boolean;
  /** False when Meta omits the diagnostic but the leadgen subscription works. */
  leadAccessVerified?: boolean;
}

export interface MetaLeadHealthProvider {
  getLeadAccess(signal: AbortSignal): Promise<MetaPageLeadAccess>;
  getLeadgenSubscription(signal: AbortSignal): Promise<{
    subscribed: boolean;
    subscribedFields: string[];
  }>;
  subscribeLeadgen(signal: AbortSignal): Promise<void>;
}

interface DiagnoseAndRepairMetaPageArgs {
  provider: MetaLeadHealthProvider;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function safeProviderText(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 1_000);
}

function failure(
  kind: Exclude<MetaLeadHealthKind, 'healthy' | 'repaired'>,
  code: string,
  message: string,
  resolution: string,
  humanAction: boolean,
  transient: boolean
): MetaLeadHealthResult {
  return { kind, code, message, resolution, humanAction, transient };
}

async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function localMetaEncryptionFailure(): MetaLeadHealthResult {
  return failure(
    'local_setup_required',
    'local_encryption_key_mismatch',
    'UsefulDesk could not decrypt the saved Facebook credential.',
    'Reconnect Facebook after the server encryption key is corrected.',
    true,
    false
  );
}

export function classifyMetaLeadHealthFailure(
  error: unknown
): MetaLeadHealthResult {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return failure(
      'transient',
      'timeout',
      'Meta did not answer the health check in time.',
      'UsefulDesk will try the Facebook connection again automatically.',
      false,
      true
    );
  }

  if (error instanceof TypeError) {
    return failure(
      'transient',
      'network_error',
      'UsefulDesk could not reach Meta.',
      'UsefulDesk will try the Facebook connection again automatically.',
      false,
      true
    );
  }

  if (error instanceof MetaGraphError) {
    if (error.code === 190) {
      return failure(
        'reconnect_required',
        'token_invalid',
        'The saved Facebook authorization is no longer valid.',
        'Reconnect Facebook to grant Page access again.',
        true,
        false
      );
    }
    if (error.retryable) {
      return failure(
        'transient',
        'meta_transient',
        'Meta temporarily could not verify the Facebook connection.',
        'UsefulDesk will try the Facebook connection again automatically.',
        false,
        true
      );
    }
    if (error.code === 10 || error.code === 200) {
      return failure(
        'meta_setup_required',
        'meta_permission_missing',
        'Meta denied a required Lead Ads permission.',
        safeProviderText(
          error.providerDetail ?? undefined,
          'Verify leads_retrieval and pages_manage_metadata Advanced Access in Meta.'
        ),
        true,
        false
      );
    }
    return failure(
      'reconnect_required',
      'meta_access_error',
      'Meta could not use the saved Facebook Page authorization.',
      safeProviderText(
        error.providerDetail ?? undefined,
        'Reconnect Facebook and verify that you still administer the Page.'
      ),
      true,
      false
    );
  }

  return failure(
    'transient',
    'unexpected_provider_error',
    'The Facebook connection health check did not finish.',
    'UsefulDesk will try the Facebook connection again automatically.',
    false,
    true
  );
}

function deniedLeadAccess(access: MetaPageLeadAccess): MetaLeadHealthResult {
  const providerResolution = safeProviderText(
    access.failure_resolution,
    'Review the Lead Ads permissions in Meta Business Settings.'
  );

  if (access.app_has_leads_permission === false) {
    return failure(
      'meta_setup_required',
      'app_lead_access_missing',
      'Meta denied lead retrieval for this app.',
      providerResolution,
      true,
      false
    );
  }
  if (
    access.enabled_lead_access_manager === true &&
    access.user_has_leads_permission === false
  ) {
    return failure(
      'meta_setup_required',
      'lead_access_manager_denied',
      'Lead Access Manager has not granted this user access to leads.',
      providerResolution,
      true,
      false
    );
  }
  if (access.is_page_admin === false) {
    return failure(
      'reconnect_required',
      'page_access_lost',
      'The connecting Facebook user no longer has usable Page access.',
      providerResolution,
      true,
      false
    );
  }
  return failure(
    'meta_setup_required',
    'lead_access_denied',
    safeProviderText(
      access.failure_reason,
      'Meta denied lead retrieval for this Page.'
    ),
    providerResolution,
    true,
    false
  );
}

export async function diagnoseAndRepairMetaPage(
  args: DiagnoseAndRepairMetaPageArgs
): Promise<MetaLeadHealthResult> {
  const timeoutMs = Math.max(1, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const access = await withTimeout(timeoutMs, (signal) =>
      args.provider.getLeadAccess(signal)
    );
    const diagnosticUnavailable =
      access.can_access_lead === undefined &&
      access.failure_reason?.trim().toLowerCase() ===
        'this api is not available.';
    if (access.can_access_lead !== true && !diagnosticUnavailable) {
      return deniedLeadAccess(access);
    }

    const before = await withTimeout(timeoutMs, (signal) =>
      args.provider.getLeadgenSubscription(signal)
    );
    if (before.subscribed) {
      return {
        kind: 'healthy',
        code: null,
        message: null,
        resolution: null,
        humanAction: false,
        transient: false,
        ...(diagnosticUnavailable ? { leadAccessVerified: false } : {}),
      };
    }

    await withTimeout(timeoutMs, (signal) =>
      args.provider.subscribeLeadgen(signal)
    );
    const after = await withTimeout(timeoutMs, (signal) =>
      args.provider.getLeadgenSubscription(signal)
    );
    if (!after.subscribed) {
      return failure(
        'meta_setup_required',
        'subscription_verification_failed',
        'Meta did not confirm the Lead Ads Page subscription.',
        'Verify pages_manage_metadata Advanced Access and the app-level Page webhook in Meta.',
        true,
        false
      );
    }

    return {
      kind: 'repaired',
      code: 'subscription_repaired',
      message: 'UsefulDesk restored the Lead Ads Page subscription.',
      resolution: null,
      humanAction: false,
      transient: false,
      ...(diagnosticUnavailable ? { leadAccessVerified: false } : {}),
    };
  } catch (error) {
    return classifyMetaLeadHealthFailure(error);
  }
}
