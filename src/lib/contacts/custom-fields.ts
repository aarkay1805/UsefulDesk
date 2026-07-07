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

/**
 * Human display of a stored value according to its field type.
 * `currency` is the account's default currency (useAuth().defaultCurrency);
 * omitting it falls back to the app-wide default, so pass it wherever known.
 */
export function formatCustomFieldValue(
  value: string,
  type?: string,
  currency?: string,
): string {
  switch (type) {
    case 'currency': {
      const n = Number(value);
      return Number.isFinite(n) ? formatCurrency(n, currency) : value;
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : value;
    }
    case 'date': {
      const d = new Date(value);
      return Number.isNaN(d.getTime())
        ? value
        : d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
    }
    default:
      return value; // text, email, phone, url
  }
}
