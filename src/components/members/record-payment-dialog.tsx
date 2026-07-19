"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { getErrorMessage } from "@/lib/errors";
import { dateAtNoonInTz } from "@/lib/locale/format";
import { validatePaymentAmount } from "@/lib/payments/validation";
import { isChargeableAmount } from "@/lib/memberships/periods";
import {
  uploadPrivateAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import type { Membership, PaymentMethod } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  onSaved: () => void;
  /**
   * Record against a SPECIFIC billing period (invoice) instead of the
   * current one — used to settle an arrears row from the invoice list
   * (057). The payment is stamped with this period so it reconciles to
   * the right cycle; the membership's `fee_status` is only touched when
   * this IS the current cycle. Omit for the default current-period flow.
   */
  period?: {
    period_start: string;
    period_end: string;
    fee_amount: number;
    balance: number;
  };
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
  period,
}: RecordPaymentDialogProps) {
  const supabase = createClient();
  const { locale, fmt } = useLocale();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState(fmt.today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [shot, setShot] = useState<{ url: string; path: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // Outstanding balance for the current period, pulled from the
  // membership_dues view so a payment settles a balance (supports
  // partials) instead of a blind paid/due flip.
  const [dues, setDues] = useState<{
    balance: number;
    collected: number;
  } | null>(null);

  // Which cycle this payment settles: an explicit period (arrears) or the
  // membership's current one.
  const targetStart = period?.period_start ?? membership.start_date;
  const targetEnd = period?.period_end ?? membership.end_date;
  const targetFee = Number(period?.fee_amount ?? membership.fee_amount ?? 0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMethod("cash");
    setPaidOn(fmt.today());
    setNote("");
    setShot(null);
    setDues(null);
    setLoadError(null);
    setIdempotencyKey(crypto.randomUUID());
    // A specific period carries its own balance (from the invoice view) —
    // no dues lookup needed. The current period reads the dues view so
    // partials show against the live balance.
    if (period) {
      const balance = Number(period.balance);
      setDues({ balance, collected: targetFee - balance });
      setAmount(isChargeableAmount(balance) ? String(balance) : "");
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("membership_dues")
        .select("balance, collected_current")
        .eq("membership_id", membership.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setAmount("");
        return;
      }
      const fee = Number(membership.fee_amount ?? 0);
      const balance = data ? Number(data.balance) : fee;
      const collected = data ? Number(data.collected_current) : 0;
      setDues({ balance, collected });
      setAmount(isChargeableAmount(balance) ? String(balance) : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membership, supabase, fmt, period, targetFee]);

  async function handleUpload(file: File) {
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error("Screenshot must be 5 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadPrivateAccountMedia("payment-receipts", file);
      setShot({ url: res.signedUrl, path: res.path });
    } catch (err) {
      toast.error(getErrorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  async function removeShot() {
    if (!shot) return;
    const path = shot.path;
    setShot(null);
    // Best-effort GC of the staged object.
    deleteAccountMedia("payment-receipts", path).catch(() => {});
  }

  function closeDialog() {
    if (shot) {
      deleteAccountMedia("payment-receipts", shot.path).catch(() => {});
      setShot(null);
    }
    onOpenChange(false);
  }

  async function handleSave() {
    const amt = Number(amount);
    if (!dues || loadError) return toast.error("The balance is not available yet");
    // ISO date strings compare lexically == chronologically. Backdating
    // is legitimate (cash noted late); future-dating is a typo.
    if (paidOn > fmt.today()) return toast.error("The payment date cannot be in the future");
    const validation = validatePaymentAmount(amt, dues.balance);
    if (validation === "invalid" || validation === "not_positive") {
      return toast.error("Enter an amount greater than zero");
    }
    if (validation === "exceeds_balance") {
      return toast.error(`Amount cannot exceed ${fmt.money(dues.balance)}`);
    }

    setSaving(true);
    try {
      // Store paid_at as an instant: local noon in the ACCOUNT's zone,
      // so the row reads back on the same day it was picked anywhere on
      // earth (a fixed noon-UTC anchor breaks past ±12h, e.g. Auckland).
      const paidAt = (dateAtNoonInTz(paidOn, locale.timeZone) ?? new Date()).toISOString();

      const { data, error } = await supabase.rpc("record_membership_payment", {
        p_membership_id: membership.id,
        p_period_end: targetEnd,
        p_amount: amt,
        p_method: method,
        p_paid_at: paidAt,
        p_note: note.trim(),
        p_receipt_path: shot?.path ?? null,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;

      const result = (data as { balance: number }[] | null)?.[0];
      const settled = Number(result?.balance ?? dues.balance - amt) <= 0;

      toast.success(settled ? "Payment recorded" : "Partial payment recorded");
      // The receipt now belongs to the persisted payment; prevent close
      // cleanup from deleting it.
      setShot(null);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to record payment"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {period
              ? `For ${fmt.date(targetStart)} – ${fmt.date(targetEnd)}.`
              : "Log a cash, UPI, or card payment for this member."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {dues && isChargeableAmount(dues.balance) && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Balance due</span>
              <span className="font-medium text-amber-foreground tabular-nums">
                {fmt.money(dues.balance)}
                {dues.collected > 0 && (
                  <span className="text-muted-foreground ml-1 text-xs">
                    of {fmt.money(targetFee)}
                  </span>
                )}
              </span>
            </div>
          )}
          {loadError && (
            <p
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
              role="alert"
            >
              Could not load the current balance. Close this dialog and try again.
            </p>
          )}
          {dues && !isChargeableAmount(dues.balance) && !loadError && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-foreground">
              This billing period is already settled.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rp-amount" className="text-muted-foreground">
                Amount
              </Label>
              <Input
                id="rp-amount"
                type="number"
                min={0.01}
                max={dues?.balance || undefined}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {dues && isChargeableAmount(dues.balance) && (
                <div className="flex gap-1.5">
                  {/* Installments are constant — one tap for the two
                      common splits instead of mental arithmetic. */}
                  <button
                    type="button"
                    onClick={() => setAmount(String(dues.balance))}
                    className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors"
                  >
                    Full {fmt.moneyShort(dues.balance)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmount(String(Math.round((dues.balance / 2) * 100) / 100))}
                    className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors"
                  >
                    Half {fmt.moneyShort(Math.round((dues.balance / 2) * 100) / 100)}
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-method" className="text-muted-foreground">
                Method
              </Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
              >
                <SelectTrigger id="rp-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {dues &&
            isChargeableAmount(dues.balance) &&
            validatePaymentAmount(Number(amount), dues.balance) === "valid" && (
              <p className="text-muted-foreground text-xs">
                {Number(amount) >= dues.balance ? (
                  <>This payment settles the period.</>
                ) : (
                  <>
                    Remaining after this payment:{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {fmt.money(dues.balance - Number(amount))}
                    </span>
                  </>
                )}
              </p>
            )}

          <div className="space-y-1.5">
            <Label htmlFor="rp-date" className="text-muted-foreground">
              Paid on
            </Label>
            <DatePicker
              id="rp-date"
              value={paidOn}
              max={fmt.today()}
              onChange={setPaidOn}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Screenshot (optional)</Label>
            {shot ? (
              <div className="border-border bg-muted/40 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.url} alt="Payment proof" className="size-10 rounded object-cover" />
                <span className="text-muted-foreground flex-1 truncate">Screenshot attached</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={removeShot}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <label className="border-border bg-muted/40 text-muted-foreground hover:bg-muted flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-2.5 py-3 text-xs">
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="size-4" /> Upload UPI/receipt screenshot
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-note" className="text-muted-foreground">
              Note
            </Label>
            <Input
              id="rp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              saving || uploading || !dues || !!loadError || !isChargeableAmount(dues.balance)
            }
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
