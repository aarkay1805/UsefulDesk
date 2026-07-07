// Per-account editable option lists for the lead attribute fields
// (status / source / gender) — migration 042 `lead_field_options`.
//
// An account with no rows for a field uses the built-in defaults below
// (the pre-042 code constants); the first save from the "Edit options"
// dialog materialises the full list. Keys are stable slugs stored on
// contacts rows; labels/colours are presentation and safe to rename.
// 'new' is a pseudo-status (NULL in contacts.lead_status) — never
// stored in the table and not editable.

import { LEAD_COLUMNS, type LeadColumn } from '@/lib/leads/status';
import { SOURCE_OPTIONS, GENDER_OPTIONS } from '@/lib/leads/attributes';

export type LeadFieldKind = 'status' | 'source' | 'gender';

/** One option row as stored in lead_field_options. */
export interface LeadFieldOption {
  key: string;
  label: string;
  /** Hex pill colour — statuses only; null/undefined for source/gender. */
  color?: string | null;
}

/** Slate — unknown/legacy keys render as a muted pill. */
export const UNKNOWN_STATUS_COLOR = '#64748b';

/** Built-in defaults, used when an account has no saved rows. */
export const DEFAULT_FIELD_OPTIONS: Record<LeadFieldKind, LeadFieldOption[]> = {
  // 'new' is the NULL bucket, not a real option — excluded here.
  status: LEAD_COLUMNS.filter((c) => c.key !== 'new').map((c) => ({
    key: c.key,
    label: c.label,
    color: c.color,
  })),
  source: SOURCE_OPTIONS.map((o) => ({ key: o.value, label: o.label })),
  gender: GENDER_OPTIONS.map((o) => ({ key: o.value, label: o.label })),
};

/**
 * The effective option list for a field: the account's saved rows
 * (already sorted by sort_order) or the defaults when none exist.
 */
export function resolveFieldOptions(
  kind: LeadFieldKind,
  rows: LeadFieldOption[] | null | undefined,
): LeadFieldOption[] {
  return rows && rows.length > 0 ? rows : DEFAULT_FIELD_OPTIONS[kind];
}

/**
 * Status options as board/table columns: the fixed "New" (NULL) bucket
 * first, then the account's statuses in order.
 */
export function statusColumns(statuses: LeadFieldOption[]): LeadColumn[] {
  const newColumn = LEAD_COLUMNS.find((c) => c.key === 'new')!;
  return [
    newColumn,
    ...statuses.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color || UNKNOWN_STATUS_COLOR,
    })),
  ];
}

/**
 * Presentation for a stored status key. Unknown keys (a status that
 * was deleted, or imported data) stay legible: humanised label, muted
 * colour — never a crash.
 */
export function statusColumn(
  columns: LeadColumn[],
  key: string | null | undefined,
): LeadColumn {
  const k = key ?? 'new';
  return (
    columns.find((c) => c.key === k) ?? {
      key: k,
      label: humaniseKey(k),
      color: UNKNOWN_STATUS_COLOR,
    }
  );
}

/** Label for a stored source/gender value, falling back to the raw value. */
export function optionLabel(
  options: LeadFieldOption[],
  value: string | null | undefined,
): string {
  if (!value) return '—';
  return options.find((o) => o.key === value)?.label ?? value;
}

/** "trial_booked" → "Trial booked" — display for keys with no row. */
export function humaniseKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * Slug for a new option's key: "Walk-in / Referral" → "walk_in_referral".
 * Uniqueness against existing keys is appended as a numeric suffix.
 */
export function slugifyOptionKey(label: string, existing: string[]): string {
  const base =
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'option';
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
