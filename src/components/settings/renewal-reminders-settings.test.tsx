// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    canEditSettings: true,
    locale: { timeZone: 'Asia/Kolkata' },
    fmt: {
      today: () => '2026-09-12',
      time: (value: Date) => value.toISOString(),
      date: (value: string) => value,
      money: (value: number) => `₹${value}`,
    },
  }),
}));
vi.mock('@/components/settings/automated-message-activity', () => ({
  AutomatedMessageActivity: () => <p>Activity content</p>,
}));

vi.mock('@/components/settings/template-manager', () => ({
  TemplateManager: ({
    setupContractId,
    onSetupClose,
  }: {
    setupContractId: string;
    onSetupClose: (submitted: boolean) => void;
  }) => (
    <div role="dialog" aria-label="Required template">
      <p>{setupContractId}</p>
      <button onClick={() => onSetupClose(false)}>Cancel template setup</button>
    </div>
  ),
}));

const rules = [
  {
    id: 'membership_renewal',
    group: 'renewals',
    title: 'Membership renewal',
    templateContracts: ['membership_renewal'],
    configurable: true,
    fields: [
      {
        key: 'enabled',
        type: 'boolean',
        label: 'Enabled',
        defaultValue: false,
      },
      {
        key: 'daysBefore',
        type: 'integer-array',
        label: 'Days before',
        defaultValue: [7, 3, 1],
        min: 0,
        max: 365,
      },
    ],
    settings: { enabled: false, daysBefore: [7, 3, 1] },
    readiness: {
      ready: false,
      code: 'template_missing',
      message: 'Create the exact template.',
    },
  },
  {
    id: 'joining_installments',
    group: 'collections',
    title: 'Joining installments',
    templateContracts: ['installment_reminder'],
    configurable: false,
    fields: [],
    settings: {},
    readiness: { ready: true, code: 'ready' },
  },
] as const;

const { RenewalRemindersSettings } =
  await import('./renewal-reminders-settings');

beforeEach(() => {
  window.history.replaceState({}, '', '/settings?tab=reminders');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById('page-header-tabs')?.remove();
});

function mockFetch(failPatch = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH')
        if (failPatch)
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Write failed' }), {
              status: 500,
            })
          );
      if (init?.method === 'PATCH')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              rule: {
                ...rules[0],
                settings: { enabled: false, daysBefore: [14, 7] },
              },
            }),
            { status: 200 }
          )
        );
      return Promise.resolve(
        new Response(JSON.stringify({ rules }), { status: 200 })
      );
    })
  );
}

function toggleReminderDay(trigger: HTMLElement, label: string) {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: label }));
  fireEvent.keyDown(document, { key: 'Escape' });
}

describe('Automated messages catalogue', () => {
  it('removes group labels and explains each rule with an info tooltip', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByRole('button', { name: 'About Membership renewal' })
    ).toBeTruthy();
    expect(
      screen.queryByText('Before and after a membership or service ends.')
    ).toBeNull();
  });

  it('keeps timing configurable while a rule is off, and preview does not send', async () => {
    mockFetch();
    const slot = document.createElement('div');
    slot.id = 'page-header-tabs';
    document.body.appendChild(slot);
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    expect(
      screen.getByRole('heading', { name: 'Choose when to send' })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Message members receive' })
    ).toBeTruthy();
    expect(screen.getByText(/Preview only. No message is sent./i)).toBeTruthy();
    expect(screen.queryByText('Days before')).toBeNull();
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH')
    ).toBe(true);
    expect(
      calls.some(([url]) => String(url).includes('/api/whatsapp/send'))
    ).toBe(false);
  });

  it('turns invoice timing fields into plain scheduling instructions', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=reminders&rule=invoice_collection'
    );
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            rules[0],
            {
              id: 'invoice_collection',
              group: 'collections',
              title: 'Invoice collection',
              templateContracts: ['invoice_due', 'invoice_overdue'],
              configurable: true,
              fields: [
                {
                  key: 'enabled',
                  type: 'boolean',
                  label: 'Enabled',
                  defaultValue: false,
                },
                {
                  key: 'beforeDueDays',
                  type: 'integer-array',
                  label: 'Days before due',
                  defaultValue: [3, 1, 0],
                  min: 0,
                  max: 365,
                },
                {
                  key: 'overdueDays',
                  type: 'integer-array',
                  label: 'Days overdue',
                  defaultValue: [1, 3, 7, 14],
                  min: 0,
                  max: 365,
                },
                {
                  key: 'catchUpDays',
                  type: 'integer',
                  label: 'Catch-up days',
                  defaultValue: 2,
                  min: 0,
                  max: 14,
                },
                {
                  key: 'sendWindowStart',
                  type: 'integer',
                  label: 'Send window start',
                  defaultValue: 9,
                  min: 0,
                  max: 23,
                },
                {
                  key: 'sendWindowEnd',
                  type: 'integer',
                  label: 'Send window end',
                  defaultValue: 19,
                  min: 0,
                  max: 23,
                },
              ],
              settings: {
                enabled: false,
                beforeDueDays: [3, 1, 0],
                overdueDays: [1, 3, 7, 14],
                catchUpDays: 2,
                sendWindowStart: 9,
                sendWindowEnd: 19,
              },
              readiness: { ready: false, code: 'template_missing' },
            },
            rules[1],
          ],
        }),
        { status: 200 }
      )
    );

    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByTestId('rule-detail-invoice_collection')
    ).toBeTruthy();
    const reminderDays = screen.getByRole('button', {
      name: 'Invoice collection reminder days, 7 selected',
    });
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'On the due date' })
    ).toBeNull();
    fireEvent.click(reminderDays);
    expect(
      screen.getAllByRole('menuitemcheckbox', { name: 'On the due date' })
    ).toHaveLength(1);
    expect(screen.getByText('Before payment is due')).toBeTruthy();
    expect(screen.getByText('After payment is due')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.getByRole('combobox', {
        name: 'Invoice collection missed reminder setting',
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('combobox', {
        name: 'Invoice collection start sending at',
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('combobox', {
        name: 'Invoice collection stop sending after',
      })
    ).toBeTruthy();
    expect(screen.getByText('Send messages from')).toBeTruthy();
    expect(screen.queryByText('Catch-up days')).toBeNull();
    expect(screen.queryByText('Send window start')).toBeNull();
    expect(screen.queryByText('Send window end')).toBeNull();
  });

  it('expands the clicked row in place, closes its sibling, and retains collapsed drafts', async () => {
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            rules[0],
            {
              ...rules[0],
              id: 'service_renewal',
              title: 'Service renewal',
              templateContracts: ['service_renewal'],
            },
          ],
        }),
        { status: 200 }
      )
    );
    render(<RenewalRemindersSettings />);
    const membershipRow = await screen.findByTestId(
      'rule-row-membership_renewal'
    );
    const serviceRow = screen.getByTestId('rule-row-service_renewal');
    const configureMembership = within(membershipRow).getByRole('button', {
      name: 'Configure',
    });
    expect(configureMembership.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(configureMembership);
    expect(
      within(membershipRow).getByTestId('rule-detail-membership_renewal')
    ).toBeTruthy();
    expect(
      within(membershipRow)
        .getByRole('button', { name: 'Close' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    toggleReminderDay(
      within(membershipRow).getByRole('button', {
        name: /Membership renewal reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(
      within(serviceRow).getByRole('button', { name: 'Configure' })
    );
    expect(
      within(serviceRow).getByTestId('rule-detail-service_renewal')
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        within(membershipRow).queryByTestId('rule-detail-membership_renewal')
      ).toBeNull()
    );
    fireEvent.click(
      within(membershipRow).getByRole('button', { name: 'Configure' })
    );
    const reminderDays = within(membershipRow).getByRole('button', {
      name: /Membership renewal reminder days/i,
    });
    fireEvent.click(reminderDays);
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: '14 days before' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(membershipRow).getByRole('button', { name: 'Close' })
    );
    await waitFor(() =>
      expect(screen.queryByTestId('rule-detail-membership_renewal')).toBeNull()
    );
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('blocks activation for missing setup while preserving the saved Off state', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    const toggle = await screen.findByLabelText(
      'Membership renewal automation'
    );
    fireEvent.click(toggle);
    expect(await screen.findByText('This template needs setup')).toBeTruthy();
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('opens the exact required template in place and preserves the rule draft and Off preference', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(screen.getByLabelText('Membership renewal automation'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up required template' })
    );
    expect(
      within(
        screen.getByRole('dialog', { name: 'Required template' })
      ).getByText('membership_renewal')
    ).toBeTruthy();
    expect(window.location.search).toBe('?tab=reminders');
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel template setup' })
    );
    const reminderDays = screen.getByRole('button', {
      name: /Membership renewal reminder days/i,
    });
    fireEvent.click(reminderDays);
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: '14 days before' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Off')).toBeTruthy();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('keeps a failed configuration draft and hides every template link', async () => {
    mockFetch(true);
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal reminder days/i,
      }),
      '14 days before'
    );
    expect(
      screen.queryByRole('link', { name: 'View message template' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByRole('button', { name: 'Save changes' })
    ).not.toHaveProperty('disabled', true);
    expect(screen.getByText(/Save or cancel your changes/i)).toBeTruthy();
  });

  it('protects a draft when opening another rule’s template setup', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('rule-detail-joining_installments')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: 'View message template' })
    ).toBeNull();
    expect(screen.getByText(/Save or cancel your changes/)).toBeTruthy();
  });

  it('shows joining installments as managed rather than an independent toggle', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collections' }));
    expect(await screen.findByText('Managed')).toBeTruthy();
    expect(
      screen.queryByRole('switch', { name: 'Joining installments automation' })
    ).toBeNull();
  });

  it('opens a linked rule in its group and lets Close dismiss that link', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=reminders&rule=joining_installments'
    );
    mockFetch();
    render(<RenewalRemindersSettings />);
    expect(
      await screen.findByTestId('rule-detail-joining_installments')
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Collections' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Schedule' })).toBeNull();
    expect(
      screen.getByText(
        /Sent 7, 3, and 1 days before each payment is due, and again on the due date/i
      )
    ).toBeTruthy();
    expect(screen.getByText(/payment plan sets these dates/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'About this message' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(
        screen.queryByTestId('rule-detail-joining_installments')
      ).toBeNull()
    );
  });
});
