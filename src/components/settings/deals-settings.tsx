'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Coins, IndianRupee, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { CURRENCIES } from '@/lib/currency';
import { isValidVpa, upiAvailableFor } from '@/lib/payments/upi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Payments & currency settings — account-wide default currency + UPI.
 *
 * One currency per account (issue #218): the chosen code formats
 * membership fees, payment amounts, and every aggregated total.
 * Writes go straight to `accounts.default_currency`; the
 * `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 *
 * (Filename/section id still say "deals" for URL back-compat —
 * the deals feature itself was retired when Pipelines merged
 * into Leads.)
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
      .from('accounts')
      .update({ default_currency: selected })
      .eq('id', accountId);
    if (error) {
      toast.error('Failed to save default currency');
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the deal form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success('Default currency updated');
  }

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead
        title="Payments & currency"
        description="The currency used for membership fees, payments, and dashboard totals — plus your UPI collection details."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Coins className="text-primary size-4" />
            Default currency
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Membership fees, recorded payments, and dashboard totals are shown
            in this currency.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">Currency</Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">
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
                'Save'
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
  const { locale } = useLocale();

  const [vpa, setVpa] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [loaded, setLoaded] = useState<{
    vpa: string;
    payeeName: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('accounts')
        .select('upi_vpa, upi_payee_name')
        .eq('id', accountId)
        .maybeSingle();
      if (cancelled) return;
      const initial = {
        vpa: data?.upi_vpa ?? '',
        payeeName: data?.upi_payee_name ?? '',
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
    !!loaded &&
    (vpa.trim() !== loaded.vpa || payeeName.trim() !== loaded.payeeName);

  async function handleSave() {
    if (!accountId || !dirty) return;
    const nextVpa = vpa.trim();
    if (nextVpa && !isValidVpa(nextVpa)) {
      return toast.error('Enter a valid UPI ID, e.g. gym@okhdfcbank');
    }
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({
        upi_vpa: nextVpa || null,
        upi_payee_name: payeeName.trim() || null,
      })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save UPI details');
      return;
    }
    setLoaded({ vpa: nextVpa, payeeName: payeeName.trim() });
    toast.success('UPI details updated');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <IndianRupee className="text-primary size-4" />
          UPI collection
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Your UPI ID powers the &quot;UPI link&quot; buttons on payment-due
          lists — staff copy a ready-to-pay link for the exact amount and paste
          it into the member&apos;s WhatsApp chat. Money lands directly in this
          UPI account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!upiAvailableFor(locale.currency) ? (
          <p className="text-muted-foreground text-sm">
            UPI collection is available for accounts billing in INR. Your
            account currency is {locale.currency} — change it above to use UPI
            links.
          </p>
        ) : (
          <>
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
              <p className="text-muted-foreground text-xs">
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
                  'Save'
                )}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
