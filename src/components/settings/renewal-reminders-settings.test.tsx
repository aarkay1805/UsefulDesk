// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TemplateRow = {
  account_id: string;
  name: string;
  language: string;
  status: string;
  category: string;
};

const database = vi.hoisted(() => ({
  templates: [] as TemplateRow[],
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-1',
    canEditSettings: true,
  }),
}));

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] };

function makeQuery(table: string) {
  const filters: Filter[] = [];

  function result() {
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

    const rows = database.templates.filter((row) =>
      filters.every((filter) => {
        const value = row[filter.column as keyof TemplateRow];
        return filter.kind === 'eq'
          ? value === filter.value
          : filter.values.includes(value);
      })
    );
    return { data: rows, error: null };
  }

  const query = {
    select: () => query,
    eq(column: string, value: unknown) {
      filters.push({ kind: 'eq', column, value });
      return query;
    },
    in(column: string, values: unknown[]) {
      filters.push({ kind: 'in', column, values });
      return query;
    },
    maybeSingle: async () => result(),
    then(
      onFulfilled: (value: ReturnType<typeof result>) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result()).then(onFulfilled, onRejected);
    },
  };

  return query;
}

const supabase = {
  from: (table: string) => makeQuery(table),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

const { RenewalRemindersSettings } =
  await import('./renewal-reminders-settings');

beforeEach(() => {
  database.templates = [];
});

afterEach(cleanup);

describe('RenewalRemindersSettings membership template readiness', () => {
  it('treats an approved Utility legacy template as ready', async () => {
    database.templates = [
      {
        account_id: 'account-1',
        name: 'gym_renewal_reminder',
        language: 'en_US',
        status: 'APPROVED',
        category: 'Utility',
      },
    ];

    render(<RenewalRemindersSettings />);

    expect(await screen.findByText('Ready')).toBeTruthy();
  });

  it('explains the replacement path for an approved Marketing template', async () => {
    database.templates = [
      {
        account_id: 'account-1',
        name: 'gym_renewal_reminder',
        language: 'en_US',
        status: 'APPROVED',
        category: 'Marketing',
      },
    ];

    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByText('Template category needs repair.')
    ).toBeTruthy();
    expect(
      screen.getByText(/gym_membership_expiry_notice.*Utility template/)
    ).toBeTruthy();
  });

  it('does not mistake a service-template category for a membership repair', async () => {
    database.templates = [
      {
        account_id: 'account-1',
        name: 'gym_service_renewal_reminder',
        language: 'en_US',
        status: 'APPROVED',
        category: 'Marketing',
      },
    ];

    render(<RenewalRemindersSettings />);

    expect(await screen.findByText('Template approval needed.')).toBeTruthy();
    expect(screen.queryByText('Template category needs repair.')).toBeNull();
  });
});
