"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { istToday } from "@/lib/memberships/expiry";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
}: RecordPaymentDialogProps) {
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState(istToday());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [shot, setShot] = useState<{ url: string; path: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(String(membership.fee_amount ?? ""));
    setMethod("cash");
    setPaidOn(istToday());
    setNote("");
    setShot(null);
  }, [open, membership]);

  async function handleUpload(file: File) {
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error("Screenshot must be 5 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadAccountMedia("chat-media", file);
      setShot({ url: res.publicUrl, path: res.path });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removeShot() {
    if (!shot) return;
    const path = shot.path;
    setShot(null);
    // Best-effort GC of the staged object.
    deleteAccountMedia("chat-media", path).catch(() => {});
  }

  async function handleSave() {
    if (!accountId || !user) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return toast.error("Enter a valid amount");

    setSaving(true);
    try {
      // Store paid_at as an instant. A picked calendar day is anchored at
      // noon UTC so it lands on the same IST day it was chosen for.
      const paidAt = `${paidOn}T12:00:00.000Z`;

      const { error: pErr } = await supabase.from("payments").insert({
        account_id: accountId,
        membership_id: membership.id,
        contact_id: membership.contact_id,
        plan_id: membership.plan_id,
        user_id: user.id,
        amount: amt,
        method,
        status: "paid",
        paid_at: paidAt,
        period_start: membership.start_date,
        period_end: membership.end_date,
        screenshot_url: shot?.url ?? null,
        screenshot_path: shot?.path ?? null,
        note: note.trim() || null,
      });
      if (pErr) throw pErr;

      const { error: mErr } = await supabase
        .from("memberships")
        .update({ fee_status: "paid" })
        .eq("id", membership.id);
      if (mErr) throw mErr;

      toast.success("Payment recorded");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Log a cash, UPI, or card payment for this member.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rp-amount" className="text-muted-foreground">Amount</Label>
              <Input
                id="rp-amount"
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-method" className="text-muted-foreground">Method</Label>
              <select
                id="rp-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-date" className="text-muted-foreground">Paid on</Label>
            <Input
              id="rp-date"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="bg-muted"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Screenshot (optional)</Label>
            {shot ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.url} alt="Payment proof" className="size-10 rounded object-cover" />
                <span className="flex-1 truncate text-muted-foreground">Screenshot attached</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={removeShot}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-2.5 py-3 text-xs text-muted-foreground hover:bg-muted">
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
            <Label htmlFor="rp-note" className="text-muted-foreground">Note</Label>
            <Input
              id="rp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              className="bg-muted"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
