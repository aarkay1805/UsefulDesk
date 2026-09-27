'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Filter } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Skeleton } from '@/components/dashboard/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import {
  loadEnquiryStages,
  type EnquiryStage,
} from '@/lib/reports/enquiry-stages';
import { createClient } from '@/lib/supabase/client';

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
 * room it needs up to the cap before it truncates.
 *
 * The age track is sized for its longest value, "Under 1 day", so the phrase
 * never spills past the card edge on a phone.
 *
 * The bar sits LAST, after the numbers, so every row's text stays one cluster.
 * Below `sm` the bar is dropped entirely — in a phone's remaining ~50px it was
 * a stub, and the label then takes the free space so the counts stay on the
 * card's right edge where a list row expects them.
 */
const STAGE_GRID =
  'grid grid-cols-[minmax(0,1fr)_2.5rem_5.5rem] content-start items-center gap-x-3 gap-y-2 sm:grid-cols-[fit-content(13rem)_3rem_5.5rem_minmax(0,1fr)]';
/** Same template minus the age column, for accounts with no stage ages yet. */
const STAGE_GRID_NO_AGE =
  'grid grid-cols-[minmax(0,1fr)_2.5rem] content-start items-center gap-x-3 gap-y-2 sm:grid-cols-[fit-content(13rem)_3rem_minmax(0,1fr)]';
/** Every row re-enters the parent template instead of restating it. */
const STAGE_ROW = 'col-span-full grid grid-cols-subgrid items-center';

/** "4 days" / "1 day" / "Under 1 day" — never the raw "1 days" or "3.4". */
function stageAge(stage: EnquiryStage): string {
  if (stage.count === 0 || stage.avgDays == null) return '';
  if (stage.avgDays < 1) return 'Under 1 day';
  const days = Math.round(stage.avgDays);
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Stage counts are the state of the enquiry list today. The page's month and
 * staff choices do not apply to them, which the description says in words.
 */
export function EnquiryStagesCard() {
  const { accountId } = useAuth();
  const [loaded, setLoaded] = useState<{
    accountId: string;
    stages: EnquiryStage[] | null;
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      try {
        const stages = await loadEnquiryStages(createClient());
        if (!cancelled) setLoaded({ accountId, stages });
      } catch (error) {
        console.error('[performance] enquiry stages failed:', error);
        if (!cancelled) setLoaded({ accountId, stages: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // A result for a branch the reader has since left is not this branch's.
  const current = loaded && loaded.accountId === accountId ? loaded : null;
  return (
    <EnquiryStagesCardView stages={current ? current.stages : undefined} />
  );
}

/**
 * The card for one load state: `undefined` while loading, `null` when the
 * read failed, otherwise the stages. Exported for the preview harness.
 */
export function EnquiryStagesCardView({
  stages,
}: {
  stages: EnquiryStage[] | null | undefined;
}) {
  const { fmt } = useLocale();
  const total = stages?.reduce((sum, stage) => sum + stage.count, 0) ?? 0;
  const maxCount = stages
    ? Math.max(1, ...stages.map((stage) => stage.count))
    : 1;
  // A fresh account has an age on no stage at all, and a column of blanks
  // under a heading reads as missing data rather than as "nothing here yet".
  const showAge = Boolean(
    stages?.some((stage) => stage.count > 0 && stage.avgDays != null)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enquiries by stage</CardTitle>
        <CardDescription>
          Where your enquiries are now. The month and staff filters do not
          change this.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stages === undefined ? (
          <div className="space-y-2" role="status" aria-label="Loading stages">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : stages === null ? (
          <EmptyState
            icon={AlertCircle}
            title="Could not load enquiry stages"
            hint="Reload the page to try again."
          />
        ) : total === 0 ? (
          <EmptyState
            icon={Filter}
            title="No enquiries yet"
            hint="New enquiries and their stages will show here."
          />
        ) : (
          <div className={showAge ? STAGE_GRID : STAGE_GRID_NO_AGE}>
            {/* The only caption: "3 days" is the one value that does not say
                what it measures. With no ages to show, no caption row. */}
            {showAge && (
              <>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span className="text-muted-foreground text-right text-xs">
                  Average days
                </span>
                <span className="hidden sm:block" aria-hidden="true" />
              </>
            )}
            <ul className={`${STAGE_ROW} gap-y-2`}>
              {stages.map((stage) => (
                <li key={stage.key} className={STAGE_ROW}>
                  <span
                    className={`truncate text-sm ${
                      stage.count > 0
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    }`}
                    title={stage.label}
                  >
                    {stage.label}
                  </span>
                  <span
                    className={`text-right text-sm tabular-nums ${
                      stage.count > 0
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {fmt.number(stage.count)}
                  </span>
                  {showAge && (
                    <span className="text-muted-foreground text-right text-xs whitespace-nowrap tabular-nums">
                      {stageAge(stage)}
                    </span>
                  )}
                  {/* Decorative: the count beside it carries the number. An
                      empty stage draws nothing, and the cap keeps a full bar a
                      chart mark rather than a slab across the card. */}
                  <div
                    className="hidden max-w-72 min-w-0 sm:block"
                    aria-hidden="true"
                  >
                    {stage.count > 0 && (
                      <div
                        className="h-2.5 rounded-full"
                        style={{
                          width: `${(stage.count / maxCount) * 100}%`,
                          // A px floor, not a percentage one: 3% of a narrow
                          // column was a 6px speck.
                          minWidth: '0.625rem',
                          backgroundColor: stage.color,
                        }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
