'use client';

import { type ReactNode, useState } from 'react';
import { ChartNoAxesCombined, CircleHelp } from 'lucide-react';

import { useLocale } from '@/hooks/use-locale';
import { ALL_LEADS_RATING_KEY } from '@/lib/dashboard/lead-conversion-rating';
import type {
  LeadRatingMetric,
  LeadSourceRating,
  LeadSourceRatingData,
} from '@/lib/dashboard/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

type RangeDays = 7 | 30 | 90;
type RangeValue = `${RangeDays}`;
const RATING_RANGES = [7, 30, 90] as const;

interface LeadConversionRatingProps {
  data: LeadSourceRatingData | null;
  loading: boolean;
  range: RangeDays;
  onRangeChange: (range: RangeDays) => void;
}

const METRIC_HELP: Record<LeadRatingMetric['key'], string> = {
  memberConversion: 'Leads who became paid members',
  trialBooking: 'Leads with a booked trial or a trial membership',
  humanResponse: 'New messages answered by a team member within 24 hours',
  followUp: 'Follow-ups finished on or before the due date',
  positiveOutcome:
    'Finished follow-ups with a good result, such as paid or renewed',
};

const CONFIDENCE_LABEL: Record<LeadSourceRating['confidence'], string> = {
  insufficient: 'not enough',
  low: 'low',
  directional: 'fair',
  strong: 'strong',
};

type RadarTooltipSide = 'top' | 'right' | 'bottom' | 'left';

const RADAR_AXIS_DETAILS: Record<
  LeadRatingMetric['key'],
  {
    label: string;
    lines: readonly [string, string];
    description: string;
    positionClass: string;
    tooltipSide: RadarTooltipSide;
  }
> = {
  memberConversion: {
    label: 'Member conversion',
    lines: ['Member', 'conversion'],
    description: 'The share of leads that became paid members.',
    positionClass: 'top-[10%] left-1/2 -translate-x-1/2 text-center',
    tooltipSide: 'top',
  },
  trialBooking: {
    label: 'Trial booking',
    lines: ['Trial', 'booking'],
    description: 'The share of leads with recorded trial-booking evidence.',
    positionClass: 'top-1/4 right-0 text-left',
    tooltipSide: 'right',
  },
  humanResponse: {
    label: 'First reply',
    lines: ['First', 'reply'],
    description:
      'The share of inbound leads that received a first human reply within 24 hours.',
    positionClass: 'right-0 bottom-[16%] text-left',
    tooltipSide: 'right',
  },
  followUp: {
    label: 'On-time follow-up',
    lines: ['On-time', 'follow-up'],
    description: 'The share of due follow-ups completed on time.',
    positionClass: 'bottom-[16%] left-0 text-right',
    tooltipSide: 'left',
  },
  positiveOutcome: {
    label: 'Positive outcome',
    lines: ['Positive', 'outcome'],
    description:
      'The share of recorded completed follow-ups with a positive outcome.',
    positionClass: 'top-1/4 left-0 text-right',
    tooltipSide: 'left',
  },
};

export function LeadConversionRating({
  data,
  loading,
  range,
  onRangeChange,
}: LeadConversionRatingProps) {
  const [selectedSource, setSelectedSource] = useState(ALL_LEADS_RATING_KEY);
  const [calculationOpen, setCalculationOpen] = useState(false);
  const selected =
    (selectedSource === ALL_LEADS_RATING_KEY
      ? data?.allLeads
      : data?.sources.find((source) => source.key === selectedSource)) ??
    data?.allLeads ??
    null;

  return (
    <Dialog open={calculationOpen} onOpenChange={setCalculationOpen}>
      <section className="border-border bg-card flex h-full flex-col rounded-xl border">
        <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-0.5">
            <div>
              <h2 className="text-foreground text-sm font-semibold">
                Lead health score
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                See how well new leads are moving.
              </p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <DialogTrigger
                  render={
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="How does the lead health score work?"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setCalculationOpen(true);
                            }
                          }}
                        />
                      }
                    />
                  }
                >
                  <CircleHelp />
                </DialogTrigger>
                <TooltipContent>
                  How does the lead health score work?
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selected?.key ?? ALL_LEADS_RATING_KEY}
              onValueChange={(value) => value && setSelectedSource(value)}
            >
              <SelectTrigger
                id="lead-rating-source"
                aria-label="Lead source"
                className="w-36 max-w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LEADS_RATING_KEY}>All leads</SelectItem>
                {data?.sources.map((source) => (
                  <SelectItem key={source.key} value={source.key}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Toolbar aria-label="Time range">
              <ToolbarToggleGroup<RangeValue>
                value={[String(range) as RangeValue]}
                onValueChange={(values) => {
                  const nextRange = values[0];
                  if (nextRange) onRangeChange(Number(nextRange) as RangeDays);
                }}
              >
                {RATING_RANGES.map((days) => (
                  <ToolbarToggleItem
                    key={days}
                    value={String(days)}
                    aria-label={`${days} days`}
                  >
                    {days}d
                  </ToolbarToggleItem>
                ))}
              </ToolbarToggleGroup>
            </Toolbar>
          </div>
        </header>

        {loading || !data ? (
          <div className="flex flex-1 flex-col p-5">
            <Skeleton className="h-56 w-full" />
          </div>
        ) : data.sources.length === 0 || !selected ? (
          <div className="flex flex-1 flex-col p-5">
            <EmptyState
              icon={ChartNoAxesCombined}
              title="No new leads in this time"
              hint="The score will show after you add leads."
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center gap-1 px-4 pt-3 pb-1">
            <RatingHeadline source={selected} />
            <RadarChart source={selected} />
          </div>
        )}
      </section>
      {data && selected && (
        <RatingCalculationDialogContent source={selected} data={data} />
      )}
    </Dialog>
  );
}

function RatingHeadline({ source }: { source: LeadSourceRating }) {
  return (
    <div className="text-center">
      <div className="flex items-baseline justify-center gap-1">
        <span className="text-foreground text-3xl font-semibold tracking-tight tabular-nums">
          {source.rating == null ? '—' : Math.round(source.rating)}
        </span>
        <span className="text-muted-foreground text-xs">/100</span>
      </div>
      {source.rating == null && (
        <p className="text-muted-foreground mt-1 text-xs">Score not ready</p>
      )}
    </div>
  );
}

function RatingCalculationDialogContent({
  source,
  data,
}: {
  source: LeadSourceRating;
  data: LeadSourceRatingData;
}) {
  const { fmt } = useLocale();

  return (
    <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>How the lead health score works</DialogTitle>
        <DialogDescription>
          This score shows how well {source.label.toLowerCase()} are moving. It
          does not rank one lead source against another.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <section aria-labelledby="rating-components-heading">
          <h3
            id="rating-components-heading"
            className="text-foreground text-sm font-medium"
          >
            What makes the score
          </h3>
          <ul className="border-border mt-2 divide-y rounded-lg border">
            {source.metrics.map((metric) => (
              <li key={metric.key} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground text-xs font-medium">
                      {metric.label}{' '}
                      <span className="text-muted-foreground font-normal">
                        · {metric.weight}%
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-5">
                      {METRIC_HELP[metric.key]}
                    </p>
                  </div>
                  <MetricResult metric={metric} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <CalculationNote title="How points are set">
          Each result is checked against its goal. A result cannot score more
          than 100. The five results are then joined using the share shown
          above.
        </CalculationNote>

        <CalculationNote title="Time used">
          This view starts with {fmt.number(source.cohortSize)} leads added from{' '}
          {fmt.date(data.period.start)} through {fmt.date(data.period.end)}. It
          uses the work saved for those leads up to now.
        </CalculationNote>

        <CalculationNote title="Scope">
          All leads includes every lead added in the chosen time, even if the
          lead source is blank. Pick a source to see only those leads.
        </CalculationNote>

        <CalculationNote title="Trial booking">
          UsefulDesk does not have a full booking list yet. It counts a Trial
          booked status, a finished Trial booked follow-up, or a trial
          membership. This does not prove that the person visited.
        </CalculationNote>

        <CalculationNote title="Good follow-up results">
          This uses only finished follow-ups with a saved result. Renewed, paid,
          promised, contacted, and trial booked count as good results. No
          answer, not interested, and other do not.
        </CalculationNote>

        <CalculationNote title="How much data is used">
          The smallest group has {fmt.number(source.confidenceSample)} records,
          so the data level is {CONFIDENCE_LABEL[source.confidence]}. Under 10
          is low, 10 to 29 gives a rough guide, and 30 or more is strong. If a
          result has no data, the score stays blank. It is not shown as zero.
        </CalculationNote>
      </div>

      <DialogFooter showCloseButton />
    </DialogContent>
  );
}

function MetricResult({ metric }: { metric: LeadRatingMetric }) {
  return (
    <div className="shrink-0 text-right">
      <p className="text-foreground text-xs font-medium tabular-nums">
        {metric.actual == null ? 'Not ready' : `${Math.round(metric.actual)}%`}
      </p>
      <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
        {metric.sample === 0
          ? `No sample · target ${metric.target}%`
          : `${metric.successes}/${metric.sample} · target ${metric.target}%`}
      </p>
    </div>
  );
}

function CalculationNote({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      <p className="text-muted-foreground mt-1 text-xs leading-5">{children}</p>
    </section>
  );
}

const RADAR_SIZE = 260;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 66;

function radarPoint(
  index: number,
  value: number,
  count: number,
  radius = RADAR_RADIUS
) {
  const angle = -Math.PI / 2 + index * ((Math.PI * 2) / count);
  const distance = radius * (value / 100);
  return {
    x: RADAR_CENTER + Math.cos(angle) * distance,
    y: RADAR_CENTER + Math.sin(angle) * distance,
  };
}

function RadarChart({ source }: { source: LeadSourceRating }) {
  const complete = source.metrics.every((metric) => metric.normalized != null);
  const axisCount = source.metrics.length;
  const points = source.metrics.map((metric, index) =>
    metric.normalized == null
      ? null
      : radarPoint(index, metric.normalized, axisCount)
  );
  const polygon = complete
    ? points.map((point) => `${point!.x},${point!.y}`).join(' ')
    : '';

  return (
    <figure className="w-full">
      <div className="relative mx-auto aspect-square w-full max-w-64">
        <svg
          viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
          className="aspect-square w-full overflow-visible"
          role="img"
          aria-labelledby={`lead-radar-title-${source.key} lead-radar-desc-${source.key}`}
        >
          <title id={`lead-radar-title-${source.key}`}>
            {source.label} lead health score
          </title>
          <desc id={`lead-radar-desc-${source.key}`}>
            Five parts of the score: members joined, trials booked, first reply,
            follow-ups on time, and good follow-up results. A part with no data
            stays blank.
          </desc>
          {[25, 50, 75, 100].map((level) => (
            <polygon
              key={level}
              points={source.metrics
                .map((_, index) => {
                  const point = radarPoint(index, level, axisCount);
                  return `${point.x},${point.y}`;
                })
                .join(' ')}
              fill="none"
              stroke="var(--border)"
              strokeWidth={level === 100 ? 1.5 : 1}
            />
          ))}
          {source.metrics.map((metric, index) => {
            const outer = radarPoint(index, 100, axisCount);
            return (
              <line
                key={metric.key}
                x1={RADAR_CENTER}
                y1={RADAR_CENTER}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--border)"
              />
            );
          })}
          {complete ? (
            <polygon
              points={polygon}
              fill="color-mix(in srgb, var(--primary) 18%, transparent)"
              stroke="var(--primary)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          ) : (
            points.map((point, index) =>
              point ? (
                <line
                  key={source.metrics[index].key}
                  x1={RADAR_CENTER}
                  y1={RADAR_CENTER}
                  x2={point.x}
                  y2={point.y}
                  stroke="var(--primary)"
                  strokeWidth="2"
                />
              ) : null
            )
          )}
          {points.map((point, index) =>
            point ? (
              <circle
                key={source.metrics[index].key}
                cx={point.x}
                cy={point.y}
                r="3.5"
                fill="var(--primary)"
                stroke="var(--card)"
                strokeWidth="2"
              />
            ) : null
          )}
        </svg>
        <TooltipProvider>
          {source.metrics.map((metric) => {
            const details = RADAR_AXIS_DETAILS[metric.key];
            return (
              <Tooltip key={metric.key}>
                <TooltipTrigger
                  closeOnClick={false}
                  render={
                    <span
                      tabIndex={0}
                      aria-label={`${details.label} metric`}
                      className={`text-muted-foreground hover:text-foreground focus-visible:text-foreground absolute z-10 cursor-help text-[10px] leading-3 outline-none focus-visible:underline ${details.positionClass}`}
                    />
                  }
                >
                  {details.lines[0]}
                  <br />
                  {details.lines[1]}
                </TooltipTrigger>
                <TooltipContent
                  side={details.tooltipSide}
                  className="max-w-64 text-pretty"
                >
                  {details.description}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>
    </figure>
  );
}
