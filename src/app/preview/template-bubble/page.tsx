'use client';

import { notFound } from 'next/navigation';
import { MessageBubble } from '@/components/inbox/message-bubble';
import { MessageActions } from '@/components/inbox/message-actions';
import type { Message } from '@/types';

// Dev-only visual harness for the template bubble. The real thread lives
// behind auth on /inbox and needs an approved template plus a live WhatsApp
// connection, so this renders the bubble against fixed rows — including the
// header shapes an account hits rarely (text header, image header, document
// header) and the bodiless rows written before sends persisted their text.
// Never reachable in production.

const DOODLE = "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

const base: Message = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_type: 'agent',
  content_type: 'template',
  template_name: 'gym_membership_renewal',
  message_id: 'wamid.TEMPLATE1',
  status: 'read',
  created_at: '2026-08-23T12:05:00.000Z',
};

const BODY =
  'Hi Rahul, your Quarterly membership expires on 20 Sep 2026. Renew for ₹3,999 to keep your access active.';

const CASES: { label: string; message: Message }[] = [
  {
    label: 'Body only',
    message: { ...base, content_text: BODY },
  },
  {
    label: 'Text header stacked above the body',
    message: { ...base, content_text: `Quarterly renewal\n\n${BODY}` },
  },
  {
    label: 'Image header',
    message: {
      ...base,
      content_text: BODY,
      media_url: '/usefuldesk-razorpay-app-icon.png',
    },
  },
  {
    label: 'Document header (link, not a filled row)',
    message: {
      ...base,
      content_text: BODY,
      media_url: 'https://cdn.example/August%20price%20list.pdf',
    },
  },
  {
    label: 'Sent before bodies were persisted (falls back to the title)',
    message: { ...base },
  },
  {
    label: 'Inbound template (neutral bubble tokens)',
    message: { ...base, sender_type: 'customer', content_text: BODY },
  },
];

export default function TemplateBubblePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className={`${DOODLE} min-h-screen p-4 sm:p-6`}>
      <div className="mx-auto max-w-3xl space-y-6">
        {CASES.map((c) => (
          <section key={c.label} className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-medium">
              {c.label}
            </h2>
            {/* MessageActions owns the row alignment + width cap in the
                real thread, so the harness wraps the bubble the same way. */}
            <MessageActions
              message={c.message}
              onReply={() => {}}
              onReact={() => {}}
            >
              <MessageBubble message={c.message} />
            </MessageActions>
          </section>
        ))}
      </div>
    </div>
  );
}
