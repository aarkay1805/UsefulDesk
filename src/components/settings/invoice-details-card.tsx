'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canManageInvoiceProfile } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  normalizeInvoiceProfile,
  validateInvoiceProfile,
  type InvoiceProfileInput,
} from '@/lib/finance/invoice-profile';
import { COUNTRY_PRESETS } from '@/lib/locale/config';
import { createClient } from '@/lib/supabase/client';

const EMPTY_PROFILE: InvoiceProfileInput = {
  business_name: '',
  legal_name: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  phone: '',
  email: '',
};

const PROFILE_FIELDS = [
  ['business_name', 'Business name'],
  ['legal_name', 'Legal name'],
  ['address_line1', 'Address line 1'],
  ['address_line2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['postal_code', 'Postal code'],
  ['country', 'Country'],
  ['phone', 'Phone'],
  ['email', 'Email'],
] as const satisfies ReadonlyArray<
  readonly [keyof InvoiceProfileInput, string]
>;

type InvoiceProfileRow = Partial<InvoiceProfileInput> | null;

function asInput(profile: InvoiceProfileRow): InvoiceProfileInput {
  return {
    business_name: profile?.business_name ?? '',
    legal_name: profile?.legal_name ?? '',
    address_line1: profile?.address_line1 ?? '',
    address_line2: profile?.address_line2 ?? '',
    city: profile?.city ?? '',
    state: profile?.state ?? '',
    postal_code: profile?.postal_code ?? '',
    country: profile?.country ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
  };
}

function hasReturnedRow(data: unknown): boolean {
  return Array.isArray(data)
    ? data.length > 0
    : data !== null && data !== undefined;
}

export function InvoiceDetailsCard() {
  const supabase = useMemo(() => createClient(), []);
  const { accountId, accountRole, account, profileLoading } = useAuth();
  const { locale } = useLocale();
  const mayManage = accountRole ? canManageInvoiceProfile(accountRole) : false;

  const [profile, setProfile] = useState<InvoiceProfileInput>(EMPTY_PROFILE);
  const [loaded, setLoaded] = useState<InvoiceProfileInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [saving, setSaving] = useState(false);

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

        const profileQuery = supabase
          .from('invoice_profiles')
          .select(
            'business_name, legal_name, address_line1, address_line2, city, state, postal_code, country, phone, email'
          )
          .eq('account_id', accountId)
          .maybeSingle();
        const legalEntityQuery = account?.legal_entity_id
          ? supabase
              .from('legal_entities')
              .select('legal_name')
              .eq('id', account.legal_entity_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null });
        const [profileResult, legalEntityResult] = await Promise.all([
          profileQuery,
          legalEntityQuery,
        ]);
        if (profileResult.error) throw profileResult.error;
        if (cancelled) return;

        const saved = normalizeInvoiceProfile(
          asInput(profileResult.data as InvoiceProfileRow)
        );
        const country =
          COUNTRY_PRESETS[locale.countryCode]?.label ?? locale.countryCode;
        const initial = profileResult.data
          ? saved
          : {
              ...saved,
              business_name: account?.name ?? '',
              legal_name:
                legalEntityResult.error === null
                  ? (legalEntityResult.data?.legal_name ?? '')
                  : '',
              country,
            };
        const normalizedInitial = normalizeInvoiceProfile(initial);
        setProfile(normalizedInitial);
        setLoaded(normalizedInitial);
        setErrors({});
        setSaveError(null);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(error, "Invoice details couldn't load. Try again.")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    account?.legal_entity_id,
    account?.name,
    accountId,
    locale.countryCode,
    profileLoading,
    reloadNonce,
    supabase,
  ]);

  const normalized = normalizeInvoiceProfile(profile);
  const dirty = loaded
    ? JSON.stringify(normalized) !== JSON.stringify(loaded)
    : false;

  function setField(field: keyof InvoiceProfileInput, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: '' }));
    }
    setSaveError(null);
  }

  async function saveProfile() {
    if (!accountId || !mayManage || saving) return;
    const next = normalizeInvoiceProfile(profile);
    const nextErrors = validateInvoiceProfile(next);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const { data, error } = await supabase.rpc('save_invoice_profile', {
        account_id: accountId,
        p_business_name: next.business_name,
        p_legal_name: next.legal_name,
        p_address_line1: next.address_line1,
        p_address_line2: next.address_line2,
        p_city: next.city,
        p_state: next.state,
        p_postal_code: next.postal_code,
        p_country: next.country,
        p_phone: next.phone,
        p_email: next.email,
      });
      if (error) throw error;
      if (!hasReturnedRow(data)) {
        throw new Error('Invoice details were not saved.');
      }
      setProfile(next);
      setLoaded(next);
      setErrors({});
      toast.success('Invoice details updated');
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Invoice details couldn't be saved. Try again."
      );
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice details</CardTitle>
        <CardDescription>
          These details appear on new invoices. Existing invoice documents keep
          the details they were issued with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div
            className="text-muted-foreground flex items-center gap-2 py-4 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading invoice details…
          </div>
        ) : loadError ? (
          <div className="space-y-3" role="alert">
            <p className="text-destructive text-sm">{loadError}</p>
            <p className="text-muted-foreground text-sm">
              Finish Invoice details in Settings -&gt; Payments first.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setReloadNonce((nonce) => nonce + 1)}
            >
              Try again
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
          >
            {!mayManage ? (
              <p className="text-muted-foreground text-sm">
                Read-only. Only account admins can change invoice details.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {PROFILE_FIELDS.map(([field, label]) => {
                const error = errors[field];
                const id = `invoice-profile-${field}`;
                return (
                  <div
                    className={
                      field === 'address_line1'
                        ? 'grid gap-2 sm:col-span-2'
                        : 'grid gap-2'
                    }
                    key={field}
                  >
                    <Label htmlFor={id}>{label}</Label>
                    <Input
                      id={id}
                      type={field === 'email' ? 'email' : 'text'}
                      value={profile[field]}
                      onChange={(event) => setField(field, event.target.value)}
                      disabled={!mayManage || saving}
                      autoCapitalize={field === 'email' ? 'none' : undefined}
                      autoCorrect={field === 'email' ? 'off' : undefined}
                      spellCheck={field === 'email' ? false : undefined}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-error` : undefined}
                    />
                    {error ? (
                      <p
                        id={`${id}-error`}
                        className="text-destructive text-xs"
                        role="alert"
                      >
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {saveError ? (
              <div className="flex flex-wrap items-center gap-3" role="alert">
                <p className="text-destructive text-sm">{saveError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void saveProfile()}
                  loading={saving}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            <GatedButton
              type="submit"
              canAct={mayManage}
              gateReason="save invoice details"
              loading={saving}
              disabled={!dirty}
            >
              Save invoice details
            </GatedButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
