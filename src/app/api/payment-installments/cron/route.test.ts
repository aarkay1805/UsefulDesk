import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const h = vi.hoisted(() => ({
  candidate: null as Record<string, unknown> | null,
  currentPlan: null as Record<string, unknown> | null,
  initialBalance: null as Record<string, unknown> | null,
  currentBalance: null as Record<string, unknown> | null,
  currentHolds: [] as Record<string, unknown>[],
  writes: [] as {
    table: string;
    operation: string;
    payload?: Record<string, unknown>;
  }[],
  providerCalls: 0,
  sentParams: [] as string[][],
  providerMode: 'success' as 'success' | 'ambiguous' | 'accepted_warning',
  initialBalanceQueryError: null as string | null,
  templateAvailable: true,
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
vi.mock('@/lib/locale/config', () => ({
  resolveAccountLocale: () => ({ timeZone: 'Asia/Kolkata' }),
}));
vi.mock('@/lib/locale/format', () => ({
  buildFormatters: () => ({
    date: (value: string) => `date:${value}`,
    money: (value: number) => `money:${value}`,
  }),
  hourInTz: () => 10,
  todayInTz: (timeZone: string) =>
    timeZone === 'UTC' ? '2026-09-10' : '2026-09-10',
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

  gte(column: string, value: unknown) {
    this.filters.set(`gte:${column}`, value);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.set(`lte:${column}`, value);
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.set(`gt:${column}`, value);
    return this;
  }

  limit(value: number) {
    this.filters.set('limit', value);
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

    if (this.table === 'membership_installment_plans') {
      if (single) return { data: h.currentPlan, error: null };
      if (!this.filters.has('account_id')) {
        return { data: [{ account_id: 'account-1' }], error: null };
      }
      return {
        data:
          this.filters.get('second_due_on') === '2026-09-11' && h.candidate
            ? [h.candidate]
            : [],
        error: null,
      };
    }
    if (this.table === 'invoice_balances') {
      if (!single && h.initialBalanceQueryError) {
        return {
          data: null,
          error: { message: h.initialBalanceQueryError },
        };
      }
      return {
        data: single
          ? h.currentBalance
          : h.initialBalance
            ? [h.initialBalance]
            : [],
        error: null,
      };
    }
    if (this.table === 'invoice_collection_commitments') {
      return {
        data:
          typeof this.filters.get('invoice_id') === 'string'
            ? h.currentHolds
            : [],
        error: null,
      };
    }
    if (this.table === 'whatsapp_config') {
      return { data: { status: 'connected' }, error: null };
    }
    if (this.table === 'message_templates') {
      return {
        data: h.templateAvailable
          ? {
              ...TEMPLATE_CONTRACTS.installment_reminder.payload,
              status: 'APPROVED',
              parameter_format: 'POSITIONAL',
            }
          : null,
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
  return { from: (table: string) => new FakeQuery(table) };
}

const { GET } = await import('./route');

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'installment-1',
    invoice_id: 'invoice-1',
    membership_id: 'membership-1',
    contact_id: 'contact-1',
    period_end: '2026-08-14',
    second_amount: 400,
    second_due_on: '2026-09-11',
    contact: { id: 'contact-1', name: 'Asha', phone: '+919999999999' },
    membership: { status: 'active', plan: { name: 'Gold' } },
    ...overrides,
  };
}

function invoiceBalance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    membership_id: 'membership-1',
    collectible_balance: 400,
    state: 'open',
    requires_refund_review: false,
    ...overrides,
  };
}

describe('GET /api/payment-installments/cron current eligibility boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.db = createDb();
    h.candidate = installment();
    h.currentPlan = installment();
    h.initialBalance = invoiceBalance();
    h.currentBalance = invoiceBalance();
    h.currentHolds = [];
    h.writes = [];
    h.providerCalls = 0;
    h.sentParams = [];
    h.providerMode = 'success';
    h.initialBalanceQueryError = null;
    h.templateAvailable = true;
  });

  it('releases the pre-provider claim and sends nothing when the invoice is settled after selection', async () => {
    h.currentBalance = invoiceBalance({ collectible_balance: 0 });

    const response = await GET(
      new Request('https://desk.example/api/payment-installments/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ sent: 0, failed: 0, skipped_ineligible: 1 });
    expect(h.providerCalls).toBe(0);
    expect(h.writes).toContainEqual(
      expect.objectContaining({
        table: 'installment_reminders_sent',
        operation: 'delete',
      })
    );
  });

  it('uses the current collectible balance for an otherwise valid send', async () => {
    h.currentBalance = invoiceBalance({ collectible_balance: 250 });

    const body = await (
      await GET(
        new Request('https://desk.example/api/payment-installments/cron')
      )
    ).json();

    expect(body).toMatchObject({ sent: 1, accepted: 1, failed: 0 });
    expect(h.providerCalls).toBe(1);
    expect(h.sentParams).toEqual([
      ['Asha', 'money:250', 'Gold', 'date:2026-09-11'],
    ]);
    expect(h.writes).toContainEqual(
      expect.objectContaining({
        table: 'installment_reminders_sent',
        operation: 'update',
        payload: expect.objectContaining({ delivery_state: 'attempting' }),
      })
    );
  });

  it('returns aggregate 503 diagnostics when a balance query fails', async () => {
    h.initialBalanceQueryError = 'balance view unavailable';

    const response = await GET(
      new Request('https://desk.example/api/payment-installments/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      sent: 0,
      accepted: 0,
      ambiguous: 0,
      failed: 1,
    });
    expect(body.notes).toContain(
      'account account-1: balance query failed — balance view unavailable'
    );
  });

  it('returns 503 for an unresolved provider outcome while retaining aggregate evidence', async () => {
    h.providerMode = 'ambiguous';

    const response = await GET(
      new Request('https://desk.example/api/payment-installments/cron')
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
      new Request('https://desk.example/api/payment-installments/cron')
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
      'account account-1 installment installment-1: provider accepted; local persistence needs review — messages insert unavailable'
    );
  });

  it('keeps template readiness blocks healthy', async () => {
    h.templateAvailable = false;

    const response = await GET(
      new Request('https://desk.example/api/payment-installments/cron')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accounts_skipped: 1,
      sent: 0,
      ambiguous: 0,
      failed: 0,
    });
  });
});
