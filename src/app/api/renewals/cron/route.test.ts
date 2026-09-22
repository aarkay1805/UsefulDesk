import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const h = vi.hoisted(() => ({
  settingsInitial: [] as Record<string, unknown>[],
  settingsCurrent: null as Record<string, unknown> | null,
  membershipsInitial: [] as Record<string, unknown>[],
  membershipCurrent: null as Record<string, unknown> | null,
  serviceCandidates: [] as Record<string, unknown>[],
  serviceCurrent: null as Record<string, unknown> | null,
  templates: [] as Record<string, unknown>[],
  writes: [] as {
    table: string;
    operation: string;
    payload?: Record<string, unknown>;
  }[],
  providerCalls: 0,
  sentParams: [] as string[][],
  providerMode: 'success' as 'success' | 'ambiguous' | 'accepted_warning',
  selectErrors: {} as Record<string, string>,
  serviceClaimError: null as string | null,
  db: null as unknown,
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => h.db,
}));
vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => true,
  isAuthorizedCronRequest: () => true,
}));
vi.mock('@/lib/platform-access/server', () => ({
  requireProductAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/whatsapp/legal-business-name', () => ({
  loadLegalBusinessName: vi.fn().mockResolvedValue({
    ok: true,
    name: 'FitZone Wellness Private Limited',
  }),
}));
vi.mock('@/lib/locale/config', () => ({
  resolveAccountLocale: () => ({ timeZone: 'Asia/Kolkata' }),
}));
vi.mock('@/lib/locale/format', () => ({
  buildFormatters: () => ({
    date: (value: string) => `date:${value}`,
    money: (value: number) => `money:${value}`,
  }),
  hourInTz: () => 10,
  todayInTz: () => '2026-09-10',
}));
vi.mock('@/lib/automations/meta-send', () => {
  class MetaAcceptedPersistenceError extends Error {
    whatsappMessageId = 'wamid.accepted';
  }
  return {
    MetaAcceptedPersistenceError,
    engineSendTemplate: vi.fn(
      async (args: { beforeSend?: () => Promise<void>; params?: string[] }) => {
        await args.beforeSend?.();
        h.providerCalls++;
        h.sentParams.push([...(args.params ?? [])]);
        if (h.providerMode === 'ambiguous') {
          throw new Error('socket closed before response');
        }
        if (h.providerMode === 'accepted_warning') {
          throw new MetaAcceptedPersistenceError('messages insert unavailable');
        }
        return { whatsapp_message_id: `wamid.${h.providerCalls}` };
      }
    ),
  };
});

type Operation = 'select' | 'upsert' | 'update' | 'delete' | 'insert';
type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

class FakeQuery {
  private operation: Operation = 'select';
  private payload?: Record<string, unknown>;
  private filters = new Map<string, unknown>();

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  in(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  upsert(payload: Record<string, unknown>) {
    this.operation = 'upsert';
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.result(true));
  }

  single() {
    return Promise.resolve(this.result(true));
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result(false)).then(onfulfilled, onrejected);
  }

  private result(single: boolean): QueryResult {
    if (this.operation !== 'select') {
      h.writes.push({
        table: this.table,
        operation: this.operation,
        payload: this.payload,
      });
      return { data: { id: `${this.table}-row` }, error: null };
    }

    const error = h.selectErrors[this.table];
    if (error) return { data: null, error: { message: error } };

    if (this.table === 'renewal_reminder_settings') {
      return {
        data: single ? h.settingsCurrent : h.settingsInitial,
        error: null,
      };
    }
    if (this.table === 'memberships') {
      return {
        data: single ? h.membershipCurrent : h.membershipsInitial,
        error: null,
      };
    }
    if (this.table === 'service_renewal_queue') {
      return { data: h.serviceCurrent, error: null };
    }
    if (this.table === 'whatsapp_config') {
      return { data: { status: 'connected' }, error: null };
    }
    if (this.table === 'message_templates') {
      if (!single) return { data: h.templates, error: null };
      const name = this.filters.get('name');
      return {
        data: h.templates.find((row) => row.name === name) ?? null,
        error: null,
      };
    }
    if (this.table === 'accounts') {
      return {
        data: { owner_user_id: 'owner-1', timezone: 'Asia/Kolkata' },
        error: null,
      };
    }
    if (this.table === 'conversations') {
      return { data: { id: 'conversation-1' }, error: null };
    }
    throw new Error(`Unexpected select table: ${this.table}`);
  }
}

function createDb() {
  return {
    from: (table: string) => new FakeQuery(table),
    rpc: (name: string) => {
      if (name !== 'claim_service_renewal_reminders') {
        throw new Error(`Unexpected RPC: ${name}`);
      }
      return Promise.resolve({
        data: h.serviceClaimError ? null : h.serviceCandidates,
        error: h.serviceClaimError ? { message: h.serviceClaimError } : null,
      });
    },
  };
}

const { GET } = await import('./route');

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-1',
    contact_id: 'contact-1',
    start_date: '2026-08-11',
    end_date: '2026-09-11',
    fee_amount: 1_000,
    status: 'active',
    collection_mode: 'manual',
    contact: { id: 'contact-1', name: 'Asha', phone: '+919999999999' },
    plan: { name: 'Gold', plan_type: 'recurring' },
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    status: 'active',
    member_name: 'Asha',
    phone: '+919999999999',
    item_name_snapshot: 'Personal training',
    end_date: '2026-09-11',
    days_until_expiry: 1,
    service_enabled: true,
    service_days_before: [1, 3, 7],
    current_renewal_price: 500,
    item_is_active: true,
    option_is_active: true,
    ...overrides,
  };
}

describe('GET /api/renewals/cron current eligibility boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.db = createDb();
    h.settingsInitial = [
      { account_id: 'account-1', enabled: true, days_before: [1] },
    ];
    h.settingsCurrent = { enabled: true, days_before: [1] };
    h.membershipsInitial = [membership()];
    h.membershipCurrent = membership();
    h.serviceCandidates = [];
    h.serviceCurrent = null;
    h.templates = [
      {
        ...TEMPLATE_CONTRACTS.membership_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
      {
        ...TEMPLATE_CONTRACTS.service_renewal.payload,
        status: 'APPROVED',
        parameter_format: 'POSITIONAL',
      },
    ];
    h.writes = [];
    h.providerCalls = 0;
    h.sentParams = [];
    h.providerMode = 'success';
    h.selectErrors = {};
    h.serviceClaimError = null;
  });

  it('releases the pre-provider claim and sends nothing when the rule is switched off after selection', async () => {
    h.settingsCurrent = { enabled: false, days_before: [1] };

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ sent: 0, failed: 0, skipped_ineligible: 1 });
    expect(h.providerCalls).toBe(0);
    expect(h.writes).toContainEqual(
      expect.objectContaining({
        table: 'renewal_reminders_sent',
        operation: 'delete',
      })
    );
  });

  it('sends nothing when the selected membership moves to AutoPay before the provider boundary', async () => {
    h.membershipCurrent = membership({ collection_mode: 'auto' });

    const body = await (
      await GET(new Request('https://desk.example/api/renewals/cron'))
    ).json();

    expect(body).toMatchObject({ sent: 0, failed: 0, skipped_ineligible: 1 });
    expect(h.providerCalls).toBe(0);
  });

  it('uses the fresh eligible membership facts in the provider request', async () => {
    h.membershipCurrent = membership({
      fee_amount: 1_250,
      contact: { id: 'contact-1', name: 'Asha K', phone: '+919999999999' },
      plan: { name: 'Gold Plus', plan_type: 'recurring' },
    });

    const body = await (
      await GET(new Request('https://desk.example/api/renewals/cron'))
    ).json();

    expect(body).toMatchObject({ sent: 1, accepted: 1, failed: 0 });
    expect(h.providerCalls).toBe(1);
    expect(h.sentParams).toEqual([
      [
        'Asha K',
        'Gold Plus',
        'date:2026-09-11',
        'money:1250',
        'FitZone Wellness Private Limited',
      ],
    ]);
    expect(h.writes).toContainEqual(
      expect.objectContaining({
        table: 'renewal_reminders_sent',
        operation: 'update',
        payload: expect.objectContaining({ delivery_state: 'attempting' }),
      })
    );
  });

  it('reopens the service claim without sending when the current service rule is disabled', async () => {
    h.settingsInitial = [];
    h.settingsCurrent = null;
    h.membershipsInitial = [];
    h.membershipCurrent = null;
    h.serviceCandidates = [service()];
    h.serviceCurrent = service({ service_enabled: false });

    const body = await (
      await GET(new Request('https://desk.example/api/renewals/cron'))
    ).json();

    expect(body).toMatchObject({ sent: 0, failed: 0, skipped_ineligible: 1 });
    expect(h.providerCalls).toBe(0);
    expect(h.writes).toContainEqual(
      expect.objectContaining({
        table: 'service_renewal_reminders_sent',
        operation: 'update',
        payload: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('uses the current active service rate for an otherwise valid send', async () => {
    h.settingsInitial = [];
    h.settingsCurrent = null;
    h.membershipsInitial = [];
    h.membershipCurrent = null;
    h.serviceCandidates = [service()];
    h.serviceCurrent = service({
      member_name: 'Asha K',
      item_name_snapshot: 'Personal training plus',
      current_renewal_price: 650,
    });

    const body = await (
      await GET(new Request('https://desk.example/api/renewals/cron'))
    ).json();

    expect(body).toMatchObject({
      sent: 1,
      service_sent: 1,
      accepted: 1,
      failed: 0,
    });
    expect(h.sentParams).toEqual([
      [
        'Asha K',
        'Personal training plus',
        'date:2026-09-11',
        'money:650',
        'FitZone Wellness Private Limited',
      ],
    ]);
  });

  it('returns aggregate 503 diagnostics when a membership query fails but service processing continues', async () => {
    h.selectErrors.memberships = 'membership read unavailable';
    h.serviceCandidates = [service()];
    h.serviceCurrent = service();

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      sent: 1,
      service_sent: 1,
      failed: 1,
      ambiguous: 0,
    });
    expect(body.notes).toContain(
      'account account-1: query failed — membership read unavailable'
    );
  });

  it('continues service processing when the membership settings query fails', async () => {
    h.selectErrors.renewal_reminder_settings = 'settings read unavailable';
    h.serviceCandidates = [service()];
    h.serviceCurrent = service();

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      sent: 1,
      service_sent: 1,
      failed: 1,
      ambiguous: 0,
    });
    expect(body.notes).toContain(
      'renewal settings query failed — settings read unavailable'
    );
  });

  it('returns 503 when the service claim query fails', async () => {
    h.settingsInitial = [];
    h.membershipsInitial = [];
    h.serviceClaimError = 'claim RPC unavailable';

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ failed: 1, service_failed: 1 });
    expect(body.notes).toContain(
      'service reminder claim failed — claim RPC unavailable'
    );
  });

  it('returns 503 for an unresolved provider outcome while retaining aggregate evidence', async () => {
    h.providerMode = 'ambiguous';

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      sent: 0,
      accepted: 0,
      ambiguous: 1,
      failed: 1,
    });
  });

  it('returns 503 when Meta accepted but local completion needs review', async () => {
    h.providerMode = 'accepted_warning';

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      sent: 1,
      accepted: 1,
      ambiguous: 0,
      failed: 1,
    });
    expect(body.notes).toContain(
      'account account-1 membership membership-1: provider accepted; local persistence needs review — messages insert unavailable'
    );
  });

  it('keeps a readiness block and an ordinary empty service claim healthy', async () => {
    h.templates = [];

    const response = await GET(
      new Request('https://desk.example/api/renewals/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accounts_skipped: 1,
      sent: 0,
      failed: 0,
      ambiguous: 0,
    });
  });
});
