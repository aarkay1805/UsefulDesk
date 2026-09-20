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

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: '123e4567-e89b-42d3-a456-426614174000' }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (v: string) => v,
      dateTime: (v: string) => v,
      time: (v: string) => `at ${v}`,
      today: () => '2026-09-12',
    },
    locale: { weekStart: 1 },
  }),
}));

import { AutomatedMessageActivity } from './automated-message-activity';

const activityRow = {
  activity_id: 'lifecycle:123e4567-e89b-42d3-a456-426614174000',
  account_id: '123e4567-e89b-42d3-a456-426614174000',
  rule_id: 'invoice_collection',
  source_kind: 'invoice_due',
  contact_id: 'contact-1',
  contact_name: 'Asha',
  contact_avatar_url: null,
  membership_id: null,
  member_service_id: null,
  invoice_id: 'invoice-1',
  conversation_id: 'conversation-1',
  follow_up_id: 'follow-1',
  occurred_at: '2026-09-12T10:00:00.000Z',
  scheduled_for: '2026-09-12',
  outcome: 'accepted',
  job_state: 'accepted',
  reason_code: null,
  provider_message_id: 'wamid',
  message_status: 'sent',
  provider_error_title: null,
  provider_error_detail: null,
};

const diagnostics = [
  {
    kind: 'membership_renewal',
    state: 'no_eligible',
    reason: 'No eligible reminders are due right now.',
  },
  {
    kind: 'service_renewal',
    state: 'disabled',
    reason: 'This schedule is off.',
  },
  {
    kind: 'installment_reminder',
    state: 'blocked',
    reason: 'Connect WhatsApp before this reminder can be sent.',
  },
];

function respond(activity: { status?: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        input.includes('readiness')
          ? new Response(JSON.stringify({ diagnostics }), { status: 200 })
          : new Response(JSON.stringify(activity.body), {
              status: activity.status ?? 200,
            })
      )
    )
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  respond({ body: { items: [activityRow], nextCursor: null } });
});

describe('AutomatedMessageActivity', () => {
  it('uses the active branch and verified destinations without confusing empty history with eligibility', async () => {
    render(<AutomatedMessageActivity />);
    await waitFor(() => expect(screen.getAllByText('Asha')).toHaveLength(2));
    const calls = vi.mocked(fetch).mock.calls;
    expect(
      calls.find(([url]) =>
        String(url).includes('/api/reminders/activity')
      )?.[1]
    ).toMatchObject({
      headers: {
        'x-usefuldesk-account-id': '123e4567-e89b-42d3-a456-426614174000',
      },
    });
    const chats = screen.getAllByRole('link', {
      name: 'Open chat with Asha',
    });
    expect(chats).toHaveLength(2);
    expect(chats[0].textContent).toContain('Open chat');
    expect(chats[0].getAttribute('href')).toContain('/inbox?c=conversation-1');
    const invoices = screen.getAllByRole('link', {
      name: 'View invoice for Asha',
    });
    expect(invoices).toHaveLength(2);
    expect(invoices[0].getAttribute('href')).toContain(
      '/finance?view=invoices&invoice=invoice-1'
    );
    expect(invoices[0].getAttribute('href')).toContain(
      'branch=123e4567-e89b-42d3-a456-426614174000'
    );
    expect(invoices[1].getAttribute('href')).toBe(
      invoices[0].getAttribute('href')
    );
    expect(
      screen
        .getAllByRole('link', { name: 'View follow-up for Asha' })[0]
        .getAttribute('href')
    ).toContain('/members?contact=contact-1&view=followups');
    const members = screen.getAllByRole('link', {
      name: 'View member Asha',
    });
    expect(members).toHaveLength(2);
    expect(members[0].textContent).toContain('View member');

    const readiness = screen.getByRole('region', {
      name: 'Renewal and installment checks',
    });
    expect(
      within(readiness).getByText(
        'Checks membership renewals, service renewals, and installment reminders only.'
      )
    ).toBeTruthy();
    expect(
      within(readiness).getByText('No eligible reminders are due right now.')
    ).toBeTruthy();
    const service = within(readiness)
      .getByText('Service renewal')
      .closest('li')!;
    expect(within(service).getByText('Off')).toBeTruthy();
  });

  it('names what each record’s date means and when it was recorded', async () => {
    render(<AutomatedMessageActivity />);
    await waitFor(() =>
      expect(screen.getAllByText('Due date: 2026-09-12')).toHaveLength(2)
    );
    expect(screen.getByText('at 2026-09-12T10:00:00.000Z')).toBeTruthy();
    expect(screen.getByText('Recorded 2026-09-12T10:00:00.000Z')).toBeTruthy();
    expect(screen.queryByText(/Anchor/)).toBeNull();
    expect(screen.getAllByText('Accepted by WhatsApp')).toHaveLength(2);
    expect(screen.getAllByText('Message')).toHaveLength(2);
    expect(screen.getAllByText('Status')).toHaveLength(2);
    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
  });

  it('shows one plain failure reason and retains original provider diagnostics behind a disclosure', async () => {
    respond({
      body: {
        items: [
          {
            ...activityRow,
            outcome: 'failed',
            job_state: 'failed',
            reason_code: 'provider_delivery_failed',
            provider_error_title: 'Message undeliverable',
            provider_error_detail: 'Message Undeliverable.',
          },
        ],
        nextCursor: null,
      },
    });
    render(<AutomatedMessageActivity />);

    await waitFor(() =>
      expect(
        screen.getAllByText(
          'WhatsApp could not deliver this message. Check the member’s phone number, then open the chat for details.'
        )
      ).toHaveLength(2)
    );
    expect(screen.queryByText('Message Undeliverable.')).toBeNull();

    const disclosures = screen.getAllByRole('button', {
      name: 'Provider details',
    });
    fireEvent.click(disclosures[0]);
    expect(await screen.findByText('Message Undeliverable.')).toBeTruthy();
    expect(screen.getByText('Message undeliverable')).toBeTruthy();
  });

  it('offers the rule as the next step for a blocked schedule', async () => {
    const onReviewRule = vi.fn();
    render(<AutomatedMessageActivity onReviewRule={onReviewRule} />);
    const review = await screen.findByRole('link', {
      name: 'Review message',
    });
    expect(review.getAttribute('href')).toContain(
      '/settings?tab=reminders&rule=joining_installments'
    );
    fireEvent.click(review);
    expect(onReviewRule).toHaveBeenCalledWith('joining_installments');
    // Only the blocked schedule carries a recovery link.
    expect(
      screen.getAllByRole('link', { name: 'Review message' })
    ).toHaveLength(1);
  });

  it('keeps an empty history neutral about eligibility', async () => {
    respond({ body: { items: [], nextCursor: null } });
    render(<AutomatedMessageActivity />);
    expect(await screen.findByText('No messages recorded yet')).toBeTruthy();
    expect(
      screen.getByText(/checks above cover renewals and installments only/i)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('replaces a server failure with a retry path', async () => {
    respond({ status: 500, body: { error: 'Internal server error' } });
    render(<AutomatedMessageActivity />);
    expect(
      await screen.findByText('Message history couldn’t load')
    ).toBeTruthy();
    expect(
      screen.getByText('Check your connection, then try again.')
    ).toBeTruthy();
    expect(screen.queryByText('Internal server error')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps the server’s explanation for a refused request', async () => {
    respond({
      status: 403,
      body: { error: 'This action requires settings access' },
    });
    render(<AutomatedMessageActivity />);
    expect(
      await screen.findByText('This action requires settings access')
    ).toBeTruthy();
  });
});
