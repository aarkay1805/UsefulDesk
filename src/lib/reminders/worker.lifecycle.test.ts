import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  engineSend: vi.fn(),
  rpc: vi.fn(),
  postExpiryKind: null as null | 'membership' | 'service',
  subjectChanged: false,
  commitmentKind: null as null | 'promise',
  promiseBroken: false,
  allocationCalls: 0,
  partialAtBoundary: false,
  paymentLinkKind: false,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock('@/lib/automations/meta-send', () => ({ engineSendTemplate: h.engineSend }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ from, rpc: h.rpc }) }));
vi.mock('@/lib/platform-access/server', () => ({ requireProductAccess: vi.fn() }));
vi.mock('@/lib/locale/config', () => ({ resolveAccountLocale: () => ({ timeZone: 'UTC' }) }));
vi.mock('@/lib/locale/format', () => ({
  buildFormatters: () => ({ money: (value: number) => `₹${value}`, date: (value: string) => value }),
  dayStartInTz: (date: string) => new Date(`${date}T00:00:00.000Z`),
  hourInTz: () => 10,
  todayInTz: (_timeZone: string, date?: Date) => h.paymentLinkKind && date?.toISOString().startsWith('2026-09-10') ? '2026-09-10' : '2026-09-11',
}));
vi.mock('@/lib/whatsapp/template-readiness', () => ({
  evaluateTemplateReadiness: () => ({ ready: true, row: { language: 'en_US' } }),
}));

const invoice = {
  id: 'invoice-1', account_id: 'account-1', contact_id: 'contact-1', membership_id: null,
  issued_at: '2026-09-11T09:00:00.000Z', invoice_number: 'INV-1', balance: 40,
  state: 'open', requires_refund_review: false,
  contact: { id: 'contact-1', name: 'Asha', phone: '+919999999999' },
};

class Query {
  private singleMode = false;
  private excludesCommitment = false;
  constructor(private table: string, private fields = '') {}
  select(fields = '') { this.fields = fields; return this; }
  eq(field: string, value: unknown) { h.filters.push([this.table, field, value]); return this; }
  neq(field: string, value: unknown) { void value; if (this.table === 'invoice_collection_commitments' && field === 'id') this.excludesCommitment = true; return this; }
  gte(field: string, value: unknown) { h.filters.push([this.table, field, value]); return this; } gt() { return this; }
  lt() { return this; } limit() { return this; } is() { return this; }
  in() { return this; } not() { return this; } upsert() { return this; }
  insert() { return this; } update() { return this; }
  maybeSingle() { this.singleMode = true; return this; } single() { this.singleMode = true; return this; }
  then(resolve: (value: { data: unknown; error: null }) => unknown) {
    const data = this.table === 'renewal_reminder_settings'
      ? this.fields.includes('invoice_collection_activated_at')
        ? [{ account_id: 'account-1', invoice_collection_enabled: !h.postExpiryKind && !h.commitmentKind && !h.paymentLinkKind, invoice_collection_activated_on: '2026-09-11', invoice_collection_activated_at: '2026-09-11T08:00:00.000Z', invoice_collection_generation: 'generation-1', invoice_collection_before_due_days: [0], invoice_collection_overdue_days: [1], invoice_collection_catch_up_days: 2, invoice_collection_send_window_start: 9, invoice_collection_send_window_end: 19, membership_post_expiry_enabled: h.postExpiryKind === 'membership', membership_post_expiry_activated_on: h.postExpiryKind === 'membership' ? '2026-09-01' : null, membership_post_expiry_activated_at: h.postExpiryKind === 'membership' ? '2026-09-01T08:00:00.000Z' : null, membership_post_expiry_generation: 'post-generation-1', membership_post_expiry_catch_up_days: 2, service_post_expiry_enabled: h.postExpiryKind === 'service', service_post_expiry_activated_on: h.postExpiryKind === 'service' ? '2026-09-01' : null, service_post_expiry_activated_at: h.postExpiryKind === 'service' ? '2026-09-01T08:00:00.000Z' : null, service_post_expiry_generation: 'post-generation-1', service_post_expiry_catch_up_days: 2, promise_to_pay_reminders_enabled: h.commitmentKind === 'promise', promise_to_pay_reminders_activated_on: h.commitmentKind === 'promise' ? '2026-09-01' : null, promise_to_pay_reminders_activated_at: h.commitmentKind === 'promise' ? '2026-09-01T08:00:00.000Z' : null, promise_to_pay_reminders_generation: 'promise-generation-1', payment_link_follow_up_enabled: h.paymentLinkKind, payment_link_follow_up_activated_on: h.paymentLinkKind ? '2026-09-01' : null, payment_link_follow_up_activated_at: h.paymentLinkKind ? '2026-09-01T08:00:00.000Z' : null, payment_link_follow_up_generation: 'link-generation-1' }]
        : []
      : this.table === 'accounts' ? [{ id: 'account-1', owner_user_id: 'owner-1', timezone: 'UTC', default_currency: 'INR', country_code: 'IN', locale: 'en-IN', date_order: 'DMY', time_format: '12', week_start: 1, phone_country_code: '+91', measurement_system: 'metric' }]
      : this.table === 'invoice_balances' ? [invoice]
      : this.table === 'memberships' ? [{ id: 'membership-1', account_id: 'account-1', contact_id: 'contact-1', end_date: h.subjectChanged ? '2026-10-04' : h.postExpiryKind ? '2026-09-04' : '2026-09-10', status: 'active', collection_mode: 'manual', fee_amount: 999, contact: invoice.contact, plan: { name: 'Gold', plan_type: 'recurring' } }]
      : this.table === 'service_renewal_queue' ? [{ id: 'service-1', account_id: 'account-1', contact_id: 'contact-1', end_date: '2026-09-04', status: 'active', item_name_snapshot: 'Personal training', current_renewal_price: 1200, item_is_active: true, option_is_active: true, member_name: 'Asha', phone: '+919999999999' }]
      : this.table === 'invoice_collection_commitments' && h.commitmentKind === 'promise' ? (this.excludesCommitment ? [] : [{ id: 'promise-1', invoice_id: 'invoice-1', contact_id: 'contact-1', kind: 'promise_to_pay', state: h.promiseBroken ? 'broken' : 'open', amount: 40, promised_on: h.promiseBroken ? '2026-09-10' : '2026-09-11', revision: 1, payment_allocation_snapshot: 0, created_at: '2026-09-11T08:00:00.000Z' }])
      : this.table === 'razorpay_payment_links' && h.paymentLinkKind ? [{ id: 'link-1', invoice_id: 'invoice-1', revision: 1, expected_amount: 40, short_url: 'https://pay.example/link-1', expires_at: '2026-09-20T00:00:00.000Z', status: 'created', last_sent_at: '2026-09-10T10:00:00.000Z', last_whatsapp_message_id: 'wamid-original', invoice: { contact_id: 'contact-1' } }]
      : this.table === 'membership_installment_plans' || this.table === 'invoice_line_balances' || this.table === 'payment_mandates' || this.table === 'membership_periods' || this.table === 'messages' ? []
      : this.table === 'conversations' ? [{ id: 'conversation-1' }]
      : this.table === 'whatsapp_config' ? [{ status: 'connected' }]
      : this.table === 'message_templates' ? [{}]
      : this.table === 'lifecycle_reminder_jobs' ? this.fields === 'id' ? [{ id: 'queued-1' }] : []
      : [];
    const value = this.singleMode && Array.isArray(data) ? data[0] ?? null : data;
    return Promise.resolve({ data: value, error: null }).then(resolve);
  }
}
function from(table: string) { return new Query(table); }

describe('runLifecycleReminderWorker', () => {
  it('queues, claims, reserves, revalidates, and records an accepted mocked provider send', async () => {
    h.filters.length = 0;
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'job-1', account_id: 'account-1', contact_id: 'contact-1', invoice_id: 'invoice-1', installment_plan_id: null, kind: 'invoice_due', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'due', effective_due_on: '2026-09-11', activation_generation: 'generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => {
      await args.beforeSend();
      return { whatsapp_message_id: 'wamid-1' };
    });
    const { runLifecycleReminderWorker } = await import('./worker');

    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));

    expect(h.engineSend).toHaveBeenCalledOnce();
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      'claim_lifecycle_reminder_jobs', 'reserve_lifecycle_reminder_daily_claim',
      'mark_lifecycle_reminder_provider_attempt', 'finish_lifecycle_reminder_job',
    ]));
    expect(summary.accepted).toBe(1);
  });

  it('uses the shared durable path for a post-expiry membership, rechecks it at beforeSend, and escalates the final unanswered milestone', async () => {
    h.postExpiryKind = 'membership';
    h.filters.length = 0;
    h.rpc.mockReset();
    h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'post-job-1', account_id: 'account-1', contact_id: 'contact-1', invoice_id: null, installment_plan_id: null, membership_id: 'membership-1', member_service_id: null, kind: 'membership_post_expiry', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'expired-7', effective_due_on: '2026-09-04', activation_generation: 'post-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => {
      await args.beforeSend();
      return { whatsapp_message_id: 'wamid-post-1' };
    });
    const { runLifecycleReminderWorker } = await import('./worker');

    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));

    expect(h.engineSend).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'gym_membership_post_expiry' }));
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      'reserve_lifecycle_reminder_daily_claim', 'mark_lifecycle_reminder_provider_attempt',
      'finish_lifecycle_reminder_job', 'escalate_post_expiry_reminder',
    ]));
    expect(summary.accepted).toBe(1);
    expect(h.filters).toEqual(expect.arrayContaining([
      ['conversations', 'account_id', 'account-1'],
      ['conversations', 'contact_id', 'contact-1'],
      ['messages', 'conversation_id', 'conversation-1'],
      ['messages', 'created_at', '2026-09-04T00:00:00.000Z'],
    ]));
    h.postExpiryKind = null;
  });

  it('uses the same worker path and exact service contract for a renewable service', async () => {
    h.postExpiryKind = 'service';
    h.rpc.mockReset();
    h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'post-service-job-1', account_id: 'account-1', contact_id: 'contact-1', invoice_id: null, installment_plan_id: null, membership_id: null, member_service_id: 'service-1', kind: 'service_post_expiry', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'expired-7', effective_due_on: '2026-09-04', activation_generation: 'post-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => {
      await args.beforeSend();
      return { whatsapp_message_id: 'wamid-service-1' };
    });
    const { runLifecycleReminderWorker } = await import('./worker');
    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(h.engineSend).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'gym_service_post_expiry' }));
    expect(summary.accepted).toBe(1);
    h.postExpiryKind = null;
  });

  it('skips a renewed subject before provider work and records an ambiguous post-expiry request after its boundary', async () => {
    h.postExpiryKind = 'membership';
    h.subjectChanged = true;
    h.rpc.mockReset();
    h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'post-job-1', account_id: 'account-1', contact_id: 'contact-1', invoice_id: null, installment_plan_id: null, membership_id: 'membership-1', member_service_id: null, kind: 'membership_post_expiry', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'expired-7', effective_due_on: '2026-09-04', activation_generation: 'post-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      return Promise.resolve({ data: true, error: null });
    });
    const { runLifecycleReminderWorker } = await import('./worker');
    const skipped = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(skipped.skipped).toBe(1);
    expect(h.engineSend).not.toHaveBeenCalled();

    h.subjectChanged = false;
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => {
      await args.beforeSend();
      throw new Error('provider connection dropped after submission');
    });
    const ambiguous = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(ambiguous.ambiguous).toBe(1);
    h.postExpiryKind = null;
  });

  it('uses the shared worker path for a revisioned promise and marks the provider boundary before sending', async () => {
    h.commitmentKind = 'promise'; h.promiseBroken = false; h.partialAtBoundary = false; h.allocationCalls = 0; h.rpc.mockReset(); h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'promise-job-1', account_id: 'account-1', contact_id: 'contact-1', invoice_id: 'invoice-1', installment_plan_id: null, collection_commitment_id: 'promise-1', commitment_revision: 1, kind: 'promise_to_pay', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'promise-due', effective_due_on: '2026-09-11', activation_generation: 'promise-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      if (name === 'reconcile_invoice_collection_commitment') return Promise.resolve({ data: h.promiseBroken ? 'broken' : 'open', error: null });
      if (name === 'invoice_commitment_payment_allocations') return Promise.resolve({ data: h.partialAtBoundary && ++h.allocationCalls > 1 ? 20 : 0, error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => { await args.beforeSend(); return { whatsapp_message_id: 'wamid-promise-1' }; });
    const { runLifecycleReminderWorker } = await import('./worker');
    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(summary.accepted).toBe(1);
    expect(h.engineSend).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'gym_payment_promise_reminder' }));
    expect(h.rpc.mock.calls.map(([name]) => name)).toContain('mark_lifecycle_reminder_provider_attempt');
    h.commitmentKind = null;
  });

  it('sends the bounded day-after broken-promise job through the provider boundary', async () => {
    h.commitmentKind = 'promise'; h.promiseBroken = true; h.partialAtBoundary = false; h.allocationCalls = 0; h.rpc.mockReset(); h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'broken-promise-job', account_id: 'account-1', contact_id: 'contact-1', invoice_id: 'invoice-1', collection_commitment_id: 'promise-1', commitment_revision: 1, kind: 'promise_to_pay', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'promise-broken', effective_due_on: '2026-09-10', activation_generation: 'promise-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      if (name === 'reconcile_invoice_collection_commitment') return Promise.resolve({ data: 'broken', error: null });
      if (name === 'invoice_commitment_payment_allocations') return Promise.resolve({ data: 0, error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => { await args.beforeSend(); return { whatsapp_message_id: 'wamid-broken-promise' }; });
    const { runLifecycleReminderWorker } = await import('./worker');
    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(summary.accepted).toBe(1);
    expect(h.rpc.mock.calls.map(([name]) => name)).toContain('mark_lifecycle_reminder_provider_attempt');
    h.commitmentKind = null; h.promiseBroken = false;
  });

  it('defers, rather than loses, a promise whose payment allocation changes at the provider boundary', async () => {
    h.commitmentKind = 'promise'; h.promiseBroken = false; h.partialAtBoundary = true; h.allocationCalls = 0; h.rpc.mockReset(); h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'partial-promise-job', account_id: 'account-1', contact_id: 'contact-1', invoice_id: 'invoice-1', collection_commitment_id: 'promise-1', commitment_revision: 1, kind: 'promise_to_pay', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'promise-due', effective_due_on: '2026-09-11', activation_generation: 'promise-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      if (name === 'reconcile_invoice_collection_commitment') return Promise.resolve({ data: 'open', error: null });
      if (name === 'invoice_commitment_payment_allocations') return Promise.resolve({ data: ++h.allocationCalls > 1 ? 20 : 0, error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => { await args.beforeSend(); return { whatsapp_message_id: 'should-not-send' }; });
    const { runLifecycleReminderWorker } = await import('./worker');
    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(summary.deferred).toBe(1);
    expect(h.rpc.mock.calls.map(([name]) => name)).not.toContain('mark_lifecycle_reminder_provider_attempt');
    h.commitmentKind = null; h.partialAtBoundary = false;
  });

  it('uses the shared worker path for an accepted, exact-balance payment link', async () => {
    h.paymentLinkKind = true; h.rpc.mockReset(); h.engineSend.mockReset();
    h.rpc.mockImplementation((name: string) => {
      if (name === 'claim_lifecycle_reminder_jobs') return Promise.resolve({ data: [{ id: 'link-job-1', account_id: 'account-1', contact_id: 'contact-1', invoice_id: 'invoice-1', installment_plan_id: null, payment_link_id: 'link-1', payment_link_revision: 1, kind: 'payment_link_follow_up', business_key: 'key', subject_cycle_id: 'cycle', milestone_key: 'link-after-1', effective_due_on: '2026-09-10', activation_generation: 'link-generation-1', state: 'leased', attempt_count: 0, lease_owner: 'worker-1', lease_generation: 1, provider_message_id: null }], error: null });
      if (name === 'reserve_lifecycle_reminder_daily_claim') return Promise.resolve({ data: 'reserved', error: null });
      return Promise.resolve({ data: true, error: null });
    });
    h.engineSend.mockImplementation(async (args: { beforeSend: () => Promise<void> }) => { await args.beforeSend(); return { whatsapp_message_id: 'wamid-link-1' }; });
    const { runLifecycleReminderWorker } = await import('./worker');
    const summary = await runLifecycleReminderWorker(new Date('2026-09-11T10:00:00.000Z'));
    expect(summary.accepted).toBe(1);
    expect(h.engineSend).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'gym_payment_link' }));
    expect(h.rpc.mock.calls.map(([name]) => name)).toContain('mark_lifecycle_reminder_provider_attempt');
    h.paymentLinkKind = false;
  });
});
