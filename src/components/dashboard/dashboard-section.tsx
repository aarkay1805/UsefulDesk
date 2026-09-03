import type { ReactNode } from 'react';

/**
 * The layout every section that SHARES A ROW passes as `className`.
 *
 * `flex flex-col` + `flex-1` on the card is the long-standing way two peer
 * sections sit side by side at equal height. `max-h-[480px]` is the cap that
 * makes the pairing hold: a queue is bounded at 8 rows but a follow-up row
 * with a long note is twice the height of a lead row, so an uncapped pair
 * leaves one card short of its neighbour and pushes the next row of work off
 * the fold. The cap bounds the row; the overflow goes to a scroller INSIDE
 * the card, never to the page.
 */
export const DASHBOARD_PAIRED_SECTION = 'flex max-h-[480px] flex-col';

/**
 * The `ScrollArea` that takes that overflow. `min-h-0` is load-bearing — a
 * flex child defaults to `min-height:auto`, so without it the scroller grows
 * to fit every row and the card is clipped with no scrollbar at all (the same
 * trap documented on the inbox conversation list).
 */
export const DASHBOARD_QUEUE_SCROLLER = 'min-h-0 flex-1';

/**
 * The dashboard's one section heading. Every block on the page renders this,
 * so the page has exactly two heading levels: this one, and the queue
 * sub-labels inside a card. There is no grouping level above it — a wrapper
 * heading like "Work to do" only named the sections it already contained.
 *
 * min-h-6 reserves the height of a size="xs" link (h-6) whether or not the
 * section HAS one, so a section with a trailing action and one without leave
 * identical space before their content.
 */
export function DashboardSection({
  id,
  title,
  meta,
  action,
  className,
  children,
}: {
  /** Section slug; the heading gets `<id>-heading` and labels the section. */
  id: string;
  title: string;
  /** Optional node beside the title — a count, a total, a help trigger. */
  meta?: ReactNode;
  /** Optional trailing link, aligned to the section's right edge. */
  action?: ReactNode;
  /** External layout only — pass `DASHBOARD_PAIRED_SECTION` to share a row. */
  className?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className={className}>
      <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
        <h2
          id={headingId}
          className="text-foreground flex items-center gap-2 text-sm font-semibold"
        >
          {title}
          {meta && (
            <>
              {/* A flex container drops a whitespace-only text run, so this
                  space costs no layout — but it keeps the section's accessible
                  name from reading "Leads by stage1 total". */}{' '}
              {meta}
            </>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
