'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  CreditCard,
  FlaskConical,
  ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { loadOwnerAttention } from '@/lib/reports/reporting';
import type { OwnerAttention } from '@/lib/reports/types';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardSection } from './dashboard-section';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface AttentionItem {
  label: string;
  detail: string;
  value: number;
  icon: LucideIcon;
  href: string;
}

/**
 * The exceptions no other queue owns. Renewals due, fees to collect, and
 * inactive members deliberately do NOT appear here — "Today at a glance"
 * already carries those three numbers and links to the same destinations,
 * so repeating them made the page state the same work twice.
 */
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
          label: 'May leave',
          detail: 'Active members marked as at risk',
          value: attention.churnRisk,
          icon: ShieldAlert,
          href: '/members?view=all',
        },
        {
          label: 'Trials to follow up',
          detail: 'Trials ending soon or already ended',
          value: attention.trialFollowups,
          icon: FlaskConical,
          href: '/members?view=trials',
        },
        {
          label: 'Auto-pay problems',
          detail: 'Auto-pay needs to be fixed',
          value: attention.failedMandates,
          icon: CreditCard,
          href: '/members?view=payments',
        },
      ]
    : [];

  return (
    <DashboardSection id="needs-attention" title="Needs attention">
      <Card>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {failed ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load these lists"
              hint="Reload the page to try again."
              className="min-h-32 sm:col-span-3"
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
                  <span className="text-foreground block truncate text-sm font-medium">
                    {item.label}
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
            Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
}
