"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, IndianRupee, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import { isValidVpa } from "@/lib/payments/upi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Deals settings — account-wide default currency.
 *
 * One currency per account (issue #218): the chosen code seeds new
 * deals and formats every aggregated total. Existing deals keep their
 * own saved currency. Writes go straight to `accounts.default_currency`;
 * the `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 */
export function DealsSettings() {
  const supabase = createClient();
  const {
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({ default_currency: selected })
      .eq("id", accountId);
    if (error) {
      toast.error("Failed to save default currency");
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the deal form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success("Default currency updated");
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Deals & currency"
        description="The currency used for new deals and for pipeline and dashboard totals."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Coins className="size-4 text-primary" />
            Default currency
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            New deals default to this currency, and pipeline and
            dashboard totals are shown in it. Existing deals keep the
            currency they were saved with.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">Currency</Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">
                Only account admins can change the default currency.
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <UpiCard />
      </div>
    </section>
  );
}

/**
 * UPI collection details (migration 038) — the gym's VPA + payee name
 * behind every "Copy UPI link" button (payment-due lists, member
 * detail). Same accounts-row write path as the currency above, so the
 * accounts_update RLS (admins+) gates it identically.
 */
function UpiCard() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [vpa, setVpa] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [loaded, setLoaded] = useState<{ vpa: string; payeeName: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("upi_vpa, upi_payee_name")
        .eq("id", accountId)
        .maybeSingle();
      if (cancelled) return;
      const initial = {
        vpa: data?.upi_vpa ?? "",
        payeeName: data?.upi_payee_name ?? "",
      };
      setLoaded(initial);
      setVpa(initial.vpa);
      setPayeeName(initial.payeeName);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const dirty =
    !!loaded && (vpa.trim() !== loaded.vpa || payeeName.trim() !== loaded.payeeName);

  async function handleSave() {
    if (!accountId || !dirty) return;
    const nextVpa = vpa.trim();
    if (nextVpa && !isValidVpa(nextVpa)) {
      return toast.error("Enter a valid UPI ID, e.g. gym@okhdfcbank");
    }
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        upi_vpa: nextVpa || null,
        upi_payee_name: payeeName.trim() || null,
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error("Failed to save UPI details");
      return;
    }
    setLoaded({ vpa: nextVpa, payeeName: payeeName.trim() });
    toast.success("UPI details updated");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <IndianRupee className="size-4 text-primary" />
          UPI collection
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Your UPI ID powers the &quot;UPI link&quot; buttons on payment-due
          lists — staff copy a ready-to-pay link for the exact amount and
          paste it into the member&apos;s WhatsApp chat. Money lands directly
          in this UPI account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="upi-vpa" className="text-muted-foreground">
              UPI ID (VPA)
            </Label>
            <Input
              id="upi-vpa"
              value={vpa}
              onChange={(e) => setVpa(e.target.value)}
              placeholder="gym@okhdfcbank"
              disabled={!canEditSettings || !loaded}
              className="bg-muted"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="upi-payee" className="text-muted-foreground">
              Payee name
            </Label>
            <Input
              id="upi-payee"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="Iron Fitness"
              disabled={!canEditSettings || !loaded}
              className="bg-muted"
            />
          </div>
        </div>
        {!canEditSettings ? (
          <p className="text-xs text-muted-foreground">
            Only account admins can change UPI details.
          </p>
        ) : (
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
