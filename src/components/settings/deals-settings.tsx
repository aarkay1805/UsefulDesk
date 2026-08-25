'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { isValidVpa, upiAvailableFor } from '@/lib/payments/upi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { RazorpaySettingsCard } from './razorpay-settings-card';
import { ExpenseCategoriesCard } from './expense-categories-card';
import { InvoiceDetailsCard } from './invoice-details-card';

/**
 * Payment collection settings — UPI and Razorpay.
 *
 * (Filename/section id still say "deals" for URL back-compat —
 * the deals feature itself was retired when Pipelines merged
 * into Leads.)
 */
export function DealsSettings() {
  return (
    <section className="max-w-2xl">
      <SettingsPanelHead
        title="Payments"
        description="Set up UPI links and Razorpay collection."
      />
      <div className="space-y-4">
        <UpiCard />
        <RazorpaySettingsCard />
        <ExpenseCategoriesCard />
        <InvoiceDetailsCard />
      </div>
    </section>
  );
}

/**
 * UPI collection details (migration 038) — the gym's VPA + payee name
 * behind every "Copy UPI link" button (payment-due lists, member
 * detail). The accounts_update RLS policy (admins+) gates the write.
 */
function UpiCard() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const { locale } = useLocale();

  const [vpa, setVpa] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [loaded, setLoaded] = useState<{
    vpa: string;
    payeeName: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [vpaTouched, setVpaTouched] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);

  useEffect(() => {
    if (profileLoading) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);
      try {
        if (!accountId) throw new Error('No account is selected.');
        const { data, error } = await supabase
          .from('accounts')
          .select('upi_vpa, upi_payee_name')
          .eq('id', accountId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const initial = {
          vpa: data?.upi_vpa ?? '',
          payeeName: data?.upi_payee_name ?? '',
        };
        setLoaded(initial);
        setVpa(initial.vpa);
        setPayeeName(initial.payeeName);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(error, "UPI details couldn't load. Try again.")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, profileLoading, reloadNonce, supabase]);

  const dirty =
    !!loaded &&
    (vpa.trim() !== loaded.vpa || payeeName.trim() !== loaded.payeeName);
  const vpaInvalid = vpa.trim() !== '' && !isValidVpa(vpa);
  const showVpaError = vpaInvalid && (vpaTouched || saveAttempted);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || !dirty || !canEditSettings) return;
    setSaveAttempted(true);
    const nextVpa = vpa.trim();
    if (vpaInvalid) return;
    setSaving(true);
    try {
      const nextPayeeName = payeeName.trim();
      const { data, error } = await supabase
        .from('accounts')
        .update({
          upi_vpa: nextVpa || null,
          upi_payee_name: nextPayeeName || null,
        })
        .eq('id', accountId)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('UPI details were not updated.');
      setLoaded({ vpa: nextVpa, payeeName: nextPayeeName });
      setVpa(nextVpa);
      setPayeeName(nextPayeeName);
      setVpaTouched(false);
      setSaveAttempted(false);
      toast.success('UPI details updated');
    } catch (error) {
      toast.error(
        getErrorMessage(error, "UPI details couldn't be saved. Try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>UPI payment links</CardTitle>
        <CardDescription>
          Save the UPI account used for exact-amount member payment links. Money
          goes directly to this account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!upiAvailableFor(locale.currency) ? (
          <p className="text-muted-foreground text-sm">
            UPI collection is available for accounts using INR. Your account
            currency is {locale.currency} — change it under Regional settings to
            use UPI links.
          </p>
        ) : loading ? (
          <div
            className="text-muted-foreground flex items-center gap-2 py-4 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading UPI details…
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>UPI details couldn&apos;t load</AlertTitle>
            <AlertDescription>
              <p>{loadError}</p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3"
                onClick={() => setReloadNonce((nonce) => nonce + 1)}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={handleSave} noValidate>
            {!canEditSettings ? (
              <Alert>
                <AlertTitle>Read-only</AlertTitle>
                <AlertDescription>
                  Only account admins can change UPI details.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="upi-vpa">UPI ID</Label>
                <Input
                  id="upi-vpa"
                  value={vpa}
                  onChange={(e) => setVpa(e.target.value)}
                  onBlur={() => setVpaTouched(true)}
                  placeholder="gym@okhdfcbank"
                  disabled={!canEditSettings}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={showVpaError}
                  aria-describedby={showVpaError ? 'upi-vpa-error' : undefined}
                />
                {showVpaError ? (
                  <p
                    id="upi-vpa-error"
                    role="alert"
                    className="text-destructive text-xs"
                  >
                    Enter a valid UPI ID, such as gym@okhdfcbank.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="upi-payee">Payee name</Label>
                <Input
                  id="upi-payee"
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                  placeholder="Iron Fitness"
                  disabled={!canEditSettings}
                />
              </div>
            </div>
            {canEditSettings ? (
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Saving…
                  </>
                ) : (
                  'Save UPI details'
                )}
              </Button>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
