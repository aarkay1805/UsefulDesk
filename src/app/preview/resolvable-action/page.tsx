'use client';

import { notFound } from 'next/navigation';
import { MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';

// Dev-only visual harness for the blocked-action explanation. The real popover
// lives behind auth on an invoice, a renewal, or a follow-up and only appears
// once a genuine prerequisite fails, so this pins it open against fixed
// blockers — including the ones real accounts hit rarely (no resolution for a
// viewer, a provider string long enough to wrap, every anchor side). Never
// reachable in production.

const noop = () => {};

const TEMPLATE: ActionBlocker = {
  title: "Invoice template isn't ready",
  description: 'Approve and sync gym_invoice_document in en_US before sending.',
  resolution: { label: 'Open template setup', href: '/settings?tab=templates' },
};

const PERMISSION: ActionBlocker = {
  title: 'Admin access required',
  description:
    'Only an agent, admin, or owner can send invoice documents from this account.',
};

const REFUND: ActionBlocker = {
  title: 'Refund review required',
  description: 'Resolve the invoice refund review before creating a document.',
  resolution: { label: 'Resolve refund review', onResolve: noop },
};

const LONG_TITLE: ActionBlocker = {
  title: 'Invoice document unavailable for this voided membership period',
  description: 'Voided invoices cannot be shared.',
};

const LONG: ActionBlocker = {
  title: 'Payment link unavailable',
  description:
    'Approve and sync the exact gym_payment_link template, then reconnect the WhatsApp number this branch collects on, before sending a payment link to this member.',
  resolution: { label: 'Open template setup', href: '/settings?tab=templates' },
};

const CASES: {
  label: string;
  blocker: ActionBlocker;
  trigger: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}[] = [
  {
    label: 'Resolution link (the reported case)',
    blocker: TEMPLATE,
    trigger: 'Send on WhatsApp',
  },
  {
    label: 'No resolution — viewer role',
    blocker: PERMISSION,
    trigger: 'Send on WhatsApp',
  },
  {
    label: 'Inline callback resolution',
    blocker: REFUND,
    trigger: 'Download invoice',
  },
  {
    label: 'Description long enough to wrap',
    blocker: LONG,
    trigger: 'Send payment link',
  },
  {
    label: 'Title long enough to reach the dismiss control',
    blocker: LONG_TITLE,
    trigger: 'Download invoice',
  },
  {
    label: 'Anchored above',
    blocker: TEMPLATE,
    trigger: 'Send reminder',
    side: 'top',
  },
  {
    label: 'Anchored right',
    blocker: TEMPLATE,
    trigger: 'Send reminder',
    side: 'right',
  },
];

export default function ResolvableActionPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-screen p-4 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-64">
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium">
            Live — hover for the tooltip, click for the explanation
          </h2>
          <div className="flex flex-wrap gap-2">
            <ResolvableAction
              trigger={
                <Button type="button" variant="outline">
                  <MessageCircle />
                  Send on WhatsApp
                </Button>
              }
              blocker={TEMPLATE}
            />
            <ResolvableAction
              trigger={
                <Button type="button" variant="outline">
                  Download invoice
                </Button>
              }
              onAction={noop}
            />
          </div>
        </section>

        {CASES.map((c) => (
          <section key={c.label} className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-medium">
              {c.label}
            </h2>
            <ResolvableAction
              trigger={
                <Button type="button" variant="outline">
                  {c.trigger}
                </Button>
              }
              blocker={c.blocker}
              side={c.side}
              open
              onOpenChange={noop}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
