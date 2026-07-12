"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import type { Message, MessageStatus } from "@/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, ArrowUpRight, Loader2 } from "lucide-react";

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
  gym_renewal_reminder: {
    type: "Renewal reminder",
    subject: "Membership expiry reminder — plan, expiry date and fee",
  },
};

function humaniseTemplateName(name: string): string {
  const cleaned = name.replace(/_/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function templateReason(m: Message): { type: string; subject: string } {
  const known = m.template_name ? TEMPLATE_REASONS[m.template_name] : null;
  if (known) return known;
  const label = m.template_name
    ? humaniseTemplateName(m.template_name)
    : "Template message";
  // Some send paths store the rendered body; prefer it as the subject.
  return { type: label, subject: m.content_text || label };
}

const STATUS_VARIANTS: Record<
  MessageStatus,
  "success" | "danger" | "info" | "neutral"
> = {
  read: "success",
  delivered: "info",
  sent: "neutral",
  sending: "neutral",
  failed: "danger",
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
        .from("conversations")
        .select("id")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
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
        .from("messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .eq("content_type", "template")
        .in("sender_type", ["agent", "bot"])
        .order("created_at", { ascending: false })
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
        <CardTitle>Communication</CardTitle>
        {conversationId && (
          <CardAction>
            <Link
              href={`/inbox?c=${conversationId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline"
            >
              Open in Inbox
              <ArrowUpRight className="size-3.5" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <MessageSquare className="size-6" />
            <p className="text-sm">No template messages sent yet.</p>
            <p className="text-xs">
              Renewal reminders and other template sends appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs">Subject</TableHead>
                  <TableHead className="text-right text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const reason = templateReason(m);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="text-foreground">{reason.type}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmt.dateTime(new Date(m.created_at))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">WhatsApp</Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        {reason.subject}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={STATUS_VARIANTS[m.status] ?? "neutral"}>
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
