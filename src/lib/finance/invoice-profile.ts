/**
 * Browser-side invoice profile shape. Database authorization and the final
 * profile write remain owned by `save_invoice_profile`.
 */
export interface InvoiceProfileInput {
  business_name: string;
  legal_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
}

const REQUIRED_FIELDS: ReadonlyArray<
  readonly [
    keyof Pick<
      InvoiceProfileInput,
      'business_name' | 'address_line1' | 'city' | 'country'
    >,
    string,
  ]
> = [
  ['business_name', 'Business name is required.'],
  ['address_line1', 'Address line 1 is required.'],
  ['city', 'City is required.'],
  ['country', 'Country is required.'],
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim profile fields and canonicalize the optional email address. */
export function normalizeInvoiceProfile(
  input: InvoiceProfileInput
): InvoiceProfileInput {
  return {
    business_name: input.business_name.trim(),
    legal_name: input.legal_name.trim(),
    address_line1: input.address_line1.trim(),
    address_line2: input.address_line2.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    postal_code: input.postal_code.trim(),
    country: input.country.trim(),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
  };
}

/** Return field-level errors matching the database-owned profile contract. */
export function validateInvoiceProfile(
  input: InvoiceProfileInput
): Record<string, string> {
  const profile = normalizeInvoiceProfile(input);
  const errors: Record<string, string> = {};

  for (const [field, message] of REQUIRED_FIELDS) {
    if (!profile[field]) errors[field] = message;
  }
  if (profile.email && !EMAIL_PATTERN.test(profile.email)) {
    errors.email = 'Enter a valid email address.';
  }

  return errors;
}
