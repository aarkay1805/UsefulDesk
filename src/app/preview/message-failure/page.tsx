'use client';

import { notFound } from 'next/navigation';
import { MessageBubble } from '@/components/inbox/message-bubble';
import { MessageActions } from '@/components/inbox/message-actions';
import type { Message } from '@/types';

// Dev-only visual harness for the failed-send note under an outbound bubble.
// The real thread lives behind auth on /inbox and needs a genuinely failed
// Meta callback, so this renders the bubble against fixed provider payloads —
// including the ones real accounts hit rarely (an embedded Business Manager
// URL, a code with no prose, a title Meta repeats as its own detail).
// Never reachable in production.

const DOODLE = "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

const base: Message = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_type: 'agent',
  content_type: 'template',
  content_text:
    'Hi Rajat, a payment of ₹1,000 for your Competition membership is still pending. Please clear it to keep your access active. Reply here for a payment link or any help.',
  template_name: 'gym_installment_reminder',
  message_id: 'wamid.STATUS1',
  status: 'failed',
  created_at: '2026-08-22T15:00:00.000Z',
};

const CASES: { label: string; message: Message }[] = [
  {
    label: 'Embedded Business Manager URL (the reported case)',
    message: {
      ...base,
      provider_error_code: '131042',
      provider_error_title: 'Business eligibility payment issue',
      provider_error_detail:
        'Message failed to send because your WhatsApp Business account currency is not configured. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=2067632370500278&asset_id=2136600423937923&wizard_name=CHANGE_CURRENCY_business-account to resolve this issue.',
    },
  },
  {
    label: 'Short detail, distinct title',
    message: {
      ...base,
      content_text: 'Your payment is due.',
      provider_error_code: '131047',
      provider_error_title: 'Re-engagement message',
      provider_error_detail:
        'More than 24 hours have passed since the recipient last replied.',
    },
  },
  {
    label: 'Meta repeats the title as its detail',
    message: {
      ...base,
      content_text: 'Reminder sent.',
      provider_error_code: '131026',
      provider_error_title: 'Message undeliverable',
      provider_error_detail: 'Message undeliverable',
    },
  },
  {
    label: 'Code only — no title, no detail',
    message: {
      ...base,
      content_text: 'Reminder sent.',
      provider_error_code: '133010',
    },
  },
  {
    label: 'Detail only — no code',
    message: {
      ...base,
      content_text: 'Reminder sent.',
      provider_error_detail:
        'This message was not sent as part of an experiment.',
    },
  },
  {
    label: 'Failed with nothing retained (note must not render)',
    message: { ...base, content_text: 'Reminder sent.' },
  },
];

export default function MessageFailurePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className={`${DOODLE} min-h-screen p-4 sm:p-6`}>
      <div className="mx-auto max-w-3xl space-y-6">
        {CASES.map((c) => (
          <section key={c.label} className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-medium">
              {c.label}
            </h2>
            <div className="flex justify-end">
              <MessageActions
                message={c.message}
                onReply={() => {}}
                onReact={() => {}}
              >
                <MessageBubble message={c.message} />
              </MessageActions>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
