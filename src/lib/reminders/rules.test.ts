import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getReminderRule,
  parseReminderRulePatch,
  REMINDER_RULE_GROUP_LABELS,
  REMINDER_RULES,
} from './rules';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260923120000_template_variable_boundaries.sql'
  ),
  'utf8'
);
const activationMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260912103000_reminder_rule_activation_readiness.sql'
  ),
  'utf8'
);

describe('reminder rule catalogue', () => {
  it('owns each persisted column exactly once so rule saves cannot overwrite a neighbour', () => {
    const columns = REMINDER_RULES.flatMap((rule) =>
      rule.fields.map((field) => field.column)
    );
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('only accepts a selected rule’s allowlisted fields', () => {
    const rule = getReminderRule('invoice_collection')!;
    expect(
      parseReminderRulePatch(rule, {
        beforeDueDays: [3, 1, 1],
        sendWindowStart: 10,
      })
    ).toEqual({
      ok: true,
      value: {
        invoice_collection_before_due_days: [1, 3],
        invoice_collection_send_window_start: 10,
      },
    });
    expect(
      parseReminderRulePatch(rule, { serviceEnabled: true })
    ).toMatchObject({ ok: false });
  });

  it('keeps the owner-facing vocabulary and timing capability in one shared catalogue', () => {
    expect(REMINDER_RULE_GROUP_LABELS).toMatchObject({
      collections: 'Payment reminders',
      retention: 'Keep members coming back',
    });
    expect(getReminderRule('invoice_collection')).toMatchObject({
      title: 'Unpaid invoice reminders',
      schedule: { capability: 'editable-date-offsets' },
    });
    expect(getReminderRule('joining_installments')).toMatchObject({
      title: 'Installment reminders',
      configurable: false,
      schedule: { capability: 'checkout-managed' },
    });
    expect(getReminderRule('autopay_recovery')).toMatchObject({
      title: 'AutoPay payment problems',
      schedule: { capability: 'event-driven' },
    });
  });

  it('rejects a reminder-day selection above the documented maximum', () => {
    const rule = getReminderRule('membership_renewal')!;
    expect(
      parseReminderRulePatch(rule, {
        daysBefore: [30, 14, 7, 3, 2, 1, 0],
      })
    ).toMatchObject({ ok: false });
  });
});

describe('reminder activation SQL contract', () => {
  const contractIds = [
    'membership_renewal',
    'service_renewal',
    'membership_post_expiry',
    'service_post_expiry',
    'invoice_due',
    'invoice_overdue',
    'payment_promise_upcoming',
    'payment_promise_missed',
    'payment_link',
    'autopay_recovery_pending',
    'autopay_recovery_terminal',
    'session_pack_low',
    'session_pack_exhausted',
    'freeze_return',
    'membership_win_back',
    'service_win_back',
    'payment_confirmation',
    'payment_membership_renewal_confirmation',
  ] as const;

  const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('keeps every SQL readiness tuple exactly aligned with canonical contracts', () => {
    for (const id of contractIds) {
      const payload = TEMPLATE_CONTRACTS[id].payload;
      const tuple = new RegExp(
        `\\('${id}', '([^']+)', '([^']+)', '(${escapeRegex(payload.body_text)})', (NULL|'([^']*)'), '(\\[.*?\\])'::jsonb\\)`
      ).exec(migration);
      expect(tuple).not.toBeNull();
      expect({
        name: tuple?.[1],
        category: tuple?.[2],
        body_text: tuple?.[3],
        footer_text: tuple?.[4] === 'NULL' ? null : tuple?.[5],
        buttons: JSON.parse(tuple?.[6] ?? '[]'),
      }).toEqual({
        name: payload.name,
        category: payload.category,
        body_text: payload.body_text,
        footer_text: payload.footer_text ?? null,
        buttons: payload.buttons ?? [],
      });
    }
  });

  it('blocks only activation edges and leaves lifecycle generation triggers in place', () => {
    expect(activationMigration).toContain('NOT COALESCE(OLD.enabled, FALSE)');
    expect(activationMigration).toContain('BEFORE INSERT OR UPDATE');
    expect(activationMigration).toContain(
      'trg_reminder_rule_activation_readiness'
    );
    expect(activationMigration).toContain(
      'Reminder rule membership_renewal cannot be enabled'
    );
    expect(activationMigration).toContain('reminder_template_buttons_match');
  });
});
