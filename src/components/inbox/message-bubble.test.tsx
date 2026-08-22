// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/types';
import { MessageBubble } from './message-bubble';

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: { time: () => '7:46 PM' },
  }),
}));

afterEach(cleanup);

const failedMessage: Message = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_type: 'agent',
  content_type: 'template',
  content_text: 'Your payment is due.',
  template_name: 'gym_payment_due',
  message_id: 'wamid.STATUS1',
  status: 'failed',
  created_at: '2026-08-22T14:16:48.000Z',
  provider_error_code: '131042',
  provider_error_title: 'Business eligibility payment issue',
  provider_error_detail:
    'Message failed to send because of a problem with the payment method.',
};

describe('MessageBubble delivery failure details', () => {
  it('shows the retained Meta code and actionable detail under a failed outbound message', () => {
    render(<MessageBubble message={failedMessage} />);

    expect(screen.getByText('Meta 131042')).toBeTruthy();
    expect(
      screen.getByText(
        'Message failed to send because of a problem with the payment method.'
      )
    ).toBeTruthy();
  });

  it('links an embedded Business Manager URL by hostname without printing it', () => {
    render(
      <MessageBubble
        message={{
          ...failedMessage,
          provider_error_detail:
            'Message failed to send because your WhatsApp Business account currency is not configured. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=2067632370500278&wizard_name=CHANGE_CURRENCY to resolve this issue.',
        }}
      />
    );

    const link = screen.getByRole('link', { name: /business\.facebook\.com/ });
    expect(link.getAttribute('href')).toBe(
      'https://business.facebook.com/billing_hub/accounts/details/?business_id=2067632370500278&wizard_name=CHANGE_CURRENCY'
    );
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // The 120-character URL must never reach the visible run — it is the
    // token that overflowed the note's width cap.
    expect(document.body.textContent).not.toContain('business_id=');
  });

  it('does not repeat a title Meta also sent verbatim as its detail', () => {
    render(
      <MessageBubble
        message={{
          ...failedMessage,
          provider_error_title: 'Message undeliverable',
          provider_error_detail: 'Message undeliverable',
        }}
      />
    );

    expect(screen.getAllByText('Message undeliverable')).toHaveLength(1);
  });

  it('does not show provider diagnostics for a delivered message', () => {
    render(
      <MessageBubble message={{ ...failedMessage, status: 'delivered' }} />
    );

    expect(screen.queryByText('Meta 131042')).toBeNull();
  });
});
