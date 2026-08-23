import { describe, expect, it, vi } from 'vitest';

import {
  MetaGraphError,
  type MetaPageLeadAccess,
} from '@/lib/whatsapp/meta-api';
import {
  classifyMetaLeadHealthFailure,
  diagnoseAndRepairMetaPage,
  localMetaEncryptionFailure,
  type MetaLeadHealthProvider,
} from './lead-ads-health';

const allowed: MetaPageLeadAccess = {
  app_has_leads_permission: true,
  can_access_lead: true,
  enabled_lead_access_manager: false,
  is_page_admin: true,
  user_has_leads_permission: true,
};

function provider(args?: {
  access?: MetaPageLeadAccess;
  subscriptions?: boolean[];
}): MetaLeadHealthProvider & {
  getLeadAccess: ReturnType<typeof vi.fn>;
  getLeadgenSubscription: ReturnType<typeof vi.fn>;
  subscribeLeadgen: ReturnType<typeof vi.fn>;
} {
  const subscriptions = args?.subscriptions ?? [true];
  return {
    getLeadAccess: vi.fn(async () => args?.access ?? allowed),
    getLeadgenSubscription: vi.fn(async () => ({
      subscribed: subscriptions.shift() ?? false,
      subscribedFields: [],
    })),
    subscribeLeadgen: vi.fn(async () => undefined),
  };
}

describe('Meta Lead Ads Page health', () => {
  it('returns healthy without a provider mutation when access and subscription pass', async () => {
    const meta = provider();

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toEqual({
      kind: 'healthy',
      code: null,
      message: null,
      resolution: null,
      humanAction: false,
      transient: false,
    });
    expect(meta.subscribeLeadgen).not.toHaveBeenCalled();
  });

  it('repairs only when lead access is true and leadgen is missing, then verifies again', async () => {
    const meta = provider({ subscriptions: [false, true] });

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toMatchObject({
      kind: 'repaired',
      code: 'subscription_repaired',
    });
    expect(meta.subscribeLeadgen).toHaveBeenCalledOnce();
    expect(meta.getLeadgenSubscription).toHaveBeenCalledTimes(2);
  });

  it('verifies the subscription when Meta says the lead-access diagnostic is unavailable', async () => {
    const meta = provider({
      access: {
        page_id: 'page-1',
        user_id: 'user-1',
        failure_reason: 'This API is not available.',
      },
    });

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toMatchObject({
      kind: 'healthy',
      leadAccessVerified: false,
    });
    expect(meta.getLeadgenSubscription).toHaveBeenCalledOnce();
    expect(meta.subscribeLeadgen).not.toHaveBeenCalled();
  });

  it('fails closed when the subscription is still absent after the repair request', async () => {
    const meta = provider({ subscriptions: [false, false] });

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toMatchObject({
      kind: 'meta_setup_required',
      code: 'subscription_verification_failed',
      humanAction: true,
      transient: false,
    });
    expect(meta.subscribeLeadgen).toHaveBeenCalledOnce();
  });

  it('requires Meta setup when the app lacks leads_retrieval', async () => {
    const meta = provider({
      access: {
        ...allowed,
        can_access_lead: false,
        app_has_leads_permission: false,
        failure_resolution: 'Request leads_retrieval Advanced Access.',
      },
    });

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toEqual({
      kind: 'meta_setup_required',
      code: 'app_lead_access_missing',
      message: 'Meta denied lead retrieval for this app.',
      resolution: 'Request leads_retrieval Advanced Access.',
      humanAction: true,
      transient: false,
    });
    expect(meta.getLeadgenSubscription).not.toHaveBeenCalled();
    expect(meta.subscribeLeadgen).not.toHaveBeenCalled();
  });

  it('requires Meta setup when Lead Access Manager denies the connecting user', async () => {
    const meta = provider({
      access: {
        ...allowed,
        can_access_lead: false,
        enabled_lead_access_manager: true,
        user_has_leads_permission: false,
        failure_resolution: 'Assign lead access in Business Settings.',
      },
    });

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toMatchObject({
      kind: 'meta_setup_required',
      code: 'lead_access_manager_denied',
      resolution: 'Assign lead access in Business Settings.',
      humanAction: true,
    });
    expect(meta.subscribeLeadgen).not.toHaveBeenCalled();
  });

  it('requires reconnect when the connecting user no longer administers the Page', async () => {
    const meta = provider({
      access: {
        ...allowed,
        can_access_lead: false,
        is_page_admin: false,
        failure_resolution: 'Ask a Page administrator to restore access.',
      },
    });

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 100 })
    ).resolves.toMatchObject({
      kind: 'reconnect_required',
      code: 'page_access_lost',
      humanAction: true,
    });
    expect(meta.subscribeLeadgen).not.toHaveBeenCalled();
  });

  it.each([
    [
      new MetaGraphError('Invalid token', 400, 190, null, null, false),
      'reconnect_required',
      'token_invalid',
    ],
    [
      new MetaGraphError('Unavailable', 503, 2, null, null, true),
      'transient',
      'meta_transient',
    ],
    [new TypeError('fetch failed'), 'transient', 'network_error'],
  ] as const)('classifies %s as %s', (error, kind, code) => {
    expect(classifyMetaLeadHealthFailure(error)).toMatchObject({
      kind,
      code,
    });
  });

  it('classifies an aborted diagnostic as a transient timeout', () => {
    const error = new DOMException('The operation was aborted', 'AbortError');
    expect(classifyMetaLeadHealthFailure(error)).toMatchObject({
      kind: 'transient',
      code: 'timeout',
      humanAction: false,
      transient: true,
    });
  });

  it('classifies local token decryption separately from Meta credentials', () => {
    expect(localMetaEncryptionFailure()).toEqual({
      kind: 'local_setup_required',
      code: 'local_encryption_key_mismatch',
      message: 'UsefulDesk could not decrypt the saved Facebook credential.',
      resolution:
        'Reconnect Facebook after the server encryption key is corrected.',
      humanAction: true,
      transient: false,
    });
  });

  it('aborts a provider diagnostic after the configured timeout', async () => {
    const meta = provider();
    meta.getLeadAccess.mockImplementation(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );

    await expect(
      diagnoseAndRepairMetaPage({ provider: meta, timeoutMs: 5 })
    ).resolves.toMatchObject({ kind: 'transient', code: 'timeout' });
  });
});
