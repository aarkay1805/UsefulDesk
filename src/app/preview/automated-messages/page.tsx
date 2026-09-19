'use client';

import { Suspense } from 'react';
import { notFound, useSearchParams } from 'next/navigation';

import { RenewalRemindersSettings } from '@/components/settings/renewal-reminders-settings';
import { PreviewAuthProvider } from '@/hooks/use-auth';
import { isAccountRole } from '@/lib/auth/roles';
import type { AutomatedMessageActivityRow } from '@/lib/reminders/activity';
import {
  REMINDER_RULES,
  ruleSettingsFromRow,
  type ReminderRulePatch,
  type ReminderRuleResponse,
} from '@/lib/reminders/rules';

// Dev-only visual harness for Settings → Automated messages. The real panel
// lives behind auth and reads branch settings plus template readiness, so this
// answers its settings request with every rule at its defaults and a mix of
// readiness states (ready, template missing, WhatsApp missing). It renders as
// an owner; `?role=agent|viewer` shows the read-only rules and the Activity
// permission state. Saves apply to the in-memory fixtures and an unready
// activation is refused, as the API does. Open and scroll to a rule with
// `?rule=<id>`.
//
// The Activity tab reads fixture history and schedule checks. Force its other
// states with `?activity=empty|error|loading` and `?readiness=error|loading`.
// Never reachable in production.

const RULES: ReminderRuleResponse[] = REMINDER_RULES.map((rule, index) => ({
  ...rule,
  settings: {
    ...ruleSettingsFromRow(rule, null),
    ...(index % 3 === 0 ? { enabled: true } : {}),
    // One rule sends late only on its own day, to show the zero wording.
    ...(rule.id === 'membership_post_expiry' ? { catchUpDays: 0 } : {}),
  },
  readiness:
    index % 4 === 1
      ? {
          ready: false,
          code: 'template_missing',
          message: 'Create and approve the exact template before it can send.',
          templateContractId: rule.templateContracts[0],
        }
      : { ready: true, code: 'ready' },
}));

const DIAGNOSTICS = [
  {
    kind: 'membership_renewal',
    state: 'ready',
    reason: '3 unclaimed reminders can send now.',
  },
  {
    kind: 'service_renewal',
    state: 'blocked',
    reason: 'gym_service_renewal is still Pending Meta review.',
  },
  {
    kind: 'installment_reminder',
    state: 'no_eligible',
    reason: 'No eligible reminders are due right now.',
  },
];

let fixtureId = 0;
function activity(
  row: Partial<AutomatedMessageActivityRow> &
    Pick<
      AutomatedMessageActivityRow,
      'rule_id' | 'outcome' | 'occurred_at' | 'contact_name'
    >
): AutomatedMessageActivityRow {
  fixtureId += 1;
  const suffix = String(fixtureId).padStart(12, '0');
  return {
    activity_id: `lifecycle:00000000-0000-4000-8000-${suffix}`,
    account_id: '00000000-0000-4000-8000-000000000000',
    source_kind: row.rule_id,
    contact_id: `00000000-0000-4000-9000-${suffix}`,
    contact_avatar_url: null,
    membership_id: null,
    member_service_id: null,
    invoice_id: null,
    conversation_id: null,
    follow_up_id: null,
    scheduled_for: '2026-09-18',
    job_state: null,
    escalation_state: null,
    next_attempt_at: null,
    reason_code: null,
    provider_message_id: null,
    message_status: null,
    provider_error_title: null,
    provider_error_detail: null,
    ...row,
  };
}

const ACTIVITY: AutomatedMessageActivityRow[] = [
  activity({
    contact_name: 'Asha Verma',
    rule_id: 'membership_renewal',
    outcome: 'read',
    occurred_at: '2026-09-16T04:02:00.000Z',
    scheduled_for: '2026-09-19',
    membership_id: 'membership-1',
    conversation_id: 'conversation-1',
  }),
  activity({
    contact_name: 'Karthik Subramanian Iyer',
    rule_id: 'invoice_collection',
    outcome: 'failed',
    occurred_at: '2026-09-16T03:48:00.000Z',
    scheduled_for: '2026-09-15',
    invoice_id: 'invoice-2',
    conversation_id: 'conversation-2',
    follow_up_id: 'follow-up-2',
    provider_error_title: 'Message undeliverable',
    provider_error_detail:
      'The recipient phone number is not registered on WhatsApp.',
  }),
  activity({
    contact_name: 'Neha Kapoor',
    rule_id: 'membership_post_expiry',
    outcome: 'blocked',
    occurred_at: '2026-09-16T03:40:00.000Z',
    scheduled_for: '2026-09-13',
    membership_id: 'membership-3',
    reason_code: 'template_not_ready',
    next_attempt_at: '2026-09-17T03:30:00.000Z',
  }),
  activity({
    contact_name: 'Arjun Reddy',
    rule_id: 'autopay_recovery',
    outcome: 'ambiguous',
    occurred_at: '2026-09-16T03:31:00.000Z',
    scheduled_for: '2026-09-15',
    invoice_id: 'invoice-4',
    conversation_id: 'conversation-4',
    follow_up_id: 'follow-up-4',
    reason_code: 'provider_outcome_unknown',
  }),
  activity({
    contact_name: 'Meera Joshi',
    rule_id: 'payment_link_follow_up',
    outcome: 'waiting',
    occurred_at: '2026-09-16T02:10:00.000Z',
    scheduled_for: '2026-09-15',
    invoice_id: 'invoice-5',
    reason_code: 'outside_send_window',
    next_attempt_at: '2026-09-16T03:30:00.000Z',
  }),
  activity({
    contact_name: 'Vikram Singh',
    rule_id: 'promise_to_pay',
    outcome: 'paused',
    occurred_at: '2026-09-15T12:20:00.000Z',
    scheduled_for: '2026-09-17',
    invoice_id: 'invoice-6',
    reason_code: 'invoice_commitment_or_hold_open',
  }),
  activity({
    contact_name: 'Rohan Mehta',
    rule_id: 'invoice_collection',
    outcome: 'delivered',
    occurred_at: '2026-09-15T04:05:00.000Z',
    scheduled_for: '2026-09-15',
    invoice_id: 'invoice-7',
    conversation_id: 'conversation-7',
  }),
  activity({
    contact_name: 'Priya Nair',
    rule_id: 'service_renewal',
    outcome: 'accepted',
    occurred_at: '2026-09-15T03:58:00.000Z',
    scheduled_for: '2026-09-22',
    member_service_id: 'service-8',
    conversation_id: 'conversation-8',
  }),
  activity({
    contact_name: 'Dev Patel',
    rule_id: 'session_pack',
    outcome: 'attempting',
    occurred_at: '2026-09-15T03:57:00.000Z',
    scheduled_for: '2026-10-01',
    membership_id: 'membership-9',
  }),
  activity({
    contact_name: 'Sana Sheikh',
    rule_id: 'membership_post_expiry',
    outcome: 'stopped',
    occurred_at: '2026-09-14T09:12:00.000Z',
    scheduled_for: '2026-09-11',
    membership_id: 'membership-10',
    conversation_id: 'conversation-10',
    reason_code: 'customer_replied',
  }),
  activity({
    contact_name: 'Ishita Banerjee',
    rule_id: 'membership_win_back',
    outcome: 'stopped',
    occurred_at: '2026-09-14T04:00:00.000Z',
    scheduled_for: '2026-08-15',
    membership_id: 'membership-11',
    conversation_id: 'conversation-11',
    follow_up_id: 'follow-up-11',
    escalation_state: 'created',
  }),
  activity({
    contact_name: 'Rahul Gupta',
    rule_id: 'freeze_return',
    outcome: 'delivered',
    occurred_at: '2026-09-13T03:45:00.000Z',
    scheduled_for: '2026-09-14',
    membership_id: 'membership-12',
    conversation_id: 'conversation-12',
  }),
  activity({
    contact_name: 'Kavya Menon',
    rule_id: 'payment_confirmation',
    outcome: 'read',
    occurred_at: '2026-09-12T11:30:00.000Z',
    scheduled_for: '2026-09-12',
    invoice_id: 'invoice-13',
    conversation_id: 'conversation-13',
  }),
  activity({
    contact_name: 'Farhan Qureshi',
    rule_id: 'invoice_collection',
    outcome: 'blocked',
    occurred_at: '2026-09-12T03:30:00.000Z',
    scheduled_for: '2026-09-12',
    invoice_id: 'invoice-14',
    reason_code: 'missing_phone',
  }),
  activity({
    contact_name: null,
    rule_id: 'membership_renewal',
    outcome: 'unconfirmed',
    occurred_at: '2026-09-10T03:31:00.000Z',
    scheduled_for: '2026-09-13',
    membership_id: 'membership-15',
    reason_code: 'legacy_claim_unconfirmed',
  }),
  activity({
    contact_name: 'Tanvi Deshpande',
    rule_id: 'joining_installments',
    outcome: 'delivered',
    occurred_at: '2026-09-09T03:40:00.000Z',
    scheduled_for: '2026-09-10',
    membership_id: 'membership-16',
    invoice_id: 'invoice-16',
    conversation_id: 'conversation-16',
  }),
];

const PAGE_SIZE = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function never(): Promise<Response> {
  return new Promise(() => {});
}

function activityResponse(url: URL) {
  const mode = new URLSearchParams(window.location.search).get('activity');
  if (mode === 'loading') return never();
  if (mode === 'error')
    return Promise.resolve(json({ error: 'Internal server error' }, 500));
  const params = url.searchParams;
  const rule = params.get('rule');
  const outcome = params.get('outcome');
  const from = params.get('from');
  const to = params.get('to');
  const matches =
    mode === 'empty'
      ? []
      : ACTIVITY.filter(
          (row) =>
            (!rule || row.rule_id === rule) &&
            (!outcome || row.outcome === outcome) &&
            (!from || row.occurred_at.slice(0, 10) >= from) &&
            (!to || row.occurred_at.slice(0, 10) <= to)
        );
  const start = params.get('cursor') ? PAGE_SIZE : 0;
  const items = matches.slice(start, start + PAGE_SIZE);
  const nextCursor = matches.length > start + PAGE_SIZE ? 'page-2' : null;
  // A short delay keeps the loading state observable between filter changes.
  return new Promise<Response>((resolve) =>
    setTimeout(() => resolve(json({ items, nextCursor })), 350)
  );
}

function saveResponse(init?: RequestInit) {
  const { ruleId, patch } = JSON.parse(String(init?.body ?? '{}')) as {
    ruleId?: string;
    patch?: ReminderRulePatch;
  };
  const index = RULES.findIndex((rule) => rule.id === ruleId);
  if (index < 0 || !patch)
    return json({ error: 'Unknown reminder rule.' }, 400);
  const rule = RULES[index];
  if (
    patch.enabled === true &&
    rule.settings.enabled !== true &&
    !rule.readiness.ready
  ) {
    return json(
      { error: rule.readiness.message, code: rule.readiness.code },
      409
    );
  }
  RULES[index] = { ...rule, settings: { ...rule.settings, ...patch } };
  return json({ rule: RULES[index] });
}

function readinessResponse() {
  const mode = new URLSearchParams(window.location.search).get('readiness');
  if (mode === 'loading') return never();
  if (mode === 'error')
    return Promise.resolve(json({ error: 'Unavailable.' }, 500));
  return Promise.resolve(
    json({ checkedAt: new Date().toISOString(), diagnostics: DIAGNOSTICS })
  );
}

if (typeof window !== 'undefined') {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const url = new URL(raw, window.location.origin);
    if (url.pathname === '/api/reminders/settings') {
      return init?.method === 'PATCH'
        ? saveResponse(init)
        : json({ whatsappConnected: true, rules: RULES });
    }
    if (url.pathname === '/api/reminders/activity')
      return activityResponse(url);
    if (url.pathname === '/api/reminders/readiness') return readinessResponse();
    return realFetch(input, init);
  };
}

function PreviewPanel() {
  const role = useSearchParams().get('role');
  return (
    <PreviewAuthProvider role={isAccountRole(role) ? role : 'owner'}>
      <RenewalRemindersSettings />
    </PreviewAuthProvider>
  );
}

export default function AutomatedMessagesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-screen">
      <div className="p-4 sm:p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
          <div aria-hidden className="hidden lg:block" />
          <div className="min-w-0">
            <Suspense>
              <PreviewPanel />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
