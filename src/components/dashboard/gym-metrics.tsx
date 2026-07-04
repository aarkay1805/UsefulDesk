"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserX, CalendarClock, CircleAlert, Wallet, IndianRupee } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { loadGymStats, type GymStats } from "@/lib/memberships/stats";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";

/**
 * Gym owner's "in control in 30 seconds" strip — the action-list KPIs
 * that decide the day: money to collect, who's expiring, who's expired,
 * active headcount, and what's been collected this month. Each tile is a
 * shortcut into the Members section where the owner acts on it.
 */
export function GymMetrics() {
  const { defaultCurrency } = useAuth();
  const [stats, setStats] = useState<GymStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = createClient();
    let cancelled = false;
    (async () => {
      try {
        const s = await loadGymStats(db);
        if (!cancelled) setStats(s);
      } catch (err) {
        console.error("[dashboard] gym stats failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Gym today</h2>
        <Link href="/members" className="text-xs font-medium text-primary hover:underline">
          View members →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading || !stats ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <TileLink href="/members">
              <MetricCard
                title="Fees to collect"
                value={formatCurrency(stats.feesDueAmount, defaultCurrency)}
                icon={Wallet}
                subtitle={`${stats.feesDueCount} pending`}
              />
            </TileLink>
            <TileLink href="/members">
              <MetricCard
                title="Renewals due (7d)"
                value={stats.expiring7.toLocaleString()}
                icon={CalendarClock}
                subtitle="Expiring this week"
              />
            </TileLink>
            <TileLink href="/members">
              <MetricCard
                title="Expired"
                value={stats.expired.toLocaleString()}
                icon={CircleAlert}
                subtitle="Win them back"
              />
            </TileLink>
            <TileLink href="/members">
              <MetricCard
                title="Inactive (10d+)"
                value={stats.inactive.toLocaleString()}
                icon={UserX}
                subtitle="No visit in 10 days"
              />
            </TileLink>
            <TileLink href="/members">
              <MetricCard
                title="Active members"
                value={stats.activeMembers.toLocaleString()}
                icon={Users}
                subtitle="Currently valid"
              />
            </TileLink>
            <MetricCard
              title="Collected this month"
              value={formatCurrency(stats.collectedThisMonth, defaultCurrency)}
              icon={IndianRupee}
              subtitle="Payments recorded"
            />
          </>
        )}
      </div>
    </section>
  );
}

function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-primary [&>div]:h-full [&>div]:transition-colors [&>div]:hover:border-primary/50"
    >
      {children}
    </Link>
  );
}
