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

describe('Automated messages catalogue', () => {
  it('keeps timing configurable while a rule is off, and preview does not send', async () => {
    mockFetch();
    const slot = document.createElement('div');
    slot.id = 'page-header-tabs';
    document.body.appendChild(slot);
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    expect(screen.getByText(/Preview only. It never sends/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '14 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH')
    ).toBe(true);
    expect(
      calls.some(([url]) => String(url).includes('/api/whatsapp/send'))
    ).toBe(false);
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
    fireEvent.click(
      within(membershipRow).getByRole('button', { name: '14 days' })
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
    expect(
      within(membershipRow)
        .getByRole('button', { name: '14 days' })
        .getAttribute('aria-pressed')
    ).toBe('true');
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

  it('keeps a failed configuration draft and hides every template link', async () => {
    mockFetch(true);
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: '14 days' }));
    expect(
      screen.queryByRole('link', { name: /Open gym_membership_renewal/i })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByRole('button', { name: 'Save changes' })
    ).not.toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Save or cancel unsaved rule changes/i)
    ).toBeTruthy();
  });

  it('protects a draft when opening another rule’s template setup', async () => {
    mockFetch();
    render(<RenewalRemindersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: '14 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByTestId('rule-detail-joining_installments')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: /Open gym_installment_reminder/ })
    ).toBeNull();
    expect(
      screen.getByText(/Save or cancel unsaved rule changes/)
    ).toBeTruthy();
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
    expect(screen.getByText('Managed schedule')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(
        screen.queryByTestId('rule-detail-joining_installments')
      ).toBeNull()
    );
  });
});
