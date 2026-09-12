import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const h = vi.hoisted(() => ({
  requireSettingsAccess: vi.fn(),
  settings: {
    account_id: 'account-1',
    enabled: true,
    days_before: [7, 3, 1],
    service_enabled: true,
    service_days_before: [7, 3, 1],
    invoice_collection_send_window_start: 9,
    invoice_collection_send_window_end: 19,
  } as Record<string, unknown>,
  whatsapp: { status: 'disconnected' },
  templates: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireSettingsAccess: h.requireSettingsAccess,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));

function db() {
  const from = vi.fn((table: string) => {
    const result = () => {
      if (table === 'renewal_reminder_settings') return h.settings;
      if (table === 'whatsapp_config') return h.whatsapp;
      if (table === 'message_templates') return h.templates;
      return [];
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: () => Promise.resolve({ data: result(), error: null }),
      update: (patch: Record<string, unknown>) => {
        h.updates.push(patch);
        Object.assign(h.settings, patch);
        return builder;
      },
      insert: (patch: Record<string, unknown>) => {
        h.updates.push(patch);
        h.settings = patch;
        return builder;
      },
      single: () => Promise.resolve({ data: result(), error: null }),
      then: (
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({ data: result(), error: null }).then(resolve, reject),
    };
    return builder;
  });
  return { from };
}

import { PATCH } from './route';

describe('PATCH /api/reminders/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.settings = {
      account_id: 'account-1',
      enabled: true,
      days_before: [7, 3, 1],
      service_enabled: true,
      service_days_before: [7, 3, 1],
      invoice_collection_send_window_start: 9,
      invoice_collection_send_window_end: 19,
    };
    h.whatsapp = { status: 'disconnected' };
    h.templates = [];
    h.updates = [];
    h.requireSettingsAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: db(),
    });
  });

  it('writes only the selected rule’s columns and permits config saves for an already-on blocked rule', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'membership_renewal',
          patch: { daysBefore: [14, 7, 7] },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(h.updates).toEqual([{ days_before: [7, 14] }]);
    expect(h.settings.service_enabled).toBe(true);
    expect((await response.json()).rule.readiness).toMatchObject({
      ready: false,
      code: 'whatsapp_not_connected',
    });
  });

  it('rejects a false-to-true activation before it writes when setup is blocked', async () => {
    h.settings.enabled = false;
    const response = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'membership_renewal',
          patch: { enabled: true },
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(h.updates).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: 'whatsapp_not_connected',
    });
  });

  it('returns the first missing contract for a multi-template rule', async () => {
    h.whatsapp = { status: 'connected' };
    h.settings.invoice_collection_enabled = false;
    const response = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'invoice_collection',
          patch: { enabled: true },
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'missing',
      templateContractId: 'invoice_due',
    });
    expect(h.updates).toEqual([]);
  });

  it('allows a ready activation and returns only the updated selected rule', async () => {
    h.whatsapp = { status: 'connected' };
    h.settings.enabled = false;
    h.templates = [
      {
        ...TEMPLATE_CONTRACTS.membership_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
    ];
    const response = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'membership_renewal',
          patch: { enabled: true },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(h.updates).toEqual([{ enabled: true }]);
    expect(await response.json()).toMatchObject({
      rule: {
        id: 'membership_renewal',
        settings: { enabled: true },
        readiness: { ready: true, code: 'ready' },
      },
    });
  });

  it('rejects malformed and cross-rule patches before it writes', async () => {
    const malformed = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: '{',
      })
    );
    const crossRule = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'membership_renewal',
          patch: { serviceEnabled: false },
        }),
      })
    );

    expect(malformed.status).toBe(400);
    expect(crossRule.status).toBe(400);
    expect(h.updates).toEqual([]);
  });

  it('validates a partial collection window against the persisted opposite edge', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'invoice_collection',
          patch: { sendWindowEnd: 8 },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(h.updates).toEqual([]);
  });

  it('enforces settings authorization before reading or mutating a rule', async () => {
    h.requireSettingsAccess.mockRejectedValue(new Error('Insufficient role'));
    const response = await PATCH(
      new Request('http://localhost/api/reminders/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ruleId: 'membership_renewal',
          patch: { enabled: false },
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(h.updates).toEqual([]);
  });
});
