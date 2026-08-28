'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import {
  AlertCircle,
  CalendarClock,
  IndianRupee,
  UserRoundX,
  Wallet,
} from 'lucide-react';

import { useLocale } from '@/hooks/use-locale';
import type { GymStats } from '@/lib/memberships/stats';
import { useDashboardActions } from '@/components/dashboard/dashboard-actions';
import { DashboardSection } from '@/components/dashboard/dashboard-section';
import { EmptyState } from '@/components/dashboard/empty-state';
import { MetricCard } from '@/components/dashboard/metric-card';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { buttonVariants } from '@/components/ui/button';
import { SkeletonCard } from '@/components/dashboard/skeleton';

/**
 * The four owner decisions that set the day: collect outstanding money,
 * retain expiring members, recover members whose attendance has gone quiet,
 * and understand today's collections against a recent daily benchmark.
 */
export function GymMetrics() {
  const { fmt } = useLocale();
  const { snapshot, failed } = useDashboardActions();
  const stats = snapshot?.gymMetrics ?? null;
  const sectionFailed =
    failed || snapshot?.errors.includes('gymMetrics') === true;
  const loading = snapshot === null && !failed;

  return (
    <DashboardSection
      id="today-at-a-glance"
      title="Today at a glance"
      action={
        <Link
          data-slot="button"
          href="/finance?view=performance"
          className={buttonVariants({ variant: 'link', size: 'xs' })}
        >
          See business report
        </Link>
      }
    >
      {sectionFailed ? (
        <EmptyState
          icon={AlertCircle}
          title="Could not load today's numbers"
          hint="Reload the page to try again."
          className="min-h-32"
        />
      ) : loading || !stats ? (
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
              subtitle={`${fmt.number(stats.feesDueCount)} ${
                stats.feesDueCount === 1 ? 'payment is' : 'payments are'
              } not paid`}
            />
          </TileLink>
          <TileLink href="/members?view=renewals">
            <MetricCard
              title="Renewals due"
              value={<AnimatedNumber value={stats.expiring7} />}
              icon={CalendarClock}
              subtitle="Memberships ending in 7 days"
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
    </DashboardSection>
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
    } your usual day this week`,
  };
}
