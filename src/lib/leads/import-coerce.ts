// Pure lead-field coercion + detection for the Leads import wizard.
//
// The mapping engine (`field-mapping.ts`) stays dependency-free and hands
// back RAW cell text for the lead fields (status / source / gender /
// assignee); this module resolves those raws against the account's option
// lists and staff roster, powers the "Fix values" panel's value-level
// remapping, and detects a sensible field type when the user creates a
// custom field from a column. Everything here is pure and unit-tested —
// DB writes stay in the wizard component.

import {
  slugifyOptionKey,
  type LeadFieldOption,
} from '@/lib/leads/field-options';
import type { MappedRow } from '@/lib/contacts/field-mapping';
import { normalizeKey } from '@/lib/contacts/dedupe';

// ---- Option coercion ------------------------------------------------------

export interface CoercedOption {
  /** Option key to store (a known key, or a slug for unknown values). */
  key: string;
  /** False when the raw value matched no option — drives the amber flag. */
  matched: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();
/** Lowercased alphanumerics only — "Walk-in" and "walk in" compare equal. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve a raw CSV cell against an option list.
 * Tiers: exact key → case-insensitive key/label → single-letter initial
 * (gyms export gender as M/F) → unmatched slug (`matched: false`).
 * Storing a slug is safe: source/gender are free-text columns and the
 * render layer humanises unknown keys into muted pills.
 */
export function coerceOptionValue(
  raw: string,
  options: LeadFieldOption[],
): CoercedOption {
  const value = raw.trim();
  const lower = norm(value);

  for (const o of options) {
    if (o.key === value) return { key: o.key, matched: true };
  }
  for (const o of options) {
    if (norm(o.key) === lower || norm(o.label) === lower) {
      return { key: o.key, matched: true };
    }
  }
  // Single-letter shorthand ("M"/"F") → the one option whose label starts
  // with it. Only when unambiguous.
  if (lower.length === 1) {
    const hits = options.filter((o) => norm(o.label).startsWith(lower));
    if (hits.length === 1) return { key: hits[0].key, matched: true };
  }

  return {
    key: slugifyOptionKey(value, options.map((o) => o.key)),
    matched: false,
  };
}

/**
 * Best-guess match for the Fix-values panel's "Auto-match" action —
 * looser than `coerceOptionValue` (containment either way on squashed
 * text, e.g. "insta" → Instagram), so it never runs silently: the user
 * triggers it and sees the result per value. Returns null when unsure.
 */
export function fuzzyMatchOption(
  raw: string,
  options: LeadFieldOption[],
): string | null {
  const q = squash(raw);
  if (q.length < 3) return null;
  const hits = options.filter((o) => {
    const label = squash(o.label);
    const key = squash(o.key);
    return (
      label.startsWith(q) ||
      key.startsWith(q) ||
      q.startsWith(label) ||
      q.startsWith(key)
    );
  });
  return hits.length === 1 ? hits[0].key : null;
}

// ---- Assignee coercion ----------------------------------------------------

export interface StaffRef {
  user_id: string;
  full_name: string;
}

/**
 * Resolve an "Assigned to" cell against the staff roster by name.
 * Exact (case-insensitive) full-name match, then an unambiguous
 * prefix/first-name match. Never creates a user; null falls back to
 * importer-as-owner at commit.
 */
export function coerceAssignee(raw: string, staff: StaffRef[]): string | null {
  const q = norm(raw);
  if (!q) return null;

  const exact = staff.find((s) => norm(s.full_name) === q);
  if (exact) return exact.user_id;

  const prefix = staff.filter(
    (s) =>
      norm(s.full_name).startsWith(q) ||
      norm(s.full_name).split(/\s+/)[0] === q,
  );
  return prefix.length === 1 ? prefix[0].user_id : null;
}

// ---- Field-type detection (inline "create field") -------------------------

/** `dd/mm/yyyy`-style triplet (also `-` and `.` separators, 2-digit years). */
const DAY_FIRST_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;
/** ISO date, optionally with a time part. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;
/** "12 Jun 2026" / "Jun 12, 2026" — month-name dates. */
const MONTH_NAME_RE =
  /^(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+\d{1,2}?,?\s*\d{2,4}$/i;

function isDateLike(value: string): boolean {
  return (
    DAY_FIRST_RE.test(value) ||
    ISO_DATE_RE.test(value) ||
    MONTH_NAME_RE.test(value)
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = /^[-+]?[\d\s,]*\d(?:\.\d+)?$/;

function isUrlLike(value: string): boolean {
  if (/\s/.test(value)) return false;
  return /^(https?:\/\/|www\.)/i.test(value);
}

export interface DetectedField {
  /** Suggested field name — the header, title-cased. */
  label: string;
  /** One of CUSTOM_FIELD_TYPES' values (text/number/date/email/phone/url). */
  type: 'text' | 'number' | 'date' | 'email' | 'phone' | 'url';
}

const PHONE_HEADER_HINT = /phone|mobile|whatsapp|contact\s*no|cell/i;

/**
 * Suggest a label + data type for a new custom field by scanning the
 * column's sample values — HubSpot's "scanning column data" pattern with
 * plain heuristics instead of AI. Thresholds are deliberately strict so
 * a mixed column falls back to text rather than mis-typing.
 */
export function detectFieldType(
  header: string,
  samples: string[],
): DetectedField {
  const label = titleCase(header.trim()) || 'New field';
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return { label, type: 'text' };

  const share = (pred: (v: string) => boolean) =>
    values.filter(pred).length / values.length;

  if (share(isDateLike) >= 0.8) return { label, type: 'date' };
  if (share((v) => EMAIL_RE.test(v.toLowerCase())) >= 0.9)
    return { label, type: 'email' };
  if (share(isUrlLike) >= 0.9) return { label, type: 'url' };
  // Digits could be a phone or a plain number — only the header can say.
  if (
    PHONE_HEADER_HINT.test(header) &&
    share((v) => v.replace(/\D/g, '').length >= 7) >= 0.9
  ) {
    return { label, type: 'phone' };
  }
  if (share((v) => NUMBER_RE.test(v.replace(/\s/g, ''))) >= 0.9)
    return { label, type: 'number' };

  return { label, type: 'text' };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s/_-])(\p{L})/gu, (m) => m.toUpperCase())
    .trim();
}

// ---- Date-order detection (DD/MM vs MM/DD) --------------------------------

export type DateOrder = 'DMY' | 'MDY';

/**
 * Infer day/month order from slash-date samples. A first part > 12 can
 * only be a day (→ DMY); a second part > 12 can only be a month-first
 * date (→ MDY). Conflicting or no evidence → 'ambiguous' (the wizard
 * shows the DD/MM chip and defaults to DMY — India-first).
 */
export function detectDateOrder(samples: string[]): DateOrder | 'ambiguous' {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    const m = s.trim().match(DAY_FIRST_RE);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (dmy > 0 && mdy === 0) return 'DMY';
  if (mdy > 0 && dmy === 0) return 'MDY';
  return 'ambiguous';
}

// ---- Preview rows ---------------------------------------------------------

export type UnmatchedField = 'status' | 'source' | 'gender' | 'assignee';

/**
 * One import row after lead-field coercion — the editable unit of the
 * Preview step. `base` keeps the raw cell text (the Fix-values panel
 * groups by it); the top-level fields hold the resolved values that the
 * commit consumes. Skipped rows (no phone / in-file dupes) never reach
 * this shape — they are counted upstream and reported as chips.
 */
export interface PreviewRow {
  base: MappedRow;
  /** Resolved status key — 'new' means the NULL bucket. Null = not mapped. */
  leadStatus: string | null;
  source: string | null;
  gender: string | null;
  /** Resolved staff user_id (null = unassigned → importer at commit). */
  assignedTo: string | null;
  /**
   * A not-yet-joined teammate (pending invite) this lead is parked on.
   * Mutually exclusive with a real `assignedTo`: when set, `assignedTo`
   * stays null (→ importer is the fallback owner at commit) and the lead
   * renders "Invite pending · <pendingAssigneeName>". Resolved when the
   * invitee redeems (see migration 049's redeem_invitation).
   */
  pendingInvitationId: string | null;
  pendingAssigneeName: string | null;
  /** Phone already exists in the account (→ "Update" flag in the grid). */
  exists: boolean;
  unmatched: Set<UnmatchedField>;
}

/** Sentinel key for `applyValueFix('assignee', …)` meaning "resolve to a
 *  pending invite": `pending:${invitationId}`. */
export const PENDING_ASSIGNEE_PREFIX = 'pending:';

export interface BuildPreviewArgs {
  /** Post-dedupe rows from `applyMapping` + `dedupeByPhone`. */
  rows: MappedRow[];
  /** Status options INCLUDING the fixed 'new' bucket (statusColumns). */
  statusOptions: LeadFieldOption[];
  sourceOptions: LeadFieldOption[];
  genderOptions: LeadFieldOption[];
  staff: StaffRef[];
  /** Normalized phones already in the account (phone_normalized values). */
  existingKeys: Set<string>;
}

/** Coerce every row's lead fields; flag the ones that matched nothing. */
export function buildPreviewRows(args: BuildPreviewArgs): PreviewRow[] {
  return args.rows.map((base) => {
    const unmatched = new Set<UnmatchedField>();

    const option = (
      raw: string | undefined,
      options: LeadFieldOption[],
      field: UnmatchedField,
    ): string | null => {
      if (!raw || !raw.trim()) return null;
      const { key, matched } = coerceOptionValue(raw, options);
      if (!matched) unmatched.add(field);
      return key;
    };

    let assignedTo: string | null = null;
    if (base.assignedTo && base.assignedTo.trim()) {
      assignedTo = coerceAssignee(base.assignedTo, args.staff);
      if (!assignedTo) unmatched.add('assignee');
    }

    return {
      base,
      leadStatus: option(base.leadStatus, args.statusOptions, 'status'),
      source: option(base.source, args.sourceOptions, 'source'),
      gender: option(base.gender, args.genderOptions, 'gender'),
      assignedTo,
      pendingInvitationId: null,
      pendingAssigneeName: null,
      exists: args.existingKeys.has(normalizeKey(base.phone)),
      unmatched,
    };
  });
}

// ---- Value-level remapping (the Fix-values panel) --------------------------

export type OptionField = 'status' | 'source' | 'gender';
/** Every field the Fix-values panel can resolve — option lists + assignee. */
export type FixableField = OptionField | 'assignee';

const FIXABLE_FIELDS: FixableField[] = ['status', 'source', 'gender', 'assignee'];

export interface UnmatchedValue {
  field: FixableField;
  /** The raw cell text, as grouped-by. */
  raw: string;
  /** How many rows carry it. */
  count: number;
}

const RAW_OF: Record<FixableField, (r: PreviewRow) => string | undefined> = {
  status: (r) => r.base.leadStatus,
  source: (r) => r.base.source,
  gender: (r) => r.base.gender,
  assignee: (r) => r.base.assignedTo,
};

/** Distinct still-unmatched values per field, with row counts. */
export function unmatchedValues(rows: PreviewRow[]): UnmatchedValue[] {
  const counts = new Map<string, UnmatchedValue>();
  for (const row of rows) {
    for (const field of FIXABLE_FIELDS) {
      if (!row.unmatched.has(field)) continue;
      const raw = (RAW_OF[field](row) ?? '').trim();
      if (!raw) continue;
      const key = `${field} ${raw.toLowerCase()}`;
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { field, raw, count: 1 });
    }
  }
  return [...counts.values()];
}

/**
 * Apply one value-level fix: every row whose raw `field` cell equals
 * `raw` (case-insensitive) resolves to `key` and drops its flag.
 * Returns new row objects (state-safe); untouched rows pass through.
 * For `assignee`, `key` is a staff user_id (or '' → fall back to the
 * importer as owner at commit).
 */
export function applyValueFix(
  rows: PreviewRow[],
  field: FixableField,
  raw: string,
  key: string,
): PreviewRow[] {
  const target = raw.trim().toLowerCase();
  return rows.map((row) => {
    if (!row.unmatched.has(field)) return row;
    const rowRaw = (RAW_OF[field](row) ?? '').trim().toLowerCase();
    if (rowRaw !== target) return row;
    const unmatched = new Set(row.unmatched);
    unmatched.delete(field);
    return {
      ...row,
      unmatched,
      ...(field === 'status' ? { leadStatus: key } : {}),
      ...(field === 'source' ? { source: key } : {}),
      ...(field === 'gender' ? { gender: key } : {}),
      ...(field === 'assignee' ? assigneePatch(key, raw) : {}),
    };
  });
}

/**
 * Assignee resolution patch. A `pending:${id}` key parks the lead on a
 * not-yet-joined teammate (real `assignedTo` stays null → importer is the
 * fallback owner); any other key is a real staff user_id (or '' = importer),
 * which also clears any prior pending overlay.
 */
function assigneePatch(key: string, raw: string): Partial<PreviewRow> {
  if (key.startsWith(PENDING_ASSIGNEE_PREFIX)) {
    return {
      assignedTo: null,
      pendingInvitationId: key.slice(PENDING_ASSIGNEE_PREFIX.length),
      pendingAssigneeName: raw.trim() || null,
    };
  }
  return {
    assignedTo: key || null,
    pendingInvitationId: null,
    pendingAssigneeName: null,
  };
}
