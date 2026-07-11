"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Receipt } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import type { Payment, PaymentMethod, Contact } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MemberIdentity } from "./member-identity";
import { PaymentProofLink } from "./payment-proof-link";
import { VoidedPaymentBadge } from "./membership-status-badge";
import { useAccountStaff } from "./use-account-staff";

interface PaymentsLedgerProps {
  /** Bump to refetch after a payment is recorded elsewhere. */
  reloadKey: number;
}

type LedgerRow = Payment & {
  contact?: Pick<Contact, "name" | "phone" | "avatar_url"> | null;
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank",
  other: "Other",
};

type MethodFilter = "all" | PaymentMethod;

/** Fetch cap — when the fetch fills it, older rows exist beyond the list
 *  and the ledger must SAY so (silent truncation reads as "that's all"
 *  to an owner reconciling a month). */
const LEDGER_LIMIT = 100;

const FILTERS: { value: MethodFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank" },
  { value: "other", label: "Other" },
];

/**
 * Flat, most-recent-first payments ledger with a method filter — the
 * surface an owner scans to reconcile what actually landed (cash drawer,
 * UPI app, bank statement) against what the app recorded.
 */
export function PaymentsLedger({ reloadKey }: PaymentsLedgerProps) {
  const { fmt } = useLocale();
  const { nameById: staffNameById } = useAccountStaff();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MethodFilter>("all");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      setLoadError(null);
      const { data, error } = await supabase
        .from("payments")
        .select("*, contact:contacts(name, phone, avatar_url)")
        .order("paid_at", { ascending: false })
        .limit(LEDGER_LIMIT);
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setRows((data as LedgerRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.method === filter)),
    [rows, filter],
  );

  // Per-method collected totals over the loaded rows, voids excluded —
  // the numbers an owner matches against the cash drawer / UPI app /
  // bank statement. Scoped to what's listed (see LEDGER_LIMIT notice).
  const totals = useMemo(() => {
    const byMethod = new Map<PaymentMethod, number>();
    let all = 0;
    for (const r of rows) {
      if (r.status !== "paid") continue;
      const amt = Number(r.amount) || 0;
      all += amt;
      byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + amt);
    }
    return { all, byMethod };
  }, [rows]);

  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Paid on", "Member", "Phone", "Method", "Amount", "Status", "Recorded by", "Note"];
    const lines = filtered.map((p) =>
      [
        fmt.date(p.paid_at),
        esc(p.contact?.name),
        esc(p.contact?.phone),
        METHOD_LABEL[p.method],
        Number(p.amount),
        p.status,
        esc(staffNameById.get(p.user_id) ?? ""),
        esc(p.note),
      ].join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${filter === "all" ? "all-methods" : filter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-border bg-muted/40 inline-flex flex-wrap gap-1 rounded-lg border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={exportCsv}
          disabled={loading || !!loadError || filtered.length === 0}
        >
          <Download className="size-3.5" /> Export CSV
        </Button>
      </div>

      {!loading && !loadError && rows.length > 0 && (
        <dl className="border-border bg-muted/20 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border px-3 py-2 text-xs">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Collected</dt>
            <dd className="text-foreground font-semibold tabular-nums">{fmt.money(totals.all)}</dd>
          </div>
          {FILTERS.filter((f) => f.value !== "all").map((f) => {
            const amt = totals.byMethod.get(f.value as PaymentMethod) ?? 0;
            if (amt <= 0) return null;
            return (
              <div key={f.value} className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="text-foreground font-medium tabular-nums">{fmt.money(amt)}</dd>
              </div>
            );
          })}
        </dl>
      )}

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading payments…
        </div>
      ) : loadError ? (
        <div
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-3 text-sm"
          role="alert"
        >
          Could not load payments: {loadError}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Receipt className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            {rows.length === 0 ? "No payments recorded yet." : "No payments for this method."}
          </p>
        </div>
      ) : (
        <>
        <ul className="divide-border border-border divide-y rounded-lg border">
          {filtered.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <MemberIdentity
                className="flex-1"
                name={p.contact?.name}
                secondary={p.contact?.phone}
                src={p.contact?.avatar_url}
                meta={
                  <p className="text-muted-foreground truncate text-xs">
                    {METHOD_LABEL[p.method]} · {fmt.date(p.paid_at)}
                    {staffNameById.has(p.user_id)
                      ? ` · by ${staffNameById.get(p.user_id)}`
                      : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                }
              />
              <span className="text-foreground shrink-0 font-semibold">
                <span className={p.status === "void" ? "line-through opacity-60" : undefined}>
                  {fmt.money(p.amount)}
                </span>
              </span>
              {p.status === "void" && (
                <VoidedPaymentBadge
                  payment={p}
                  voidedOn={p.voided_at ? fmt.date(p.voided_at) : null}
                />
              )}
              <PaymentProofLink payment={p} />
            </li>
          ))}
        </ul>
        {rows.length === LEDGER_LIMIT && (
          <p className="text-muted-foreground text-xs">
            Showing the latest {LEDGER_LIMIT} payments — older entries are not listed here.
          </p>
        )}
        </>
      )}
    </div>
  );
}
