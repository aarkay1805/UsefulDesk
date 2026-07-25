'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, IndianRupee, UserRoundX, Wallet } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import { loadGymStats, type GymStats } from '@/lib/memberships/stats';
import { MetricCard } from '@/components/dashboard/metric-card';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { SkeletonCard } from '@/components/dashboard/skeleton';

/**
 * The four owner decisions that set the day: collect outstanding money,
 * retain expiring members, recover members whose attendance has gone quiet,
 * and understand today's collections against a recent daily benchmark.
 */
export function GymMetrics() {
  const { locale, fmt } = useLocale();
  const [stats, setStats] = useState<GymStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = createClient();
    let cancelled = false;
    (async () => {
      try {
        const s = await loadGymStats(db, fmt.today(), locale.timeZone);
        if (!cancelled) setStats(s);
      } catch (err) {
        console.error('[dashboard] gym stats failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fmt, locale.timeZone]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            Owner decisions
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Money, renewals, and retention that need attention today
          </p>
        </div>
        <Link
          href="/reports"
          className="text-primary-text text-xs font-medium hover:underline"
        >
          Open reports →
        </Link>
      </div>

      {loading || !stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TileLink href="/members?view=payments">
            <MetricCard
              title="Fees to collect"
              value={
                <AnimatedNumber
                  value={stats.feesDueAmount}
                  format={(n) => fmt.money(n)}
                  className="tabular-nums"
                />
              }
              icon={Wallet}
              subtitle={`${fmt.number(stats.feesDueCount)} outstanding ${
                stats.feesDueCount === 1 ? 'balance' : 'balances'
              }`}
            />
          </TileLink>
          <TileLink href="/members?view=renewals">
            <MetricCard
              title="Renewals due"
              value={<AnimatedNumber value={stats.expiring7} />}
              icon={CalendarClock}
              subtitle="Memberships ending in the next 7 days"
            />
          </TileLink>
          <TileLink href="/members?view=retention">
            <MetricCard
              title="Members at risk"
              value={
                <AnimatedNumber
                  value={stats.missedVisitRisk + stats.neverVisitedRisk}
                />
              }
              icon={UserRoundX}
              subtitle={riskContext(stats, fmt.number)}
            />
          </TileLink>
          <TileLink href="/finance?view=payments">
            <MetricCard
              title="Collected today"
              value={
                <AnimatedNumber
                  value={stats.collectedToday}
                  format={(n) => fmt.money(n)}
                  className="tabular-nums"
                />
              }
              icon={IndianRupee}
              delta={collectionComparison(stats, fmt.money)}
            />
          </TileLink>
        </div>
      )}
    </section>
  );
}

function TileLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="focus-visible:ring-primary hover:[&>div]:border-border-hover block h-full rounded-xl outline-none focus-visible:ring-2 [&>div]:h-full [&>div]:transition-colors"
    >
      {children}
    </Link>
  );
}

function riskContext(
  stats: GymStats,
  formatNumber: (value: number) => string
): string {
  if (stats.missedVisitRisk > 0 && stats.neverVisitedRisk > 0) {
    return `${formatNumber(stats.missedVisitRisk)} missed visits · ${formatNumber(
      stats.neverVisitedRisk
    )} never checked in`;
  }
  if (stats.missedVisitRisk > 0) {
    return `${formatNumber(stats.missedVisitRisk)} absent for 10+ days`;
  }
  if (stats.neverVisitedRisk > 0) {
    return `${formatNumber(stats.neverVisitedRisk)} never checked in`;
  }
  return 'No attendance risks to follow up';
}

function collectionComparison(
  stats: GymStats,
  formatMoney: (value: number) => string
): { sign: number; label: string } {
  const difference = stats.collectedToday - stats.collectionDailyAverage7d;
  if (Math.abs(difference) < 0.5) {
    return {
      sign: 0,
      label: `${formatMoney(stats.collectionDailyAverage7d)} 7-day daily average`,
    };
  }
  return {
    sign: difference,
    label: `${formatMoney(Math.abs(difference))} ${
      difference > 0 ? 'above' : 'below'
    } 7-day daily average`,
  };
}
