// Shared display formatting for dates. One formatter for both plain
// `YYYY-MM-DD` columns (membership start/end, follow-up due dates) and full
// ISO timestamps (created_at) so Members and Leads read identically.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "Jul 11, 2026" from a plain `YYYY-MM-DD` or a full ISO timestamp.
 *
 * Plain dates are formatted from their parts — NEVER via `new Date(str)`,
 * which parses them as UTC midnight and shifts the day for viewers west of
 * UTC (an IST-first product must not show a member expiring a day off).
 * Timestamps carry a timezone, so locale formatting is safe for those.
 */
export function formatDay(value: string): string {
  const m = PLAIN_DATE.exec(value);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
