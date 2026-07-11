/**
 * Account localization — the single place geography lives.
 *
 * Every gym (account) carries its own locale config: country, BCP-47
 * locale, currency, IANA time zone, date/time/week formatting prefs,
 * phone country code, and measurement system (migration 055). The rest
 * of the codebase NEVER branches on country — it consumes a resolved
 * `AccountLocale` (via `useLocale()` client-side or
 * `resolveAccountLocale(accountRow)` server-side) and formats through
 * `buildFormatters` (./format). Adding a country = adding a preset
 * here; nothing else changes.
 *
 * Scope note: this is REGIONAL formatting (dates, numbers, currency,
 * time zones, phones), not string translation/i18n.
 */

export type DateOrder = 'DMY' | 'MDY' | 'YMD';
export type TimeFormatPref = '12h' | '24h';
/** JS `getDay()` values: 0 = Sunday, 1 = Monday, 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;
export type MeasurementSystem = 'metric' | 'imperial';

/** Fully-resolved localization config for one account. */
export interface AccountLocale {
  /** ISO 3166-1 alpha-2, e.g. 'IN'. 'ZZ' = unlisted country. */
  countryCode: string;
  /** BCP-47 tag driving Intl output, e.g. 'en-IN' (lakh grouping). */
  locale: string;
  /** ISO-4217 — mirrors `accounts.default_currency`. */
  currency: string;
  /** IANA zone, e.g. 'Asia/Kolkata'. Drives "today" and time renders. */
  timeZone: string;
  /** Numeric-date order for renders AND import-parsing ambiguity. */
  dateOrder: DateOrder;
  timeFormat: TimeFormatPref;
  weekStart: WeekStart;
  /** Dial prefix with '+', e.g. '+91'. '' when unknown ('ZZ'). */
  phoneCountryCode: string;
  measurementSystem: MeasurementSystem;
}

export interface CountryPreset extends Omit<AccountLocale, 'countryCode'> {
  /** Picker label, e.g. 'India'. */
  label: string;
  /** Zones offered first in the timezone picker (multi-zone countries).
   *  `timeZone` above is the default and must be in this list. */
  timeZones?: string[];
}

/**
 * Per-country defaults applied at signup and by the Settings country
 * picker. Every field remains individually editable afterwards — the
 * preset is a starting point, not a constraint. Keys are ISO 3166-1
 * alpha-2 codes; 'ZZ' is the "somewhere else" fallback.
 *
 * Locale tags are chosen for OUTPUT correctness, not nationality: NP/BD
 * use 'en-IN' because Intl only carries lakh/crore digit grouping (and
 * day-first dates) under the -IN tag.
 */
export const COUNTRY_PRESETS: Record<string, CountryPreset> = {
  IN: {
    label: 'India',
    locale: 'en-IN',
    currency: 'INR',
    timeZone: 'Asia/Kolkata',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+91',
    measurementSystem: 'metric',
  },
  NP: {
    label: 'Nepal',
    locale: 'en-IN',
    currency: 'NPR',
    timeZone: 'Asia/Kathmandu',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 0,
    phoneCountryCode: '+977',
    measurementSystem: 'metric',
  },
  BD: {
    label: 'Bangladesh',
    locale: 'en-IN',
    currency: 'BDT',
    timeZone: 'Asia/Dhaka',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 0,
    phoneCountryCode: '+880',
    measurementSystem: 'metric',
  },
  LK: {
    label: 'Sri Lanka',
    locale: 'en-GB',
    currency: 'LKR',
    timeZone: 'Asia/Colombo',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+94',
    measurementSystem: 'metric',
  },
  AE: {
    label: 'United Arab Emirates',
    locale: 'en-AE',
    currency: 'AED',
    timeZone: 'Asia/Dubai',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+971',
    measurementSystem: 'metric',
  },
  SA: {
    label: 'Saudi Arabia',
    locale: 'en-GB',
    currency: 'SAR',
    timeZone: 'Asia/Riyadh',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 0,
    phoneCountryCode: '+966',
    measurementSystem: 'metric',
  },
  SG: {
    label: 'Singapore',
    locale: 'en-SG',
    currency: 'SGD',
    timeZone: 'Asia/Singapore',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+65',
    measurementSystem: 'metric',
  },
  US: {
    label: 'United States',
    locale: 'en-US',
    currency: 'USD',
    timeZone: 'America/New_York',
    timeZones: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
    ],
    dateOrder: 'MDY',
    timeFormat: '12h',
    weekStart: 0,
    phoneCountryCode: '+1',
    measurementSystem: 'imperial',
  },
  CA: {
    label: 'Canada',
    locale: 'en-CA',
    currency: 'CAD',
    timeZone: 'America/Toronto',
    timeZones: [
      'America/St_Johns',
      'America/Halifax',
      'America/Toronto',
      'America/Winnipeg',
      'America/Edmonton',
      'America/Vancouver',
    ],
    dateOrder: 'YMD',
    timeFormat: '12h',
    weekStart: 0,
    phoneCountryCode: '+1',
    measurementSystem: 'metric',
  },
  GB: {
    label: 'United Kingdom',
    locale: 'en-GB',
    currency: 'GBP',
    timeZone: 'Europe/London',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+44',
    measurementSystem: 'metric',
  },
  AU: {
    label: 'Australia',
    locale: 'en-AU',
    currency: 'AUD',
    timeZone: 'Australia/Sydney',
    timeZones: [
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Brisbane',
      'Australia/Adelaide',
      'Australia/Darwin',
      'Australia/Perth',
      'Australia/Hobart',
    ],
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+61',
    measurementSystem: 'metric',
  },
  NZ: {
    label: 'New Zealand',
    locale: 'en-NZ',
    currency: 'NZD',
    timeZone: 'Pacific/Auckland',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+64',
    measurementSystem: 'metric',
  },
  ZA: {
    label: 'South Africa',
    locale: 'en-ZA',
    currency: 'ZAR',
    timeZone: 'Africa/Johannesburg',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+27',
    measurementSystem: 'metric',
  },
  NG: {
    label: 'Nigeria',
    locale: 'en-NG',
    currency: 'NGN',
    timeZone: 'Africa/Lagos',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '+234',
    measurementSystem: 'metric',
  },
  ZZ: {
    label: 'Somewhere else',
    locale: 'en-GB',
    currency: 'USD',
    timeZone: 'Etc/UTC',
    dateOrder: 'DMY',
    timeFormat: '12h',
    weekStart: 1,
    phoneCountryCode: '',
    measurementSystem: 'metric',
  },
};

/** Picker-ordered country options (India first, then A→Z, 'ZZ' last). */
export const COUNTRY_OPTIONS: { code: string; label: string }[] = Object.keys(
  COUNTRY_PRESETS
)
  .sort((a, b) => {
    if (a === 'IN') return -1;
    if (b === 'IN') return 1;
    if (a === 'ZZ') return 1;
    if (b === 'ZZ') return -1;
    return COUNTRY_PRESETS[a].label.localeCompare(COUNTRY_PRESETS[b].label);
  })
  .map((code) => ({ code, label: COUNTRY_PRESETS[code].label }));

export function presetFor(countryCode: string): AccountLocale {
  const preset = COUNTRY_PRESETS[countryCode] ?? COUNTRY_PRESETS.IN;
  return {
    countryCode: COUNTRY_PRESETS[countryCode] ? countryCode : 'IN',
    locale: preset.locale,
    currency: preset.currency,
    timeZone: preset.timeZone,
    dateOrder: preset.dateOrder,
    timeFormat: preset.timeFormat,
    weekStart: preset.weekStart,
    phoneCountryCode: preset.phoneCountryCode,
    measurementSystem: preset.measurementSystem,
  };
}

/** The product's home market — every fallback resolves to India. */
export const DEFAULT_ACCOUNT_LOCALE: AccountLocale = presetFor('IN');

export function isDateOrder(v: unknown): v is DateOrder {
  return v === 'DMY' || v === 'MDY' || v === 'YMD';
}
export function isTimeFormatPref(v: unknown): v is TimeFormatPref {
  return v === '12h' || v === '24h';
}
export function isWeekStart(v: unknown): v is WeekStart {
  return v === 0 || v === 1 || v === 6;
}
export function isMeasurementSystem(v: unknown): v is MeasurementSystem {
  return v === 'metric' || v === 'imperial';
}

/** True when Intl accepts the tag AND it looks like a BCP-47 tag. */
export function isValidLocaleTag(v: unknown): v is string {
  if (typeof v !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)) {
    return false;
  }
  try {
    new Intl.NumberFormat(v);
    return true;
  } catch {
    return false;
  }
}

/** True when the runtime's Intl knows the IANA zone. */
export function isValidTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Raw `accounts` localization columns as selected from the DB. */
export interface AccountLocaleRow {
  country_code?: string | null;
  locale?: string | null;
  default_currency?: string | null;
  timezone?: string | null;
  date_order?: string | null;
  time_format?: string | null;
  week_start?: number | null;
  phone_country_code?: string | null;
  measurement_system?: string | null;
}

/**
 * Narrow a raw account row into a total `AccountLocale`. Field-by-field:
 * anything missing or malformed falls back to the India default, so a
 * pre-055 row (or a null account while loading) still formats sanely.
 */
export function resolveAccountLocale(
  row: AccountLocaleRow | null | undefined
): AccountLocale {
  const d = DEFAULT_ACCOUNT_LOCALE;
  if (!row) return d;
  const country =
    typeof row.country_code === 'string' && /^[A-Z]{2}$/.test(row.country_code)
      ? row.country_code
      : d.countryCode;
  return {
    countryCode: country,
    locale: isValidLocaleTag(row.locale) ? row.locale : d.locale,
    currency:
      typeof row.default_currency === 'string' &&
      /^[A-Z]{3}$/.test(row.default_currency)
        ? row.default_currency
        : d.currency,
    timeZone: isValidTimeZone(row.timezone) ? row.timezone : d.timeZone,
    dateOrder: isDateOrder(row.date_order) ? row.date_order : d.dateOrder,
    timeFormat: isTimeFormatPref(row.time_format)
      ? row.time_format
      : d.timeFormat,
    weekStart: isWeekStart(row.week_start) ? row.week_start : d.weekStart,
    phoneCountryCode:
      typeof row.phone_country_code === 'string' &&
      (row.phone_country_code === '' ||
        /^\+[0-9]{1,4}$/.test(row.phone_country_code))
        ? row.phone_country_code
        : d.phoneCountryCode,
    measurementSystem: isMeasurementSystem(row.measurement_system)
      ? row.measurement_system
      : d.measurementSystem,
  };
}

/**
 * The snake_case payload written to `accounts` (and sent as signup
 * metadata for `handle_new_user`, migration 055) for a config. Column
 * names ARE the wire format — one shape everywhere.
 */
export function toAccountColumns(cfg: AccountLocale): Required<
  Omit<AccountLocaleRow, 'default_currency'>
> & {
  default_currency: string;
} {
  return {
    country_code: cfg.countryCode,
    locale: cfg.locale,
    default_currency: cfg.currency,
    timezone: cfg.timeZone,
    date_order: cfg.dateOrder,
    time_format: cfg.timeFormat,
    week_start: cfg.weekStart,
    phone_country_code: cfg.phoneCountryCode,
    measurement_system: cfg.measurementSystem,
  };
}

/**
 * Import parsing needs a binary day-first/month-first prior for
 * ambiguous numeric dates; YMD renders unambiguous dates but its
 * countries (e.g. Canada) colloquially write month-first slashes.
 */
export function importDateOrder(cfg: AccountLocale): 'DMY' | 'MDY' {
  return cfg.dateOrder === 'MDY' || cfg.dateOrder === 'YMD' ? 'MDY' : 'DMY';
}
