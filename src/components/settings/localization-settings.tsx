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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Settings → Localization — the gym's regional profile (migration 055).
 *
 * One draft covering every localization column on `accounts`. Picking a
 * country re-fills the whole draft from its preset (lib/locale/config);
 * each field stays individually editable after. Currency is included —
 * it's part of the preset — and the same column also remains editable
 * under Payments & currency (one DB column, both panels round-trip
 * through refreshProfile, so they can't drift).
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

const selectClass =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60';

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
      toast.error('Failed to save localization settings');
      return;
    }
    await refreshProfile();
    setSaving(false);
    toast.success('Localization updated');
  }

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead
        title="Localization"
        description="Your gym's country, time zone, and formatting — dates, times, numbers, and phone prefixes follow these everywhere, for every teammate."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Globe2 className="text-primary size-4" />
            Region & formats
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Picking a country applies its defaults to every field below — then
            adjust anything individually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Country</Label>
              <select
                value={
                  COUNTRY_PRESETS[draft.countryCode] ? draft.countryCode : 'ZZ'
                }
                onChange={(e) => applyCountry(e.target.value)}
                disabled={disabled}
                className={selectClass}
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Time zone</Label>
              <select
                value={draft.timeZone}
                onChange={(e) => set('timeZone', e.target.value)}
                disabled={disabled}
                className={selectClass}
              >
                {suggestedZones.length > 0 && (
                  <optgroup label="Suggested">
                    {suggestedZones.map((tz) => (
                      <option key={`s-${tz}`} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="All time zones">
                  {timeZones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Currency</Label>
              <select
                value={draft.currency}
                onChange={(e) => set('currency', e.target.value)}
                disabled={disabled}
                className={selectClass}
              >
                {!CURRENCIES.some((c) => c.code === draft.currency) && (
                  <option value={draft.currency}>{draft.currency}</option>
                )}
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.label}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                Also editable under Payments &amp; currency — same setting.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="phone-cc" className="text-muted-foreground">
                Phone country code
              </Label>
              <Input
                id="phone-cc"
                value={draft.phoneCountryCode}
                onChange={(e) => set('phoneCountryCode', e.target.value)}
                placeholder="+91"
                disabled={disabled}
                className="bg-muted"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Date format</Label>
              <select
                value={draft.dateOrder}
                onChange={(e) => set('dateOrder', e.target.value as DateOrder)}
                disabled={disabled}
                className={selectClass}
              >
                {DATE_ORDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.hint}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Time format</Label>
              <select
                value={draft.timeFormat}
                onChange={(e) =>
                  set('timeFormat', e.target.value as TimeFormatPref)
                }
                disabled={disabled}
                className={selectClass}
              >
                <option value="12h">12-hour (9:00 pm)</option>
                <option value="24h">24-hour (21:00)</option>
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Week starts on</Label>
              <select
                value={String(draft.weekStart)}
                onChange={(e) =>
                  set('weekStart', Number(e.target.value) as WeekStart)
                }
                disabled={disabled}
                className={selectClass}
              >
                {WEEK_START_OPTIONS.map((o) => (
                  <option key={o.value} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Measurement</Label>
              <select
                value={draft.measurementSystem}
                onChange={(e) =>
                  set('measurementSystem', e.target.value as MeasurementSystem)
                }
                disabled={disabled}
                className={selectClass}
              >
                <option value="metric">Metric (kg, cm)</option>
                <option value="imperial">Imperial (lb, ft)</option>
              </select>
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label className="text-muted-foreground">Formatting locale</Label>
              <select
                value={draft.locale}
                onChange={(e) => set('locale', e.target.value)}
                disabled={disabled}
                className={selectClass}
              >
                {localeOptions(draft.locale).map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                Advanced — controls digit grouping and month names (en-IN groups
                ₹1,00,000; en-US groups $100,000).
              </p>
            </div>
          </div>

          {/* Live preview of the draft before saving. */}
          <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-3.5 py-2.5 text-sm">
            <span className="text-foreground font-medium">Preview:</span>{' '}
            {preview.date(preview.today())} ·{' '}
            {preview.dateShort(preview.today())} · {preview.time(previewNow)} ·{' '}
            {preview.number(100000)} · {preview.money(100000)}
          </div>

          {!canEditSettings ? (
            <p className="text-muted-foreground text-xs">
              Only account admins can change localization settings.
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
        </CardContent>
      </Card>
    </section>
  );
}
