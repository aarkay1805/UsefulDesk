import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  absenceDueAt,
  absenceStreakStart,
  hasSixAbsentDays,
} from './attendance-absence';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

describe('missed visit reminder timing', () => {
  it('sends an assigned arrival one hour later in the branch timezone', () => {
    expect(
      absenceDueAt('2026-09-24', '07:30:00', 19, 'Asia/Kolkata')?.toISOString()
    ).toBe('2026-09-24T03:00:00.000Z');
  });

  it('uses 30 minutes before the sending hours end for unassigned members', () => {
    expect(
      absenceDueAt('2026-09-24', null, 19, 'Asia/Kolkata')?.toISOString()
    ).toBe('2026-09-24T14:00:00.000Z');
  });

  it('keeps the scheduled visit day when a late slot becomes due after midnight', () => {
    expect(
      absenceDueAt('2026-09-24', '23:30', 23, 'Asia/Kolkata')?.toISOString()
    ).toBe('2026-09-24T19:00:00.000Z');
  });
});

describe('extended absence eligibility', () => {
  it('starts a new member on the membership start day and reaches day six exactly', () => {
    expect(absenceStreakStart('2026-09-01', null)).toBe('2026-09-01');
    expect(hasSixAbsentDays('2026-09-05', '2026-09-01', null)).toBe(false);
    expect(hasSixAbsentDays('2026-09-06', '2026-09-01', null)).toBe(true);
  });

  it('resets the count after each check-in, including one during the current day', () => {
    expect(absenceStreakStart('2026-09-01', '2026-09-18')).toBe('2026-09-19');
    expect(hasSixAbsentDays('2026-09-24', '2026-09-01', '2026-09-18')).toBe(
      true
    );
    expect(hasSixAbsentDays('2026-09-24', '2026-09-01', '2026-09-19')).toBe(
      false
    );
    expect(hasSixAbsentDays('2026-09-24', '2026-09-01', '2026-09-24')).toBe(
      false
    );
  });
});

describe('missed visit queue contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924140000_attendance_absence_reminders.sql'
    ),
    'utf8'
  );
  const windowMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924141000_attendance_absence_window_end.sql'
    ),
    'utf8'
  );
  const claimMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924142000_claim_attendance_absence_jobs.sql'
    ),
    'utf8'
  );
  const isolationMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924143000_isolate_attendance_absence_claims.sql'
    ),
    'utf8'
  );
  const priorityMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924144000_prioritize_collection_over_absence.sql'
    ),
    'utf8'
  );

  it('requires an active membership, no same-day check-in, and one durable daily key', () => {
    expect(migration).toContain("member.status = 'active'");
    expect(migration).toContain('FROM public.attendance visit');
    expect(migration).toContain('visit.checked_in_at >=');
    expect(migration).toContain('visit.checked_in_at <');
    expect(migration).toContain(
      'ON CONFLICT (account_id, business_key) DO NOTHING'
    );
    expect(migration).toContain('due_at >= activated_at');
    expect(windowMigration).toContain(
      "make_interval(hours => config.send_hour) + INTERVAL '30 minutes'"
    );
    expect(claimMigration).toContain("job.kind = 'attendance_absence'");
    expect(isolationMigration).toContain("job.kind <> 'attendance_absence'");
    expect(priorityMigration).toContain(
      "WHEN 'invoice_due' THEN 2 WHEN 'attendance_absence' THEN 1"
    );
  });
});

describe('extended absence SQL contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924150000_attendance_streak_reminders.sql'
    ),
    'utf8'
  );
  const dailySuppression = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924151000_suppress_daily_absence_during_streak.sql'
    ),
    'utf8'
  );
  const messageMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924152000_warm_extended_absence_copy.sql'
    ),
    'utf8'
  );
  const unifiedMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924153000_unify_attendance_absence_reminders.sql'
    ),
    'utf8'
  );
  const overnightMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924154000_count_absence_repeat_from_send_day.sql'
    ),
    'utf8'
  );
  const onePerContactMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924155000_one_absence_reminder_per_contact.sql'
    ),
    'utf8'
  );
  const cappedMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924156000_cap_absence_to_two_messages.sql'
    ),
    'utf8'
  );
  const handoffMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924157000_absence_staff_follow_up.sql'
    ),
    'utf8'
  );
  const queueOrderMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924158000_qualify_absence_queue_order.sql'
    ),
    'utf8'
  );
  const replyMigration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260924159000_stop_absence_sequence_on_reply.sql'
    ),
    'utf8'
  );

  it('matches the approved template and repeats at least six days after each send', () => {
    expect(messageMigration).toContain(
      TEMPLATE_CONTRACTS.attendance_streak.payload.body_text.replaceAll(
        "'",
        "''"
      )
    );
    expect(migration).toContain('GREATEST(member.start_date');
    expect(migration).toContain('WHERE visit_on >= streak_start + 5');
    expect(migration).toContain("':since-' || streak_start::text");
    expect(migration).toContain(
      'ON CONFLICT (account_id, business_key) DO NOTHING'
    );
    expect(migration).toContain(
      "job.kind IN ('attendance_absence', 'attendance_streak')"
    );
    expect(migration).toContain(
      "job.kind NOT IN ('attendance_absence', 'attendance_streak')"
    );
    expect(dailySuppression).toContain('NOT config.streak_enabled OR');
    expect(dailySuppression).toContain(
      'day.visit_on < GREATEST(member.start_date'
    );
    expect(unifiedMigration).toContain(
      'CHECK (NOT attendance_absence_enabled)'
    );
    expect(unifiedMigration).toContain('RETURN 0;');
    expect(unifiedMigration).toContain('last_send_on + 6');
    expect(unifiedMigration).toContain("':on-' || visit_on::text");
    expect(unifiedMigration).toContain(
      "contact.assigned_arrival_time + INTERVAL '1 hour'"
    );
    expect(unifiedMigration).toContain(
      "job.state IN ('queued', 'leased', 'attempting', 'blocked', 'deferred')"
    );
    expect(overnightMigration).toContain(
      '(due_at AT TIME ZONE timezone)::date >= last_send_on + 6'
    );
    expect(onePerContactMigration).toContain(
      'SELECT DISTINCT ON (account_id, contact_id, visit_on)'
    );
    expect(onePerContactMigration).toContain(
      'job.contact_id = candidate.contact_id'
    );
    expect(cappedMigration).toContain('AND prior_attempts < 2');
    expect(cappedMigration).toContain("':n-' || (prior_attempts + 1)::text");
    expect(handoffMigration).toContain("v_job.milestone_key NOT LIKE '%:n-2'");
    expect(handoffMigration).toContain("'inactive', 'todo', v_today + 1");
    expect(handoffMigration).toContain("SET status = 'cancelled'");
    expect(queueOrderMigration).toContain(
      'ORDER BY eligible.account_id, eligible.contact_id, eligible.visit_on'
    );
    expect(replyMigration).toContain("message.sender_type = 'customer'");
    expect(replyMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.attendance_absence_has_reply'
    );
  });
});
