'use client';

import { useAuth } from './use-auth';
import type { AccountLocale } from '@/lib/locale/config';
import type { LocaleFormatters } from '@/lib/locale/format';

/**
 * useLocale — the account's localization config + bound formatters.
 *
 * The ONE way client components format region-sensitive output. The
 * gym's settings (migration 055) decide everything; the viewer's
 * browser locale is never consulted, so every staff member sees the
 * same dates, grouping, and currency.
 *
 *   const { fmt, locale } = useLocale();
 *   fmt.date(m.end_date)      // "11 Jul 2026" (IN) · "Jul 11, 2026" (US)
 *   fmt.money(plan.price)     // "₹1,00,000" · "$100,000"
 *   fmt.today()               // 'YYYY-MM-DD' in the gym's zone — pass
 *                             // into expiry/dues/trials date math
 *   locale.phoneCountryCode   // "+91" — input placeholders, hints
 *
 * Values are resolved once in AuthProvider (India-shaped fallback
 * while loading), so this is safe to call unconditionally.
 */
export function useLocale(): { locale: AccountLocale; fmt: LocaleFormatters } {
  const { locale, fmt } = useAuth();
  return { locale, fmt };
}
