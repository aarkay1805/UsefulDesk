"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, CheckCircle2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { bucketForDue, daysOverdue, DUE_BUCKETS, type DueBucket } from "@/lib/memberships/dues";
import { isChargeableAmount } from "@/lib/memberships/periods";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { MemberIdentity } from "./member-identity";

interface PaymentDueBucketsProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
  /** Tell the parent to refresh its own tiles/views after a payment. */
  onChanged: () => void;
}

/** A member with an unpaid balance on their current period. */
type DueMember = Membership & { balance: number };

const SELECT = "*, contact:contacts(*), plan:membership_plans(*)";

export function PaymentDueBuckets({
  readiness,
  onSelect,
  reloadKey,
  onChanged,
}: PaymentDueBucketsProps) {
  const { fmt } = useLocale();
  const [rows, setRows] = useState<DueMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [payFor, setPayFor] = useState<Membership | null>(null);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      setLoadError(null);
      // Real Membership rows (with contact/plan) for reuse in the reminder
      // button and payment dialog, plus balances from the dues view.
      const [membershipsRes, duesRes] = await Promise.all([
        supabase
          .from("memberships")
          .select(SELECT)
          .neq("status", "cancelled")
          .order("start_date", { ascending: true }),
        supabase.from("membership_dues").select("membership_id, balance").gt("balance", 0),
      ]);
      if (cancelled) return;
      const error = membershipsRes.error ?? duesRes.error;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }

      const balanceById = new Map<string, number>(
        (duesRes.data ?? []).map((d) => [d.membership_id as string, Number(d.balance) || 0]),
      );
      // A sub-display-unit residue (a ₹0.32 pro-rated stub) is not a debt
      // — it renders as ₹0 and can't be collected, so it must not put a
      // member on the chase list.
      const merged: DueMember[] = ((membershipsRes.data as Membership[]) ?? [])
        .map((m) => ({ ...m, balance: balanceById.get(m.id) ?? 0 }))
        .filter((m) => isChargeableAmount(m.balance));

      setRows(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading dues…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-3 text-sm"
        role="alert"
      >
        Could not load payment dues: {loadError}
      </div>
    );
  }

  const grouped: Record<DueBucket, DueMember[]> = {
    due_soon: [],
    overdue_1_7: [],
    overdue_8_30: [],
    overdue_30_plus: [],
  };
  const today = fmt.today();
  for (const m of rows) grouped[bucketForDue(m.start_date, today)].push(m);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {DUE_BUCKETS.map(({ key, label }) => (
          <BucketCard
            key={key}
            title={label}
            rows={grouped[key]}
            readiness={readiness}
            onSelect={onSelect}
            onRecord={setPayFor}
            onSent={reload}
          />
        ))}
      </div>

      {payFor && (
        <RecordPaymentDialog
          open={!!payFor}
          onOpenChange={(o) => !o && setPayFor(null)}
          membership={payFor}
          onSaved={reload}
        />
      )}
    </>
  );
}

function BucketCard({
  title,
  rows,
  readiness,
  onSelect,
  onRecord,
  onSent,
}: {
  title: string;
  rows: DueMember[];
  readiness: ReminderReadiness;
  onSelect: (id: string) => void;
  onRecord: (m: Membership) => void;
  onSent: () => void;
}) {
  const { fmt } = useLocale();
  const today = fmt.today();
  const total = rows.reduce((s, m) => s + m.balance, 0);
  return (
    <section className="border-border bg-card flex flex-col rounded-xl border">
      <header className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        <Wallet className="size-4 text-amber-700 dark:text-amber-400" />
        <h3 className="text-foreground text-sm font-medium">{title}</h3>
        <span className="bg-muted text-muted-foreground ml-auto rounded-full px-2 py-0.5 text-xs font-medium">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-500/70" />
          <p className="text-muted-foreground text-xs">Nothing here.</p>
        </div>
      ) : (
        <>
          <div className="border-border text-muted-foreground border-b px-3 py-1.5 text-xs">
            <span className="tabular-nums">{fmt.money(total)}</span> outstanding
          </div>
          <ul className="divide-border divide-y">
            {rows.map((m) => {
              const overdue = daysOverdue(m.start_date, today);
              return (
                <li
                  key={m.id}
                  className="hover:bg-muted/50 cursor-pointer px-3 py-2.5 transition-colors"
                  onClick={() => onSelect(m.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <MemberIdentity
                      name={m.contact?.name}
                      secondary={m.contact?.phone}
                      src={m.contact?.avatar_url}
                      meta={
                        <p className="text-muted-foreground truncate text-xs">
                          {m.plan?.name ?? "—"}
                          {overdue > 0 ? ` · ${overdue}d overdue` : " · due now"}
                        </p>
                      }
                    />
                    <span className="shrink-0 text-sm font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                      {fmt.money(m.balance)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button type="button" variant="outline" size="sm" onClick={() => onRecord(m)}>
                      <Wallet className="size-3.5" /> Record
                    </Button>
                    <SendReminderButton membership={m} readiness={readiness} onSent={onSent} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
