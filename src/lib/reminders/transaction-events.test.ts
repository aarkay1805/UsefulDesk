import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  send: vi.fn(),
  attempts: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock('@/lib/automations/meta-send', () => ({ engineSendTemplate: h.send }));
vi.mock('@/lib/locale/config', () => ({
  resolveAccountLocale: () => ({
    locale: 'en-IN',
    currency: 'INR',
    timeZone: 'UTC',
    countryCode: 'IN',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+91',
    measurementSystem: 'metric',
  }),
}));
vi.mock('@/lib/locale/format', () => ({
  buildFormatters: () => ({
    money: (amount: number) => `₹${amount}`,
    date: (date: string) => date,
  }),
  todayInTz: () => '2026-09-11',
}));
vi.mock('@/lib/whatsapp/template-readiness', () => ({
  evaluateTemplateReadiness: () => ({
    ready: true,
    row: { language: 'en_US' },
  }),
}));

type Rows = Record<string, unknown>;
class Query {
  private fields = '';
  private filters: Array<[string, unknown]> = [];
  constructor(
    private table: string,
    private rows: Rows
  ) {}
  select(fields = '') {
    this.fields = fields;
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }
  limit() {
    return this;
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({
      data: this.rows[this.table] ?? [],
      error: null,
    }).then(onfulfilled, onrejected);
  }
  maybeSingle() {
    const boundaryRow =
      this.fields.startsWith('superseded_at, event_kind') ||
      this.fields.startsWith('status, invoice_id') ||
      this.fields ===
        'id, invoice_number, state, balance, requires_refund_review'
        ? this.rows[`${this.table}:beforeSend`]
        : undefined;
    return Promise.resolve({
      data: boundaryRow ?? this.rows[this.table] ?? null,
      error: null,
    });
  }
}

function job(
  kind: 'payment_confirmation' | 'autopay_recovery',
  extras: Partial<Record<string, unknown>> = {}
) {
  return {
    id: 'job-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    invoice_id: 'invoice-1',
    kind,
    business_key: 'key',
    subject_cycle_id: 'cycle',
    milestone_key: 'confirmed',
    effective_due_on: '2026-09-11',
    activation_generation: 'gen-1',
    state: 'leased',
    attempt_count: 0,
    lease_owner: 'worker-1',
    lease_generation: 1,
    provider_message_id: null,
    ...extras,
  } as never;
}

async function run(
  rows: Rows,
  currentJob = job('payment_confirmation', {
    payment_id: 'payment-1',
    reason: { renewed: false },
  }),
  reservation: 'reserved' | 'deferred' = 'reserved'
) {
  const { processTransactionEventJob } = await import('./transaction-events');
  const finish = vi.fn().mockResolvedValue(undefined);
  h.send.mockImplementation(
    async (input: { beforeSend: () => Promise<void> }) => {
      await input.beforeSend();
      return { whatsapp_message_id: 'wamid-1' };
    }
  );
  h.reserve.mockResolvedValue(reservation);
  const result = await processTransactionEventJob({
    admin: { from: (table: string) => new Query(table, rows) } as never,
    job: currentJob,
    account: {
      owner_user_id: 'owner-1',
      timezone: 'UTC',
      default_currency: 'INR',
      country_code: 'IN',
      locale: 'en-IN',
      date_order: 'DMY',
      time_format: '12h',
      week_start: 1,
      phone_country_code: '+91',
      measurement_system: 'metric',
    },
    now: new Date('2026-09-11T10:00:00.000Z'),
    finish,
    findConversation: vi.fn().mockResolvedValue('conversation-1'),
    markProviderAttempt: h.attempts,
    reserveDailyClaim: h.reserve,
  });
  return { result, finish };
}

const enabled = {
  payment_confirmations_enabled: true,
  payment_confirmations_activated_at: '2026-09-11T08:00:00.000Z',
  payment_confirmations_generation: 'gen-1',
  autopay_recovery_enabled: true,
  autopay_recovery_activated_at: '2026-09-11T08:00:00.000Z',
  autopay_recovery_generation: 'gen-1',
};

describe('transaction lifecycle event worker', () => {
  it('confirms only the exact new payment and states payment-only settlement accurately', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    const { result } = await run({
      renewal_reminder_settings: enabled,
      payments: {
        id: 'payment-1',
        contact_id: 'contact-1',
        amount: 500,
        status: 'paid',
        created_at: '2026-09-11T09:00:00.000Z',
        invoice: { invoice_number: 'INV-1' },
        contact: { name: 'Asha' },
      },
      whatsapp_config: { status: 'connected' },
      message_templates: {},
    });
    expect(result).toBe('accepted');
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'gym_payment_confirmation',
        params: [
          'Asha',
          '₹500',
          'INV-1',
          'This payment confirmation does not confirm a membership renewal.',
        ],
      })
    );
    expect(h.attempts).toHaveBeenCalledOnce();
  });

  it('uses the recorded period only for an actual renewal confirmation', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    await run(
      {
        renewal_reminder_settings: enabled,
        payments: {
          id: 'payment-1',
          contact_id: 'contact-1',
          amount: 500,
          status: 'paid',
          created_at: '2026-09-11T09:00:00.000Z',
          invoice: { invoice_number: 'INV-1' },
          contact: { name: 'Asha' },
        },
        whatsapp_config: { status: 'connected' },
        message_templates: {},
      },
      job('payment_confirmation', {
        payment_id: 'payment-1',
        reason: { renewed: true, period_end: '2026-12-20' },
      })
    );
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.arrayContaining([
          'This payment renewed your membership until 2026-12-20.',
        ]),
      })
    );
  });

  it('fails closed and retries when an invoice-linked confirmation cannot re-read its invoice', async () => {
    const { processTransactionEventJob } = await import('./transaction-events');
    h.attempts.mockReset();
    h.send.mockReset();
    const finish = vi.fn().mockResolvedValue(undefined);
    h.send.mockImplementation(
      async (input: { beforeSend: () => Promise<void> }) => {
        await input.beforeSend();
        return { whatsapp_message_id: 'wamid-1' };
      }
    );
    const rows = {
      renewal_reminder_settings: enabled,
      payments: {
        id: 'payment-1',
        contact_id: 'contact-1',
        invoice_id: 'invoice-1',
        amount: 500,
        status: 'paid',
        created_at: '2026-09-11T09:00:00.000Z',
        invoice: { invoice_number: 'INV-1' },
        contact: { name: 'Asha' },
      },
      whatsapp_config: { status: 'connected' },
      message_templates: {},
    };
    const admin = {
      from: (table: string) => {
        const query = new Query(table, rows);
        if (table === 'invoice_balances')
          query.maybeSingle = (() =>
            Promise.resolve({
              data: null,
              error: { message: 'temporary read failure' },
            })) as never;
        return query;
      },
    } as never;
    const result = await processTransactionEventJob({
      admin,
      job: job('payment_confirmation', { payment_id: 'payment-1' }),
      account: {
        owner_user_id: 'owner-1',
        timezone: 'UTC',
        default_currency: 'INR',
        country_code: 'IN',
        locale: 'en-IN',
        date_order: 'DMY',
        time_format: '12h',
        week_start: 1,
        phone_country_code: '+91',
        measurement_system: 'metric',
      },
      now: new Date('2026-09-11T10:00:00.000Z'),
      finish,
      findConversation: vi.fn().mockResolvedValue('conversation-1'),
      markProviderAttempt: h.attempts,
      reserveDailyClaim: h.reserve,
    });
    expect(result).toBe('failed');
    expect(h.attempts).not.toHaveBeenCalled();
    expect(finish).toHaveBeenLastCalledWith(
      'queued',
      expect.objectContaining({
        reason: { code: 'payment_confirmation_invoice_unavailable' },
      })
    );
  });

  it('sends a verified pending AutoPay update without a manual-pay request or a daily reservation', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    const { result } = await run(
      {
        renewal_reminder_settings: enabled,
        razorpay_autopay_failure_events: {
          id: 'failure-1',
          event_kind: 'retry_pending',
          contact_id: 'contact-1',
          invoice_id: null,
          superseded_at: null,
          mandate: {
            id: 'mandate-1',
            membership_id: 'membership-1',
            status: 'active',
            provider_subscription_status: 'pending',
          },
        },
        whatsapp_config: { status: 'connected' },
        message_templates: {},
      },
      job('autopay_recovery', { autopay_failure_event_id: 'failure-1' })
    );
    expect(result).toBe('accepted');
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'gym_autopay_retry_update' })
    );
  });

  it('does not send a terminal manual-fallback request once a refund/hold makes the exact invoice noncollectible', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    const { result, finish } = await run(
      {
        renewal_reminder_settings: enabled,
        razorpay_autopay_failure_events: {
          id: 'failure-1',
          event_kind: 'terminal',
          contact_id: 'contact-1',
          invoice_id: 'invoice-1',
          superseded_at: null,
          mandate: {
            id: 'mandate-1',
            membership_id: 'membership-1',
            status: 'failed',
            provider_subscription_status: 'halted',
          },
        },
        invoice_balances: {
          id: 'invoice-1',
          invoice_number: 'INV-1',
          balance: 0,
          state: 'open',
          requires_refund_review: true,
          contact: { name: 'Asha', phone: '+9199' },
        },
      },
      job('autopay_recovery', { autopay_failure_event_id: 'failure-1' })
    );
    expect(result).toBe('blocked');
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('blocked', {
      reason: { code: 'manual_fallback_needs_staff_review' },
    });
  });

  it('reserves the shared daily chase slot for a terminal fallback and refreshes its balance at the provider boundary', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    h.reserve.mockReset();
    const { result } = await run(
      {
        renewal_reminder_settings: enabled,
        razorpay_autopay_failure_events: {
          id: 'failure-1',
          event_kind: 'terminal',
          contact_id: 'contact-1',
          invoice_id: 'invoice-1',
          superseded_at: null,
          mandate: {
            id: 'mandate-1',
            membership_id: 'membership-1',
            status: 'failed',
            provider_subscription_status: 'halted',
          },
        },
        invoice_balances: {
          id: 'invoice-1',
          invoice_number: 'INV-1',
          balance: 500,
          state: 'open',
          requires_refund_review: false,
          contact: { name: 'Asha', phone: '+9199' },
        },
        'invoice_balances:beforeSend': {
          id: 'invoice-1',
          invoice_number: 'INV-1',
          balance: 350,
          state: 'open',
          requires_refund_review: false,
        },
        whatsapp_config: { status: 'connected' },
        message_templates: {},
      },
      job('autopay_recovery', { autopay_failure_event_id: 'failure-1' })
    );
    expect(result).toBe('accepted');
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'gym_autopay_payment_help',
        params: ['Asha', 'INV-1', '₹350'],
      })
    );
  });

  it('defers terminal fallback when an open promise or hold appears', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    h.reserve.mockReset();
    const { result, finish } = await run(
      {
        renewal_reminder_settings: enabled,
        razorpay_autopay_failure_events: {
          id: 'failure-1',
          event_kind: 'terminal',
          contact_id: 'contact-1',
          invoice_id: 'invoice-1',
          superseded_at: null,
          mandate: {
            id: 'mandate-1',
            membership_id: 'membership-1',
            status: 'failed',
            provider_subscription_status: 'halted',
          },
        },
        invoice_balances: {
          id: 'invoice-1',
          invoice_number: 'INV-1',
          balance: 500,
          state: 'open',
          requires_refund_review: false,
          contact: { name: 'Asha', phone: '+9199' },
        },
        invoice_collection_commitments: [{ id: 'hold-1' }],
        whatsapp_config: { status: 'connected' },
        message_templates: {},
      },
      job('autopay_recovery', { autopay_failure_event_id: 'failure-1' })
    );
    expect(result).toBe('deferred');
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      'deferred',
      expect.objectContaining({
        reason: { code: 'invoice_commitment_or_hold_open' },
      })
    );
  });

  it('does not send a terminal fallback when the shared daily budget is already reserved', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    h.reserve.mockReset();
    const { result, finish } = await run(
      {
        renewal_reminder_settings: enabled,
        razorpay_autopay_failure_events: {
          id: 'failure-1',
          event_kind: 'terminal',
          contact_id: 'contact-1',
          invoice_id: 'invoice-1',
          superseded_at: null,
          mandate: {
            id: 'mandate-1',
            membership_id: 'membership-1',
            status: 'failed',
            provider_subscription_status: 'halted',
          },
        },
        invoice_balances: {
          id: 'invoice-1',
          invoice_number: 'INV-1',
          balance: 500,
          state: 'open',
          requires_refund_review: false,
          contact: { name: 'Asha', phone: '+9199' },
        },
        whatsapp_config: { status: 'connected' },
        message_templates: {},
      },
      job('autopay_recovery', { autopay_failure_event_id: 'failure-1' }),
      'deferred'
    );
    expect(result).toBe('deferred');
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      'deferred',
      expect.objectContaining({ reason: { code: 'daily_contact_budget' } })
    );
  });

  it('supersedes an old retry fact at the actual provider boundary', async () => {
    h.attempts.mockReset();
    h.send.mockReset();
    const { result, finish } = await run(
      {
        renewal_reminder_settings: enabled,
        razorpay_autopay_failure_events: {
          id: 'failure-1',
          event_kind: 'retry_pending',
          contact_id: 'contact-1',
          invoice_id: null,
          superseded_at: null,
          mandate: {
            id: 'mandate-1',
            membership_id: 'membership-1',
            status: 'active',
            provider_subscription_status: 'pending',
          },
        },
        'razorpay_autopay_failure_events:beforeSend': {
          superseded_at: '2026-09-11T10:01:00.000Z',
          event_kind: 'retry_pending',
          invoice_id: null,
          mandate: {
            membership_id: 'membership-1',
            status: 'active',
            provider_subscription_status: 'pending',
          },
        },
        whatsapp_config: { status: 'connected' },
        message_templates: {},
      },
      job('autopay_recovery', { autopay_failure_event_id: 'failure-1' })
    );
    expect(result).toBe('skipped');
    expect(h.attempts).not.toHaveBeenCalled();
    expect(finish).toHaveBeenLastCalledWith('skipped', {
      reason: { code: 'autopay_failure_superseded' },
    });
  });
});
