'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { Filter } from 'lucide-react';
import { useLocale } from '@/hooks/use-locale';
import type { LeadFunnelData, LeadFunnelStage } from '@/lib/dashboard/types';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DashboardSection } from './dashboard-section';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface LeadFunnelProps {
  /**
   * Section id, so the preview harness can render several funnels without
   * colliding on one heading id.
   */
  sectionId?: string;
  data: LeadFunnelData | null;
  loading: boolean;
}

/**
 * ONE grid owns the caption row and every stage row, so the column headings
 * sit exactly over the numbers they label instead of being eyeballed into
 * place. The list and its rows re-enter that grid through `subgrid` rather
 * than repeating the template: a per-row grid would resolve `fit-content`
 * against that row's own label, and the counts would step in and out by a
 * few pixels down the column.
 *
 * The label track is `fit-content`, not a fixed width: an account whose
 * statuses are all short ("New", "Lost") spends nothing on a column sized for
 * a long one, and a long custom status ("Waiting on payment link") gets the
 * room it needs up to the cap before it truncates. A fixed 5rem track
 * truncated that label on every viewport.
 *
 * The bar sits LAST, after the numbers, so every row's text stays one cluster.
 * With the bar in the middle, an empty stage had its label at the left edge
 * and its "0" at the right with a quarter of the card between them and
 * nothing to bridge it. Below `sm` the bar is dropped entirely — in a phone's
 * remaining ~50px it was a stub, and the label then takes the free space so
 * the counts stay on the card's right edge where a list row expects them.
 */
const STAGE_GRID =
  'grid grid-cols-[minmax(0,1fr)_2.5rem_4rem] content-start items-center gap-x-3 gap-y-2 sm:grid-cols-[fit-content(13rem)_3rem_4.5rem_minmax(0,1fr)]';
/** Same template minus the age column, for accounts with no stage ages yet. */
const STAGE_GRID_NO_AGE =
  'grid grid-cols-[minmax(0,1fr)_2.5rem] content-start items-center gap-x-3 gap-y-2 sm:grid-cols-[fit-content(13rem)_3rem_minmax(0,1fr)]';
/** Every row re-enters the parent template instead of restating it. */
const STAGE_ROW = 'col-span-full grid grid-cols-subgrid items-center';
const SOURCE_GRID =
  'grid grid-cols-[minmax(0,1fr)_5rem_3rem] items-center gap-x-3 text-sm';

/** "4 days" / "1 day" / "<1 day" — never the raw "1 days" or "3.4". */
function stageAge(stage: LeadFunnelStage): string {
  if (stage.count === 0 || stage.avgDays == null) return '';
  if (stage.avgDays < 1) return '<1 day';
  const days = Math.round(stage.avgDays);
  return days === 1 ? '1 day' : `${days} days`;
}

// Lead funnel — the PRD's reporting layer, kept to the numbers an
// owner acts on: how many leads sit in each status (and for how
// long), how many converted this month, and which sources actually
// produce members (not just form fills).
export function LeadFunnel({
  data,
  loading,
  sectionId = 'leads-by-stage',
}: LeadFunnelProps) {
  const { fmt } = useLocale();
  const maxCount = data ? Math.max(1, ...data.stages.map((s) => s.count)) : 1;
  const conversionBase = data ? data.totalLeads + data.convertedTotal : 0;
  // A fresh account has an age on no stage at all, and a column of blanks
  // under a heading reads as missing data rather than as "nothing here yet".
  // Drop the column until at least one stage can fill it.
  const showAge = Boolean(
    data?.stages.some((s) => s.count > 0 && s.avgDays != null)
  );
  const stageGrid = showAge ? STAGE_GRID : STAGE_GRID_NO_AGE;

  return (
    <DashboardSection
      id={sectionId}
      title="Leads by stage"
      // The lead total moved here from the retired status ring, which was the
      // only thing that view carried beyond these bars. "total" rather than a
      // bare numeral: on its own the number read as a stage count.
      meta={
        data && data.totalLeads > 0 ? (
          <span className="text-muted-foreground text-xs font-normal">
            <span className="tabular-nums">{fmt.number(data.totalLeads)}</span>{' '}
            total
          </span>
        ) : null
      }
      action={
        <Link
          data-slot="button"
          href="/leads"
          className={buttonVariants({ variant: 'link', size: 'xs' })}
        >
          See all leads
        </Link>
      }
    >
      {/* No CardHeader: this card has no controls, so a header would hold
          nothing but a repeat of the section title. */}
      <Card>
        {loading || !data ? (
          <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
            <Separator className="lg:hidden" />
            <Separator orientation="vertical" className="hidden lg:block" />
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-x-6">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </div>
          </CardContent>
        ) : data.totalLeads === 0 && data.convertedThisMonth === 0 ? (
          <CardContent>
            <EmptyState
              icon={Filter}
              title="No leads yet"
              hint="Add or import leads to see stage and conversion numbers here."
            />
          </CardContent>
        ) : (
          /* Two regions, not two equal columns: where leads sit, then what
             converts. A rule carries that split so the numbers on each side
             no longer need a box each to stay apart. */
          <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            {/* Stage bars */}
            <div className={stageGrid}>
              {/* The only caption left. "Stage" restated the section
                  heading and "Leads" restated a column of bold counts inside
                  a card named for them; "13 days" is the one value that does
                  not say what it measures. When no stage can fill it the row
                  has nothing to say and is not rendered at all. */}
              {showAge && (
                <>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span className="text-muted-foreground text-right text-xs">
                    Avg. time
                  </span>
                  <span className="hidden sm:block" aria-hidden="true" />
                </>
              )}
              <ul className={`${STAGE_ROW} gap-y-2`}>
                {data.stages.map((s) => (
                  <li key={s.key} className={STAGE_ROW}>
                    <span
                      className={`truncate text-sm ${
                        s.count > 0
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                      title={s.label}
                    >
                      {s.label}
                    </span>
                    <span
                      className={`text-right text-sm tabular-nums ${
                        s.count > 0
                          ? 'text-foreground font-medium'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {fmt.number(s.count)}
                    </span>
                    {showAge && (
                      <span className="text-muted-foreground text-right text-xs whitespace-nowrap tabular-nums">
                        {stageAge(s)}
                      </span>
                    )}
                    {/* Decorative: the count beside it carries the number.
                        An empty stage draws nothing — six identical grey
                        tracks with two bars on them made the zeros as loud
                        as the data. The shared left origin is the scale, and
                        the cap keeps a full bar a chart mark rather than a
                        slab running the width of the card. */}
                    <div
                      className="hidden max-w-72 min-w-0 sm:block"
                      aria-hidden="true"
                    >
                      {s.count > 0 && (
                        <div
                          className="h-2.5 rounded-full"
                          style={{
                            width: `${(s.count / maxCount) * 100}%`,
                            // A px floor, not a percentage one: 3% of a
                            // narrow phone column was a 6px speck.
                            minWidth: '0.625rem',
                            backgroundColor: s.color,
                          }}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <Separator className="lg:hidden" />
            <Separator orientation="vertical" className="hidden lg:block" />

            {/* Conversion stats + source performance */}
            <div className="space-y-5">
              {/* No boxes: two label/number stacks side by side read as a
                  pair on their own, and a bordered tile inside a bordered
                  card was one container too many. */}
              <div className="grid grid-cols-2 gap-x-6">
                <div>
                  <p className="text-muted-foreground text-xs">
                    Joined this month
                  </p>
                  <p className="text-foreground mt-1 text-xl leading-none font-semibold tabular-nums">
                    {fmt.number(data.convertedThisMonth)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    Leads who joined
                  </p>
                  <p className="text-foreground mt-1 text-xl leading-none font-semibold tabular-nums">
                    {data.conversionRate == null
                      ? '—'
                      : `${Math.round(data.conversionRate * 100)}%`}
                  </p>
                  {/* A percentage off three contacts is noise without its base. */}
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    {conversionBase === 0 ? (
                      'all time'
                    ) : (
                      <>
                        <span className="tabular-nums">
                          {fmt.number(data.convertedTotal)}
                        </span>{' '}
                        of{' '}
                        <span className="tabular-nums">
                          {fmt.number(conversionBase)}
                        </span>{' '}
                        all time
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-foreground mb-2 text-sm font-medium">
                  Joined by source
                </p>
                {data.topSources.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No sources recorded yet.
                  </p>
                ) : (
                  /* No caption row: "Source" restated the heading above it,
                     and under "Joined by source" a row reading "22 of 32"
                     then "69%" needs no legend to say which is which. */
                  <ul className="space-y-2">
                    {data.topSources.map((s) => (
                      <li key={s.key} className={SOURCE_GRID}>
                        <span
                          className="text-foreground min-w-0 truncate"
                          title={s.label}
                        >
                          {s.label}
                        </span>
                        <span className="text-muted-foreground text-right whitespace-nowrap tabular-nums">
                          {fmt.number(s.members)} of{' '}
                          {fmt.number(s.members + s.leads)}
                        </span>
                        <span className="text-foreground text-right font-medium tabular-nums">
                          {s.rate == null
                            ? '—'
                            : `${Math.round(s.rate * 100)}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </DashboardSection>
  );
}
