"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, UserCheck, Dumbbell } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { dayStartInTz } from "@/lib/locale/format";
import { effectiveStatus, daysUntil } from "@/lib/memberships/expiry";
import type { Membership } from "@/types";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { MembershipStatusBadge } from "./membership-status-badge";
import { MemberIdentity } from "./member-identity";

interface CheckInViewProps {
  /** Bump to refetch after a mutation elsewhere. */
  reloadKey: number;
  /** Notify the parent that a check-in happened (so tiles/lists refresh). */
  onCheckedIn?: () => void;
}

export function CheckInView({ reloadKey, onCheckedIn }: CheckInViewProps) {
  const { user } = useAuth();
  const { locale, fmt } = useLocale();
  const [rows, setRows] = useState<Membership[]>([]);
  const [checkedToday, setCheckedToday] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      // "Today" starts at local midnight in the ACCOUNT's zone.
      const todayStart = (
        dayStartInTz(fmt.today(), locale.timeZone) ?? new Date()
      ).toISOString();
      const [membersRes, attRes] = await Promise.all([
        supabase
          .from("memberships")
          .select("*, contact:contacts(*), plan:membership_plans(*)")
          .order("end_date", { ascending: true }),
        supabase
          .from("attendance")
          .select("contact_id")
          .gte("checked_in_at", todayStart),
      ]);
      if (cancelled) return;
      setRows((membersRes.data as Membership[]) ?? []);
      const seen = new Set(
        ((attRes.data as { contact_id: string }[] | null) ?? []).map((r) => r.contact_id),
      );
      setCheckedToday(seen);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, fmt, locale.timeZone]);

  const today = fmt.today();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => {
      const name = m.contact?.name?.toLowerCase() ?? "";
      const phone = m.contact?.phone ?? "";
      return name.includes(q) || phone.includes(q);
    });
  }, [rows, search]);

  async function checkIn(m: Membership) {
    if (!user) return;
    setBusyId(m.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("attendance").insert({
        account_id: m.account_id,
        contact_id: m.contact_id,
        membership_id: m.id,
        user_id: user.id,
        method: "manual",
      });
      if (error) throw error;
      setCheckedToday((prev) => new Set(prev).add(m.contact_id));
      toast.success(`${m.contact?.name || "Member"} checked in`);
      onCheckedIn?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          containerClassName="max-w-xs flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a member to check in…"
        />
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm">
          <UserCheck className="size-4 text-emerald-700 dark:text-emerald-400" />
          <span className="font-medium text-foreground">{checkedToday.size}</span>
          <span className="text-muted-foreground">in today</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading members…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Dumbbell className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "No members yet." : "No members match your search."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((m) => {
            const done = checkedToday.has(m.contact_id);
            const eff = effectiveStatus(m, today);
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <MemberIdentity
                  className="flex-1"
                  name={m.contact?.name}
                  secondary={m.contact?.phone}
                  meta={
                    <p className="truncate text-xs text-muted-foreground">
                      {m.plan?.name ?? "—"}
                    </p>
                  }
                />
                <MembershipStatusBadge status={eff} daysToExpiry={daysUntil(m.end_date, today)} />
                <Button
                  type="button"
                  variant={done ? "outline" : "default"}
                  size="sm"
                  disabled={done || busyId === m.id}
                  onClick={() => checkIn(m)}
                  className={done ? "" : "bg-primary text-primary-foreground hover:bg-primary/90"}
                >
                  {busyId === m.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : done ? (
                    <Check className="size-3.5" />
                  ) : (
                    <UserCheck className="size-3.5" />
                  )}
                  {done ? "In" : "Check in"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
