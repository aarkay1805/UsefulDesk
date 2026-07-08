"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, CheckCircle2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { bucketForDue, daysOverdue, DUE_BUCKETS, type DueBucket } from "@/lib/memberships/dues";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { CopyUpiLinkButton, useUpiConfig, type UpiConfig } from "./copy-upi-link-button";

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
  const { defaultCurrency } = useAuth();
  const upi = useUpiConfig();
  const [rows, setRows] = useState<DueMember[]>([]);
  const [loading, setLoading] = useState(true);
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
      // Real Membership rows (with contact/plan) for reuse in the reminder
      // button and payment dialog, plus balances from the dues view.
      const [membershipsRes, duesRes] = await Promise.all([
        supabase
          .from("memberships")
          .select(SELECT)
          .eq("fee_status", "due")
          .neq("status", "cancelled")
          .order("start_date", { ascending: true }),
        supabase.from("membership_dues").select("membership_id, balance").gt("balance", 0),
      ]);
      if (cancelled) return;

      const balanceById = new Map<string, number>(
        (duesRes.data ?? []).map((d) => [d.membership_id as string, Number(d.balance) || 0]),
      );
      const merged: DueMember[] = ((membershipsRes.data as Membership[]) ?? [])
        .map((m) => ({ ...m, balance: balanceById.get(m.id) ?? (Number(m.fee_amount) || 0) }))
        .filter((m) => m.balance > 0);

      setRows(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading dues…
      </div>
    );
  }

  const grouped: Record<DueBucket, DueMember[]> = {
    due_soon: [],
    overdue_1_7: [],
    overdue_8_30: [],
    overdue_30_plus: [],
  };
  for (const m of rows) grouped[bucketForDue(m.start_date)].push(m);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {DUE_BUCKETS.map(({ key, label }) => (
          <BucketCard
            key={key}
            title={label}
            rows={grouped[key]}
            currency={defaultCurrency}
            readiness={readiness}
            upi={upi}
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
  currency,
  readiness,
  upi,
  onSelect,
  onRecord,
  onSent,
}: {
  title: string;
  rows: DueMember[];
  currency: string;
  readiness: ReminderReadiness;
  upi: UpiConfig | null;
  onSelect: (id: string) => void;
  onRecord: (m: Membership) => void;
  onSent: () => void;
}) {
  const total = rows.reduce((s, m) => s + m.balance, 0);
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Wallet className="size-4 text-amber-700 dark:text-amber-400" />
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-500/70" />
          <p className="text-xs text-muted-foreground">Nothing here.</p>
        </div>
      ) : (
        <>
          <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            {formatCurrency(total, currency)} outstanding
          </div>
          <ul className="divide-y divide-border">
            {rows.map((m) => {
              const overdue = daysOverdue(m.start_date);
              return (
                <li
                  key={m.id}
                  className="cursor-pointer px-3 py-2.5 transition-colors hover:bg-muted/50"
                  onClick={() => onSelect(m.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {m.contact?.name || m.contact?.phone || "Unnamed"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.plan?.name ?? "—"}
                        {overdue > 0 ? ` · ${overdue}d overdue` : " · due now"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-amber-700 dark:text-amber-400">
                      {formatCurrency(m.balance, currency)}
                    </span>
                  </div>
                  <div
                    className="mt-2 flex justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CopyUpiLinkButton
                      upi={upi}
                      amount={m.balance}
                      note={`${m.plan?.name ?? "Membership"} fee`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRecord(m)}
                    >
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
