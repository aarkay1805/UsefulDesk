"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserX, CalendarClock, CircleAlert, Wallet, IndianRupee } from "lucide-react";

import { motion } from "motion/react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { loadGymStats, type GymStats } from "@/lib/memberships/stats";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { SkeletonCard } from "@/components/dashboard/skeleton";

// Tiles rise + fade in sequence when the stats land; each number then counts
// up (AnimatedNumber). Container drives the stagger, item drives the reveal.
const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const tileVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 400, damping: 32 },
  },
} as const;

/**
 * Gym owner's "in control in 30 seconds" strip — the action-list KPIs
 * that decide the day: money to collect, who's expiring, who's expired,
 * active headcount, and what's been collected this month. Each tile is a
 * shortcut into the Members section where the owner acts on it.
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
        console.error("[dashboard] gym stats failed:", err);
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
        <h2 className="text-sm font-semibold text-foreground">Gym today</h2>
        <Link href="/members" className="text-xs font-medium text-primary-text hover:underline">
          View members →
        </Link>
      </div>

      {loading || !stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <motion.div
          variants={gridVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <motion.div variants={tileVariants} className="h-full">
            <TileLink href="/members">
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
                subtitle={`${stats.feesDueCount} pending`}
              />
            </TileLink>
          </motion.div>
          <motion.div variants={tileVariants} className="h-full">
            <TileLink href="/members">
              <MetricCard
                title="Renewals due (7d)"
                value={<AnimatedNumber value={stats.expiring7} />}
                icon={CalendarClock}
                subtitle="Expiring this week"
              />
            </TileLink>
          </motion.div>
          <motion.div variants={tileVariants} className="h-full">
            <TileLink href="/members">
              <MetricCard
                title="Expired"
                value={<AnimatedNumber value={stats.expired} />}
                icon={CircleAlert}
                subtitle="Win them back"
              />
            </TileLink>
          </motion.div>
          <motion.div variants={tileVariants} className="h-full">
            <TileLink href="/members">
              <MetricCard
                title="Inactive (10d+)"
                value={<AnimatedNumber value={stats.inactive} />}
                icon={UserX}
                subtitle="No visit in 10 days"
              />
            </TileLink>
          </motion.div>
          <motion.div variants={tileVariants} className="h-full">
            <TileLink href="/members">
              <MetricCard
                title="Active members"
                value={<AnimatedNumber value={stats.activeMembers} />}
                icon={Users}
                subtitle="Currently valid"
              />
            </TileLink>
          </motion.div>
          <motion.div variants={tileVariants} className="h-full">
            <MetricCard
              title="Collected this month"
              value={
                <AnimatedNumber
                  value={stats.collectedThisMonth}
                  format={(n) => fmt.money(n)}
                  className="tabular-nums"
                />
              }
              icon={IndianRupee}
              subtitle="Payments recorded"
            />
          </motion.div>
        </motion.div>
      )}
    </section>
  );
}

function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block h-full rounded-xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-primary [&>div]:h-full [&>div]:transition-colors [&>div]:hover:border-primary/50"
    >
      {children}
    </Link>
  );
}
