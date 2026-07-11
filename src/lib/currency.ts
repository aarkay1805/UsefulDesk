/**
 * Currency — single source of truth for deal-value formatting and
 * the currency picker options.
 *
 * Before this module, ~6 components each defined their own
 * `Intl.NumberFormat(..., { currency: "USD" })` helper with USD
 * baked in. The default currency is now configurable per account
 * (accounts.default_currency, migration 021), so every formatter
 * takes a currency and falls back to DEFAULT_CURRENCY only when
 * nothing is known.
 */

/** App-wide fallback when no account/deal currency is available. */
export const DEFAULT_CURRENCY = "USD";

export interface CurrencyOption {
  /** ISO-4217 code, e.g. "USD". Stored verbatim in the DB. */
  code: string;
  /** Human label for the dropdown, e.g. "US Dollar". */
  label: string;
  /** Symbol for compact display, e.g. "$". */
  symbol: string;
}

/**
 * The currencies offered in pickers. Codes must be valid ISO-4217 so
 * `Intl.NumberFormat` renders the right symbol/grouping. Extend this
 * list to offer more — nothing else needs to change.
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  { code: "BRL", label: "Brazilian Real", symbol: "R$" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "CNY", label: "Chinese Yuan", symbol: "¥" },
  { code: "AED", label: "UAE Dirham", symbol: "د.إ" },
  { code: "ZAR", label: "South African Rand", symbol: "R" },
  { code: "NGN", label: "Nigerian Naira", symbol: "₦" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "MXN", label: "Mexican Peso", symbol: "$" },
  // Country-preset currencies (lib/locale/config.ts) — every preset's
  // currency must be offerable here or the settings picker couldn't
  // re-select what signup chose.
  { code: "NPR", label: "Nepalese Rupee", symbol: "रू" },
  { code: "BDT", label: "Bangladeshi Taka", symbol: "৳" },
  { code: "LKR", label: "Sri Lankan Rupee", symbol: "Rs" },
  { code: "SAR", label: "Saudi Riyal", symbol: "﷼" },
  { code: "NZD", label: "New Zealand Dollar", symbol: "NZ$" },
];

/**
 * Symbol for a currency code ("INR" → "₹"), for adorning amount inputs
 * where a full formatted string doesn't fit. Falls back to the code
 * itself for currencies we don't carry a symbol for.
 */
export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

/**
 * Format a deal value as a currency string. Whole-number output
 * (no minor units) — deal values are tracked to the dollar across
 * the app. `currency` defaults to USD so callers with nothing better
 * stay safe, but pass the account/deal currency wherever known.
 *
 * `locale` decides digit GROUPING ('en-IN' → ₹1,00,000 lakh style,
 * 'en-US' → $100,000). Undefined = the runtime default — prefer the
 * account locale via `useLocale().fmt.money()` / `buildFormatters`
 * so the gym's convention wins over the viewer's browser.
 *
 * Total by design: `Intl.NumberFormat` throws a RangeError on a
 * structurally invalid currency code, and `deals.currency` carries
 * NO DB CHECK (only `accounts.default_currency` does), so legacy
 * rows, imports, or hand-edited data can hold malformed values like
 * "United States". We never let that crash a render — on a bad code
 * we fall back to "CODE 1,234". An invalid locale tag is likewise
 * swallowed (retried with the runtime default).
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
  locale?: string,
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  };
  try {
    try {
      return new Intl.NumberFormat(locale, opts).format(amount);
    } catch (err) {
      // A RangeError can mean a bad locale OR a bad currency code —
      // retry locale-less so only a truly bad code hits the fallback.
      if (locale === undefined) throw err;
      return new Intl.NumberFormat(undefined, opts).format(amount);
    }
  } catch {
    // Invalid ISO code — show the raw code + grouped number so the
    // value is still legible instead of throwing.
    return `${code} ${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amount)}`;
  }
}

/**
 * Compact currency for tight spaces (donut center, legend rows):
 * "$1.2M" / "€34.5k" / "₹900". Uses the currency's symbol from
 * CURRENCIES, falling back to the code when we don't carry a symbol.
 */
export function formatCurrencyShort(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = currency || DEFAULT_CURRENCY;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${symbol}${(v / 1_000).toFixed(1)}k`;
  return `${symbol}${v.toFixed(0)}`;
}
