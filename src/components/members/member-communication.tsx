'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import type { Message, MessageStatus } from '@/types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/table/table-skeleton';
import { MessageSquare, ArrowUpRight } from 'lucide-react';

interface MemberCommunicationProps {
  /** The member's contact id — the join key to their conversation. */
  contactId: string;
  /** Only fetch once the sheet is open (mirrors ContactNotesThread). */
  active: boolean;
}

/**
 * Known templates → the human reason they're sent. Anything not listed
 * falls back to a humanised template name, so new templates surface
 * without a code change.
 */
const TEMPLATE_REASONS: Record<string, { type: string; subject: string }> = {
  gym_membership_renewal: {
    type: 'Renewal reminder',
    subject: 'Membership renewal invitation — plan, end date and price',
  },
  gym_service_renewal: {
    type: 'Service renewal',
    subject: 'Service renewal invitation — service, end date and price',
  },
  gym_installment_reminder: {
    type: 'Installment reminder',
    subject: 'Existing installment — amount, membership and due date',
  },
  gym_payment_link: {
    type: 'Payment link',
    subject: 'Existing invoice — amount, reference and secure payment link',
  },
  gym_payment_due: {
    type: 'Payment due',
    subject: 'Existing membership balance — amount and plan',
  },
  gym_payment_receipt: {
    type: 'Payment receipt',
    subject: 'Recorded payment — amount, plan and active-until date',
  },
  gym_membership_activation: {
    type: 'Membership activation',
    subject: 'Activated membership — plan, gym and membership dates',
  },
  gym_win_back: {
    type: 'Win-back campaign',
    subject: 'Return invitation for a lapsed member',
  },
  gym_festival_offer: {
    type: 'Festival offer',
    subject: 'Time-bound promotional gym offer',
  },
  gym_membership_expiry_notice: {
    type: 'Legacy renewal message',
    subject: 'Retired membership-expiry template',
  },
  gym_renewal_reminder: {
    type: 'Legacy renewal message',
    subject: 'Retired renewal template',
  },
};

function humaniseTemplateName(name: string): string {
  const cleaned = name.replace(/_/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function templateReason(m: Message): { type: string; subject: string } {
  const known = m.template_name ? TEMPLATE_REASONS[m.template_name] : null;
  if (known) return known;
  const label = m.template_name
    ? humaniseTemplateName(m.template_name)
    : 'Template message';
  // Some send paths store the rendered body; prefer it as the subject.
  return { type: label, subject: m.content_text || label };
}

const STATUS_VARIANTS: Record<
  MessageStatus,
  'success' | 'danger' | 'info' | 'neutral'
> = {
  read: 'success',
  delivered: 'info',
  sent: 'neutral',
  sending: 'neutral',
  failed: 'danger',
};

/**
 * Communication log — the template messages sent to this member (renewal
 * reminders etc.) and why. Deliberately NOT a chat: members are talked to
 * on the phone/WhatsApp directly; this only answers "what did the system
 * send, when, and did it land". Free-form chat lives in the Inbox.
 */
export function MemberCommunication({
  contactId,
  active,
}: MemberCommunicationProps) {
  const supabase = createClient();
  const { fmt } = useLocale();
  const [loading, setLoading] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [rows, setRows] = useState<Message[]>([]);

  useEffect(() => {
    if (!active || !contactId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // One conversation per (account, contact) — grab the most recent.
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (!conv?.id) {
        setConversationId(null);
        setRows([]);
        setLoading(false);
        return;
      }

      // Outbound template sends only — the system/staff-initiated log.
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .eq('content_type', 'template')
        .in('sender_type', ['agent', 'bot'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (cancelled) return;
      setConversationId(conv.id);
      setRows((msgs ?? []) as Message[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, contactId, supabase]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages sent</CardTitle>
        {conversationId && (
          <CardAction>
            <Link
              href={`/inbox?c=${conversationId}`}
              className="text-primary-text inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              Open in Inbox
              <ArrowUpRight className="size-3.5" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="-mx-2">
            <TableSkeleton
              label="Loading sent messages"
              rows={5}
              columns={[
                { label: 'Type', variant: 'stacked' },
                { label: 'Subject' },
                {
                  label: 'Status',
                  variant: 'badge',
                  headClassName: 'text-right',
                  cellClassName: '[&>div]:ml-auto',
                },
              ]}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center">
            <MessageSquare className="size-6" />
            <p className="text-sm">No messages sent yet.</p>
          </div>
        ) : (
          /* Unframed like the Billing table: the card is the container, and
             every row of a hard-coded "WhatsApp" channel column said the same
             word. -mx-2 cancels the cell padding so column one lines up. */
          <div className="-mx-2">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const reason = templateReason(m);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="text-foreground">{reason.type}</div>
                        <div className="text-muted-foreground text-xs">
                          {fmt.dateTime(new Date(m.created_at))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-normal">
                        {reason.subject}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={STATUS_VARIANTS[m.status] ?? 'neutral'}>
                          {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
