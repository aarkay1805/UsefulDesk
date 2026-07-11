// Shared helpers for honoring a custom field's data type wherever the
// field is used (leads table, lead detail panel, contact form). Values
// are stored as free text in `contact_custom_values.value`; the field's
// `custom_fields.field_type` (see CUSTOM_FIELD_TYPES) decides how they
// are entered and displayed. Every formatter falls back to the raw value
// when it can't parse, so legacy/imported data stays legible.

import { formatCurrency } from '@/lib/currency';

/** HTML `<input type>` for entering a value of the given field type. */
export function customFieldInputType(type?: string): string {
  switch (type) {
    case 'number':
    case 'currency':
      return 'number';
    case 'date':
      return 'date';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'url':
      return 'url';
    default:
      return 'text';
  }
}

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Human display of a stored value according to its field type.
 * `currency` + `localeTag` come from the account locale
 * (`useLocale().locale.currency` / `.locale`); omitting them falls back
 * to app defaults, so pass them wherever known — locale decides digit
 * grouping (en-IN lakhs) and date order.
 */
export function formatCustomFieldValue(
  value: string,
  type?: string,
  currency?: string,
  localeTag?: string,
): string {
  switch (type) {
    case 'currency': {
      const n = Number(value);
      return Number.isFinite(n) ? formatCurrency(n, currency, localeTag) : value;
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n)
        ? new Intl.NumberFormat(localeTag).format(n)
        : value;
    }
    case 'date': {
      // Plain YYYY-MM-DD (what <input type=date> stores) is formatted
      // from its parts on a UTC anchor — `new Date(str)` would parse UTC
      // midnight and shift the day for viewers west of UTC.
      const m = PLAIN_DATE.exec(value);
      const d = m
        ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
        : new Date(value);
      return Number.isNaN(d.getTime())
        ? value
        : d.toLocaleDateString(localeTag ?? 'en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            ...(m ? { timeZone: 'UTC' } : {}),
          });
    }
    default:
      return value; // text, email, phone, url
  }
}
