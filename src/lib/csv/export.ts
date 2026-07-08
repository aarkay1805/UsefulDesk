// Minimal client-side CSV export. Kept generic (headers + string rows) so
// call-sites own the display formatting — the same avatar/label resolvers
// the table uses produce the cell text. RFC-4180 quoting + a UTF-8 BOM so
// Excel opens Indian names / ₹ values without mojibake.

type Cell = string | number | null | undefined;

/** Quote a field only when it contains a comma, quote, or newline. */
function escapeCell(value: Cell): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CRLF-delimited CSV string from a header row + body rows. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\r\n');
}

/** Trigger a browser download of `content` as `filename`. Prepends a BOM
 *  so spreadsheet apps detect UTF-8. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿', content], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
