// Pure engine for the members CSV import (Upload → Map → Confirm).
// Parsing reuses lib/contacts/field-mapping's parseCsvRaw; this module
// owns the member-specific column targets, date parsing (India-first
// DMY), plan resolution, and row → membership-payload building — all
// side-effect free so the commit maths is unit-testable. DB writes stay
// in the dialog (find-or-create contact, per-row membership insert).

import { normalizeKey } from "@/lib/contacts/dedupe";
import { istAddDays } from "@/lib/memberships/expiry";
import type { DateOrder } from "@/lib/leads/import-coerce";
import type { MembershipPlan } from "@/types";

export const MEMBER_IGNORE_KEY = "__ignore__";

/** The columns a members CSV can map to. Phone is the row identity;
 *  plan (or an explicit end date) drives the membership period. */
export interface MemberTarget {
  key: string;
  label: string;
  synonyms: string[];
}

export const MEMBER_TARGETS: MemberTarget[] = [
  {
    key: "phone",
    label: "Phone",
    synonyms: ["phone", "mobile", "whatsapp", "phone number", "mobile number", "contact", "contact no", "contact number"],
  },
  { key: "name", label: "Name", synonyms: ["name", "full name", "member", "member name", "customer", "customer name"] },
  { key: "email", label: "Email", synonyms: ["email", "e-mail", "email address", "mail"] },
  { key: "plan", label: "Plan", synonyms: ["plan", "membership", "membership plan", "package", "plan name", "scheme"] },
  {
    key: "start_date",
    label: "Start date",
    synonyms: ["start", "start date", "joined", "join date", "joining date", "from", "started"],
  },
  {
    key: "end_date",
    label: "Expiry date",
    synonyms: ["end", "end date", "expiry", "expiry date", "expires", "expiration", "valid till", "valid until", "to", "renewal date"],
  },
  { key: "fee_amount", label: "Fee", synonyms: ["fee", "fees", "amount", "price", "fee amount", "monthly fee"] },
  {
    key: "fee_status",
    label: "Fee status",
    synonyms: ["fee status", "payment status", "paid", "paid status", "status"],
  },
];

/** Guess a member target per header (first match wins, one column per
 *  target) — the members sibling of field-mapping's autoMapColumns. */
export function autoMapMemberColumns(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((header) => {
    const norm = header.trim().toLowerCase();
    if (!norm) return MEMBER_IGNORE_KEY;
    for (const target of MEMBER_TARGETS) {
      if (used.has(target.key)) continue;
      if (target.synonyms.includes(norm)) {
        used.add(target.key);
        return target.key;
      }
    }
    return MEMBER_IGNORE_KEY;
  });
}

/** One CSV row mapped to raw member fields (all strings, untrimmed cells ok). */
export interface MemberImportRow {
  phone: string;
  name: string;
  email: string;
  planName: string;
  startDate: string;
  endDate: string;
  fee: string;
  feeStatus: string;
}

export interface MemberMappingResult {
  rows: MemberImportRow[];
  /** Rows dropped for an empty phone cell. */
  skippedNoPhone: number;
  /** Rows dropped as in-file duplicates (same normalized phone). */
  skippedDuplicate: number;
}

/** Apply a mapping (aligned to headers) to raw rows: pick cells into
 *  MemberImportRow, drop phoneless rows, dedupe in-file by phone. */
export function applyMemberMapping(
  rows: string[][],
  mapping: string[]
): MemberMappingResult {
  const col = (key: string) => mapping.indexOf(key);
  const idx = {
    phone: col("phone"),
    name: col("name"),
    email: col("email"),
    plan: col("plan"),
    start: col("start_date"),
    end: col("end_date"),
    fee: col("fee_amount"),
    feeStatus: col("fee_status"),
  };
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const seen = new Set<string>();
  const out: MemberImportRow[] = [];
  let skippedNoPhone = 0;
  let skippedDuplicate = 0;

  for (const row of rows) {
    const phone = cell(row, idx.phone);
    if (!phone) {
      skippedNoPhone++;
      continue;
    }
    const key = normalizeKey(phone);
    if (seen.has(key)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(key);
    out.push({
      phone,
      name: cell(row, idx.name),
      email: cell(row, idx.email),
      planName: cell(row, idx.plan),
      startDate: cell(row, idx.start),
      endDate: cell(row, idx.end),
      fee: cell(row, idx.fee),
      feeStatus: cell(row, idx.feeStatus),
    });
  }

  return { rows: out, skippedNoPhone, skippedDuplicate };
}

/**
 * Parse an imported date cell to `YYYY-MM-DD`, or null when unparseable.
 * Accepts ISO (already day-exact) and slash/dash/dot D/M/Y-style dates,
 * ordered per `order` (India-first default is DMY). Pure string maths —
 * never `new Date(str)`, which would shift the day by timezone.
 */
export function parseImportDate(
  value: string,
  order: DateOrder = "DMY"
): string | null {
  const v = value.trim();
  if (!v) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(v);
  if (!parts) return null;
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  let year = Number(parts[3]);
  if (year < 100) year += 2000;

  // A first part > 12 can only be a day regardless of the declared order.
  const dayFirst = order === "DMY" || a > 12;
  const day = dayFirst ? a : b;
  const month = dayFirst ? b : a;
  return ymd(year, month, day);
}

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Case-insensitive plan lookup by name. */
export function resolvePlan(
  planName: string,
  plans: MembershipPlan[]
): MembershipPlan | null {
  const norm = planName.trim().toLowerCase();
  if (!norm) return null;
  return plans.find((p) => p.name.trim().toLowerCase() === norm) ?? null;
}

/** Normalize a fee-status cell: paid-ish words → 'paid', else 'due'. */
export function parseFeeStatus(value: string): "paid" | "due" {
  return /^(paid|yes|done|cleared|complete|completed|y|true)$/i.test(value.trim())
    ? "paid"
    : "due";
}

/** The memberships-insert payload a valid row builds (sans ids). */
export interface BuiltMembership {
  plan_id: string;
  start_date: string;
  end_date: string;
  fee_amount: number;
  fee_status: "paid" | "due";
}

export type MemberRowError = "unknown-plan" | "bad-date" | "bad-fee";

/**
 * Build the membership payload for one mapped row. Defaults: start =
 * today (IST), end = start + plan duration when no explicit expiry, fee
 * = plan price, fee_status = 'due'. Returns errors instead of throwing
 * so the confirm step can tally skips per reason.
 */
export function buildMembershipRow(
  row: MemberImportRow,
  plans: MembershipPlan[],
  order: DateOrder,
  today: string
): { membership: BuiltMembership | null; errors: MemberRowError[] } {
  const errors: MemberRowError[] = [];

  const plan = resolvePlan(row.planName, plans);
  if (!plan) errors.push("unknown-plan");

  const start = row.startDate ? parseImportDate(row.startDate, order) : today;
  const endExplicit = row.endDate ? parseImportDate(row.endDate, order) : null;
  if ((row.startDate && !start) || (row.endDate && !endExplicit)) {
    errors.push("bad-date");
  }

  let fee: number | null = null;
  if (row.fee) {
    const parsed = Number(row.fee.replace(/[₹,\s]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) fee = parsed;
    else errors.push("bad-fee");
  }

  if (errors.length > 0 || !plan || !start) {
    return { membership: null, errors };
  }

  return {
    membership: {
      plan_id: plan.id,
      start_date: start,
      end_date: endExplicit ?? istAddDays(start, plan.duration_days),
      fee_amount: fee ?? Number(plan.price),
      fee_status: parseFeeStatus(row.feeStatus),
    },
    errors,
  };
}

/** The sample CSV offered on the upload step. */
export const MEMBER_TEMPLATE_CSV = [
  "Name,Phone,Email,Plan,Start date,Expiry date,Fee,Fee status",
  "Asha Rao,+91 98765 43210,asha@example.com,Monthly,01/07/2026,,1500,paid",
  "Vikram Shah,+91 91234 56780,,Quarterly,15/06/2026,14/09/2026,4000,due",
].join("\n");
