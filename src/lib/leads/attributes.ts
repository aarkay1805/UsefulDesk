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

// Why a fixed list and not a `contacts.goal` column: the goal answer is
// stored as a TAG (resolved through the normal tag path), so it is
// already filterable on /leads and rendered on the lead card without a
// new column, a widened lead_field_options CHECK, or an edit to the
// column registry / filters / cell renderers / contact + member forms /
// import wizard. Keeping the list closed keeps the blast radius at
// seven tags, ever. Promote it to a real column only when a gym asks to
// filter and report on it as a first-class dimension.
export const GOAL_OPTIONS: AttributeOption[] = [
  { value: 'weight_loss', label: 'Weight loss' },
  { value: 'muscle_gain', label: 'Muscle gain' },
  { value: 'general_fitness', label: 'General fitness' },
  { value: 'strength', label: 'Strength & conditioning' },
  { value: 'sports', label: 'Sports training' },
  { value: 'rehab', label: 'Rehab / recovery' },
  { value: 'other', label: 'Other' },
];

const SOURCE_LABELS = new Map(SOURCE_OPTIONS.map((o) => [o.value, o.label]));
const GENDER_LABELS = new Map(GENDER_OPTIONS.map((o) => [o.value, o.label]));
const GOAL_LABELS = new Map(GOAL_OPTIONS.map((o) => [o.value, o.label]));

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

/** Display label for a capture-form goal. Returns null for an unknown or
 *  absent value — callers tag the lead only when this resolves, so a
 *  hand-crafted payload can't mint arbitrary tags. */
export function goalLabel(value?: string | null): string | null {
  if (!value) return null;
  return GOAL_LABELS.get(value) ?? null;
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
  form: 'Form',
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
