"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_DAYS_BEFORE,
  normalizeDaysBefore,
} from "@/lib/memberships/renewal-reminders";
import { useReminderReadiness } from "@/components/members/send-reminder-button";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/** The offsets an owner can toggle. Kept to sensible round choices —
 *  the cron accepts any, but a picker beats a free-text int array. */
const OFFSET_CHOICES: { value: number; label: string }[] = [
  { value: 14, label: "14 days before" },
  { value: 7, label: "7 days before" },
  { value: 3, label: "3 days before" },
  { value: 1, label: "1 day before" },
  { value: 0, label: "On expiry day" },
];

/**
 * Auto renewal reminders — the opt-in + schedule for the cron that fires
 * the `gym_renewal_reminder` template on its own (Phase 2). Settings-class:
 * `renewal_reminder_settings` RLS restricts writes to admins+, so a
 * non-admin sees the current config read-only.
 *
 * Loads with the IIFE + cancelled-guard pattern (not a setState-wrapping
 * call in useEffect) to satisfy react-hooks/set-state-in-effect; manual
 * refetch is a nonce bump.
 */
export function RenewalRemindersSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const readiness = useReminderReadiness();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [enabled, setEnabled] = useState(false);
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_DAYS_BEFORE);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("renewal_reminder_settings")
        .select("enabled, days_before")
        .eq("account_id", accountId)
        .maybeSingle();
      if (cancelled) return;

      if (data) {
        setEnabled(Boolean(data.enabled));
        const clean = normalizeDaysBefore(data.days_before);
        setOffsets(clean.length ? clean : DEFAULT_DAYS_BEFORE);
      } else {
        setEnabled(false);
        setOffsets(DEFAULT_DAYS_BEFORE);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, supabase, reloadNonce]);

  function toggleOffset(value: number) {
    setOffsets((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value],
    );
  }

  async function handleSave() {
    if (!accountId) return;
    const clean = normalizeDaysBefore(offsets);
    if (enabled && clean.length === 0) {
      toast.error("Pick at least one reminder day, or turn reminders off.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("renewal_reminder_settings")
        .upsert(
          { account_id: accountId, enabled, days_before: clean },
          { onConflict: "account_id" },
        );
      if (error) throw error;
      toast.success("Reminder settings saved");
      setReloadNonce((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="Auto renewal reminders"
          description="Send the WhatsApp renewal reminder automatically as memberships approach expiry."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const disabled = !canEditSettings;

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Auto renewal reminders"
        description="Send the WhatsApp renewal reminder automatically as memberships approach expiry — the same message as the manual Remind button, on a schedule."
      />

      {/* Readiness — reuse the manual button's gate so an owner isn't
          surprised that "enabled" sends nothing when WhatsApp / the
          template aren't set up. */}
      {!readiness.loading && !readiness.ready && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{readiness.reason} Reminders won&apos;t send until this is done.</span>
        </div>
      )}
      {!readiness.loading && readiness.ready && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-700/40 bg-emerald-950/25 px-3 py-2.5 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>WhatsApp is connected and the renewal template is approved.</span>
        </div>
      )}

      <Card>
        <CardContent className="space-y-6 p-5">
          {/* Master toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="font-medium text-foreground">
                  Automatic reminders
                </p>
                <p className="text-sm text-muted-foreground">
                  When on, expiring members are messaged on WhatsApp without you
                  clicking Remind. Each member gets at most one message per
                  selected day.
                </p>
              </div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(v: boolean) => setEnabled(v)}
              disabled={disabled}
            />
          </div>

          {/* Offset picker */}
          <div
            className={cn(
              "space-y-3 transition-opacity",
              !enabled && "pointer-events-none opacity-50",
            )}
          >
            <p className="text-sm font-medium text-foreground">Remind on</p>
            <div className="flex flex-wrap gap-2">
              {OFFSET_CHOICES.map((choice) => {
                const on = offsets.includes(choice.value);
                return (
                  <button
                    key={choice.value}
                    type="button"
                    disabled={disabled || !enabled}
                    onClick={() => toggleOffset(choice.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      on
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                      (disabled || !enabled) && "cursor-not-allowed",
                    )}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              e.g. 7 + 3 + 1 days before nudges a member three times as their
              expiry nears. All times use IST.
            </p>
          </div>

          {canEditSettings && (
            <div className="flex justify-end border-t border-border pt-4">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save settings"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
