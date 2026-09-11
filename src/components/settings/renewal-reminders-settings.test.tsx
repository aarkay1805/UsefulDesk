// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageTemplate } from '@/types';
import {
  TEMPLATE_CONTRACTS,
  type TemplateContractId,
} from '@/lib/whatsapp/template-contracts';

const database = vi.hoisted(() => ({
  templates: [] as Partial<MessageTemplate>[],
  history: [] as { state: string; created_at: string; reason: { code?: string } | null }[],
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-1', canEditSettings: true }),
}));

function approved(id: TemplateContractId): Partial<MessageTemplate> {
  return {
    account_id: 'account-1',
    ...TEMPLATE_CONTRACTS[id].payload,
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
  };
}

function makeQuery(table: string) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => {
      if (table === 'renewal_reminder_settings') {
        return {
          data: {
            enabled: false,
            days_before: [7, 3, 1],
            service_enabled: false,
            service_days_before: [7, 3, 1],
          },
          error: null,
        };
      }
      if (table === 'whatsapp_config') {
        return { data: { status: 'connected' }, error: null };
      }
      return { data: null, error: null };
    },
    then(
      onFulfilled: (value: {
        data: Partial<MessageTemplate>[];
        error: null;
      }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve({
        data: table === 'lifecycle_reminder_jobs' ? database.history : database.templates,
        error: null,
      }).then(
        onFulfilled,
        onRejected
      );
    },
  };
  return query;
}

const supabase = { from: (table: string) => makeQuery(table) };

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

const { RenewalRemindersSettings } =
  await import('./renewal-reminders-settings');

beforeEach(() => {
  database.templates = [];
  database.history = [];
});

afterEach(cleanup);

describe('RenewalRemindersSettings template readiness', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            diagnostics: [
              {
                kind: 'membership_renewal',
                state: 'no_eligible',
                dateMatchedCount: 0,
                pendingCount: 0,
                blockedCount: 0,
                deferredCount: 0,
                reason: 'No eligible reminders are due right now.',
              },
              {
                kind: 'service_renewal',
                state: 'no_eligible',
                dateMatchedCount: 0,
                pendingCount: 0,
                blockedCount: 0,
                deferredCount: 0,
                reason: 'No eligible reminders are due right now.',
              },
              {
                kind: 'installment_reminder',
                state: 'blocked',
                dateMatchedCount: 1,
                pendingCount: 0,
                blockedCount: 0,
                deferredCount: 0,
                reason:
                  'Create and submit the exact gym_installment_reminder template.',
              },
            ],
          })
        )
      )
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reports all six feature contracts independently', async () => {
    database.templates = [
      approved('membership_renewal'),
      approved('installment_reminder'),
    ];

    render(<RenewalRemindersSettings />);

    expect(await screen.findByText('WhatsApp template readiness')).toBeTruthy();
    expect(
      screen.getByTestId('readiness-membership_renewal').textContent
    ).toContain('Ready');
    expect(
      screen.getByTestId('readiness-service_renewal').textContent
    ).toContain('Needs setup');
    expect(
      screen.getByTestId('readiness-installment_reminder').textContent
    ).toContain('Ready');
    expect(screen.getByTestId('readiness-payment_link').textContent).toContain(
      'Needs setup'
    );
    expect(screen.getByTestId('readiness-invoice_due').textContent).toContain(
      'Needs setup'
    );
    expect(screen.getByTestId('readiness-invoice_overdue').textContent).toContain(
      'Needs setup'
    );
    expect(
      screen.getByTestId('readiness-membership_renewal').textContent
    ).not.toMatch(/opt-in/i);
  });

  it('keeps invoice collection explicitly off and explains its issued-date policy', async () => {
    render(<RenewalRemindersSettings />);

    expect(await screen.findByText('Invoice collection')).toBeTruthy();
    expect(
      screen.getByLabelText('Invoice collection reminders').getAttribute('aria-checked')
    ).toBe('false');
    expect(screen.getByText(/issued date is the effective due date/i)).toBeTruthy();
  });

  it('shows durable blocked and accepted invoice outcomes without customer content', async () => {
    database.history = [
      { state: 'blocked', created_at: '2026-09-10T10:00:00.000Z', reason: { code: 'missing_phone' } },
      { state: 'accepted', created_at: '2026-09-10T09:00:00.000Z', reason: null },
    ];
    render(<RenewalRemindersSettings />);

    expect(await screen.findByText('Recent lifecycle reminder activity')).toBeTruthy();
    expect(screen.getAllByText('Blocked')).not.toHaveLength(0);
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText('missing_phone')).toBeTruthy();
  });

  it('requires the exact Marketing membership-renewal contract', async () => {
    database.templates = [
      { ...approved('membership_renewal'), category: 'Utility' },
    ];

    render(<RenewalRemindersSettings />);

    expect(
      await screen.findAllByText(
        /does not have the category required by its UsefulDesk contract/
      )
    ).toBeTruthy();
  });

  it('shows empty work as healthy and a missing installment template as actionable', async () => {
    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByText('Scheduled reminder readiness')
    ).toBeTruthy();
    expect(
      screen.getByTestId('diagnostic-membership_renewal').textContent
    ).toContain('Nothing due');
    expect(
      screen.getByTestId('diagnostic-installment_reminder').textContent
    ).toContain('Blocked');
  });
});
