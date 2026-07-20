'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Ghost, Loader2, MoonStar } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { INACTIVE_DAYS } from '@/lib/memberships/stats';
import {
  partitionInactivity,
  daysSinceVisit,
} from '@/lib/memberships/inactivity';
import type { Contact, MemberActivity, Membership } from '@/types';
import { Badge } from '@/components/ui/badge';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import { FollowUpButton } from '@/components/follow-ups/follow-up-button';
import { MemberIdentity } from './member-identity';

interface InactiveActionListsProps {
  /** Opens the member detail sheet (keyed by membership id). */
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

/** The follow-up dialog wants a Membership; rebuild one from the flat
 *  view row (only the fields the dialog and defaultReason read). */
function toMembership(r: MemberActivity): Membership {
  return {
    id: r.membership_id,
    account_id: r.account_id,
    contact_id: r.contact_id,
    member_number: r.member_number,
    user_id: '',
    plan_id: r.plan_id,
    start_date: r.start_date,
    end_date: r.end_date,
    status: r.status,
    fee_amount: r.fee_amount,
    fee_status: r.fee_status,
    is_trial: r.is_trial,
    created_at: '',
    updated_at: '',
    contact: { name: r.contact_name, phone: r.contact_phone } as Contact,
  } as Membership;
}

/**
 * Retention action lists — the churn-risk half of "who stopped
 * coming?". Two buckets over the member_activity view (037):
 * paid-up members gone quiet for INACTIVE_DAYS+, and members who
 * joined but never checked in. Each row hands the chase to a staff
 * owner via the follow-ups system (reason: inactive).
 */
export function InactiveActionLists({
  onSelect,
  reloadKey,
}: InactiveActionListsProps) {
  const { canSendMessages } = useAuth();
  const { fmt } = useLocale();

  const [rows, setRows] = useState<MemberActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Member being handed to a staff owner via the assign dialog.
  const [assigning, setAssigning] = useState<MemberActivity | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      // Current paying members only — expired/trial people are already
      // chased from the Renewals and Trials lists.
      const { data } = await supabase
        .from('member_activity')
        .select('*')
        .eq('status', 'active')
        .eq('is_trial', false)
        .gte('end_date', fmt.today());
      if (cancelled) return;
      setRows((data as MemberActivity[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, fmt]);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  const today = fmt.today();
  const { inactive, neverVisited } = partitionInactivity(rows, today);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <RetentionList
          title={`Inactive ${INACTIVE_DAYS}+ days`}
          icon={
            <MoonStar className="size-4 text-amber-foreground" />
          }
          rows={inactive}
          detail={(r) => {
            const days = daysSinceVisit(r, today);
            return `${r.plan_name ?? '—'} · last visit ${days}d ago`;
          }}
          onSelect={onSelect}
          onAssign={canSendMessages ? setAssigning : undefined}
          emptyLabel="Everyone with a visit history has been in recently."
        />
        <RetentionList
          title="Never visited"
          icon={<Ghost className="text-muted-foreground size-4" />}
          rows={neverVisited}
          detail={(r) => `${r.plan_name ?? '—'} · member since ${r.start_date}`}
          onSelect={onSelect}
          onAssign={canSendMessages ? setAssigning : undefined}
          emptyLabel="Every member has checked in at least once."
        />
      </div>

      {assigning && (
        <FollowUpDialog
          open={!!assigning}
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          membership={toMembership(assigning)}
          initialReason="inactive"
          onSaved={() => setAssigning(null)}
        />
      )}
    </>
  );
}

function RetentionList({
  title,
  icon,
  rows,
  detail,
  onSelect,
  onAssign,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: MemberActivity[];
  detail: (r: MemberActivity) => string;
  onSelect: (membershipId: string) => void;
  /** Present for agent+ — opens the assign-follow-up dialog. */
  onAssign?: (r: MemberActivity) => void;
  emptyLabel: string;
}) {
  return (
    <section className="border-border bg-card flex flex-col rounded-xl border">
      <header className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        {icon}
        <h3 className="text-foreground text-sm font-medium">{title}</h3>
        <Badge variant="neutral" className="ml-auto tabular-nums">
          {rows.length}
        </Badge>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCircle2 className="size-6 text-emerald-foreground" />
          <p className="text-muted-foreground text-xs">{emptyLabel}</p>
        </div>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((r) => (
            <li
              key={r.membership_id}
              className="hover:bg-muted/50 cursor-pointer px-3 py-2.5 transition-colors"
              onClick={() => onSelect(r.membership_id)}
            >
              <div className="flex items-center justify-between gap-2">
                <MemberIdentity
                  name={r.contact_name}
                  secondary={r.contact_phone}
                  meta={
                    <p className="text-muted-foreground truncate text-xs">
                      {detail(r)}
                    </p>
                  }
                />
                {onAssign && (
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FollowUpButton onClick={() => onAssign(r)} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
