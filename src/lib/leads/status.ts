import type { LeadStatus } from '@/types';

// ------------------------------------------------------------
// Lead status metadata — single source of truth for the Leads
// board columns, the table's status chip, the contact form's
// status select, and the dashboard donut. Column order here IS
// the board's left-to-right order.
//
// 'new' is not a stored status: contacts.lead_status is NULL
// until someone assesses the lead, and the board renders that
// bucket as the "New" column. `leadColumnKey` / `columnToStatus`
// convert between the two representations.
// ------------------------------------------------------------

export type LeadColumnKey = LeadStatus | 'new';

export interface LeadColumn {
  key: LeadColumnKey;
  label: string;
  color: string;
}

export const LEAD_COLUMNS: LeadColumn[] = [
  { key: 'new', label: 'New', color: '#3b82f6' }, // blue — captured, not contacted
  { key: 'contacted', label: 'Contacted', color: '#eab308' }, // yellow — reached, awaiting reply
  { key: 'interested', label: 'Interested', color: '#f97316' }, // orange — replied, wants to join
  { key: 'trial_booked', label: 'Trial Booked', color: '#22c55e' }, // green — visit/trial scheduled
  { key: 'lost', label: 'Lost', color: '#64748b' }, // slate — not converting / cold
];

export const LEAD_COLUMN_BY_KEY: Record<LeadColumnKey, LeadColumn> =
  Object.fromEntries(LEAD_COLUMNS.map((c) => [c.key, c])) as Record<
    LeadColumnKey,
    LeadColumn
  >;

/** Board column a contact belongs to (NULL status → the "New" column). */
export function leadColumnKey(status: LeadStatus | null | undefined): LeadColumnKey {
  return status ?? 'new';
}

/** Stored value for a board column ("new" → NULL). */
export function columnToStatus(key: LeadColumnKey): LeadStatus | null {
  return key === 'new' ? null : key;
}
