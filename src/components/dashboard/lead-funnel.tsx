'use client';

import Link from 'next/link';
import { Filter } from 'lucide-react';
import { useLocale } from '@/hooks/use-locale';
import type { LeadFunnelData, LeadFunnelStage } from '@/lib/dashboard/types';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface LeadFunnelProps {
  data: LeadFunnelData | null;
  loading: boolean;
}

// One grid template for the caption row AND every stage row, so the
// column headings sit exactly over the numbers they label instead of
// being eyeballed into place.
const STAGE_GRID =
  'grid grid-cols-[5rem_1fr_2rem_3.5rem] items-center gap-x-3 sm:grid-cols-[7rem_1fr_2.75rem_4.5rem]';
const SOURCE_GRID =
  'grid grid-cols-[1fr_3.5rem_2.5rem] items-center gap-x-3 text-xs';

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
export function LeadFunnel({ data, loading }: LeadFunnelProps) {
  const { fmt } = useLocale();
  const maxCount = data ? Math.max(1, ...data.stages.map((s) => s.count)) : 1;
  const conversionBase = data ? data.totalLeads + data.convertedTotal : 0;

  return (
    <Card>
      <CardHeader className="border-b">
        {/* The lead total moved here from the retired status ring, which was
            the only thing that view carried beyond these bars. "total" rather
            than a bare numeral: on its own the number read as a stage count. */}
        <CardTitle className="flex items-baseline gap-2">
          Leads by stage
          {data && data.totalLeads > 0 && (
            <span className="text-muted-foreground text-sm font-normal">
              <span className="tabular-nums">
                {fmt.number(data.totalLeads)}
              </span>{' '}
              total
            </span>
          )}
        </CardTitle>
        <CardAction>
          <Link
            data-slot="button"
            href="/leads"
            className={buttonVariants({ variant: 'link', size: 'xs' })}
          >
            See all leads
          </Link>
        </CardAction>
      </CardHeader>

      {loading || !data ? (
        <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="space-y-2.5 lg:col-span-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
          <div className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-[74px] w-full" />
              <Skeleton className="h-[74px] w-full" />
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
        <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Stage bars */}
          <div className="lg:col-span-3">
            <div
              className={`${STAGE_GRID} text-muted-foreground mb-2.5 text-[11px]`}
            >
              <span>Stage</span>
              <span aria-hidden="true" />
              <span className="text-right">Leads</span>
              <span className="text-right">Avg. time</span>
            </div>
            <ul className="space-y-2.5">
              {data.stages.map((s) => (
                <li key={s.key} className={STAGE_GRID}>
                  <span
                    className="text-foreground truncate text-xs"
                    title={s.label}
                  >
                    {s.label}
                  </span>
                  {/* Decorative: the count beside it carries the number. */}
                  <div
                    className="bg-muted/60 h-2.5 min-w-0 rounded-full"
                    aria-hidden="true"
                  >
                    {s.count > 0 && (
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, (s.count / maxCount) * 100)}%`,
                          backgroundColor: s.color,
                        }}
                      />
                    )}
                  </div>
                  <span
                    className={`text-right text-xs tabular-nums ${
                      s.count > 0
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {fmt.number(s.count)}
                  </span>
                  <span className="text-muted-foreground text-right text-[11px] whitespace-nowrap tabular-nums">
                    {stageAge(s)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Conversion tiles + source performance */}
          <div className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-border bg-muted/30 rounded-lg border px-3 py-2.5">
                <p className="text-muted-foreground text-[11px]">
                  Joined this month
                </p>
                <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
                  {fmt.number(data.convertedThisMonth)}
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  new memberships
                </p>
              </div>
              <div className="border-border bg-muted/30 rounded-lg border px-3 py-2.5">
                <p className="text-muted-foreground text-[11px]">
                  Leads who joined
                </p>
                <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
                  {data.conversionRate == null
                    ? '—'
                    : `${Math.round(data.conversionRate * 100)}%`}
                </p>
                {/* A percentage off three contacts is noise without its base. */}
                <p className="text-muted-foreground mt-0.5 text-[11px]">
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
              <p className="text-foreground mb-2 text-xs font-medium">
                Joined by source
              </p>
              {data.topSources.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No sources recorded yet.
                </p>
              ) : (
                <>
                  <div
                    className={`${SOURCE_GRID} text-muted-foreground mb-1.5 text-[11px]`}
                  >
                    <span>Source</span>
                    <span className="text-right">Joined</span>
                    <span className="text-right">Rate</span>
                  </div>
                  <ul className="space-y-1.5">
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
                </>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
