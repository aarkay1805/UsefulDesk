/**
 * Locale-aware formatting — pure functions over an `AccountLocale`.
 *
 * `buildFormatters(cfg)` is the one formatting surface for the whole
 * product: client components get a memoized instance from
 * `useLocale()`, server code (renewal cron, API routes) builds one from
 * the account row. All output follows the GYM's locale — never the
 * viewer's browser — so a US owner travelling in Europe still sees
 * their gym's dates, and an Indian gym renders ₹1,00,000 on any device.
 *
 * Date-value contract (mirrors the old `lib/dates/format.ts`): a plain
 * 'YYYY-MM-DD' string is a CALENDAR date — formatted from its parts,
 * never via `new Date(str)` (which would parse UTC-midnight and shift
 * the day for western viewers). Anything else is treated as a timestamp
 * and rendered in the account's time zone.
 */

import type { AccountLocale } from './config';
import { DEFAULT_ACCOUNT_LOCALE } from './config';
import { formatCurrency, formatCurrencyShort } from '@/lib/currency';

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Intl instances are expensive to construct; cache per (locale, options).
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(
  locale: string,
  opts: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    dtfCache.set(key, f);
  }
  return f;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string): Intl.NumberFormat {
  let f = nfCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale);
    nfCache.set(locale, f);
  }
  return f;
}

/**
 * Today's calendar date in a zone as 'YYYY-MM-DD'. The generalized
 * `istToday()` — every "is this expired / due / expiring" comparison
 * keys off the ACCOUNT's zone so members never expire a day early or
 * late anywhere on earth. en-CA formats as YYYY-MM-DD.
 */
export function todayInTz(timeZone: string, now: Date = new Date()): string {
  try {
    return dtf('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // Unknown zone (bad DB value that bypassed resolve) — UTC beats a crash.
    return dtf('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/** Hour-of-day (0–23) in a zone right now. Drives the cron send window. */
export function hourInTz(timeZone: string, now: Date = new Date()): number {
  try {
    return Number(
      dtf('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now)
    );
  } catch {
    return now.getUTCHours();
  }
}

/** Zone offset from UTC in minutes at `at` (IST → +330). */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = dtf('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts?.value ?? '');
  if (!m) return 0; // plain 'GMT' (UTC) or unexpected shape
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * The instant of 12:00 local time in `timeZone` on a 'YYYY-MM-DD' day.
 * Use this to stamp a user-picked calendar day into a timestamptz
 * column (e.g. `payments.paid_at`) so the row reads back on the SAME
 * day in the account's zone — a fixed "noon UTC" anchor breaks for
 * zones beyond ±12h (Pacific/Auckland). Malformed input → `null`.
 */
export function dateAtNoonInTz(dateStr: string, timeZone: string): Date | null {
  const m = PLAIN_DATE.exec(dateStr);
  if (!m) return null;
  const utcNoon = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  try {
    return new Date(
      utcNoon - tzOffsetMinutes(timeZone, new Date(utcNoon)) * 60_000
    );
  } catch {
    return new Date(utcNoon);
  }
}

/**
 * The instant of 00:00 local time in `timeZone` on a 'YYYY-MM-DD' day —
 * the lower bound for "everything that happened today here" queries
 * (attendance check-ins, activity). Malformed input → `null`.
 */
export function dayStartInTz(dateStr: string, timeZone: string): Date | null {
  const m = PLAIN_DATE.exec(dateStr);
  if (!m) return null;
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0);
  try {
    return new Date(
      utcMidnight - tzOffsetMinutes(timeZone, new Date(utcMidnight)) * 60_000
    );
  } catch {
    return new Date(utcMidnight);
  }
}

/**
 * The instant of `HH:mm` local time in `timeZone` on a 'YYYY-MM-DD'
 * day (e.g. follow-up reminder slots — "8am on the due date, gym
 * time"). Two offset passes make it DST-safe. Malformed input → null.
 */
export function timeInTzToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string
): Date | null {
  const dm = PLAIN_DATE.exec(dateStr);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dm || !tm) return null;
  const wall = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2])
  );
  try {
    let utc = wall - tzOffsetMinutes(timeZone, new Date(wall)) * 60_000;
    // Second pass converges when the first guess straddled a DST shift.
    utc = wall - tzOffsetMinutes(timeZone, new Date(utc)) * 60_000;
    return new Date(utc);
  } catch {
    return new Date(wall);
  }
}

/** Wall-clock 'HH:mm' (24h) of an instant as seen in `timeZone`. */
export function hhmmInTz(date: Date, timeZone: string): string {
  try {
    return dtf('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  } catch {
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(
      date.getUTCMinutes()
    ).padStart(2, '0')}`;
  }
}

/** Accepted by every formatter: plain date, ISO timestamp, or Date. */
export type DateValue = string | Date;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function plainParts(value: DateValue): Ymd | null {
  if (typeof value !== 'string') return null;
  const m = PLAIN_DATE.exec(value);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function asDate(value: DateValue): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar Y/M/D of a timestamp as seen in `timeZone`. */
function partsInTz(date: Date, timeZone: string): Ymd {
  const s = todayInTz(timeZone, date); // en-CA → YYYY-MM-DD
  const m = PLAIN_DATE.exec(s)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The account-locale formatting surface. Build once per config (cheap —
 * Intl instances are cached module-wide) and pass around; client code
 * gets a shared instance from `useLocale()`.
 */
export interface LocaleFormatters {
  /** The config these formatters were built from. */
  readonly config: AccountLocale;
  /** Today ('YYYY-MM-DD') in the account's zone. Pass to expiry math. */
  today(): string;
  /** Medium date — 'en-IN' → "11 Jul 2026", 'en-US' → "Jul 11, 2026". */
  date(value: DateValue): string;
  /** Numeric date per `dateOrder` — 11/07/2026 · 07/11/2026 · 2026-07-11. */
  dateShort(value: DateValue): string;
  /** Time of day per `timeFormat`, in the account zone — "9:30 pm" / "21:30". */
  time(value: DateValue): string;
  /** Date + time (timestamps); falls back to `date()` for plain dates. */
  dateTime(value: DateValue): string;
  /** Grouped number — 'en-IN' → 1,00,000; 'en-US' → 100,000. */
  number(value: number): string;
  /** Currency in the account's locale grouping; defaults to its currency. */
  money(value: number, currency?: string): string;
  /** Compact currency — "₹2.5M" — for tiles/legends. */
  moneyShort(value: number, currency?: string): string;
}

export function buildFormatters(
  cfg: AccountLocale = DEFAULT_ACCOUNT_LOCALE
): LocaleFormatters {
  const mediumDate: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const hour12 = cfg.timeFormat === '12h';
  const timeOpts: Intl.DateTimeFormatOptions = hour12
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' };

  const shortFromYmd = ({ y, m, d }: Ymd): string => {
    if (cfg.dateOrder === 'MDY') return `${pad2(m)}/${pad2(d)}/${y}`;
    if (cfg.dateOrder === 'YMD') return `${y}-${pad2(m)}-${pad2(d)}`;
    return `${pad2(d)}/${pad2(m)}/${y}`;
  };

  return {
    config: cfg,

    today: () => todayInTz(cfg.timeZone),

    date(value) {
      const plain = plainParts(value);
      if (plain) {
        // Anchor at UTC noon and format in UTC — the parts pass through
        // untouched while the locale decides order and month names.
        return dtf(cfg.locale, { ...mediumDate, timeZone: 'UTC' }).format(
          new Date(Date.UTC(plain.y, plain.m - 1, plain.d, 12))
        );
      }
      const ts = asDate(value);
      if (!ts) return String(value);
      return dtf(cfg.locale, { ...mediumDate, timeZone: cfg.timeZone }).format(
        ts
      );
    },

    dateShort(value) {
      const plain = plainParts(value);
      if (plain) return shortFromYmd(plain);
      const ts = asDate(value);
      if (!ts) return String(value);
      return shortFromYmd(partsInTz(ts, cfg.timeZone));
    },

    time(value) {
      const ts = asDate(value);
      if (!ts || plainParts(value)) return '';
      return dtf(cfg.locale, { ...timeOpts, timeZone: cfg.timeZone }).format(
        ts
      );
    },

    dateTime(value) {
      const ts = asDate(value);
      if (!ts || plainParts(value)) return this.date(value);
      return dtf(cfg.locale, {
        ...mediumDate,
        ...timeOpts,
        timeZone: cfg.timeZone,
      }).format(ts);
    },

    number(value) {
      return nf(cfg.locale).format(Number(value) || 0);
    },

    money(value, currency = cfg.currency) {
      return formatCurrency(value, currency, cfg.locale);
    },

    moneyShort(value, currency = cfg.currency) {
      return formatCurrencyShort(value, currency);
    },
  };
}

/** Shared India-default instance — the pre-provider fallback. */
export const DEFAULT_FORMATTERS: LocaleFormatters = buildFormatters();
