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

import { getReminderRule } from '@/lib/reminders/rules';

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
    ...getReminderRule('membership_renewal')!,
    settings: { enabled: false, daysBefore: [7, 3, 1] },
    readiness: { ready: true, code: 'ready' },
  },
  {
    ...getReminderRule('joining_installments')!,
    settings: {},
    readiness: { ready: true, code: 'ready' },
  },
] as const;

const unreadyMembershipRule = {
  ...rules[0],
  readiness: {
    ready: false,
    code: 'missing',
    message: 'Create the exact template.',
  },
} as const;

const invoiceCollectionRule = {
  ...getReminderRule('invoice_collection')!,
  settings: {
    enabled: false,
    beforeDueDays: [3, 1, 0],
    overdueDays: [1, 3, 7, 14],
    catchUpDays: 2,
    sendWindowStart: 9,
    sendWindowEnd: 19,
  },
  readiness: { ready: true, code: 'ready' },
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

/** One reminder-day chip, found inside its captioned group. */
function reminderChip(
  label: string,
  group = 'Membership renewal: before the membership ends'
) {
  return within(screen.getByRole('group', { name: group })).getByRole(
    'button',
    { name: label }
  );
}

function toggleReminderDay(
  label: string,
  group = 'Membership renewal: before the membership ends'
) {
  fireEvent.click(reminderChip(label, group));
}

describe('Automated messages catalogue', () => {
  it('shows each message group as its own section instead of filter chips', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);

    const renewals = await screen.findByRole('region', { name: 'Renewals' });
    const collections = screen.getByRole('region', {
      name: 'Payment reminders',
    });
    expect(within(renewals).getByText('Membership renewal')).toBeTruthy();
    expect(within(renewals).queryByText('Installment reminders')).toBeNull();
    expect(within(collections).getByText('Installment reminders')).toBeTruthy();
    // A group with no rules gets no empty section.
    expect(
      screen.queryByRole('region', { name: 'Keep members coming back' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Renewals' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Payment reminders' })
    ).toBeNull();
  });

  it('puts the Messages and Message history tabs under the panel heading, not in the app bar', async () => {
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
      screen
        .getByRole('tab', { name: 'Messages' })
        .getAttribute('aria-selected')
    ).toBe('true');
  });

  it('leads collapsed rules with their timing instead of a second purpose line', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByText(
        'Members get reminders 7, 3 and 1 days before the membership ends.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByText(
        'Reminds members before their current membership ends.'
      )
    ).toBeNull();
  });

  it('keeps timing configurable while a rule is off, and preview does not send', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );
    expect(
      screen.getByRole('heading', {
        name: 'Timing',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Members get reminders 7, 3 and 1 days before the membership ends.'
      )
    ).toBeTruthy();
    expect(screen.getByText('This is a sample message.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Message preview' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Message preview' })
    ).toBeNull();
    expect(screen.queryByText('Who gets it')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Who gets this message' })
    );
    expect(screen.getByText('Who gets it')).toBeTruthy();
    expect(screen.getByText('When it stops')).toBeTruthy();
    expect(screen.getByText('What your team should do')).toBeTruthy();
    expect(screen.queryByText('Days before')).toBeNull();
    toggleReminderDay('14 days');
    // The row reads the unsaved schedule back as each chip is pressed.
    expect(
      within(screen.getByTestId('rule-row-membership_renewal')).getByText(
        'Members get reminders 14, 7, 3 and 1 days before the membership ends.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH')
    ).toBe(true);
    expect(
      calls.some(([url]) => String(url).includes('/api/whatsapp/send'))
    ).toBe(false);
  });

  it('uses invoice and business samples in both payment confirmation previews', async () => {
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            {
              ...getReminderRule('payment_confirmation')!,
              settings: { enabled: true },
              readiness: { ready: true, code: 'ready' },
            },
          ],
        }),
        { status: 200 }
      )
    );
    render(<RenewalRemindersSettings />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Payment confirmation',
      })
    );
    expect(
      screen.getByText(
        'Hi Rahul, we received ₹2700 for invoice INV-1024. Reply to FitZone Wellness Private Limited if anything looks incorrect. Thank you.'
      )
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('tab', {
        name: 'Payment and membership renewal confirmation',
      })
    );
    expect(
      screen.getByText(
        'Hi Rahul, we received ₹2700 for invoice INV-1024 and renewed your membership until 2026-12-20. Reply to FitZone Wellness Private Limited if anything looks incorrect. Thank you.'
      )
    ).toBeTruthy();
  });

  it('explains multi-select limits and validates that at least one day remains', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );
    // The limit is only explained once it is reached.
    expect(screen.queryByText(/Up to 6 days/)).toBeNull();

    for (const label of ['7 days', '3 days', '1 day']) toggleReminderDay(label);

    expect(screen.getByRole('alert').textContent).toContain(
      'Select at least one reminder day.'
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('explains fixed reminder days separately from delayed-send allowance', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?tab=reminders&rule=membership_post_expiry'
    );
    const fixedRule = {
      ...getReminderRule('membership_post_expiry')!,
      settings: { enabled: false, catchUpDays: 2 },
      readiness: { ready: true, code: 'ready' },
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ rules: [fixedRule] }), { status: 200 })
        )
    );
    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByText('These days cannot be changed.')
    ).toBeTruthy();
    expect(screen.getByText('If a message is late')).toBeTruthy();
    expect(screen.getByText('Send it up to')).toBeTruthy();
    expect(screen.getByText('after its scheduled date.')).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: /change reminder days/i,
      })
    ).toBeNull();
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
        name: 'Timing',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Members get reminders 3 and 1 days before payment is due, on the due date and 1, 3, 7 and 14 days after payment is due.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'If an invoice has no due date, UsefulDesk uses the day it was created. It cannot send a reminder for an earlier day.'
      )
    ).toBeTruthy();
    // Both offsets are visible without opening anything, each under the
    // date it counts from.
    expect(
      reminderChip(
        'On the due date',
        'Unpaid invoice reminders: before payment is due'
      ).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      reminderChip(
        '14 days',
        'Unpaid invoice reminders: after payment is due'
      ).getAttribute('aria-pressed')
    ).toBe('true');
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
        name: 'Unpaid invoice reminders delayed reminder setting',
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
    fireEvent.click(
      within(sendingHours).getByRole('button', {
        name: 'Which messages?',
      })
    );
    const sendingScope = await screen.findByRole('dialog');
    expect(
      within(sendingScope).getByText('Unpaid invoice reminders')
    ).toBeTruthy();
    expect(
      within(sendingScope).getByText('Invite members to renew a service')
    ).toBeTruthy();
    expect(
      within(sendingScope).getByText(
        /Membership, service, and installment reminders start/i
      )
    ).toBeTruthy();
    expect(
      within(sendingScope).getByText(
        /Payment confirmations and AutoPay updates send as soon as the payment changes/i
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
              ...getReminderRule('promise_to_pay')!,
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
      await screen.findByRole('button', {
        name: 'Edit Promised payment reminder',
      })
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
              ...getReminderRule('promise_to_pay')!,
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
      await screen.findByRole('button', {
        name: 'Edit Promised payment reminder',
      })
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
              ...getReminderRule('service_renewal')!,
              settings: { enabled: false, daysBefore: [7, 3, 1] },
              readiness: { ready: true, code: 'ready' },
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
      name: 'Edit Membership renewal',
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
    toggleReminderDay('14 days');
    fireEvent.click(
      within(serviceRow).getByRole('button', {
        name: 'Edit Service renewal',
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
        name: 'Edit Membership renewal',
      })
    );
    expect(reminderChip('14 days').getAttribute('aria-pressed')).toBe('true');
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

  it.each([false, true])(
    'offers only setup when a template is unready (enabled: %s)',
    async (enabled) => {
      mockFetch();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rules: [
              {
                ...unreadyMembershipRule,
                settings: { ...unreadyMembershipRule.settings, enabled },
              },
            ],
          })
        )
      );
      render(<RenewalRemindersSettings />);
      const row = await screen.findByTestId('rule-row-membership_renewal');
      expect(within(row).queryByRole('switch')).toBeNull();
      expect(within(row).queryByText(/^(On|Off|Blocked)$/)).toBeNull();
      expect(
        within(row).queryByRole('button', {
          name: 'Edit Membership renewal',
        })
      ).toBeNull();
      expect(
        within(row).queryByTestId('rule-detail-membership_renewal')
      ).toBeNull();
      fireEvent.click(
        within(row).getByRole('button', {
          name: 'Send for review: Membership renewal',
        })
      );
      expect(
        await screen.findByRole('dialog', {
          name: 'Required template',
        })
      ).toBeTruthy();
      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel template setup' })
      );
      expect(within(row).queryByRole('switch')).toBeNull();
      expect(
        vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
      ).toBe(false);
    }
  );

  it('keeps WhatsApp setup reachable without exposing configuration or a switch', async () => {
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            {
              ...rules[0],
              readiness: {
                ready: false,
                code: 'whatsapp_not_connected',
                message: 'Connect this branch to WhatsApp before it can send.',
              },
            },
          ],
        })
      )
    );
    render(<RenewalRemindersSettings />);
    const row = await screen.findByTestId('rule-row-membership_renewal');
    expect(within(row).queryByRole('switch')).toBeNull();
    expect(within(row).getByText('WhatsApp not connected')).toBeTruthy();
    const setup = within(row).getByRole('button', {
      name: 'Connect WhatsApp: Membership renewal',
    });
    expect(setup.getAttribute('href')).toContain('tab=whatsapp');
    expect(
      within(row).queryByRole('button', {
        name: 'Edit Membership renewal',
      })
    ).toBeNull();
    expect(
      within(row).queryByTestId('rule-detail-membership_renewal')
    ).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it.each([false, true])(
    'renders the saved On/Off switch only when ready (enabled: %s)',
    async (enabled) => {
      const readyRule = {
        ...rules[0],
        settings: { ...rules[0].settings, enabled },
        readiness: { ready: true, code: 'ready' },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                init?.method === 'PATCH'
                  ? {
                      rule: {
                        ...readyRule,
                        settings: {
                          ...readyRule.settings,
                          enabled: !enabled,
                        },
                      },
                    }
                  : { rules: [readyRule] }
              )
            )
          )
        )
      );
      render(<RenewalRemindersSettings />);
      const row = await screen.findByTestId('rule-row-membership_renewal');
      const toggle = within(row).getByRole('switch', {
        name: 'Membership renewal automation',
      });
      expect(toggle.getAttribute('aria-checked')).toBe(String(enabled));
      expect(within(row).getByText(enabled ? 'On' : 'Off')).toBeTruthy();
      expect(
        within(row).queryByRole('button', {
          name: 'Send for review: Membership renewal',
        })
      ).toBeNull();
      fireEvent.click(
        within(row).getByRole('button', {
          name: 'Edit Membership renewal',
        })
      );
      expect(
        vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
      ).toBe(false);
      fireEvent.click(toggle);
      await waitFor(() =>
        expect(toggle.getAttribute('aria-checked')).toBe(String(!enabled))
      );
      const patches = vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(JSON.parse(String(patches[0][1]?.body))).toEqual({
        ruleId: 'membership_renewal',
        patch: { enabled: !enabled },
      });
    }
  );

  it.each(['agent', 'viewer'] as const)(
    'explains setup permission for %s without exposing Edit',
    async (role) => {
      authState.role = role;
      mockFetch();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ rules: [unreadyMembershipRule] }), {
          status: 200,
        })
      );
      render(<RenewalRemindersSettings />);

      const setup = await screen.findByRole('button', {
        name: 'Send for review: Membership renewal',
      });
      expect(
        screen.queryByRole('switch', { name: 'Membership renewal automation' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Edit Membership renewal' })
      ).toBeNull();
      // Gated, not dead: still focusable, and pressing it explains why.
      expect(setup).toHaveProperty('disabled', false);
      expect(setup.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(setup);
      expect(
        await screen.findByRole('dialog', {
          name: 'You do not have permission',
        })
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Only the owner or an admin can change automated messages.'
        )
      ).toBeTruthy();
      expect(screen.queryByText('This template needs setup')).toBeNull();
      expect(
        screen.queryByRole('dialog', { name: 'Required template' })
      ).toBeNull();
      expect(
        vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
      ).toBe(false);
    }
  );

  it('opens the exact required template in place before configuration is available', async () => {
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ rules: [unreadyMembershipRule] }), {
        status: 200,
      })
    );
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Send for review: Membership renewal',
      })
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
    expect(
      screen.getByRole('button', {
        name: 'Send for review: Membership renewal',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Edit Membership renewal' })
    ).toBeNull();
    expect(
      screen.queryByRole('switch', { name: 'Membership renewal automation' })
    ).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('reports real unsaved state and clears it when a rule value is restored', async () => {
    const onUnsavedChangesChange = vi.fn();
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rules: [
            {
              ...rules[0],
              settings: { enabled: false, daysBefore: [1, 3, 7] },
            },
            rules[1],
          ],
        }),
        { status: 200 }
      )
    );
    render(
      <RenewalRemindersSettings
        onUnsavedChangesChange={onUnsavedChangesChange}
      />
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );
    toggleReminderDay('3 days');
    expect(onUnsavedChangesChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    toggleReminderDay('3 days');
    expect(onUnsavedChangesChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('guards link navigation outside Settings while a draft is unsaved', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    mockFetch();
    render(
      <>
        <RenewalRemindersSettings />
        <a href="/dashboard">Dashboard</a>
      </>
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );
    toggleReminderDay('14 days');

    expect(
      fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    ).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved changes to automated messages. Leave this page and lose them?'
    );
  });

  it('keeps a failed configuration draft and hides every template link', async () => {
    mockFetch(true);
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );
    toggleReminderDay('14 days');
    expect(
      screen.queryByRole('link', { name: 'View message template' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' })
      ).not.toHaveProperty('disabled', true)
    );
    expect(screen.getByText(/Save or cancel your changes/i)).toBeTruthy();
  });

  it('protects a draft when opening another rule’s template setup', async () => {
    const installmentNeedsSetup = {
      ...rules[1],
      readiness: {
        ready: false,
        code: 'missing',
        templateContractId: 'installment_reminder',
      },
    };
    mockFetch();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ rules: [rules[0], installmentNeedsSetup] }),
        { status: 200 }
      )
    );
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );
    toggleReminderDay('14 days');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Send for review: Installment reminders',
      })
    );
    expect(
      within(
        await screen.findByRole('dialog', { name: 'Required template' })
      ).getByText('installment_reminder')
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel template setup' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Membership renewal' })
    );
    expect(reminderChip('14 days').getAttribute('aria-pressed')).toBe('true');
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('shows installments as payment-plan managed without an independent toggle', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    const collections = await screen.findByRole('region', {
      name: 'Payment reminders',
    });
    expect(within(collections).getByText('Installment reminders')).toBeTruthy();
    expect(
      within(collections).getByText('Set by the installment plan')
    ).toBeTruthy();
    expect(
      screen.queryByRole('switch', { name: 'Installment reminders automation' })
    ).toBeNull();
  });

  it('shows installment readiness and setup even though it has no enable switch', async () => {
    const installmentNeedsSetup = {
      ...rules[1],
      readiness: {
        ready: false,
        code: 'missing',
        templateContractId: 'installment_reminder',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rules: [installmentNeedsSetup] }), {
          status: 200,
        })
      )
    );
    render(<RenewalRemindersSettings />);

    const row = await screen.findByTestId('rule-row-joining_installments');
    expect(within(row).getByText('Set by the installment plan')).toBeTruthy();
    expect(within(row).getByText('Not sent for review')).toBeTruthy();
    expect(within(row).queryByRole('switch')).toBeNull();
    expect(
      within(row).queryByRole('button', {
        name: 'Edit Installment reminders',
      })
    ).toBeNull();
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Send for review: Installment reminders',
      })
    );
    expect(
      within(
        await screen.findByRole('dialog', { name: 'Required template' })
      ).getByText('installment_reminder')
    ).toBeTruthy();
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
      screen.getByRole('region', { name: 'Payment reminders' })
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
        /7, 3 and 1 days before each installment is due, and again on the due date/i
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Each due date comes from the member’s joining payment plan/i
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find a member' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Message preview' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Close Installment reminders',
      })
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
      expect(screen.getByText('View only')).toBeTruthy();
      expect(
        screen.queryByText('Automated messages could not load')
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

      const toggle = screen.getByRole('switch', {
        name: 'Membership renewal automation',
      });
      expect(toggle.getAttribute('aria-readonly')).toBe('true');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(toggle);
      expect(
        await screen.findByRole('dialog', {
          name: 'You do not have permission',
        })
      ).toBeTruthy();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(patched()).toBe(false);
    }
  );

  it('opens a read-only rule with Edit and explains the day picker instead of opening it', async () => {
    authState.role = 'viewer';
    mockCatalogue([readyRule]);
    render(<RenewalRemindersSettings />);

    expect(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Details Membership renewal' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Membership renewal' })
    );
    expect(
      screen.getByText(
        'Members get reminders 7, 3 and 1 days before the membership ends.'
      )
    ).toBeTruthy();
    const reminderDays = screen.getByRole('button', {
      name: 'Membership renewal change reminder days, 3 selected',
    });
    expect(reminderDays).toHaveProperty('disabled', false);
    fireEvent.click(reminderDays);
    expect(
      await screen.findByRole('dialog', { name: 'You do not have permission' })
    ).toBeTruthy();
    // Read-only users get the explanation, never the editable day chips.
    expect(
      screen.queryByRole('group', {
        name: 'Membership renewal: before the membership ends',
      })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
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

  it('keeps Message history visible to non-admins but shows a permission state instead of mounting it', async () => {
    authState.role = 'agent';
    mockCatalogue([readyRule]);
    render(<RenewalRemindersSettings />);

    fireEvent.click(
      await screen.findByRole('tab', { name: 'Message history' })
    );
    expect(await screen.findByText('You do not have permission')).toBeTruthy();
    expect(
      screen.getByText('Ask the owner or an admin to check message history.')
    ).toBeTruthy();
    expect(screen.queryByText('Activity content')).toBeNull();
    expect(screen.queryByText('View only')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(await screen.findByText('View only')).toBeTruthy();
  });

  it('shows admins the activity history', async () => {
    authState.role = 'admin';
    mockCatalogue([readyRule]);
    render(<RenewalRemindersSettings />);

    expect(screen.queryByText('View only')).toBeNull();
    fireEvent.click(
      await screen.findByRole('tab', { name: 'Message history' })
    );
    expect(await screen.findByText('Activity content')).toBeTruthy();
    expect(screen.queryByText('You do not have permission')).toBeNull();
  });

  it('reviews a rule from Message history by opening it on Messages, focusing it, and scrolling to it', async () => {
    authState.role = 'admin';
    mockCatalogue([readyRule, rules[1]]);
    render(<RenewalRemindersSettings />);

    fireEvent.click(
      await screen.findByRole('tab', { name: 'Message history' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review joining installments' })
    );

    expect(
      screen
        .getByRole('tab', { name: 'Messages' })
        .getAttribute('aria-selected')
    ).toBe('true');
    const row = screen.getByTestId('rule-row-joining_installments');
    expect(
      within(row).getByTestId('rule-detail-joining_installments')
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      within(row).getByRole('button', {
        name: 'Close Installment reminders',
      })
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

    fireEvent.click(
      await screen.findByRole('tab', { name: 'Message history' })
    );
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

describe('Automated messages setup guidance', () => {
  function stubCatalogue(
    catalogue: readonly unknown[],
    submitted = { submitted: 1, failed: 0 }
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/whatsapp/templates/submit-required'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                total: 1,
                already_ready_or_pending: 0,
                results: [],
                ...submitted,
              }),
              { status: 200 }
            )
          );
        if (String(url).includes('/api/whatsapp/templates/sync'))
          return Promise.resolve(
            new Response(JSON.stringify({ total: 1 }), { status: 200 })
          );
        return Promise.resolve(
          new Response(JSON.stringify({ rules: catalogue }), { status: 200 })
        );
      })
    );
  }

  const calledUrls = () =>
    vi.mocked(fetch).mock.calls.map(([url]) => String(url));

  it('names each unready state and its specific next step', async () => {
    stubCatalogue([
      {
        ...rules[0],
        readiness: { ready: false, code: 'rejected' },
      },
      {
        ...getReminderRule('service_renewal')!,
        settings: { enabled: true },
        readiness: { ready: false, code: 'pending' },
      },
    ]);
    render(<RenewalRemindersSettings />);

    const membership = await screen.findByTestId('rule-row-membership_renewal');
    expect(within(membership).getByText('Rejected by WhatsApp')).toBeTruthy();
    expect(
      within(membership).getByRole('button', {
        name: 'Fix and resend: Membership renewal',
      })
    ).toBeTruthy();
    // A rule left On must not read as sending while WhatsApp reviews it.
    const service = screen.getByTestId('rule-row-service_renewal');
    expect(
      within(service).getByText('On, not sending: in WhatsApp review')
    ).toBeTruthy();
    expect(
      within(service).getByRole('button', {
        name: 'View status: Service renewal',
      })
    ).toBeTruthy();
  });

  it('sends every unapproved message for review in one action and reloads', async () => {
    stubCatalogue([unreadyMembershipRule, rules[1]]);
    render(<RenewalRemindersSettings />);

    const setup = await screen.findByRole('region', {
      name: 'Get ready to send',
    });
    expect(
      within(setup).getByRole('listitem', { current: 'step' }).textContent
    ).toContain('Get approved · 1 of 2 ready');
    expect(
      within(setup).getByText(/1 message is not sent for review yet/)
    ).toBeTruthy();
    fireEvent.click(
      within(setup).getByRole('button', { name: 'Send 1 message for review' })
    );
    await waitFor(() =>
      expect(
        calledUrls().filter((url) => url.includes('/api/reminders/settings'))
      ).toHaveLength(2)
    );
    const urls = calledUrls();
    expect(
      urls.findIndex((url) => url.includes('submit-required'))
    ).toBeLessThan(urls.findIndex((url) => url.includes('templates/sync')));
    // Approval never turns a message on.
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')
    ).toBe(false);
  });

  it('explains the permission instead of sending for review without settings access', async () => {
    authState.role = 'agent';
    stubCatalogue([unreadyMembershipRule]);
    render(<RenewalRemindersSettings />);

    const setup = await screen.findByRole('region', {
      name: 'Get ready to send',
    });
    fireEvent.click(
      within(setup).getByRole('button', { name: 'Send 1 message for review' })
    );
    expect(
      await screen.findByRole('dialog', { name: 'You do not have permission' })
    ).toBeTruthy();
    expect(calledUrls().some((url) => url.includes('submit-required'))).toBe(
      false
    );
  });

  it('hides the setup guide once every message is approved', async () => {
    stubCatalogue(rules);
    render(<RenewalRemindersSettings />);

    expect(await screen.findByText('Membership renewal')).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Get ready to send' })
    ).toBeNull();
  });

  it('stops offering more reminder days at the limit', async () => {
    stubCatalogue([
      {
        ...rules[0],
        settings: { enabled: false, daysBefore: [30, 14, 7, 3, 2, 1] },
      },
    ]);
    render(<RenewalRemindersSettings />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Edit Membership renewal',
      })
    );

    expect(
      screen.getByText('Up to 6 days. Remove one to pick another.')
    ).toBeTruthy();
    expect(reminderChip('On the day')).toHaveProperty('disabled', true);
    expect(reminderChip('7 days')).toHaveProperty('disabled', false);
  });
});
