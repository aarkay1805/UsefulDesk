import { COUNTRY_PRESETS } from '@/lib/locale/config';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

/**
 * Canonical visible dial prefix. Accounts created before localization may
 * still supply digits-only codes, but the product always presents a country
 * code with its leading plus.
 */
export function canonicalPhoneCountryCode(countryCode: string): string {
  const digits = normalizePhone(countryCode.trim()).replace(/^00/, '');
  return digits ? `+${digits}` : '';
}

function nationalPhoneLengths(countryCode: string): Set<number> {
  const codeDigits = normalizePhone(canonicalPhoneCountryCode(countryCode));
  return new Set(
    Object.values(COUNTRY_PRESETS)
      .filter(
        (preset) => normalizePhone(preset.phoneCountryCode) === codeDigits
      )
      .flatMap((preset) => preset.phoneNationalLengths)
  );
}

function isAccountQualifiedDigits(
  digits: string,
  codeDigits: string,
  countryCode: string
): boolean {
  const lengths = nationalPhoneLengths(countryCode);
  const remainderLength = digits.length - codeDigits.length;
  return (
    digits.startsWith(codeDigits) &&
    (lengths.size > 0 ? lengths.has(remainderLength) : remainderLength >= 9)
  );
}

/**
 * Add the conventional plus sign only when a display value is already a
 * digits-only account-qualified phone. National numbers, explicit
 * international values, and invalid source text remain untouched.
 */
export function accountQualifiedPhoneDisplayValue(
  phone: string,
  countryCode: string
): string {
  const raw = phone.trim();
  const codeDigits = normalizePhone(canonicalPhoneCountryCode(countryCode));
  if (!raw || !codeDigits || raw.startsWith('+') || raw.startsWith('00')) {
    return raw;
  }

  if (!/^[\d\s().-]+$/.test(raw)) return raw;

  const digits = normalizePhone(raw);
  if (isAccountQualifiedDigits(digits, codeDigits, countryCode)) {
    return `+${digits}`;
  }

  return raw;
}

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
  const code = canonicalPhoneCountryCode(countryCode);
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
    isAccountQualifiedDigits(digits, codeDigits, countryCode)
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

  if (codeDigits && isAccountQualifiedDigits(digits, codeDigits, countryCode)) {
    return `${code}${digits.slice(codeDigits.length)}`;
  }

  return `${code}${raw.replace(/^0+/, '')}`;
}
