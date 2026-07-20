'use client';

import type { ReactNode } from 'react';
import { UserRoundSearch, Users } from 'lucide-react';

import { LeadsSort, type SortState } from '@/components/leads/leads-sort';
import type { StaffMember } from '@/components/members/use-account-staff';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
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
import {
  FOLLOW_UP_BUCKET_OPTIONS,
  type FollowUpBucket,
  type FollowUpFilters as FollowUpFilterState,
} from '@/lib/memberships/follow-up-filters';
import { FollowUpFilters } from './follow-up-filters';

export type FollowUpQueueScope = 'mine' | 'team';
type QuickBucket = 'all' | FollowUpBucket;

export interface FollowUpBucketCounts {
  all: number;
  overdue: number;
  today: number;
  upcoming: number;
}

interface FollowUpQueueControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: FollowUpFilterState;
  onFiltersChange: (value: FollowUpFilterState) => void;
  staff: StaffMember[];
  showReasons?: boolean;
  sort: SortState | null;
  onSortChange: (value: SortState | null) => void;
  sortColumns: { key: string; label: string }[];
  scope: FollowUpQueueScope;
  onScopeChange: (value: FollowUpQueueScope) => void;
  counts: FollowUpBucketCounts;
  searchPlaceholder?: string;
  actions?: ReactNode;
}

/** Shared queue toolbar: search, filters, sort, due buckets, and owner scope. */
export function FollowUpQueueControls({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  staff,
  showReasons = true,
  sort,
  onSortChange,
  sortColumns,
  scope,
  onScopeChange,
  counts,
  searchPlaceholder = 'Search follow-ups…',
  actions,
}: FollowUpQueueControlsProps) {
  const activeBucket: QuickBucket = filters.buckets[0] ?? 'all';

  function setQuickBucket(values: QuickBucket[]) {
    const next = values[0];
    if (!next) return;
    onFiltersChange({
      ...filters,
      buckets: next === 'all' ? [] : [next],
    });
  }

  return (
    <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        placeholder={searchPlaceholder}
        aria-label="Search follow-ups"
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <FollowUpFilters
          value={filters}
          onChange={onFiltersChange}
          staff={staff}
          showReasons={showReasons}
        />
        <LeadsSort value={sort} onChange={onSortChange} columns={sortColumns} />
        <Separator
          orientation="vertical"
          className="mx-0.5 h-5 data-vertical:self-center"
        />
        <TooltipProvider>
          <ChipGroup<QuickBucket>
            selectionMode="single"
            value={[activeBucket]}
            onValueChange={setQuickBucket}
            aria-label="Due date quick filters"
          >
            <QueueChip
              value="all"
              label="All"
              count={counts.all}
              helpText="All open follow-ups in this owner scope."
            />
            {FOLLOW_UP_BUCKET_OPTIONS.map((option) => (
              <QueueChip
                key={option.value}
                value={option.value}
                label={option.label}
                count={counts[option.value]}
                helpText={
                  option.value === 'overdue'
                    ? 'Follow-ups past their due date.'
                    : option.value === 'today'
                      ? 'Follow-ups due today.'
                      : 'Follow-ups due after today.'
                }
              />
            ))}
          </ChipGroup>
        </TooltipProvider>
      </div>

      <Toolbar className="ml-auto" aria-label="Follow-up owner scope">
        <ToolbarToggleGroup<FollowUpQueueScope>
          value={[scope]}
          onValueChange={(values) => values[0] && onScopeChange(values[0])}
          aria-label="Owner scope"
        >
          <ToolbarToggleItem value="mine">
            <UserRoundSearch className="size-4" />
            My work
          </ToolbarToggleItem>
          <ToolbarToggleItem value="team">
            <Users className="size-4" />
            Team
          </ToolbarToggleItem>
        </ToolbarToggleGroup>
      </Toolbar>
      {actions}
    </div>
  );
}

function QueueChip({
  value,
  label,
  count,
  helpText,
}: {
  value: QuickBucket;
  label: string;
  count: number;
  helpText: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger delay={1000} render={<Chip value={value} />}>
        {label} <ChipCount count={count} />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">
        {helpText}
      </TooltipContent>
    </Tooltip>
  );
}
