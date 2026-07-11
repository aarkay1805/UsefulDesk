"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Check } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import type { LocaleFormatters } from "@/lib/locale/format";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { RENEWAL_TEMPLATE_NAME } from "@/lib/memberships/renewal-reminders";

// RENEWAL_TEMPLATE_NAME now lives in the server-safe lib so the cron can
// share it; re-exported here to keep existing import sites working.
export { RENEWAL_TEMPLATE_NAME };

export interface ReminderReadiness {
  loading: boolean;
  /** True when WhatsApp is connected AND the renewal template is approved. */
  ready: boolean;
  /** Human-readable blocker when not ready. */
  reason: string | null;
  /** The approved template's language, passed through on send. */
  templateLanguage: string;
}

/**
 * One-shot check that the one-tap reminder can actually send: WhatsApp
 * must be connected and the `gym_renewal_reminder` template approved by
 * Meta. Fetched once and shared across every action-list row so we don't
 * re-query per member.
 */
export function useReminderReadiness(): ReminderReadiness {
  const { accountId } = useAuth();
  const [state, setState] = useState<ReminderReadiness>({
    loading: true,
    ready: false,
    reason: null,
    templateLanguage: "en_US",
  });

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const [{ data: config }, { data: template }] = await Promise.all([
        supabase.from("whatsapp_config").select("status").maybeSingle(),
        supabase
          .from("message_templates")
          .select("language, status")
          .eq("name", RENEWAL_TEMPLATE_NAME)
          .eq("status", "APPROVED")
          .maybeSingle(),
      ]);
      if (cancelled) return;

      if (!config || config.status !== "connected") {
        setState({
          loading: false,
          ready: false,
          reason: "Connect WhatsApp in Settings to send reminders.",
          templateLanguage: "en_US",
        });
        return;
      }
      if (!template) {
        setState({
          loading: false,
          ready: false,
          reason: `Create and approve the "${RENEWAL_TEMPLATE_NAME}" template in Settings → Templates.`,
          templateLanguage: "en_US",
        });
        return;
      }
      setState({
        loading: false,
        ready: true,
        reason: null,
        templateLanguage: template.language ?? "en_US",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

/**
 * Send the renewal template to one member via `/api/whatsapp/send`
 * (contact_id path → the route find-or-creates the conversation, so a
 * member who never messaged still gets reached). Throws on failure —
 * callers own the toast/tally (the single button toasts per send, the
 * bulk toolbar reports one tally).
 */
export async function sendRenewalReminder(
  membership: Membership,
  readiness: ReminderReadiness,
  fmt: LocaleFormatters
): Promise<void> {
  // {{3}} expiry + {{4}} fee rendered the way the gym writes them
  // (locale settings, migration 055) — mirrors the cron's params.
  const params = [
    membership.contact?.name?.trim() || "there",
    membership.plan?.name || "membership",
    fmt.date(membership.end_date),
    fmt.money(membership.fee_amount),
  ];
  const res = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contact_id: membership.contact_id,
      message_type: "template",
      template_name: RENEWAL_TEMPLATE_NAME,
      template_language: readiness.templateLanguage,
      template_message_params: { body: params },
      template_params: params,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Failed to send reminder");
  }
}

interface SendReminderButtonProps {
  membership: Membership;
  readiness: ReminderReadiness;
  /** Called after a reminder is successfully sent. */
  onSent?: () => void;
  size?: "sm" | "default";
}

/**
 * Sends the renewal template to a member via the existing
 * `/api/whatsapp/send` route (contact_id path → the route find-or-creates
 * the conversation, so a member who never messaged still gets reached).
 */
export function SendReminderButton({
  membership,
  readiness,
  onSent,
  size = "sm",
}: SendReminderButtonProps) {
  const { fmt } = useLocale();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const phone = membership.contact?.phone?.trim();
  const hasPhone = !!phone;

  // Reset the "Reminded ✓" flash when the row's membership changes.
  useEffect(() => {
    setSent(false);
  }, [membership.id, membership.end_date]);

  const blockedReason = !hasPhone
    ? "This member has no phone number."
    : readiness.reason;
  const disabled = sending || sent || !hasPhone || !readiness.ready;

  const send = useCallback(async () => {
    if (!readiness.ready || !hasPhone) {
      if (blockedReason) toast.error(blockedReason);
      return;
    }
    setSending(true);
    try {
      await sendRenewalReminder(membership, readiness, fmt);
      setSent(true);
      toast.success("Reminder sent on WhatsApp");
      onSent?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reminder");
    } finally {
      setSending(false);
    }
  }, [readiness, hasPhone, blockedReason, membership, fmt, onSent]);

  return (
    <Button
      type="button"
      variant={sent ? "outline" : "secondary"}
      size={size}
      onClick={send}
      disabled={disabled}
      title={blockedReason ?? "Send a WhatsApp renewal reminder"}
    >
      {sending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : sent ? (
        <Check className="size-3.5" />
      ) : (
        <MessageCircle className="size-3.5" />
      )}
      {sent ? "Reminded" : "Remind"}
    </Button>
  );
}
