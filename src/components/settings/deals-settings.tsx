'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IndianRupee, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
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
import { RazorpaySettingsCard } from './razorpay-settings-card';

/**
 * Payment collection settings — UPI and Razorpay.
 *
 * (Filename/section id still say "deals" for URL back-compat —
 * the deals feature itself was retired when Pipelines merged
 * into Leads.)
 */
export function DealsSettings() {
  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead
        title="Payments"
        description="Set up UPI and Razorpay to collect member payments."
      />
      <UpiCard />

      <div className="mt-6">
        <RazorpaySettingsCard />
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
          <IndianRupee className="text-primary-text size-4" />
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
            UPI collection is available for accounts using INR. Your account
            currency is {locale.currency} — change it under Regional settings to
            use UPI links.
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
