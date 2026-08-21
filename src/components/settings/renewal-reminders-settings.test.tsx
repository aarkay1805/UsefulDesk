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
      return Promise.resolve({ data: database.templates, error: null }).then(
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
});

afterEach(cleanup);

describe('RenewalRemindersSettings template readiness', () => {
  it('reports all four feature contracts independently', async () => {
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
});
