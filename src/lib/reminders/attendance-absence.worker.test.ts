import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processAttendanceAbsenceJob } from './attendance-absence';
import type { LifecycleReminderJob, ReminderRunSummary } from './types';

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/automations/meta-send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/automations/meta-send')>()),
  engineSendTemplate: h.send,
}));
vi.mock('@/lib/whatsapp/template-readiness', () => ({
  evaluateTemplateReadiness: () => ({
    ready: true,
    row: { language: 'en_US' },
  }),
}));

class Query {
  private selection = '';
  constructor(
    private table: string,
    private rows: Record<string, unknown>
  ) {}
  select(columns: string) {
    this.selection = columns;
    return this;
  }
  eq() {
    return this;
  }
  gte() {
    return this;
  }
  lt() {
    return this;
  }
  lte() {
    return this;
  }
  order() {
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
  then(ok: (value: { data: unknown; error: null }) => unknown) {
    return Promise.resolve({
      data:
        this.table === 'attendance' && this.selection === 'checked_in_at'
          ? (this.rows.lastVisit ?? [])
          : (this.rows[this.table] ?? []),
      error: null,
    }).then(ok);
  }
}

const job = {
  id: 'job-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  membership_id: 'membership-1',
  kind: 'attendance_streak',
  milestone_key: 'since-2026-09-19:on-2026-09-24:n-1',
  effective_due_on: '2026-09-24',
  scheduled_for_at: '2026-09-24T08:30:00.000Z',
  activation_generation: 'generation-2',
} as LifecycleReminderJob;

function summary(): ReminderRunSummary {
  return {
    accountsConsidered: 1,
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
  };
}

function setup(
  attendance: unknown[],
  {
    streakEnabled = true,
    lastVisit = [{ checked_in_at: '2026-09-18T08:00:00.000Z' }] as unknown[],
    assignedArrival = '07:30:00',
    replied = false,
  } = {}
) {
  const rows = {
    renewal_reminder_settings: {
      attendance_streak_enabled: streakEnabled,
      attendance_streak_generation: 'generation-2',
      invoice_collection_send_window_end: 19,
    },
    memberships: {
      id: 'membership-1',
      contact_id: 'contact-1',
      status: 'active',
      start_date: '2026-09-01',
      end_date: '2026-10-01',
      contact: {
        name: 'Asha',
        phone: '+919999999999',
        assigned_arrival_time: assignedArrival,
      },
    },
    attendance,
    lastVisit,
    whatsapp_config: { status: 'connected' },
    message_templates: [{ name: 'gym_extended_absence' }],
  };
  const finish = vi.fn().mockResolvedValue(undefined);
  const markProviderAttempt = vi.fn().mockResolvedValue(undefined);
  const reserveDailyClaim = vi.fn().mockResolvedValue('reserved');
  const result = summary();
  const args = {
    admin: {
      from: (table: string) => new Query(table, rows),
      rpc: vi.fn().mockResolvedValue({ data: replied, error: null }),
    } as unknown as Parameters<typeof processAttendanceAbsenceJob>[0]['admin'],
    job,
    account: {
      owner_user_id: 'owner-1',
      timezone: 'UTC',
      legalBusinessName: 'FitZone',
    },
    now: new Date('2026-09-24T08:40:00.000Z'),
    summary: result,
    finish,
    findConversation: vi.fn().mockResolvedValue('conversation-1'),
    markProviderAttempt,
    reserveDailyClaim,
  };
  return { args, finish, markProviderAttempt, result };
}

describe('six-day absence delivery', () => {
  beforeEach(() => {
    h.send.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T08:40:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('stops when a check-in exists before the reminder is sent', async () => {
    const { args, finish, result } = setup([{ id: 'visit-1' }]);
    await processAttendanceAbsenceJob(args);
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'attendance_streak_no_longer_eligible' },
    });
    expect(result.skipped).toBe(1);
  });

  it('rechecks attendance before the provider call and marks the attempt', async () => {
    const { args, finish, markProviderAttempt, result } = setup([]);
    h.send.mockImplementation(
      async (input: { beforeSend: () => Promise<void> }) => {
        await input.beforeSend();
        return { whatsapp_message_id: 'wamid-1' };
      }
    );
    await processAttendanceAbsenceJob(args);
    expect(finish.mock.calls.map(([state]) => state)).toEqual([
      'attempting',
      'accepted',
    ]);
    expect(markProviderAttempt).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'gym_extended_absence',
        params: ['Asha', 'FitZone'],
      })
    );
    expect(result.accepted).toBe(1);
  });

  it('uses the assigned arrival on a repeat reminder day', async () => {
    const { args, result } = setup([], {
      streakEnabled: true,
      lastVisit: [{ checked_in_at: '2026-09-18T08:00:00.000Z' }],
    });
    args.job = {
      ...job,
      kind: 'attendance_streak',
      milestone_key: 'since-2026-09-19:on-2026-09-30:n-2',
      effective_due_on: '2026-09-30',
      scheduled_for_at: '2026-09-30T08:30:00.000Z',
      activation_generation: 'generation-2',
    };
    args.now = new Date('2026-09-30T08:40:00.000Z');
    vi.setSystemTime(args.now);
    h.send.mockImplementation(
      async (input: { beforeSend: () => Promise<void> }) => {
        await input.beforeSend();
        return { whatsapp_message_id: 'wamid-2' };
      }
    );

    await processAttendanceAbsenceJob(args);

    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'gym_extended_absence',
        params: ['Asha', 'FitZone'],
      })
    );
    expect(result.accepted).toBe(1);
  });

  it('does not send a retired daily reminder job', async () => {
    const { args, finish } = setup([]);
    args.job = { ...job, kind: 'attendance_absence' };
    await processAttendanceAbsenceJob(args);
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'attendance_streak_no_longer_eligible' },
    });
  });

  it('does not send a third automated message in the same absence streak', async () => {
    const { args, finish } = setup([]);
    args.job = {
      ...job,
      milestone_key: 'since-2026-09-19:on-2026-09-24:n-3',
    };
    await processAttendanceAbsenceJob(args);
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'attendance_streak_no_longer_eligible' },
    });
  });

  it('stops the second message when the member has replied', async () => {
    const { args, finish } = setup([], { replied: true });
    args.job = {
      ...job,
      milestone_key: 'since-2026-09-19:on-2026-09-30:n-2',
      effective_due_on: '2026-09-30',
      scheduled_for_at: '2026-09-30T08:30:00.000Z',
    };
    args.now = new Date('2026-09-30T08:40:00.000Z');
    await processAttendanceAbsenceJob(args);
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'attendance_streak_no_longer_eligible' },
    });
  });

  it('cancels a queued longer-absence reminder after a new check-in', async () => {
    const { args, finish } = setup([], {
      streakEnabled: true,
      lastVisit: [{ checked_in_at: '2026-09-24T17:00:00.000Z' }],
    });
    args.job = {
      ...job,
      kind: 'attendance_streak',
      milestone_key: 'since-2026-09-19:on-2026-09-24:n-1',
      scheduled_for_at: '2026-09-24T08:30:00.000Z',
      activation_generation: 'generation-2',
    };
    args.now = new Date('2026-09-24T08:40:00.000Z');
    await processAttendanceAbsenceJob(args);
    expect(h.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('skipped', {
      reason: { code: 'attendance_streak_no_longer_eligible' },
    });
  });

  it('retries the same streak at the next daily slot when another message used today', async () => {
    const { args, finish, result } = setup([], {
      streakEnabled: true,
      lastVisit: [{ checked_in_at: '2026-09-18T08:00:00.000Z' }],
    });
    args.job = {
      ...job,
      kind: 'attendance_streak',
      milestone_key: 'since-2026-09-19:on-2026-09-24:n-1',
      scheduled_for_at: '2026-09-24T08:30:00.000Z',
      activation_generation: 'generation-2',
    };
    args.now = new Date('2026-09-24T08:40:00.000Z');
    args.reserveDailyClaim = vi.fn().mockResolvedValue('deferred');
    await processAttendanceAbsenceJob(args);
    expect(finish).toHaveBeenCalledWith('deferred', {
      reason: { code: 'daily_contact_budget' },
      nextAttemptAt: '2026-09-25T08:30:00.000Z',
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(result.deferred).toBe(1);

    args.now = new Date('2026-09-25T08:40:00.000Z');
    args.reserveDailyClaim = vi.fn().mockResolvedValue('reserved');
    vi.setSystemTime(args.now);
    h.send.mockImplementation(
      async (input: { beforeSend: () => Promise<void> }) => {
        await input.beforeSend();
        return { whatsapp_message_id: 'wamid-3' };
      }
    );
    await processAttendanceAbsenceJob(args);
    expect(result.accepted).toBe(1);
    expect(h.send).toHaveBeenCalledOnce();
  });

  it('retries an overnight arrival at the next local slot', async () => {
    const { args, finish } = setup([], { assignedArrival: '23:30:00' });
    args.job = {
      ...job,
      scheduled_for_at: '2026-09-25T00:30:00.000Z',
    };
    args.now = new Date('2026-09-25T00:40:00.000Z');
    args.reserveDailyClaim = vi.fn().mockResolvedValue('deferred');
    await processAttendanceAbsenceJob(args);
    expect(finish).toHaveBeenCalledWith('deferred', {
      reason: { code: 'daily_contact_budget' },
      nextAttemptAt: '2026-09-26T00:30:00.000Z',
    });
  });
});
