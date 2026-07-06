// Lead attribute option lists — the presets offered in the contact form
// and the Leads Filters panel for the free-text `source` and `gender`
// columns (migration 041). Free-text in the DB, curated here so the two
// surfaces stay in sync; gyms can still store other values via import.

export interface AttributeOption {
  value: string;
  label: string;
}

export const SOURCE_OPTIONS: AttributeOption[] = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'referral', label: 'Referral' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'google', label: 'Google' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other' },
];

export const GENDER_OPTIONS: AttributeOption[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'unspecified', label: 'Prefer not to say' },
];

const SOURCE_LABELS = new Map(SOURCE_OPTIONS.map((o) => [o.value, o.label]));
const GENDER_LABELS = new Map(GENDER_OPTIONS.map((o) => [o.value, o.label]));

/** Display label for a stored source value (falls back to the raw value). */
export function sourceLabel(value?: string | null): string {
  if (!value) return '—';
  return SOURCE_LABELS.get(value) ?? value;
}

/** Display label for a stored gender value (falls back to the raw value). */
export function genderLabel(value?: string | null): string {
  if (!value) return '—';
  return GENDER_LABELS.get(value) ?? value;
}
