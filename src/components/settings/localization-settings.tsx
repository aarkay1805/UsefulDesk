'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Globe2, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES } from '@/lib/currency';
import {
  COUNTRY_OPTIONS,
  COUNTRY_PRESETS,
  presetFor,
  toAccountColumns,
  type AccountLocale,
  type DateOrder,
  type MeasurementSystem,
  type TimeFormatPref,
  type WeekStart,
} from '@/lib/locale/config';
import { buildFormatters } from '@/lib/locale/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Settings → Regional settings — the gym's regional profile (migration 055).
 *
 * One draft covering every localization column on `accounts`. Picking a
 * country re-fills the whole draft from its preset (lib/locale/config);
 * each field stays individually editable after. Currency is included as
 * part of the country preset and is edited only on this surface.
 *
 * Writes follow the deals-settings pattern: direct `accounts` update
 * (accounts_update RLS = admins+) + refreshProfile() so every open
 * surface re-formats immediately.
 */

const DATE_ORDER_OPTIONS: { value: DateOrder; hint: string }[] = [
  { value: 'DMY', hint: 'DD/MM/YYYY' },
  { value: 'MDY', hint: 'MM/DD/YYYY' },
  { value: 'YMD', hint: 'YYYY-MM-DD' },
];

const WEEK_START_OPTIONS: { value: WeekStart; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 0, label: 'Sunday' },
  { value: 6, label: 'Saturday' },
];

/** All IANA zones the runtime knows, with a static fallback set. */
function allTimeZones(): string[] {
  if (typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone');
  }
  return Array.from(
    new Set(
      Object.values(COUNTRY_PRESETS).flatMap((p) => [
        p.timeZone,
        ...(p.timeZones ?? []),
      ])
    )
  ).sort();
}

/** Curated "formatting locale" choices: preset locales + the current value. */
function localeOptions(current: string): string[] {
  return Array.from(
    new Set([...Object.values(COUNTRY_PRESETS).map((p) => p.locale), current])
  ).sort();
}

export function LocalizationSettings() {
  const supabase = createClient();
  const {
    accountId,
    locale: saved,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [draft, setDraft] = useState<AccountLocale>(saved);
  const [saving, setSaving] = useState(false);

  // Re-sync the draft when the saved config's identity changes (initial
  // account load, or refreshProfile after a save) — adjust-state-during-
  // render, not a setState-in-effect (repo lint rule).
  const [synced, setSynced] = useState(saved);
  if (synced !== saved) {
    setSynced(saved);
    setDraft(saved);
  }

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  const set = <K extends keyof AccountLocale>(
    key: K,
    value: AccountLocale[K]
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const applyCountry = (code: string) => {
    setDraft(code === draft.countryCode ? draft : presetFor(code));
  };

  // Preview formatters for the CURRENT draft — instant feedback on any
  // change before saving.
  const preview = useMemo(() => buildFormatters(draft), [draft]);
  const previewNow = useMemo(() => new Date(), []);

  const timeZones = useMemo(() => allTimeZones(), []);
  const suggestedZones =
    COUNTRY_PRESETS[draft.countryCode]?.timeZones ??
    (COUNTRY_PRESETS[draft.countryCode]
      ? [COUNTRY_PRESETS[draft.countryCode].timeZone]
      : []);

  const disabled = !canEditSettings || profileLoading;

  async function handleSave() {
    if (!accountId || !dirty) return;
    const phone = draft.phoneCountryCode.trim();
    if (phone !== '' && !/^\+[0-9]{1,4}$/.test(phone)) {
      return toast.error('Phone country code must look like +91');
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('accounts')
      .update(toAccountColumns({ ...draft, phoneCountryCode: phone }))
      .eq('id', accountId)
      .select('id');
    if (error || !data?.length) {
      setSaving(false);
      toast.error('Failed to save regional settings');
      return;
    }
    await refreshProfile();
    setSaving(false);
    toast.success('Regional settings updated');
  }

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead
        title="Regional settings"
        description="Set your gym's country, currency, time zone, and display formats for every teammate."
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe2 className="text-primary-text size-4" />
              Regional profile
            </CardTitle>
            <CardDescription>
              Country presets fill every setting at once. You can fine-tune
              individual fields before saving.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-medium">Region defaults</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Used for billing, phone numbers, and time-based activity.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="regional-country">Country</Label>
                  <Select
                    value={
                      COUNTRY_PRESETS[draft.countryCode]
                        ? draft.countryCode
                        : 'ZZ'
                    }
                    onValueChange={(v) => v && applyCountry(v)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-country" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_OPTIONS.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="regional-time-zone">Time zone</Label>
                  <Select
                    value={draft.timeZone}
                    onValueChange={(v) => v && set('timeZone', v)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-time-zone" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {suggestedZones.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Suggested</SelectLabel>
                          {suggestedZones.map((tz) => (
                            <SelectItem key={`s-${tz}`} value={tz}>
                              {tz.replace(/_/g, ' ')}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      <SelectGroup>
                        <SelectLabel>All time zones</SelectLabel>
                        {timeZones.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="regional-currency">Currency</Label>
                  <Select
                    value={draft.currency}
                    onValueChange={(v) => v && set('currency', v)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!CURRENCIES.some((c) => c.code === draft.currency) && (
                        <SelectItem value={draft.currency}>
                          {draft.currency}
                        </SelectItem>
                      )}
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="phone-cc">Phone country code</Label>
                  <Input
                    id="phone-cc"
                    value={draft.phoneCountryCode}
                    onChange={(e) => set('phoneCountryCode', e.target.value)}
                    placeholder="+91"
                    disabled={disabled}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div>
                <h3 className="font-medium">Display formats</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Controls how dates, time, and measurements appear to your
                  team.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="regional-date-format">Date format</Label>
                  <Select
                    value={draft.dateOrder}
                    onValueChange={(v) => set('dateOrder', v as DateOrder)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-date-format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_ORDER_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.hint}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="regional-time-format">Time format</Label>
                  <Select
                    value={draft.timeFormat}
                    onValueChange={(v) =>
                      set('timeFormat', v as TimeFormatPref)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-time-format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12h">12-hour (9:00 pm)</SelectItem>
                      <SelectItem value="24h">24-hour (21:00)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="regional-week-start">Week starts on</Label>
                  <Select
                    value={String(draft.weekStart)}
                    onValueChange={(v) =>
                      set('weekStart', Number(v) as WeekStart)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-week-start" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEK_START_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="regional-measurement">Measurement</Label>
                  <Select
                    value={draft.measurementSystem}
                    onValueChange={(v) =>
                      set('measurementSystem', v as MeasurementSystem)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-measurement" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="metric">Metric (kg, cm)</SelectItem>
                      <SelectItem value="imperial">
                        Imperial (lb, ft)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="regional-locale">Formatting locale</Label>
                  <Select
                    value={draft.locale}
                    onValueChange={(v) => v && set('locale', v)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="regional-locale" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {localeOptions(draft.locale).map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Advanced — controls digit grouping and month names (en-IN
                    groups ₹1,00,000; en-US groups $100,000).
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <h3 className="font-medium">Preview</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  This is how the current draft will appear across UsefulDesk.
                </p>
              </div>
              <dl className="bg-muted/40 grid gap-x-6 gap-y-4 rounded-lg p-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground text-xs">Date</dt>
                  <dd className="mt-1 font-medium">
                    {preview.date(preview.today())}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Short date</dt>
                  <dd className="mt-1 font-medium">
                    {preview.dateShort(preview.today())}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Time</dt>
                  <dd className="mt-1 font-medium">
                    {preview.time(previewNow)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Number</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {preview.number(100000)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Money</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {preview.money(100000)}
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {!canEditSettings
                ? 'Only account admins can change regional settings.'
                : dirty
                  ? 'You have unsaved changes.'
                  : 'All regional settings are up to date.'}
            </p>
            {canEditSettings ? (
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            ) : null}
          </CardFooter>
        </Card>
      </form>
    </section>
  );
}
