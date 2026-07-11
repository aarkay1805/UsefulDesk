"use client";

import { useEffect, useState } from "react";
import { Wallet, CalendarDays, IndianRupee, AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { dayStartInTz, todayInTz } from "@/lib/locale/format";
import { istAddDays } from "@/lib/memberships/expiry";

interface PaymentSummaryTilesProps {
  /** Bump to refetch after a payment is recorded elsewhere. */
  reloadKey: number;
}

interface Totals {
  today: number;
  week: number;
  month: number;
  outstanding: number;
}

const ZERO: Totals = { today: 0, week: 0, month: 0, outstanding: 0 };

/**
 * Owner-altitude money tiles: what's been collected (today / last 7 days /
 * this month) and what's still owed. Collection windows are keyed off the
 * IST calendar day each payment landed on; outstanding is the sum of live
 * balances from the `membership_dues` view.
 */
export function PaymentSummaryTiles({ reloadKey }: PaymentSummaryTilesProps) {
  const { locale, fmt } = useLocale();
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      setLoadError(null);
      const today = fmt.today();
      const monthStart = `${today.slice(0, 7)}-01`;
      const weekStart = istAddDays(today, -6);
      // Fetch from the earlier of the two window starts, as an instant at
      // that day's local midnight in the account's zone.
      const from = weekStart < monthStart ? weekStart : monthStart;
      const fromInstant = (dayStartInTz(from, locale.timeZone) ?? new Date()).toISOString();

      const [paymentsResult, duesResult] = await Promise.all([
        supabase
          .from("payments")
          .select("amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", fromInstant),
        supabase.from("membership_dues").select("balance").gt("balance", 0),
      ]);
      if (cancelled) return;
      const error = paymentsResult.error ?? duesResult.error;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      const pays = paymentsResult.data;
      const dues = duesResult.data;

      const t = { ...ZERO };
      for (const p of pays ?? []) {
        const day = todayInTz(locale.timeZone, new Date(p.paid_at as string));
        const amt = Number(p.amount) || 0;
        if (day === today) t.today += amt;
        if (day >= weekStart) t.week += amt;
        if (day >= monthStart) t.month += amt;
      }
      t.outstanding = (dues ?? []).reduce((s, d) => s + (Number(d.balance) || 0), 0);

      setTotals(t);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, fmt, locale.timeZone]);

  const tiles = [
    {
      label: "Collected today",
      value: totals.today,
      icon: <IndianRupee className="size-4 text-emerald-700 dark:text-emerald-400" />,
    },
    {
      label: "Last 7 days",
      value: totals.week,
      icon: <CalendarDays className="size-4 text-emerald-700 dark:text-emerald-400" />,
    },
    {
      label: "This month",
      value: totals.month,
      icon: <Wallet className="size-4 text-emerald-700 dark:text-emerald-400" />,
    },
    {
      label: "Outstanding",
      value: totals.outstanding,
      icon: <AlertTriangle className="size-4 text-amber-700 dark:text-amber-400" />,
      accent: true,
    },
  ];

  if (loadError) {
    return (
      <div
        className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-3 text-sm"
        role="alert"
      >
        Could not load payment totals: {loadError}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="border-border bg-card rounded-xl border p-4">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {t.icon}
            {t.label}
          </div>
          <div
            className={`mt-2 text-xl font-semibold ${t.accent && t.value > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}
          >
            {loading ? "—" : fmt.money(t.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
