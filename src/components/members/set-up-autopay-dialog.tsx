"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Repeat, Check } from "lucide-react";

import { getErrorMessage } from "@/lib/errors";
import { useLocale } from "@/hooks/use-locale";
import type { Membership } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SetUpAutoPayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: Membership;
  /** Called after a mandate link is created so the sheet can refresh. */
  onStarted: () => void;
}

/**
 * Start a UPI-AutoPay mandate for a member (migration 059). Posts to the
 * mandate route (which creates the Razorpay plan + subscription on the
 * gym's own account) and surfaces the returned `short_url` — the hosted
 * UPI-mandate page the member approves once. The mandate only goes live
 * (and the membership flips to auto collection) when Razorpay's webhook
 * fires `subscription.authenticated`, so this dialog just hands over the
 * link; it does not claim success.
 */
export function SetUpAutoPayDialog({
  open,
  onOpenChange,
  membership,
  onStarted,
}: SetUpAutoPayDialogProps) {
  const { fmt } = useLocale();
  const [busy, setBusy] = useState(false);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createMandate() {
    setBusy(true);
    try {
      const res = await fetch("/api/payments/razorpay/mandate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membership.id }),
      });
      const data = (await res.json()) as { short_url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start auto-pay");
      if (!data.short_url) throw new Error("No mandate link returned");
      setShortUrl(data.short_url);
      onStarted();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not start auto-pay"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!shortUrl) return;
    await navigator.clipboard.writeText(shortUrl);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Reset for the next open.
      setShortUrl(null);
      setCopied(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="size-4" /> Set up auto-pay
          </DialogTitle>
          <DialogDescription>
            Auto-debit {membership.contact?.name ?? "this member"}&apos;s{" "}
            <span className="tabular-nums">{fmt.money(membership.fee_amount)}</span>{" "}
            {membership.plan?.name ? `${membership.plan.name} ` : ""}fee each cycle
            over UPI AutoPay. The member approves the mandate once; renewals then
            collect automatically.
          </DialogDescription>
        </DialogHeader>

        {!shortUrl ? (
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>
              We&apos;ll create a UPI-mandate link on your Razorpay account. Share
              it with the member — they approve it once in their UPI app (GPay,
              PhonePe, etc.) with a single PIN.
            </p>
            <p>
              Until they approve, this member stays on manual collection. If a
              future auto-debit fails, they fall back to the usual WhatsApp
              reminder + manual payment.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Mandate link created. Send it to the member to approve.
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted flex-1 truncate rounded-md px-2.5 py-2 text-xs">
                {shortUrl}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={copyLink}
                aria-label="Copy link"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              The member&apos;s auto-pay turns on once they approve — you&apos;ll
              see it reflected here shortly after.
            </p>
          </div>
        )}

        <DialogFooter>
          {!shortUrl ? (
            <>
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button onClick={createMandate} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Create mandate link
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button
                render={
                  <a href={shortUrl} target="_blank" rel="noopener noreferrer" />
                }
              >
                <ExternalLink className="size-4" /> Open link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
