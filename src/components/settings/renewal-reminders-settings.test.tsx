// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'admin' | 'agent' | 'viewer',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/hooks/use-auth', async () => {
  // Capabilities come from the real predicates, so `useCan` and the
  // `canEditSettings` flag agree for every role the tests pick.
  const { canEditSettings } =
    await vi.importActual<typeof import('@/lib/auth/roles')>(
      '@/lib/auth/roles'
    );
  return {
    useAuth: () => ({
      accountRole: authState.role,
      profileLoading: false,
      isOrganizationOwner: false,
      canEditSettings: canEditSettings(authState.role),
      locale: { timeZone: 'Asia/Kolkata' },
      fmt: {
        today: () => '2026-09-12',
        time: (value: Date) => value.toISOString(),
        date: (value: string) => value,
        money: (value: number) => `₹${value}`,
      },
    }),
  };
});
vi.mock('@/components/settings/automated-message-activity', () => ({
  AutomatedMessageActivity: ({
    onReviewRule,
  }: {
    onReviewRule?: (id: string) => void;
  }) => (
    <div>
      <p>Activity content</p>
      <button onClick={() => onReviewRule?.('joining_installments')}>
        Review joining installments
      </button>
    </div>
  ),
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

const invoiceCollectionRule = {
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
} as const;

const { RenewalRemindersSettings } =
  await import('./renewal-reminders-settings');

/** The rows `scrollIntoView` was called on, in call order. */
let scrolled: Element[] = [];
const scrollIntoView = vi.fn();

beforeEach(() => {
  authState.role = 'owner';
  window.history.replaceState({}, '', '/settings?tab=reminders');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  scrolled = [];
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement, options?: ScrollIntoViewOptions) {
      scrolled.push(this);
      scrollIntoView(options);
    },
  });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  delete (window as { matchMedia?: unknown }).matchMedia;
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
  it('shows each message group as its own section instead of filter chips', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);

    const renewals = await screen.findByRole('region', { name: 'Renewals' });
    const collections = screen.getByRole('region', { name: 'Collections' });
    expect(within(renewals).getByText('Membership renewal')).toBeTruthy();
    expect(within(renewals).queryByText('Joining installments')).toBeNull();
    expect(within(collections).getByText('Joining installments')).toBeTruthy();
    // A group with no rules gets no empty section.
    expect(screen.queryByRole('region', { name: 'Retention' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Renewals' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collections' })).toBeNull();
  });

  it('puts the Rules and Activity tabs under the panel heading, not in the app bar', async () => {
    mockFetch();
    const slot = document.createElement('div');
    slot.id = 'page-header-tabs';
    document.body.appendChild(slot);
    render(<RenewalRemindersSettings />);

    // The tabs hold their place while the rules load.
    const tabs = screen.getByRole('tablist', { name: 'Automated messages' });
    expect(screen.getByText('Loading automated messages…')).toBeTruthy();
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Automated messages',
    });
    expect(
      heading.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(await screen.findByText('Membership renewal')).toBeTruthy();
    expect(slot.childElementCount).toBe(0);
    expect(
      screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')
    ).toBe('true');
  });

  it('explains each rule with an info tooltip instead of a group description', async () => {
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
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Configure Membership renewal',
      })
    );
    expect(
      screen.getByRole('heading', {
        name: 'When will members get reminders?',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Members get reminders 7, 3, and 1 days before the membership ends.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('This is only a sample.')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'See message and details' })
    );
    expect(screen.getByText('This is only a sample.')).toBeTruthy();
    expect(screen.queryByText('Days before')).toBeNull();
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal change reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH')
    ).toBe(true);
    expect(
      calls.some(([url]) => String(url).includes('/api/whatsapp/send'))
    ).toBe(false);
  });

  it('keeps invoice-specific timing in the rule and moves shared hours to the branch section', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=reminders&rule=invoice_collection'
    );
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [rules[0], invoiceCollectionRule, rules[1]],
        }),
        { status: 200 }
      )
    );

    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByTestId('rule-detail-invoice_collection')
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'When will members get reminders?',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Members get reminders 3 and 1 days before payment is due, on the due date, and 1, 3, 7, and 14 days after payment is due.'
      )
    ).toBeTruthy();
    const reminderDays = screen.getByRole('button', {
      name: 'Invoice collection change reminder days, 7 selected',
    });
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'On the due date' })
    ).toBeNull();
    fireEvent.click(reminderDays);
    expect(
      screen.getAllByRole('menuitemcheckbox', { name: 'On the due date' })
    ).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('tab', { name: 'Before or on due date' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'See message and details' })
    );
    expect(
      screen.getByRole('tab', { name: 'Before or on due date' })
    ).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'After due date' })).toBeTruthy();
    const invoiceDetail = screen.getByTestId('rule-detail-invoice_collection');
    fireEvent.click(
      within(invoiceDetail).getByRole('button', {
        name: 'More sending options',
      })
    );
    expect(
      screen.getByRole('combobox', {
        name: 'Invoice collection delayed reminder setting',
      })
    ).toBeTruthy();
    expect(
      within(invoiceDetail).queryByRole('combobox', {
        name: /start sending at/i,
      })
    ).toBeNull();
    const sendingHours = screen.getByTestId('lifecycle-sending-hours');
    expect(
      within(sendingHours).getByRole('combobox', {
        name: 'Start sending at',
      })
    ).toBeTruthy();
    expect(
      within(sendingHours).getByRole('combobox', {
        name: 'Stop sending after',
      })
    ).toBeTruthy();
    expect(
      within(sendingHours).getByText('Unpaid invoice reminders')
    ).toBeTruthy();
    expect(
      within(sendingHours).getByText('Invite members to renew a service')
    ).toBeTruthy();
    expect(
      within(sendingHours).getByText(
        /Membership renewal, service renewal, and installment reminders still start after/i
      )
    ).toBeTruthy();
    expect(
      within(sendingHours).getByText(
        /Payment confirmations and AutoPay updates send from their recorded events/i
      )
    ).toBeTruthy();
    expect(screen.queryByText('Catch-up days')).toBeNull();
    expect(screen.queryByText('Send window start')).toBeNull();
    expect(screen.queryByText('Send window end')).toBeNull();
  });

  it('saves only the existing lifecycle-window fields without changing activation', async () => {
    const apiFetch = vi
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                rule: {
                  ...invoiceCollectionRule,
                  settings: {
                    ...invoiceCollectionRule.settings,
                    sendWindowStart: 10,
                  },
                },
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ rules: [invoiceCollectionRule] }), {
            status: 200,
          })
        );
      });
    vi.stubGlobal('fetch', apiFetch);
    render(<RenewalRemindersSettings />);

    const user = userEvent.setup();
    const sendingHours = await screen.findByTestId('lifecycle-sending-hours');
    await user.click(
      within(sendingHours).getByRole('combobox', {
        name: 'Start sending at',
      })
    );
    await user.click((await screen.findAllByRole('option'))[10]);
    await user.click(
      within(sendingHours).getByRole('button', { name: 'Save changes' })
    );

    await waitFor(() =>
      expect(
        apiFetch.mock.calls.some(([, init]) => init?.method === 'PATCH')
      ).toBe(true)
    );
    const patchCall = apiFetch.mock.calls.find(
      ([, init]) => init?.method === 'PATCH'
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      ruleId: 'invoice_collection',
      patch: { sendWindowStart: 10, sendWindowEnd: 19 },
    });
  });

  it('focuses and scrolls directly to Sending hours without opening Invoice collection', async () => {
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            invoiceCollectionRule,
            {
              id: 'promise_to_pay',
              group: 'collections',
              title: 'Promise to pay',
              templateContracts: ['payment_promise_reminder'],
              configurable: true,
              fields: [],
              settings: {},
              readiness: { ready: true, code: 'ready' },
            },
          ],
        }),
        { status: 200 }
      )
    );
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'View Promise to pay' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'See message and details' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Change sending hours' })
    );

    const invoiceRow = screen.getByTestId('rule-row-invoice_collection');
    const sendingHours = screen.getByTestId('lifecycle-sending-hours');
    expect(
      within(invoiceRow).queryByTestId('rule-detail-invoice_collection')
    ).toBeNull();
    expect(document.activeElement).toBe(
      within(sendingHours).getByRole('combobox', {
        name: 'Start sending at',
      })
    );
    await waitFor(() => expect(scrolled).toEqual([sendingHours]));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'smooth',
    });
  });

  it('jumps to Sending hours when reduced motion is requested', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            invoiceCollectionRule,
            {
              id: 'promise_to_pay',
              group: 'collections',
              title: 'Promise to pay',
              templateContracts: ['payment_promise_reminder'],
              configurable: true,
              fields: [],
              settings: {},
              readiness: { ready: true, code: 'ready' },
            },
          ],
        }),
        { status: 200 }
      )
    );
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'View Promise to pay' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'See message and details' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Change sending hours' })
    );

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        behavior: 'auto',
      })
    );
    expect(document.activeElement).toBe(
      within(screen.getByTestId('lifecycle-sending-hours')).getByRole(
        'combobox',
        { name: 'Start sending at' }
      )
    );
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
      name: 'Configure Membership renewal',
    });
    expect(configureMembership.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(configureMembership);
    expect(
      within(membershipRow).getByTestId('rule-detail-membership_renewal')
    ).toBeTruthy();
    expect(
      within(membershipRow)
        .getByRole('button', { name: 'Close Membership renewal' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    toggleReminderDay(
      within(membershipRow).getByRole('button', {
        name: /Membership renewal change reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(
      within(serviceRow).getByRole('button', {
        name: 'Configure Service renewal',
      })
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
      within(membershipRow).getByRole('button', {
        name: 'Configure Membership renewal',
      })
    );
    const reminderDays = within(membershipRow).getByRole('button', {
      name: /Membership renewal change reminder days/i,
    });
    fireEvent.click(reminderDays);
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: '14 days before' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(membershipRow).getByRole('button', {
        name: 'Close Membership renewal',
      })
    );
    await waitFor(() =>
      expect(screen.queryByTestId('rule-detail-membership_renewal')).toBeNull()
    );
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('offers one setup action when a rule is not ready', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    const setup = await screen.findByRole('button', { name: 'Set up' });
    fireEvent.click(setup);
    expect(await screen.findByText('This template needs setup')).toBeTruthy();
    expect(screen.queryByLabelText('Membership renewal automation')).toBeNull();
  });

  it('explains the permission instead of opening template setup without settings access', async () => {
    authState.role = 'agent';
    mockFetch();
    render(<RenewalRemindersSettings />);

    const setup = await screen.findByRole('button', { name: 'Set up' });
    // Gated, not dead: still focusable, and pressing it explains why.
    expect(setup).toHaveProperty('disabled', false);
    expect(setup.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(setup);
    expect(
      await screen.findByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();
    expect(
      screen.getByText('Only an admin or owner can change automated messages.')
    ).toBeTruthy();
    expect(screen.queryByText('This template needs setup')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Set up required template' })
    ).toBeNull();
    expect(
      screen.queryByRole('dialog', { name: 'Required template' })
    ).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('opens the exact required template in place and preserves the rule draft and Off preference', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Configure Membership renewal',
      })
    );
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal change reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
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
      name: /Membership renewal change reminder days/i,
    });
    fireEvent.click(reminderDays);
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: '14 days before' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Set up' })).toBeTruthy();
    expect(screen.queryByLabelText('Membership renewal automation')).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('keeps a failed configuration draft and hides every template link', async () => {
    mockFetch(true);
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Configure Membership renewal',
      })
    );
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal change reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'See message and details' })
    );
    expect(
      screen.queryByRole('link', { name: 'View message template' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save settings' })
      ).not.toHaveProperty('disabled', true)
    );
    expect(screen.getByText(/Save or cancel your changes/i)).toBeTruthy();
  });

  it('protects a draft when opening another rule’s template setup', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Configure Membership renewal',
      })
    );
    toggleReminderDay(
      screen.getByRole('button', {
        name: /Membership renewal change reminder days/i,
      }),
      '14 days before'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'View Joining installments' })
    );
    // Both rows share the page now, and the closing one is still animating.
    const joiningRow = screen.getByTestId('rule-row-joining_installments');
    expect(
      within(joiningRow).getByTestId('rule-detail-joining_installments')
    ).toBeTruthy();
    fireEvent.click(
      within(joiningRow).getByRole('button', {
        name: 'See message and details',
      })
    );
    expect(
      screen.queryByRole('link', { name: 'View message template' })
    ).toBeNull();
    expect(
      within(joiningRow).getByText(/Save or cancel your changes/)
    ).toBeTruthy();
  });

  it('shows joining installments without an independent toggle or extra status', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    const collections = await screen.findByRole('region', {
      name: 'Collections',
    });
    expect(within(collections).getByText('Joining installments')).toBeTruthy();
    expect(screen.queryByText('Managed')).toBeNull();
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
    const linkedRow = within(
      screen.getByRole('region', { name: 'Collections' })
    ).getByTestId('rule-row-joining_installments');
    // A deep link lands on its rule without moving focus.
    await waitFor(() => expect(scrolled).toEqual([linkedRow]));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'auto',
    });
    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole('heading', { name: 'Schedule' })).toBeNull();
    expect(
      screen.getByText(
        /Sent 7, 3, and 1 days before each payment is due, and again on the due date/i
      )
    ).toBeTruthy();
    expect(screen.getByText(/payment plan sets these dates/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'See message and details' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Joining installments' })
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('rule-detail-joining_installments')
      ).toBeNull()
    );
  });
});

describe('Automated messages access', () => {
  const readyRule = {
    ...rules[0],
    settings: { enabled: true, daysBefore: [7, 3, 1] },
    readiness: { ready: true, code: 'ready' },
  };

  function mockCatalogue(catalogue: readonly unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ rules: catalogue }), { status: 200 })
          )
        )
    );
  }

  function patched() {
    return vi
      .mocked(fetch)
      .mock.calls.some(([, init]) => init?.method === 'PATCH');
  }

  it.each(['agent', 'viewer'] as const)(
    'shows an %s the rules read-only instead of a load error',
    async (role) => {
      authState.role = role;
      mockCatalogue([readyRule, rules[1]]);
      render(<RenewalRemindersSettings />);

      expect(await screen.findByText('Membership renewal')).toBeTruthy();
      expect(screen.getByText('Read-only')).toBeTruthy();
      expect(screen.queryByText('Automated messages couldn’t load')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

      const toggle = screen.getByRole('switch', {
        name: 'Membership renewal automation',
      });
      expect(toggle.getAttribute('aria-readonly')).toBe('true');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(toggle);
      expect(
        await screen.findByRole('dialog', { name: 'Admin access required' })
      ).toBeTruthy();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(patched()).toBe(false);
    }
  );

  it('opens a read-only rule with View and explains the day picker instead of opening it', async () => {
    authState.role = 'viewer';
    mockCatalogue([readyRule]);
    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByRole('button', { name: 'View Membership renewal' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Configure Membership renewal' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'View Membership renewal' })
    );
    expect(
      screen.getByText(
        'Members get reminders 7, 3, and 1 days before the membership ends.'
      )
    ).toBeTruthy();
    const reminderDays = screen.getByRole('button', {
      name: 'Membership renewal change reminder days, 3 selected',
    });
    expect(reminderDays).toHaveProperty('disabled', false);
    fireEvent.click(reminderDays);
    expect(
      await screen.findByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    expect(patched()).toBe(false);
  });

  it('keeps branch Sending hours visible but read-only without settings access', async () => {
    authState.role = 'viewer';
    mockCatalogue([invoiceCollectionRule]);
    render(<RenewalRemindersSettings />);

    const sendingHours = await screen.findByTestId('lifecycle-sending-hours');
    expect(
      within(sendingHours).getByRole('combobox', { name: 'Start sending at' })
    ).toHaveProperty('disabled', true);
    expect(
      within(sendingHours).getByRole('combobox', {
        name: 'Stop sending after',
      })
    ).toHaveProperty('disabled', true);
    expect(
      within(sendingHours).queryByRole('button', { name: 'Save changes' })
    ).toBeNull();
    expect(patched()).toBe(false);
  });

  it('keeps Activity visible to non-admins but shows a permission state instead of mounting it', async () => {
    authState.role = 'agent';
    mockCatalogue([readyRule]);
    render(<RenewalRemindersSettings />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('Admin access required')).toBeTruthy();
    expect(
      screen.getByText(
        'Only admins and owners can view scheduled reminder readiness and message history.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Activity content')).toBeNull();
    expect(screen.queryByText('Read-only')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(await screen.findByText('Read-only')).toBeTruthy();
  });

  it('shows admins the activity history', async () => {
    authState.role = 'admin';
    mockCatalogue([readyRule]);
    render(<RenewalRemindersSettings />);

    expect(screen.queryByText('Read-only')).toBeNull();
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('Activity content')).toBeTruthy();
    expect(screen.queryByText('Admin access required')).toBeNull();
  });

  it('reviews a rule from Activity by opening it on Rules, focusing it, and scrolling to it', async () => {
    authState.role = 'admin';
    mockCatalogue([readyRule, rules[1]]);
    render(<RenewalRemindersSettings />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review joining installments' })
    );

    expect(
      screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')
    ).toBe('true');
    const row = screen.getByTestId('rule-row-joining_installments');
    expect(
      within(row).getByTestId('rule-detail-joining_installments')
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      within(row).getByRole('button', { name: 'Close Joining installments' })
    );
    await waitFor(() => expect(scrolled).toEqual([row]));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'smooth',
    });
    expect(screen.queryByText('Activity content')).toBeNull();
  });

  it('jumps instead of animating the scroll when reduced motion is on', async () => {
    authState.role = 'admin';
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    mockCatalogue([readyRule, rules[1]]);
    render(<RenewalRemindersSettings />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review joining installments' })
    );

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        behavior: 'auto',
      })
    );
    expect(window.matchMedia).toHaveBeenCalledWith(
      '(prefers-reduced-motion: reduce)'
    );
  });

  it('offers no retry when the server denies access, but keeps it for other failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'This branch is archived' }), {
          status: 403,
        })
      )
    );
    render(<RenewalRemindersSettings />);
    expect(await screen.findByText('This branch is archived')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    cleanup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Temporarily unavailable' }), {
          status: 503,
        })
      )
    );
    render(<RenewalRemindersSettings />);
    expect(await screen.findByText('Temporarily unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
