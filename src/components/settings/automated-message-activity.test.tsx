// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: '123e4567-e89b-42d3-a456-426614174000' }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (v: string) => v,
      dateTime: (v: string) => v,
      today: () => '2026-09-12',
    },
    locale: { weekStart: 1 },
  }),
}));

import { AutomatedMessageActivity } from './automated-message-activity';

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
  const activity = {
    items: [
      {
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
      },
    ],
    nextCursor: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.includes('readiness')
              ? {
                  diagnostics: [
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
                  ],
                }
              : activity
          ),
          { status: 200 }
        )
      )
    )
  );
});

describe('AutomatedMessageActivity', () => {
  it('uses the active branch and verified destinations without confusing empty history with eligibility', async () => {
    render(<AutomatedMessageActivity />);
    await screen.findByText('Asha');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
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
    expect(
      screen.getByRole('button', { name: 'Conversation' }).getAttribute('href')
    ).toContain('/inbox?c=conversation-1');
    expect(
      screen.getByRole('button', { name: 'Invoice' }).getAttribute('href')
    ).toContain('/finance?view=invoices&invoice=invoice-1');
    expect(
      screen.getByRole('button', { name: 'Invoice' }).getAttribute('href')
    ).toContain('branch=123e4567-e89b-42d3-a456-426614174000');
    expect(
      screen.getByText(/No eligible reminders are due right now/)
    ).toBeTruthy();
    expect(screen.getByText(/Service renewal · Off/)).toBeTruthy();
  });
});
