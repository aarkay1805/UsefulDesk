// Lead attribute option lists — the presets offered in the contact form
// and the Leads Filters panel for the free-text `source` and `gender`
// columns (migration 041). Free-text in the DB, curated here so the two
// surfaces stay in sync; gyms can still store other values via import.

import type { ReceivedVia } from '@/types';

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

// ---- Received-via (lead origin, migration 048) --------------------------

// Human-driven origins render the creating teammate in the "Received By"
// column; every other value renders an "Auto · <channel>" pill. NULL is
// treated as human (see the migration note).
const HUMAN_ORIGINS = new Set<ReceivedVia>(['manual', 'import']);

const AUTO_CHANNEL_LABELS: Record<ReceivedVia, string> = {
  manual: '',
  import: '',
  whatsapp: 'WhatsApp',
  meta: 'Meta',
  api: 'API',
  automation: 'Automation',
};

/** Whether a lead's origin was a human action (→ show the creator) rather
 *  than an automated capture. NULL/unknown counts as human. */
export function isHumanReceived(value?: ReceivedVia | null): boolean {
  return !value || HUMAN_ORIGINS.has(value);
}

/** Pill label for an automated origin, e.g. "Auto · WhatsApp". Returns
 *  null for human origins (the column shows the creator instead). */
export function autoReceivedLabel(value?: ReceivedVia | null): string | null {
  if (isHumanReceived(value)) return null;
  const channel = AUTO_CHANNEL_LABELS[value as ReceivedVia];
  return channel ? `Auto · ${channel}` : 'Auto';
}
