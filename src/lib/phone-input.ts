import { normalizePhone } from '@/lib/whatsapp/phone-utils';

/**
 * Convert a persisted/account-qualified phone into the national-number text
 * shown beside PhoneInput's fixed country-code compartment.
 *
 * The length guard preserves the real local-number trap documented by the
 * capture flow: an Indian national number such as `9198765432` starts with
 * `91`, but only leaves eight digits after it and must not be stripped.
 */
export function nationalPhoneInputValue(
  phone: string,
  countryCode: string
): string {
  const raw = phone.trimStart();
  const code = countryCode.trim();
  if (!raw || !code) return raw;

  if (raw.startsWith(code)) return raw.slice(code.length).trimStart();

  const digits = normalizePhone(raw);
  const codeDigits = normalizePhone(code);
  if (!codeDigits) return raw;

  if (digits.startsWith(`00${codeDigits}`)) {
    return digits.slice(codeDigits.length + 2);
  }

  if (
    !raw.startsWith('+') &&
    digits.startsWith(codeDigits) &&
    digits.length - codeDigits.length >= 9
  ) {
    return digits.slice(codeDigits.length);
  }

  return raw;
}

/**
 * Join national-number text back to the account country code for storage,
 * dedupe, and WhatsApp sends. Explicit international input is preserved; a
 * domestic trunk zero is removed when the account code is applied.
 */
export function accountQualifiedPhoneValue(
  nationalPhone: string,
  countryCode: string
): string {
  const raw = nationalPhone.trim();
  const code = countryCode.trim();
  if (!raw || !code) return raw;

  const digits = normalizePhone(raw);
  const codeDigits = normalizePhone(code);

  if (raw.startsWith('+') || digits.startsWith('00')) return raw;

  if (
    codeDigits &&
    digits.startsWith(codeDigits) &&
    digits.length - codeDigits.length >= 9
  ) {
    return `${code}${digits.slice(codeDigits.length)}`;
  }

  return `${code}${raw.replace(/^0+/, '')}`;
}
