'use client';

import { useEffect, useState } from 'react';
import { UserRoundSearch } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/user-avatar';
import { QueueCount, QueueEmpty, QueueSkeleton } from './action-queue';
import { DashboardSection } from './dashboard-section';

/**
 * Leads still sitting in "New" past the first-response window — nobody has
 * replied to them. Its own section since follow-ups moved into one merged
 * queue; these are the leads that never became a follow-up at all.
 *
 * No "See all": `/leads` routes only `all | followups`, and the first-response
 * accountability view is not reachable from its tabs. Do not link this to a
 * page that shows a different set.
 */

const STALE_HOURS = 24;
const LIST_LIMIT = 8;

interface StaleLead {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  messagePreview: string;
  /** Whole days since capture — computed at fetch time (render stays pure). */
  waitingDays: number;
}

interface StaleLeadRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export function UncontactedLeads() {
  const [leads, setLeads] = useState<StaleLead[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const staleCutoff = new Date(
        Date.now() - STALE_HOURS * 60 * 60 * 1000
      ).toISOString();
      const staleResult = await supabase
        .from('contacts')
        .select('id, name, avatar_url, created_at, memberships!left(id)', {
          count: 'exact',
        })
        .is('memberships', null)
        .is('lead_status', null)
        .lt('created_at', staleCutoff)
        .order('created_at', { ascending: true })
        .limit(LIST_LIMIT);

      const staleRows = (staleResult.data ?? []) as unknown as StaleLeadRow[];
      const staleContactIds = staleRows.map((lead) => lead.id);
      const conversationResult =
        staleContactIds.length > 0
          ? await supabase
              .from('conversations')
              .select('contact_id, last_message_text')
              .in('contact_id', staleContactIds)
              .order('last_message_at', {
                ascending: false,
                nullsFirst: false,
              })
          : { data: [] };

      if (cancelled) return;
      const now = Date.now();
      const messageByContact = new Map<string, string>();
      for (const conversation of conversationResult.data ?? []) {
        if (!messageByContact.has(conversation.contact_id)) {
          messageByContact.set(
            conversation.contact_id,
            conversation.last_message_text?.trim() || 'No message yet'
          );
        }
      }
      setLeads(
        staleRows.map((lead) => ({
          id: lead.id,
          name: lead.name,
          avatarUrl: lead.avatar_url,
          messagePreview: messageByContact.get(lead.id) ?? 'No message yet',
          waitingDays: Math.max(
            1,
            Math.floor(
              (now - new Date(lead.created_at).getTime()) /
                (24 * 60 * 60 * 1000)
            )
          ),
        }))
      );
      setTotal(staleResult.count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = leads?.length ?? 0;

  return (
    <DashboardSection
      id="not-contacted-yet"
      title="Not contacted yet"
      className="flex flex-col"
      action={<QueueCount shown={shown} total={total} />}
    >
      <Card className="flex-1">
        <CardContent>
          {leads === null ? (
            <QueueSkeleton rowClassName="h-11" />
          ) : leads.length === 0 ? (
            <QueueEmpty
              icon={UserRoundSearch}
              text={`Every lead older than ${STALE_HOURS} hours has been picked up.`}
            />
          ) : (
            <ul className="divide-border/60 -mx-2 divide-y">
              {leads.map((lead) => {
                const displayName = lead.name?.trim() || 'Unnamed lead';
                return (
                  <li key={lead.id}>
                    <Link
                      href={`/leads?contact=${encodeURIComponent(lead.id)}&focus=followup`}
                      className="hover:bg-muted/50 flex items-center gap-3 px-2 py-2.5 transition-colors"
                    >
                      <UserAvatar
                        name={displayName}
                        src={lead.avatarUrl}
                        className="size-8 shrink-0"
                        fallbackClassName="text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {displayName}
                        </p>
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {lead.messagePreview}
                        </p>
                      </div>
                      <Badge variant="info">Waiting {lead.waitingDays}d</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
}
