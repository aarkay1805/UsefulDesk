'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { createClient } from '@/lib/supabase/client';
import { daysBetween, istAddDays } from '@/lib/memberships/expiry';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
import { useLocale } from '@/hooks/use-locale';
import { MemberIdentity } from '@/components/members/member-identity';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { QueueCount, QueueEmpty, QueueSkeleton } from './action-queue';
import { DashboardSection } from './dashboard-section';

/**
 * Memberships ending inside the renewal window that nobody has scheduled work
 * for yet. Its own section since follow-ups moved into one merged queue —
 * these are the renewals that have not become a follow-up.
 *
 * Expired recovery stays in the full Renewals queue; this is the near window
 * only. `Renewals due` in Today at a glance counts the same population, which
 * is why this heading names the memberships rather than repeating that label.
 */

const LIST_LIMIT = 8;
const RENEWAL_WINDOW_DAYS = 7;

interface DashboardMembership {
  id: string;
  end_date: string;
  contact: {
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  plan: { name: string | null; plan_type: string | null } | null;
}

export function ExpiringMemberships() {
  const { fmt } = useLocale();
  const [expiring, setExpiring] = useState<DashboardMembership[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = fmt.today();
      const result = await supabase
        .from('memberships')
        .select(
          'id, end_date, contact:contacts(name, phone, avatar_url), plan:membership_plans(name, plan_type)'
        )
        .eq('is_trial', false)
        .eq('status', 'active')
        .gte('end_date', today)
        .lte('end_date', istAddDays(today, RENEWAL_WINDOW_DAYS))
        .order('end_date', { ascending: true });
      if (cancelled) return;
      const rows = (result.data as DashboardMembership[] | null) ?? [];
      setExpiring(rows.filter((row) => isRenewalChaseable(row.plan)));
    })();
    return () => {
      cancelled = true;
    };
  }, [fmt]);

  const total = expiring?.length ?? 0;
  const shown = Math.min(total, LIST_LIMIT);

  return (
    <DashboardSection
      id="expiring-memberships"
      title="Expiring memberships"
      className="flex flex-col"
      action={
        <div className="flex items-center gap-2">
          <QueueCount shown={shown} total={total} />
          <Link
            data-slot="button"
            href="/members?view=renewals"
            className={buttonVariants({ variant: 'link', size: 'xs' })}
          >
            See all
          </Link>
        </div>
      }
    >
      <Card className="flex-1">
        <CardContent>
          {expiring === null ? (
            <QueueSkeleton rowClassName="h-11" />
          ) : expiring.length === 0 ? (
            <QueueEmpty
              icon={CalendarClock}
              text={`No memberships expiring in the next ${RENEWAL_WINDOW_DAYS} days.`}
            />
          ) : (
            <ul className="divide-border/60 -mx-2 divide-y">
              {expiring.slice(0, LIST_LIMIT).map((membership) => {
                const days = daysBetween(fmt.today(), membership.end_date);
                return (
                  <li
                    key={membership.id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <Link
                      href={`/members?view=renewals&member=${encodeURIComponent(membership.id)}`}
                      className="flex items-center gap-3 px-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <MemberIdentity
                          name={membership.contact?.name}
                          secondary={membership.contact?.phone}
                          src={membership.contact?.avatar_url}
                          meta={membership.plan?.name ?? undefined}
                        />
                      </div>
                      <Badge variant="warning">
                        {days === 0 ? 'Expires today' : `Expires in ${days}d`}
                      </Badge>
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
