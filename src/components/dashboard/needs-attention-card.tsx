'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  FlaskConical,
  ShieldAlert,
  UserRoundX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { loadOwnerAttention } from '@/lib/reports/reporting';
import type { OwnerAttention } from '@/lib/reports/types';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface AttentionItem {
  label: string;
  detail: string;
  value: number;
  icon: LucideIcon;
  href: string;
  badge?: string;
}

export function NeedsAttentionCard() {
  const { accountId } = useAuth();
  const { fmt, locale } = useLocale();
  const [attention, setAttention] = useState<OwnerAttention | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await loadOwnerAttention(
          createClient(),
          accountId,
          fmt.today(),
          locale.timeZone
        );
        if (!cancelled) setAttention(next);
      } catch (error) {
        console.error('[dashboard] attention queue failed:', error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, fmt, locale.timeZone]);

  const items: AttentionItem[] = attention
    ? [
        {
          label: 'Renewals due',
          detail: 'Recurring plans ending in the next 7 days',
          value: attention.renewalsDue,
          icon: CalendarClock,
          href: '/members?view=renewals',
          badge: '7 days',
        },
        {
          label: 'Outstanding dues',
          detail: fmt.money(attention.outstandingAmount),
          value: attention.outstandingDues,
          icon: CircleDollarSign,
          href: '/members?view=payments',
        },
        {
          label: 'Inactive members',
          detail: 'No visit for 10+ days, including never visited',
          value: attention.inactiveMembers,
          icon: UserRoundX,
          href: '/members?view=renewals',
        },
        {
          label: 'Churn risk',
          detail: 'Active members carrying a churn-risk flag',
          value: attention.churnRisk,
          icon: ShieldAlert,
          href: '/members?view=all',
        },
        {
          label: 'Trial follow-ups',
          detail: 'Trials expired or ending within 3 days',
          value: attention.trialFollowups,
          icon: FlaskConical,
          href: '/members?view=trials',
        },
        {
          label: 'Failed mandates',
          detail: 'AutoPay mandates without an active replacement',
          value: attention.failedMandates,
          icon: CreditCard,
          href: '/members?view=payments',
        },
      ]
    : [];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>Live operating queues for today</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {failed ? (
          <EmptyState
            icon={AlertCircle}
            title="Operating queues unavailable"
            hint="Reload the page to try again."
            className="min-h-52 sm:col-span-2"
          />
        ) : attention ? (
          items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="hover:bg-muted/60 focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-lg p-2.5 transition-colors outline-none focus-visible:ring-2"
            >
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <item.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-foreground truncate text-sm font-medium">
                    {item.label}
                  </span>
                  {item.badge && <Badge variant="neutral">{item.badge}</Badge>}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {item.detail}
                </span>
              </span>
              <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
                {fmt.number(item.value)}
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </Link>
          ))
        ) : (
          Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))
        )}
      </CardContent>
    </Card>
  );
}
