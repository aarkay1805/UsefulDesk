"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IndianRupee } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { buildUpiLink, upiAvailableFor } from "@/lib/payments/upi";
import { Button } from "@/components/ui/button";

export interface UpiConfig {
  vpa: string | null;
  payeeName: string | null;
}

/**
 * The account's UPI collection details (migration 038). `null` while
 * loading; `{ vpa: null, ... }` when UPI isn't configured — callers
 * hide their link buttons in both cases.
 */
export function useUpiConfig(): UpiConfig | null {
  const { accountId } = useAuth();
  const [config, setConfig] = useState<UpiConfig | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("upi_vpa, upi_payee_name")
        .eq("id", accountId)
        .maybeSingle();
      if (cancelled) return;
      setConfig({
        vpa: data?.upi_vpa ?? null,
        payeeName: data?.upi_payee_name ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return config;
}

/**
 * "Copy UPI link" — puts a `upi://pay` deep link for the exact amount
 * on the clipboard, ready to paste into the member's WhatsApp chat.
 * Renders nothing until the account has a VPA configured (Settings →
 * Deals & currency).
 */
export function CopyUpiLinkButton({
  upi,
  amount,
  note,
  size = "sm",
}: {
  upi: UpiConfig | null;
  amount: number;
  note?: string;
  size?: "sm" | "default";
}) {
  const { locale } = useLocale();
  // UPI is INR-only — non-INR accounts never see the button.
  if (!upiAvailableFor(locale.currency) || !upi?.vpa) return null;

  async function copy() {
    const link = buildUpiLink({
      vpa: upi!.vpa!,
      payeeName: upi!.payeeName,
      amount,
      note,
    });
    await navigator.clipboard.writeText(link);
    toast.success("UPI payment link copied — paste it into the chat");
  }

  return (
    <Button type="button" variant="outline" size={size} onClick={copy}>
      <IndianRupee className={size === "sm" ? "size-3.5" : "size-4"} /> UPI link
    </Button>
  );
}
