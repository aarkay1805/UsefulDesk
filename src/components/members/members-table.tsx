"use client";

import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { effectiveStatus, daysUntil } from "@/lib/memberships/expiry";
import type { Membership } from "@/types";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, Dumbbell } from "lucide-react";
import {
  MembershipStatusBadge,
  FeeStatusBadge,
} from "./membership-status-badge";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";

interface MembersTableProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  /** Bump to force a refetch after a mutation elsewhere. */
  reloadKey: number;
}

export function MembersTable({ readiness, onSelect, reloadKey }: MembersTableProps) {
  const [rows, setRows] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("memberships")
        .select("*, contact:contacts(*), plan:membership_plans(*)")
        .order("end_date", { ascending: true });
      if (cancelled) return;
      setRows((data as Membership[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => {
      const name = m.contact?.name?.toLowerCase() ?? "";
      const phone = m.contact?.phone ?? "";
      return name.includes(q) || phone.includes(q);
    });
  }, [rows, search]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members…"
          className="bg-muted pl-8"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading members…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Dumbbell className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "No members yet. Add your first member." : "No members match your search."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right">Reminder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const eff = effectiveStatus(m);
                const days = daysUntil(m.end_date);
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(m.id)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {m.contact?.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.contact?.phone}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.plan?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.end_date}</TableCell>
                    <TableCell>
                      <MembershipStatusBadge status={eff} daysToExpiry={days} />
                    </TableCell>
                    <TableCell>
                      <FeeStatusBadge status={m.fee_status} />
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SendReminderButton membership={m} readiness={readiness} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
