import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ send: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/automations/meta-send', () => ({ engineSendTemplate: h.send }));
vi.mock('@/lib/locale/config', () => ({
  resolveAccountLocale: () => ({
    timeZone: 'UTC',
    locale: 'en-IN',
    currency: 'INR',
    countryCode: 'IN',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+91',
    measurementSystem: 'metric',
  }),
}));
vi.mock('@/lib/locale/format', () => ({
  dayStartInTz: (date: string) => new Date(`${date}T00:00:00.000Z`),
  todayInTz: () => '2026-09-11',
  buildFormatters: () => ({
    date: (value: string) => value,
    money: (value: number) => `₹${value}`,
  }),
}));
vi.mock('@/lib/whatsapp/template-readiness', () => ({
  evaluateTemplateReadiness: () => ({
    ready: true,
    row: { language: 'en_US' },
  }),
}));

class Query {
  constructor(
    private readonly table: string,
    private readonly rows: Record<string, unknown>
  ) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  gte() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({
      data: this.rows[this.table] ?? null,
      error: null,
    });
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    ok?:
      | ((value: {
          data: unknown;
          error: null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    bad?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({
      data: this.rows[this.table] ?? [],
      error: null,
    }).then(ok, bad);
  }
}

const account = {
  id: 'account-1',
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
};
const settings = {
  session_pack_reminders_enabled: true,
  session_pack_reminders_activated_on: '2026-09-01',
  session_pack_reminders_activated_at: '2026-09-01T00:00:00Z',
  session_pack_reminders_generation: 'gen-1',
};

describe('retention worker', () => {
  it('does not send an obsolete low-session job once zero sessions supersede it', async () => {
    const { processRetentionJob } = await import('./retention-worker');
    h.send.mockReset();
    const finish = vi.fn().mockResolvedValue(undefined);
    const member = {
      id: 'member-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      start_date: '2026-09-01',
      end_date: '2026-10-01',
      status: 'active',
      collection_mode: 'manual',
      planned_return_on: null,
      plan: { name: 'Pack', plan_type: 'session_pack', sessions_count: 10 },
      contact: { name: 'Asha', phone: '+9199' },
    };
    const admin = {
      from: (table: string) =>
        new Query(table, {
          renewal_reminder_settings: settings,
          memberships: member,
          whatsapp_config: { status: 'connected' },
          message_templates: [],
        }),
      rpc: (name: string) =>
        name === 'attendance_usage_counts'
          ? Promise.resolve({
              data: [{ membership_id: 'member-1', used: 10 }],
              error: null,
            })
          : Promise.resolve({ data: true, error: null }),
    } as never;
    await processRetentionJob({
      admin,
      job: {
        id: 'job-1',
        account_id: 'account-1',
        contact_id: 'contact-1',
        membership_id: 'member-1',
        kind: 'session_pack_low',
        subject_cycle_id: 'member-1:2026-09-01:2026-10-01:gen-1',
        milestone_key: 'sessions-2',
        effective_due_on: '2026-10-01',
        activation_generation: 'gen-1',
        attempt_count: 0,
        lease_owner: 'worker-1',
        lease_generation: 1,
      } as never,
      account,
      now: new Date('2026-09-11T10:00:00Z'),
      summary: {
        accountsConsidered: 0,
        queued: 0,
        deferred: 0,
        attempted: 0,
        accepted: 0,
        blocked: 0,
        skipped: 0,
        failed: 0,
        ambiguous: 0,
        infrastructureFailures: 0,
        notes: [],
      },
      finish,
      findConversation: vi.fn(),
      markProviderAttempt: vi.fn(),
      reserveDailyClaim: vi.fn(),
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'session_threshold_superseded' },
    });
  });

  it('creates a return-day staff action without a provider send', async () => {
    const { processRetentionJob } = await import('./retention-worker');
    h.send.mockReset();
    const finish = vi.fn().mockResolvedValue(undefined);
    const member = {
      id: 'member-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      start_date: '2026-09-01',
      end_date: '2026-10-01',
      status: 'frozen',
      collection_mode: 'manual',
      planned_return_on: '2026-09-11',
      plan: null,
      contact: { name: 'Asha', phone: '+9199' },
    };
    const admin = {
      from: (table: string) =>
        new Query(table, {
          renewal_reminder_settings: {
            ...settings,
            freeze_return_reminders_enabled: true,
            freeze_return_reminders_activated_on: '2026-09-01',
            freeze_return_reminders_activated_at: '2026-09-01T00:00:00Z',
            freeze_return_reminders_generation: 'freeze-1',
          },
          memberships: member,
        }),
      rpc: vi.fn().mockResolvedValue({ data: 'created', error: null }),
    } as never;
    await processRetentionJob({
      admin,
      job: {
        id: 'job-2',
        account_id: 'account-1',
        contact_id: 'contact-1',
        membership_id: 'member-1',
        kind: 'freeze_return',
        subject_cycle_id: 'member-1:2026-09-11:freeze-1',
        milestone_key: 'return-day-follow-up',
        effective_due_on: '2026-09-11',
        activation_generation: 'freeze-1',
        attempt_count: 0,
        lease_owner: 'worker-1',
        lease_generation: 1,
      } as never,
      account,
      now: new Date('2026-09-11T10:00:00Z'),
      summary: {
        accountsConsidered: 0,
        queued: 0,
        deferred: 0,
        attempted: 0,
        accepted: 0,
        blocked: 0,
        skipped: 0,
        failed: 0,
        ambiguous: 0,
        infrastructureFailures: 0,
        notes: [],
      },
      finish,
      findConversation: vi.fn(),
      markProviderAttempt: vi.fn(),
      reserveDailyClaim: vi.fn(),
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('accepted', {
      reason: { code: 'freeze_return_follow_up_created' },
    });
  });

  it('never sends a late day-before return reminder', async () => {
    const { processRetentionJob } = await import('./retention-worker');
    h.send.mockReset();
    const finish = vi.fn().mockResolvedValue(undefined);
    const member = {
      id: 'member-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      start_date: '2026-09-01',
      end_date: '2026-10-01',
      status: 'frozen',
      collection_mode: 'manual',
      planned_return_on: '2026-09-11',
      plan: null,
      contact: { name: 'Asha', phone: '+9199' },
    };
    const admin = {
      from: (table: string) =>
        new Query(table, {
          renewal_reminder_settings: {
            ...settings,
            freeze_return_reminders_enabled: true,
            freeze_return_reminders_activated_on: '2026-09-01',
            freeze_return_reminders_activated_at: '2026-09-01T00:00:00Z',
            freeze_return_reminders_generation: 'freeze-1',
          },
          memberships: member,
        }),
      rpc: vi.fn(),
    } as never;
    await processRetentionJob({
      admin,
      job: {
        id: 'job-3',
        account_id: 'account-1',
        contact_id: 'contact-1',
        membership_id: 'member-1',
        kind: 'freeze_return',
        subject_cycle_id: 'member-1:2026-09-11:freeze-1',
        milestone_key: 'return-before-1',
        effective_due_on: '2026-09-11',
        activation_generation: 'freeze-1',
        attempt_count: 0,
        lease_owner: 'worker-1',
        lease_generation: 1,
      } as never,
      account,
      now: new Date('2026-09-11T10:00:00Z'),
      summary: {
        accountsConsidered: 0,
        queued: 0,
        deferred: 0,
        attempted: 0,
        accepted: 0,
        blocked: 0,
        skipped: 0,
        failed: 0,
        ambiguous: 0,
        infrastructureFailures: 0,
        notes: [],
      },
      finish,
      findConversation: vi.fn(),
      markProviderAttempt: vi.fn(),
      reserveDailyClaim: vi.fn(),
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'retention_subject_changed' },
    });
  });

  it('supersedes a stale +14 win-back job once +30 is current', async () => {
    const { processRetentionJob } = await import('./retention-worker');
    h.send.mockReset();
    const finish = vi.fn().mockResolvedValue(undefined);
    const member = {
      id: 'member-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      start_date: '2026-06-01',
      end_date: '2026-08-12',
      status: 'active',
      collection_mode: 'manual',
      planned_return_on: null,
      plan: { name: 'Quarterly', plan_type: 'recurring', sessions_count: null },
      contact: { name: 'Asha', phone: '+9199' },
    };
    const admin = {
      from: (table: string) =>
        new Query(table, {
          renewal_reminder_settings: {
            ...settings,
            membership_win_back_enabled: true,
            membership_win_back_activated_on: '2026-08-01',
            membership_win_back_activated_at: '2026-08-01T00:00:00Z',
            membership_win_back_generation: 'winback-1',
          },
          memberships: member,
        }),
      rpc: vi.fn(),
    } as never;
    await processRetentionJob({
      admin,
      job: {
        id: 'job-4',
        account_id: 'account-1',
        contact_id: 'contact-1',
        membership_id: 'member-1',
        kind: 'membership_win_back',
        subject_cycle_id: 'member-1:2026-08-12:winback-1',
        milestone_key: 'win-back-14',
        effective_due_on: '2026-08-12',
        activation_generation: 'winback-1',
        attempt_count: 0,
        lease_owner: 'worker-1',
        lease_generation: 1,
      } as never,
      account,
      now: new Date('2026-09-11T10:00:00Z'),
      summary: {
        accountsConsidered: 0,
        queued: 0,
        deferred: 0,
        attempted: 0,
        accepted: 0,
        blocked: 0,
        skipped: 0,
        failed: 0,
        ambiguous: 0,
        infrastructureFailures: 0,
        notes: [],
      },
      finish,
      findConversation: vi.fn(),
      markProviderAttempt: vi.fn(),
      reserveDailyClaim: vi.fn(),
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'win_back_milestone_superseded' },
    });
  });
});
