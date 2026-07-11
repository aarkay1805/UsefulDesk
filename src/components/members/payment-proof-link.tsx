"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createPrivateMediaUrl } from "@/lib/storage/upload-media";
import type { Payment } from "@/types";

/**
 * Opens legacy public proofs or signs a fresh, short-lived URL for new
 * private receipts. Rendering the signed URL only after interaction data
 * has loaded keeps sensitive proof links out of persisted application data.
 */
export function PaymentProofLink({ payment }: { payment: Payment }) {
  const [url, setUrl] = useState(payment.screenshot_url ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUrl(payment.screenshot_url ?? null);
  }, [payment.id, payment.screenshot_url]);

  if (!payment.screenshot_url && !payment.screenshot_path) return null;

  async function openProof() {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!payment.screenshot_path || !payment.receipt_bucket) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const signed = await createPrivateMediaUrl(payment.receipt_bucket, payment.screenshot_path);
      setUrl(signed);
      if (popup) popup.location.href = signed;
      else toast.info("Receipt link ready. Select the proof icon again to open it.");
    } catch (error) {
      popup?.close();
      toast.error(error instanceof Error ? error.message : "Could not open payment proof");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={openProof}
      disabled={loading}
      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      aria-label="View payment proof"
      title="View payment proof"
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <ExternalLink className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
