"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/errors";
import { createPrivateMediaUrl } from "@/lib/storage/upload-media";
import type { Payment } from "@/types";
import { Button } from "@/components/ui/button";

/**
 * Opens legacy public proofs or signs a fresh, short-lived URL for new
 * private receipts. Rendering the signed URL only after interaction data
 * has loaded keeps sensitive proof links out of persisted application data.
 */
/** Signed URLs live 5 min (`createPrivateMediaUrl` default); reuse a
 *  cached one only while comfortably inside that window — a click after
 *  expiry must re-sign, not open a dead link. */
const SIGNED_URL_REUSE_MS = 4 * 60 * 1000;

export function PaymentProofLink({ payment }: { payment: Payment }) {
  // Freshly signed private link + when it was signed. Legacy public
  // proofs (screenshot_url) never expire and skip this cache entirely.
  const [signed, setSigned] = useState<{ url: string; at: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSigned(null);
  }, [payment.id]);

  if (!payment.screenshot_url && !payment.screenshot_path) return null;

  async function openProof() {
    if (payment.screenshot_url) {
      window.open(payment.screenshot_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (signed && Date.now() - signed.at < SIGNED_URL_REUSE_MS) {
      window.open(signed.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!payment.screenshot_path || !payment.receipt_bucket) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const url = await createPrivateMediaUrl(payment.receipt_bucket, payment.screenshot_path);
      setSigned({ url, at: Date.now() });
      if (popup) popup.location.href = url;
      else toast.info("Receipt link ready. Select the proof icon again to open it.");
    } catch (error) {
      popup?.close();
      toast.error(getErrorMessage(error, "Could not open payment proof"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={openProof}
      disabled={loading}
      aria-label="View payment proof"
      title="View payment proof"
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <ExternalLink className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  );
}
