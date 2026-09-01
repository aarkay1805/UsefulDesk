import { COUNTRY_PRESETS } from './locale/config';
import { normalizePhone } from './whatsapp/phone-utils';

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
 * Present every valid phone with an explicit international dial prefix.
 *
 * Persisted contacts may contain a national number, a legacy digits-only
 * account-qualified number, or an explicit international value. Display is
 * the one place those storage shapes converge: the account code is added to
 * national numbers, legacy qualified numbers gain their leading plus, and a
 * `00` international prefix is presented as `+`. Invalid source text remains
 * untouched so a formatting pass never disguises a data-quality problem.
 */
export function accountQualifiedPhoneDisplayValue(
  phone: string,
  countryCode: string
): string {
  const raw = phone.trim();
  const codeDigits = normalizePhone(canonicalPhoneCountryCode(countryCode));
  if (!raw || raw.startsWith('+')) return raw;

  if (!/^[\d\s().-]+$/.test(raw)) return raw;

  const digits = normalizePhone(raw);
  if (raw.startsWith('00')) {
    return digits.length > 2 ? `+${digits.slice(2)}` : raw;
  }
  if (!codeDigits) return raw;

  if (isAccountQualifiedDigits(digits, codeDigits, countryCode)) {
    return `+${digits}`;
  }

  const lengths = nationalPhoneLengths(countryCode);
  const withoutTrunk = digits.replace(/^0+/, '');
  const isNational =
    lengths.size > 0
      ? lengths.has(digits.length) || lengths.has(withoutTrunk.length)
      : digits.length >= 7 && digits.length <= 12;
  if (isNational) {
    return `+${codeDigits}${withoutTrunk}`;
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
