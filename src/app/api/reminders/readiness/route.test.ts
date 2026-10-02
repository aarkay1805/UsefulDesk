import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const h = vi.hoisted(() => ({
  requireAutomatedMessageActivityAccess: vi.fn(),
  requireProductAccess: vi.fn(),
  tables: new Map<string, unknown[]>(),
  settings: {
    enabled: true,
    days_before: [1, 3],
    service_enabled: true,
    service_days_before: [1, 3, 7],
  } as Record<string, unknown>,
  whatsapp: { status: 'connected' } as Record<string, unknown>,
  account: { timezone: 'Asia/Kolkata' } as Record<string, unknown>,
  hour: 10,
  legalIdentity: { ok: true, name: 'Useful Gym Private Limited' } as Record<
    string,
    unknown
  >,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireAutomatedMessageActivityAccess:
    h.requireAutomatedMessageActivityAccess,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/platform-access/server', () => ({
  requireProductAccess: h.requireProductAccess,
}));

vi.mock('@/lib/whatsapp/legal-business-name', () => ({
  loadLegalBusinessName: () => Promise.resolve(h.legalIdentity),
}));

vi.mock('@/lib/locale/format', () => ({
  todayInTz: () => '2026-09-10',
  hourInTz: () => h.hour,
}));

function createDb() {
  const from = vi.fn((table: string) => {
    const result = () => {
      if (table === 'renewal_reminder_settings') return h.settings;
      if (table === 'whatsapp_config') return h.whatsapp;
      if (table === 'accounts') return h.account;
      return h.tables.get(table) ?? [];
    };
    const builder = {
      select: () => builder,
      eq: (...args: unknown[]) => {
        h.calls.push({ table, method: 'eq', args });
        return builder;
      },
      in: (...args: unknown[]) => {
        h.calls.push({ table, method: 'in', args });
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: result(), error: null }),
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

import { GET } from './route';

describe('GET /api/reminders/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireProductAccess.mockResolvedValue({ allowed: true });
    h.tables = new Map([
      ['message_templates', []],
      ['memberships', []],
      ['service_renewal_queue', []],
      ['membership_installment_plans', []],
      ['invoice_balances', []],
    ]);
    h.settings = {
      enabled: true,
      days_before: [1, 3],
      service_enabled: true,
      service_days_before: [1, 3, 7],
    };
    h.whatsapp = { status: 'connected' };
    h.account = { timezone: 'Asia/Kolkata' };
    h.hour = 10;
    h.legalIdentity = { ok: true, name: 'Useful Gym Private Limited' };
    h.calls = [];
    h.requireAutomatedMessageActivityAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: createDb(),
    });
  });

  it('reports a missing installment contract as blocked without claiming or sending work', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'installment_reminder',
          state: 'blocked',
          reason: expect.stringContaining('gym_installment_reminder'),
        }),
      ])
    );
    expect(h.requireAutomatedMessageActivityAccess).toHaveBeenCalledOnce();
  });

  it('reports a configured, ready worker with no candidates as healthy empty work', async () => {
    const templates = [
      'membership_renewal',
      'service_renewal',
      'installment_reminder',
    ].map((id) => {
      // The production contract shape is intentionally used here so a test
      // cannot make a drifted template look ready.
      const contract =
        TEMPLATE_CONTRACTS[id as keyof typeof TEMPLATE_CONTRACTS];
      return {
        ...contract.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      };
    });
    h.tables.set('message_templates', templates);

    const body = await (await GET()).json();

    expect(body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'membership_renewal',
          state: 'no_eligible',
          dateMatchedCount: 0,
        }),
        expect.objectContaining({
          kind: 'service_renewal',
          state: 'no_eligible',
          dateMatchedCount: 0,
        }),
      ])
    );
  });

  it('does not present a retired custom service claim as sendable work', async () => {
    h.tables.set('message_templates', [
      {
        ...TEMPLATE_CONTRACTS.service_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
    ]);
    h.tables.set('service_renewal_queue', [
      {
        id: 'service-retired',
        end_date: '2026-09-11',
        phone: '+919000000004',
        days_until_expiry: 1,
        service_days_before: [1, 3, 7],
        current_renewal_price: 500,
        item_is_active: true,
        option_is_active: true,
      },
    ]);
    h.tables.set('service_renewal_reminders_sent', [
      {
        member_service_id: 'service-retired',
        end_date: '2026-09-11',
        days_before: 1,
        status: 'retired',
        claimed_at: null,
      },
    ]);

    const body = await (await GET()).json();
    expect(
      body.diagnostics.find(
        (diagnostic: { kind: string }) => diagnostic.kind === 'service_renewal'
      )
    ).toMatchObject({
      state: 'no_eligible',
      dateMatchedCount: 1,
      pendingCount: 0,
    });
  });

  it.each([
    ['claimed', null],
    ['attempting', '2026-09-10T04:00:00Z'],
    ['ambiguous', '2026-09-10T04:00:00Z'],
    ['failed', '2026-09-10T04:00:00Z'],
  ])(
    'does not reopen a %s service claim in readiness',
    async (status, attemptedAt) => {
      h.tables.set('message_templates', [
        {
          ...TEMPLATE_CONTRACTS.service_renewal.payload,
          status: 'APPROVED',
          parameter_format: 'POSITIONAL',
        },
      ]);
      h.tables.set('service_renewal_queue', [
        {
          id: 'service-closed',
          end_date: '2026-09-11',
          phone: '+919000000004',
          days_until_expiry: 1,
          service_days_before: [1, 3, 7],
          current_renewal_price: 500,
          item_is_active: true,
          option_is_active: true,
        },
      ]);
      h.tables.set('service_renewal_reminders_sent', [
        {
          member_service_id: 'service-closed',
          end_date: '2026-09-11',
          days_before: 1,
          status,
          claimed_at: '2026-09-09T00:00:00Z',
          provider_attempted_at: attemptedAt,
        },
      ]);
      const body = await (await GET()).json();
      expect(
        body.diagnostics.find(
          (row: { kind: string }) => row.kind === 'service_renewal'
        )
      ).toMatchObject({
        state: 'no_eligible',
        pendingCount: 0,
        deferredCount: 0,
      });
    }
  );

  it('reports a service failure known to precede WhatsApp as retryable', async () => {
    h.tables.set('message_templates', [
      {
        ...TEMPLATE_CONTRACTS.service_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
    ]);
    h.tables.set('service_renewal_queue', [
      {
        id: 'service-retry',
        end_date: '2026-09-11',
        phone: '+919000000004',
        days_until_expiry: 1,
        service_days_before: [1, 3, 7],
        current_renewal_price: 500,
        item_is_active: true,
        option_is_active: true,
      },
    ]);
    h.tables.set('service_renewal_reminders_sent', [
      {
        member_service_id: 'service-retry',
        end_date: '2026-09-11',
        days_before: 1,
        status: 'failed',
        claimed_at: '2026-09-09T00:00:00Z',
        provider_attempted_at: null,
      },
    ]);
    const body = await (await GET()).json();
    expect(
      body.diagnostics.find(
        (row: { kind: string }) => row.kind === 'service_renewal'
      )
    ).toMatchObject({ state: 'ready', pendingCount: 1 });
  });

  it.each([
    'legal_business_identity_missing',
    'legal_business_identity_lookup_unavailable',
  ])('blocks renewal readiness when %s prevents sending', async (code) => {
    h.legalIdentity = { ok: false, code };
    h.tables.set(
      'message_templates',
      ['membership_renewal', 'service_renewal'].map((id) => ({
        ...TEMPLATE_CONTRACTS[id as keyof typeof TEMPLATE_CONTRACTS].payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      }))
    );
    const body = await (await GET()).json();
    for (const kind of ['membership_renewal', 'service_renewal']) {
      expect(
        body.diagnostics.find((row: { kind: string }) => row.kind === kind)
      ).toMatchObject({
        state: 'blocked',
        reason: expect.stringMatching(/business name/i),
      });
    }
  });

  it('reports date-matched, claimed, missing-phone, and currently sendable rows separately', async () => {
    const templates = [
      'membership_renewal',
      'service_renewal',
      'installment_reminder',
    ].map((id) => ({
      ...TEMPLATE_CONTRACTS[id as keyof typeof TEMPLATE_CONTRACTS].payload,
      status: 'APPROVED',
      parameter_format: 'POSITIONAL',
    }));
    h.tables.set('message_templates', templates);
    h.tables.set('memberships', [
      {
        id: 'sent',
        end_date: '2026-09-11',
        fee_amount: 1000,
        contact: { phone: '+919000000001' },
        plan: { plan_type: 'recurring' },
      },
      {
        id: 'missing-phone',
        end_date: '2026-09-11',
        fee_amount: 1000,
        contact: { phone: null },
        plan: { plan_type: 'recurring' },
      },
      {
        id: 'pending',
        end_date: '2026-09-11',
        fee_amount: 1000,
        contact: { phone: '+919000000002' },
        plan: { plan_type: 'recurring' },
      },
      {
        id: 'non-recurring',
        end_date: '2026-09-11',
        fee_amount: 1000,
        contact: { phone: '+919000000003' },
        plan: { plan_type: 'non_recurring' },
      },
    ]);
    h.tables.set('renewal_reminders_sent', [
      { membership_id: 'sent', end_date: '2026-09-11', days_before: 1 },
    ]);
    h.tables.set('service_renewal_queue', [
      {
        id: 'service-1',
        end_date: '2026-09-11',
        phone: '+919000000004',
        days_until_expiry: 1,
        service_days_before: [1, 3, 7],
        current_renewal_price: 500,
        item_is_active: true,
        option_is_active: true,
      },
    ]);

    const body = await (await GET()).json();
    const membership = body.diagnostics.find(
      (diagnostic: { kind: string }) => diagnostic.kind === 'membership_renewal'
    );

    expect(membership).toMatchObject({
      state: 'ready',
      dateMatchedCount: 3,
      pendingCount: 1,
      blockedCount: 1,
      deferredCount: 0,
    });
    const accountScopedTables = [
      'renewal_reminder_settings',
      'whatsapp_config',
      'message_templates',
      'memberships',
      'service_renewal_queue',
      'membership_installment_plans',
      'renewal_reminders_sent',
      'service_renewal_reminders_sent',
    ];
    for (const table of accountScopedTables) {
      expect(h.calls).toContainEqual({
        table,
        method: 'eq',
        args: ['account_id', 'account-1'],
      });
    }
  });

  it('defers otherwise sendable reminders before the local send window', async () => {
    h.hour = 8;
    h.tables.set('message_templates', [
      {
        ...TEMPLATE_CONTRACTS.membership_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
    ]);
    h.tables.set('memberships', [
      {
        id: 'pending',
        end_date: '2026-09-11',
        fee_amount: 1000,
        contact: { phone: '+919000000002' },
        plan: { plan_type: 'recurring' },
      },
    ]);

    const body = await (await GET()).json();
    expect(
      body.diagnostics.find(
        (diagnostic: { kind: string }) =>
          diagnostic.kind === 'membership_renewal'
      )
    ).toMatchObject({
      state: 'deferred',
      dateMatchedCount: 1,
      pendingCount: 0,
      deferredCount: 1,
    });
  });

  it('requires standard reminder access before exposing sendable candidates', async () => {
    h.requireProductAccess.mockRejectedValue(
      new Error('UsefulDesk access is unavailable')
    );
    const response = await GET();
    expect(response.status).toBe(403);
    expect(h.calls).toHaveLength(0);
  });

  it('reports an unavailable current membership price as blocked', async () => {
    h.tables.set('message_templates', [
      {
        ...TEMPLATE_CONTRACTS.membership_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
    ]);
    h.tables.set('memberships', [
      {
        id: 'unpriced',
        account_id: 'account-1',
        plan_id: 'plan-1',
        pricing_option_id: 'option-1',
        fee_amount: 1500,
        end_date: '2026-09-11',
        contact: { phone: '+919000000004' },
        plan: { plan_type: 'recurring', is_active: true },
        pricing_option: null,
      },
    ]);
    const body = await (await GET()).json();
    expect(
      body.diagnostics.find(
        (row: { kind: string }) => row.kind === 'membership_renewal'
      )
    ).toMatchObject({
      state: 'blocked',
      pendingCount: 0,
      blockedCount: 1,
      reason: expect.stringMatching(/price/i),
    });
  });

  it('enforces the admin-only activity boundary before querying diagnostic data', async () => {
    h.requireAutomatedMessageActivityAccess.mockRejectedValue(
      new Error('Insufficient role')
    );

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Insufficient role' });
    expect(h.calls).toHaveLength(0);
  });
});
