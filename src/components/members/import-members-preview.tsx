'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Info,
  XCircle,
} from 'lucide-react';

import { EditableCell } from '@/components/leads/editable-cell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocale } from '@/hooks/use-locale';
import {
  filterMemberImportCandidates,
  searchMemberImportCandidates,
  summarizeMemberImportCandidates,
  type MemberImportCandidate,
  type MemberImportCandidateDisposition,
  type MemberImportCandidateExclusionReason,
  type MemberImportCandidateFilter,
  type MemberImportDraftValues,
  type MemberImportExistingContactResolution,
  type MemberImportCandidateResolutions,
  type MemberImportPaymentCorrection,
  type MemberImportPaymentResolution,
} from '@/lib/memberships/member-import-candidates';
import { parseMoney } from '@/lib/memberships/import-commit';
import { durationLabel } from '@/lib/memberships/pricing';
import { cn } from '@/lib/utils';
import type { CatalogItem, MembershipPlan, Trainer } from '@/types';
import { MemberIdentity } from './member-identity';

const PAGE_SIZE = 50;

type CandidatePatch = Partial<MemberImportDraftValues>;
type EditingCell = {
  sourceKey: string;
  key: string;
  surface: 'desktop' | 'mobile';
} | null;
type PreviewView = 'issues' | 'rows';
type IssueCode = MemberImportCandidate['issues'][number]['code'];

/**
 * The one place a blocking issue is named. Everything else the operator
 * reads — why it blocks and what to do next — is authored once per issue in
 * `member-import-candidates`, so queue copy can never drift from the rule
 * that produced it.
 */
const ISSUE_TITLES: Partial<Record<IssueCode, string>> = {
  'missing-phone': 'Add missing phone number',
  'invalid-phone': 'Correct invalid phone number',
  'shared-phone': 'Phone number used by multiple members',
  'plan-needs-resolution': 'Match plan and billing option',
  'pricing-option-needs-resolution': 'Match plan and billing option',
  'offering-needs-classification': 'Choose plan or service',
  'service-needs-resolution': 'Match service, option, and trainer',
  'service-values-invalid': 'Correct service dates or price',
  'duplicate-service': 'Resolve duplicate service purchase',
  'purchase-total-mismatch': 'Correct purchase total',
  'payment-conflict': 'Payment figures conflict',
  'existing-contact': 'Choose which contact details to keep',
  'invalid-membership-values': 'Correct membership details',
  'expiry-not-after-start': 'Correct membership dates',
  'trainer-unmatched': 'Trainer not found',
  'assignee-unmatched': 'Teammate not found',
  'churn-risk-unmatched': 'Churn risk not recognised',
  'profile-value-invalid': 'Height or weight not readable',
  'cancelled-dues-written-off': 'Cancelled member has unpaid balance',
};

interface ImportMembersPreviewProps {
  candidates: MemberImportCandidate[];
  plans: MembershipPlan[];
  catalogItems: CatalogItem[];
  trainers: Trainer[];
  onPatch: (sourceKey: string, patch: CandidatePatch) => void;
  onResolveGroupedPlan: (
    sourceKeys: string[],
    resolution: { planId: string; pricingOptionId: string }
  ) => void;
  onResolveGroupedOffering: (
    sourceKeys: string[],
    resolution: NonNullable<MemberImportCandidateResolutions['offering']>
  ) => void;
  onResolveGroupedService: (
    sourceKeys: string[],
    resolution: {
      itemId: string;
      optionId: string;
      trainerId: string | null;
    }
  ) => void;
  onResolvePayment: (
    sourceKey: string,
    resolution: MemberImportPaymentResolution,
    correction?: MemberImportPaymentCorrection
  ) => void;
  onResolveExistingContact: (
    sourceKey: string,
    resolution: MemberImportExistingContactResolution
  ) => void;
  onSetDisposition: (
    sourceKey: string,
    disposition: MemberImportCandidateDisposition
  ) => void;
}

interface IssueGroup {
  key: string;
  code: IssueCode;
  title: string;
  explanation: string;
  nextAction: string;
  candidates: MemberImportCandidate[];
}

interface IssueQueueSection {
  title: string;
  groups: IssueGroup[];
}

/**
 * The queue names each kind of problem once and lists its instances beneath.
 * Without this, three separate missing-phone groups render three identical
 * titles, and the row label alone (a member name, a raw phone, a plan string)
 * never says what is wrong with it.
 */
function queueSections(groups: IssueGroup[]): IssueQueueSection[] {
  const sections = new Map<string, IssueQueueSection>();
  for (const group of groups) {
    const existing = sections.get(group.title);
    if (existing) existing.groups.push(group);
    else sections.set(group.title, { title: group.title, groups: [group] });
  }
  return [...sections.values()];
}

function unresolvedGroups(candidates: MemberImportCandidate[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const candidate of candidates) {
    if (candidate.disposition !== 'included') continue;
    for (const issue of candidate.issues) {
      if (issue.severity === 'notice' || issue.resolved) continue;
      const existing = groups.get(issue.groupKey);
      if (existing) existing.candidates.push(candidate);
      else {
        groups.set(issue.groupKey, {
          key: issue.groupKey,
          code: issue.code,
          title: ISSUE_TITLES[issue.code] ?? 'Correct membership details',
          explanation: issue.explanation,
          nextAction: issue.nextAction,
          candidates: [candidate],
        });
      }
    }
  }
  return [...groups.values()];
}

export function ImportMembersPreview({
  candidates,
  plans,
  catalogItems,
  trainers,
  onPatch,
  onResolveGroupedPlan,
  onResolveGroupedOffering,
  onResolveGroupedService,
  onResolvePayment,
  onResolveExistingContact,
  onSetDisposition,
}: ImportMembersPreviewProps) {
  const { fmt } = useLocale();
  const sectionId = useId();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MemberImportCandidateFilter>('all');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [view, setView] = useState<PreviewView>(() =>
    unresolvedGroups(candidates).length > 0 ? 'issues' : 'rows'
  );
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const summary = useMemo(
    () => summarizeMemberImportCandidates(candidates),
    [candidates]
  );
  const groups = useMemo(() => unresolvedGroups(candidates), [candidates]);
  const sections = useMemo(() => queueSections(groups), [groups]);
  const activeGroupIndex = Math.max(
    0,
    groups.findIndex((group) => group.key === selectedGroupKey)
  );
  const activeGroup = groups[activeGroupIndex] ?? null;
  const activeView: PreviewView = groups.length === 0 ? 'rows' : view;
  const visible = useMemo(() => {
    const searched = searchMemberImportCandidates(candidates, search);
    return filterMemberImportCandidates(searched, filter);
  }, [candidates, filter, search]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const counts: Record<MemberImportCandidateFilter, number> = {
    all: summary.source,
    'needs-resolution': summary.needsResolution,
    ready: summary.ready,
    excluded: summary.exclusions,
  };

  function startEditing(
    sourceKey: string,
    key: string,
    surface: 'desktop' | 'mobile'
  ) {
    setEditing({ sourceKey, key, surface });
  }

  function isEditing(
    sourceKey: string,
    key: string,
    surface: 'desktop' | 'mobile'
  ) {
    return (
      editing?.sourceKey === sourceKey &&
      editing.key === key &&
      editing.surface === surface
    );
  }

  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => value && setView(value as PreviewView)}
      /* `flex-1` is what actually gives this a height: the dialog body is a
         flex column whose own height comes from a max-height clamp, so a
         percentage height would resolve against an indefinite parent.
         `h-full` stays as the fallback for any non-flex host. */
      className="h-full min-h-0 flex-1 gap-0"
    >
      {/* The strip carries the dialog's gutter now that the body no longer
          pads this step, so the tab labels line up with the title above and
          the footer buttons below. Geometry matches the app's other line
          tabs (members, leads, finance): flat list, roomy gap, underline
          pinned to the divider it sits on. */}
      <div className="border-border flex shrink-0 items-end gap-4 border-b px-6 pt-3">
        <TabsList variant="line" className="h-auto gap-5 p-0">
          {/* Counts the queue this tab opens. The affected-member count is
              already stated in the dialog description, and each issue states
              its own row count, so the badge adds a number instead of
              repeating one. */}
          <TabsTrigger
            value="issues"
            disabled={groups.length === 0}
            aria-label={`Issues, ${groups.length} to resolve`}
            className="flex-none px-0.5 pb-2 group-data-horizontal/tabs:after:bottom-0"
          >
            Issues
            <Badge variant="warning" size="count">
              {groups.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="rows"
            aria-label={`Review rows, ${summary.source} in total`}
            className="flex-none px-0.5 pb-2 group-data-horizontal/tabs:after:bottom-0"
          >
            Review rows
            <Badge variant="neutral" size="count">
              {summary.source}
            </Badge>
          </TabsTrigger>
        </TabsList>
        {/* Below sm the tab labels and their counts already fill the strip;
            the same two totals stay reachable on the Review rows filters. */}
        <p className="text-muted-foreground ml-auto hidden pb-2 text-xs whitespace-nowrap tabular-nums sm:block">
          {fmt.number(summary.ready)} ready · {fmt.number(summary.exclusions)}{' '}
          excluded
        </p>
      </div>

      {activeView === 'issues' && activeGroup ? (
        <TabsContent
          value="issues"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <div className="grid min-h-0 flex-1 md:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="border-border hidden min-h-0 border-r md:flex md:flex-col">
              <nav
                aria-label="Issue queue"
                className="divide-border min-h-0 flex-1 divide-y overflow-y-auto px-4 pb-3"
              >
                {sections.map((section, index) => (
                  <div
                    key={section.title}
                    role="group"
                    aria-labelledby={`${sectionId}-${index}`}
                    /* No padding above the heading: a sticky element cannot
                       rise above its parent's content box, so top padding here
                       would park the pinned heading below the scrollport edge
                       and let rows slide visibly through the gap. The heading
                       owns its own top space instead. */
                    className="pb-2"
                  >
                    {/* The kind of problem is named once per cluster, so a row
                        only has to carry the value that identifies it. The
                        heading and the rows it names both sit in the quiet
                        text role, so the heading earns its own register —
                        smaller, heavier, wider-tracked, held above a rule, and
                        set closer to its own rows than to the cluster above.
                        Without that it reads as a fourth, unclickable row. */}
                    <p
                      id={`${sectionId}-${index}`}
                      className="bg-popover text-muted-foreground sticky top-0 z-10 flex items-start gap-1.5 px-2.5 pt-3 pb-2 text-xs font-semibold tracking-wide"
                    >
                      {/* Every section in this rail blocks the import, so the
                          marker is the same amber `AlertTriangle` a row's own
                          status carries. Its left edge lands on the row labels
                          beneath it, so the rail keeps one left edge and the
                          heading sits off it instead of alongside it.
                          Decorative: the heading already names the problem. */}
                      <AlertTriangle
                        className="text-amber-foreground mt-px size-3.5 shrink-0"
                        aria-hidden
                      />
                      <span className="min-w-0">{section.title}</span>
                    </p>
                    <div className="space-y-0.5">
                      {section.groups.map((group) => (
                        <Button
                          key={group.key}
                          type="button"
                          variant={
                            group.key === activeGroup.key
                              ? 'secondary'
                              : 'ghost'
                          }
                          /* A queue row carries a value the operator matches
                             against their file — a plan name, a phone number —
                             so it reads in the ink role like the same list
                             does in the mobile Select. Ghost's muted default
                             put it in the very role the section heading uses,
                             which is what made the two indistinguishable. */
                          className={cn(
                            'w-full justify-start',
                            group.key !== activeGroup.key && 'text-foreground'
                          )}
                          aria-pressed={group.key === activeGroup.key}
                          onClick={() => setSelectedGroupKey(group.key)}
                        >
                          <span className="min-w-0 flex-1 truncate text-left">
                            {groupQueueLabel(group, fmt.phone)}
                          </span>
                          {group.candidates.length > 1 ? (
                            <Badge variant="neutral" size="count">
                              {group.candidates.length}
                            </Badge>
                          ) : null}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
              {/* Without the queue rail, the picker and the pager are the same
                  navigation and belong on one row above the work. */}
              <div className="border-border flex shrink-0 items-center gap-2 border-b px-6 py-3 md:hidden">
                <div className="min-w-0 flex-1">
                  <Select
                    value={activeGroup.key}
                    onValueChange={(value) =>
                      value && setSelectedGroupKey(value)
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Choose issue">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.key} value={group.key}>
                          {`${groupQueueLabel(group, fmt.phone)} · ${group.title}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous issue"
                  disabled={activeGroupIndex === 0}
                  onClick={() =>
                    setSelectedGroupKey(groups[activeGroupIndex - 1].key)
                  }
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next issue"
                  disabled={activeGroupIndex === groups.length - 1}
                  onClick={() =>
                    setSelectedGroupKey(groups[activeGroupIndex + 1].key)
                  }
                >
                  <ChevronRight />
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <section
                  aria-label="Focused issue"
                  className="@container max-w-3xl px-6 pt-5 pb-6"
                >
                  <h3 className="text-base font-semibold">
                    {activeGroup.title}
                  </h3>
                  <p className="text-muted-foreground mt-1.5 max-w-[70ch] text-sm">
                    {activeGroup.explanation} {activeGroup.nextAction}
                  </p>
                  <div className="mt-5">
                    <GroupResolver
                      key={activeGroup.key}
                      group={activeGroup}
                      plans={plans}
                      catalogItems={catalogItems}
                      trainers={trainers}
                      onResolveGroupedPlan={onResolveGroupedPlan}
                      onResolveGroupedOffering={onResolveGroupedOffering}
                      onResolveGroupedService={onResolveGroupedService}
                      onResolvePayment={onResolvePayment}
                      onResolveExistingContact={onResolveExistingContact}
                      onPatch={onPatch}
                      onSetDisposition={onSetDisposition}
                    />
                  </div>
                </section>
              </div>
            </div>
          </div>
        </TabsContent>
      ) : null}

      {activeView === 'rows' ? (
        <TabsContent
          value="rows"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-4 pb-4">
            <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center">
              <SearchInput
                value={search}
                onValueChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                placeholder="Search customers or Member ID"
                aria-label="Search import rows"
                containerClassName="w-full lg:w-[240px]"
              />
              <ChipGroup<MemberImportCandidateFilter>
                selectionMode="single"
                value={[filter]}
                onValueChange={(values) => {
                  if (!values[0]) return;
                  setFilter(values[0]);
                  setPage(0);
                }}
                aria-label="Import row filters"
              >
                {(
                  [
                    ['all', 'All'],
                    ['needs-resolution', 'Needs resolution'],
                    ['ready', 'Ready'],
                    ['excluded', 'Excluded'],
                  ] as const
                ).map(([value, label]) => (
                  <Chip key={value} value={value}>
                    {label} <ChipCount count={counts[value]} />
                  </Chip>
                ))}
              </ChipGroup>
            </div>

            {visible.length === 0 ? (
              <EmptyRows
                filtered={search.trim().length > 0 || filter !== 'all'}
                onReset={() => {
                  setSearch('');
                  setFilter('all');
                  setPage(0);
                }}
              />
            ) : (
              <>
                <div
                  data-testid="member-import-desktop"
                  className="border-border hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border md:flex"
                >
                  {/* One scroll box owns both axes. `Table` wraps its own
                      `overflow-x-auto` container, and nesting that inside a
                      vertical scroller detaches `sticky` from the box that
                      actually scrolls — the header slides away and the
                      horizontal scrollbar parks below the last row. */}
                  <div className="min-h-0 flex-1 overflow-auto">
                    {/* Declared widths sum to the min-width, so `table-fixed`
                        hands every column exactly what it was given instead
                        of scaling them down into each other. */}
                    <table className="w-full min-w-[1152px] table-fixed caption-bottom text-sm">
                      <TableHeader className="bg-popover sticky top-0 z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-52">Name</TableHead>
                          <TableHead className="w-24">Member ID</TableHead>
                          <TableHead className="w-40">Phone</TableHead>
                          <TableHead className="w-56">Offering</TableHead>
                          <TableHead className="w-24 text-right">Fee</TableHead>
                          <TableHead className="w-28">Expiry</TableHead>
                          <TableHead className="w-40">Status</TableHead>
                          <TableHead className="w-24 text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paged.map((candidate) => (
                          <TableRow key={candidate.sourceKey}>
                            <TableCell>
                              <MemberIdentity
                                name={
                                  candidate.draftValues.name || 'Unnamed member'
                                }
                                secondary={`Source row ${candidate.sourceRow}`}
                              />
                            </TableCell>
                            <TableCell
                              className="text-muted-foreground truncate text-xs"
                              title={candidate.legacyMemberId || undefined}
                            >
                              {candidate.legacyMemberId || '—'}
                            </TableCell>
                            <TableCell className="p-0">
                              <EditableCell
                                editing={isEditing(
                                  candidate.sourceKey,
                                  'phone',
                                  'desktop'
                                )}
                                saving={false}
                                kind="phone"
                                value={candidate.draftValues.phone}
                                display={
                                  <span className="text-foreground truncate text-sm">
                                    {candidate.draftValues.phone
                                      ? fmt.phone(candidate.draftValues.phone)
                                      : 'Add phone'}
                                  </span>
                                }
                                onStart={() =>
                                  startEditing(
                                    candidate.sourceKey,
                                    'phone',
                                    'desktop'
                                  )
                                }
                                onCancel={() => setEditing(null)}
                                onCommit={(phone) => {
                                  onPatch(candidate.sourceKey, { phone });
                                  setEditing(null);
                                }}
                              />
                            </TableCell>
                            <TableCell className="p-0">
                              {candidate.outcomeKind === 'membership' ? (
                                <EditableCell
                                  editing={isEditing(
                                    candidate.sourceKey,
                                    'plan',
                                    'desktop'
                                  )}
                                  saving={false}
                                  kind="select"
                                  value={
                                    candidate.built.membership?.plan_id ?? ''
                                  }
                                  options={plans.map((plan) => ({
                                    value: plan.id,
                                    label: plan.name,
                                  }))}
                                  display={
                                    <CandidateOffering candidate={candidate} />
                                  }
                                  onStart={() =>
                                    startEditing(
                                      candidate.sourceKey,
                                      'plan',
                                      'desktop'
                                    )
                                  }
                                  onCancel={() => setEditing(null)}
                                  onCommit={(planId) => {
                                    const plan = plans.find(
                                      (item) => item.id === planId
                                    );
                                    const option = plan?.pricing_options?.find(
                                      (item) => item.is_active
                                    );
                                    if (plan && option) {
                                      onResolveGroupedPlan(
                                        [candidate.sourceKey],
                                        {
                                          planId: plan.id,
                                          pricingOptionId: option.id,
                                        }
                                      );
                                    }
                                    setEditing(null);
                                  }}
                                />
                              ) : (
                                // Matches EditableCell's own 36px slot and px-2
                                // inset, so a row that cannot be edited still
                                // starts its offering on the same vertical line.
                                <div className="flex h-9 items-center px-4.5">
                                  <CandidateOffering candidate={candidate} />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <CandidateFee candidate={candidate} />
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">
                              <CandidateDates candidate={candidate} />
                            </TableCell>
                            <TableCell>
                              <CandidateStatus candidate={candidate} />
                            </TableCell>
                            <TableCell className="text-right">
                              <DispositionAction
                                candidate={candidate}
                                onSetDisposition={onSetDisposition}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </table>
                  </div>
                  {/* Outside the scroll box: the pager belongs to the frame, not
                  to the rows it pages through. */}
                  <Pagination
                    page={safePage}
                    pageCount={pageCount}
                    total={visible.length}
                    onPageChange={setPage}
                  />
                </div>

                <div
                  className="flex min-h-0 flex-1 flex-col md:hidden"
                  data-testid="member-import-mobile"
                >
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
                    {paged.map((candidate) => (
                      <article
                        key={candidate.sourceKey}
                        className="border-border bg-muted/30 space-y-3 rounded-xl border p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <MemberIdentity
                            name={
                              candidate.draftValues.name || 'Unnamed member'
                            }
                            secondary={
                              candidate.draftValues.phone
                                ? fmt.phone(candidate.draftValues.phone)
                                : 'No phone'
                            }
                            meta={
                              <div className="text-muted-foreground truncate text-xs">
                                {`Source row ${candidate.sourceRow} · ${candidate.legacyMemberId || 'No Member ID'}`}
                              </div>
                            }
                          />
                          <CandidateStatus candidate={candidate} />
                        </div>
                        {/* Stacked rather than a label column: the offering is the
                      longest value on the card and needs the full width to
                      wrap instead of forcing the list to scroll sideways. */}
                        <dl className="space-y-2 text-sm">
                          <div className="min-w-0">
                            <dt className="text-muted-foreground text-xs">
                              Offering
                            </dt>
                            <dd className="text-foreground mt-0.5 min-w-0">
                              <CandidateOffering candidate={candidate} wrap />
                            </dd>
                          </div>
                          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                            <div className="min-w-0">
                              <dt className="text-muted-foreground text-xs">
                                Fee
                              </dt>
                              <dd className="text-foreground mt-0.5">
                                <CandidateFee candidate={candidate} />
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground text-xs">
                                Expiry
                              </dt>
                              <dd className="text-foreground mt-0.5 text-xs">
                                <CandidateDates candidate={candidate} />
                              </dd>
                            </div>
                          </div>
                        </dl>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              startEditing(
                                candidate.sourceKey,
                                'phone',
                                'mobile'
                              )
                            }
                          >
                            {candidate.draftValues.phone
                              ? 'Edit phone'
                              : 'Add phone'}
                          </Button>
                          <DispositionAction
                            candidate={candidate}
                            onSetDisposition={onSetDisposition}
                          />
                        </div>
                        {isEditing(candidate.sourceKey, 'phone', 'mobile') && (
                          <EditableCell
                            editing
                            saving={false}
                            kind="phone"
                            value={candidate.draftValues.phone}
                            display={null}
                            onStart={() => undefined}
                            onCancel={() => setEditing(null)}
                            onCommit={(phone) => {
                              onPatch(candidate.sourceKey, { phone });
                              setEditing(null);
                            }}
                          />
                        )}
                      </article>
                    ))}
                  </div>
                  <Pagination
                    page={safePage}
                    pageCount={pageCount}
                    total={visible.length}
                    onPageChange={setPage}
                  />
                </div>
              </>
            )}
          </div>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function groupQueueLabel(
  group: IssueGroup,
  formatPhone: (phone: string) => string
) {
  const first = group.candidates[0];
  switch (group.code) {
    case 'plan-needs-resolution':
    case 'pricing-option-needs-resolution':
      return `${first.originalValues.planName || '(blank plan)'} · ${first.originalValues.pricingOption || 'No billing option'}`;
    case 'offering-needs-classification':
      return first.originalValues.offering || 'Unclassified offering';
    case 'service-needs-resolution':
      return `${first.originalValues.serviceName || first.originalValues.offering || 'Unknown service'} · ${first.originalValues.serviceOption || 'No option'}`;
    case 'missing-phone':
      return first.draftValues.name || `Source row ${first.sourceRow}`;
    case 'invalid-phone':
    case 'shared-phone':
      return first.draftValues.phone || first.originalValues.phone
        ? formatPhone(first.draftValues.phone || first.originalValues.phone)
        : 'Phone issue';
    case 'payment-conflict':
    case 'purchase-total-mismatch':
      return first.draftValues.name || `Source row ${first.sourceRow}`;
    case 'existing-contact':
      return (
        first.draftValues.name ||
        formatPhone(first.draftValues.phone) ||
        'Member'
      );
    default:
      // The queue section already names the problem, so a row that falls
      // through must identify the record instead of repeating the title.
      return first.draftValues.name || `Source row ${first.sourceRow}`;
  }
}

function candidateName(candidate: MemberImportCandidate) {
  return candidate.draftValues.name || 'Unnamed member';
}

/**
 * One identity treatment for every row in the queue, so the same member reads
 * identically whichever issue surfaced them.
 */
function CandidateIdentity({
  candidate,
}: {
  candidate: MemberImportCandidate;
}) {
  return (
    <MemberIdentity
      name={candidateName(candidate)}
      secondary={`Member ID ${candidate.legacyMemberId || 'not set'}`}
      meta={`Source row ${candidate.sourceRow}`}
    />
  );
}

function ExcludeAction({
  candidate,
  onSetDisposition,
  className,
}: {
  candidate: MemberImportCandidate;
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
  className?: string;
}) {
  const name = candidateName(candidate);
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className={className}
      aria-label={`Exclude ${name}, source row ${candidate.sourceRow}`}
      onClick={() => onSetDisposition(candidate.sourceKey, 'excluded')}
    >
      Exclude
    </Button>
  );
}

function ExcludeGroupAction({
  group,
  onSetDisposition,
}: {
  group: IssueGroup;
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const count = group.candidates.length;
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      onClick={() => {
        for (const candidate of group.candidates) {
          onSetDisposition(candidate.sourceKey, 'excluded');
        }
      }}
    >
      {count === 1 ? 'Exclude this row' : `Exclude these ${count} rows`}
    </Button>
  );
}

/**
 * Every per-row resolver renders through this shell: identity, the control
 * that fixes the row, and the same escape hatch. `stacked` gives the control
 * the full width when it is a field grid rather than a single input.
 */
function IssueRows({
  group,
  onSetDisposition,
  renderControl,
  stacked = false,
}: {
  group: IssueGroup;
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
  renderControl?: (candidate: MemberImportCandidate) => ReactNode;
  stacked?: boolean;
}) {
  // A long group must not push its commit control past the fold: the record
  // list takes the scroll so the instruction above and the action below it
  // both stay on screen. Stacked rows are ~4x taller, so they get more room.
  const bounded = group.candidates.length > 4;
  return (
    <ul
      className={cn(
        'border-border divide-border divide-y rounded-xl border',
        bounded && 'overflow-y-auto',
        bounded &&
          (stacked ? 'max-h-[min(32rem,55vh)]' : 'max-h-[min(20rem,40vh)]')
      )}
    >
      {group.candidates.map((candidate) => (
        <li
          key={candidate.sourceKey}
          className={cn('p-3', stacked && 'space-y-3')}
        >
          {stacked ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CandidateIdentity candidate={candidate} />
                <ExcludeAction
                  candidate={candidate}
                  onSetDisposition={onSetDisposition}
                />
              </div>
              {renderControl?.(candidate)}
            </>
          ) : (
            <div
              /* Container query, not a viewport one: the queue rail takes
                 a fixed slice of the dialog, so at the dialog's own medium
                 width the viewport is past `sm` while this column is not
                 wide enough for name, control, and action side by side —
                 which crushed the name to a few characters. */
              className={cn(
                'grid gap-3 @xl:items-center',
                renderControl
                  ? '@xl:grid-cols-[minmax(0,1fr)_minmax(14rem,0.8fr)_auto]'
                  : '@xl:grid-cols-[minmax(0,1fr)_auto]'
              )}
            >
              <CandidateIdentity candidate={candidate} />
              {renderControl?.(candidate)}
              {/* Once the row stacks, this is a full-width grid cell and a
                  centred `Exclude` reads as the row's main action rather
                  than its escape hatch. */}
              <ExcludeAction
                candidate={candidate}
                onSetDisposition={onSetDisposition}
                className="justify-self-start"
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Every group-wide resolver renders through this shell: the source value that
 * could not be matched, one choice that maps the whole group, and the same
 * escape hatch.
 */
function GroupChoice({
  group,
  sourceLabel,
  ariaLabel,
  placeholder,
  onValueChange,
  onSetDisposition,
  unavailable,
  children,
}: {
  group: IssueGroup;
  sourceLabel: string;
  ariaLabel: string;
  placeholder: string;
  onValueChange: (value: string) => void;
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
  unavailable?: ReactNode;
  children?: ReactNode;
}) {
  const affected = group.candidates.map(candidateName);
  const shown = affected.slice(0, 3).join(', ');
  const remaining = affected.length - 3;
  return (
    <div className="space-y-3">
      {/* One choice maps rows the operator cannot see here, so the container
          and its caption name exactly who the mapping lands on. */}
      <div className="border-border grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] sm:items-center">
        <div className="min-w-0 space-y-1">
          <p className="text-foreground text-sm font-medium break-words">
            {sourceLabel}
          </p>
          <p className="text-muted-foreground text-xs">
            Affects {affected.length} source row
            {affected.length === 1 ? '' : 's'}: {shown}
            {remaining > 0 ? ` +${remaining} more` : ''}
          </p>
        </div>
        {unavailable ?? (
          <Select<string>
            value={null}
            onValueChange={(value) => value && onValueChange(value)}
          >
            <SelectTrigger className="w-full" aria-label={ariaLabel}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>{children}</SelectContent>
          </Select>
        )}
      </div>
      <ExcludeGroupAction group={group} onSetDisposition={onSetDisposition} />
    </div>
  );
}

function PhoneIssueResolver({
  group,
  onPatch,
  onSetDisposition,
}: {
  group: IssueGroup;
  onPatch: ImportMembersPreviewProps['onPatch'];
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      group.candidates.map((candidate) => [
        candidate.sourceKey,
        candidate.draftValues.phone,
      ])
    )
  );
  const changedCandidates = group.candidates.filter(
    (candidate) => drafts[candidate.sourceKey] !== candidate.draftValues.phone
  );

  return (
    <div className="space-y-4">
      <IssueRows
        group={group}
        onSetDisposition={onSetDisposition}
        renderControl={(candidate) => (
          <PhoneInput
            value={drafts[candidate.sourceKey] ?? ''}
            onValueChange={(phone) =>
              setDrafts((current) => ({
                ...current,
                [candidate.sourceKey]: phone,
              }))
            }
            aria-label={`Phone for ${candidateName(candidate)}`}
            aria-invalid={
              group.code === 'invalid-phone' &&
              drafts[candidate.sourceKey] === candidate.draftValues.phone
            }
          />
        )}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs">
          {changedCandidates.length === 0
            ? 'Edit a phone number to resolve this issue.'
            : `${changedCandidates.length} phone ${changedCandidates.length === 1 ? 'change' : 'changes'} ready to save.`}
        </p>
        <Button
          type="button"
          disabled={changedCandidates.length === 0}
          onClick={() => {
            for (const candidate of changedCandidates) {
              onPatch(candidate.sourceKey, {
                phone: drafts[candidate.sourceKey],
              });
            }
          }}
        >
          Save &amp; resolve
        </Button>
      </div>
    </div>
  );
}

function PaymentConflictResolver({
  group,
  onResolvePayment,
  onSetDisposition,
}: {
  group: IssueGroup;
  onResolvePayment: ImportMembersPreviewProps['onResolvePayment'];
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const { fmt } = useLocale();
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [manualDrafts, setManualDrafts] = useState<
    Record<string, { paid: string; balance: string }>
  >({});

  function draftFor(candidate: MemberImportCandidate) {
    return (
      manualDrafts[candidate.sourceKey] ?? {
        paid: candidate.draftValues.amountPaid ?? '',
        balance: candidate.draftValues.balance ?? '',
      }
    );
  }

  return (
    <IssueRows
      group={group}
      onSetDisposition={onSetDisposition}
      stacked
      renderControl={(candidate) => {
        const fee = parseMoney(candidate.draftValues.fee ?? '') ?? 0;
        const paid = parseMoney(candidate.draftValues.amountPaid ?? '') ?? 0;
        const balance = parseMoney(candidate.draftValues.balance ?? '') ?? 0;
        const manual = draftFor(candidate);
        return (
          <div className="space-y-3">
            {/* The four figures are the decision itself, so they read as a
                labelled set rather than one muted run-on line. */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {(
                [
                  ['Total', fee],
                  ['Paid', paid],
                  ['Balance', balance],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-foreground text-sm tabular-nums">
                    {fmt.money(value)}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-muted-foreground text-xs">Off by</dt>
                <dd className="text-amber-foreground text-sm tabular-nums">
                  {fmt.money(fee - paid - balance)}
                </dd>
              </div>
            </dl>
            <Select
              value={candidate.resolutions.payment}
              onValueChange={(value) => {
                if (!value) return;
                if (value === 'manual') {
                  setManualKey(candidate.sourceKey);
                  return;
                }
                setManualKey(null);
                onResolvePayment(
                  candidate.sourceKey,
                  value as MemberImportPaymentResolution
                );
              }}
            >
              <SelectTrigger
                className="w-full sm:max-w-sm"
                aria-label={`Resolve payment for source row ${candidate.sourceRow}`}
              >
                <SelectValue placeholder="Choose which figures to trust" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trust_paid">
                  Keep paid, recalculate the total
                </SelectItem>
                <SelectItem value="trust_balance">
                  Keep balance, recalculate paid
                </SelectItem>
                <SelectItem value="member_only">
                  Import without a payment
                </SelectItem>
                <SelectItem value="manual">Enter corrected figures</SelectItem>
              </SelectContent>
            </Select>
            {manualKey === candidate.sourceKey && (
              <div className="grid gap-3 sm:max-w-sm sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`paid-${candidate.sourceKey}`} size="sm">
                    Corrected paid
                  </Label>
                  <Input
                    id={`paid-${candidate.sourceKey}`}
                    inputMode="decimal"
                    value={manual.paid}
                    onChange={(event) =>
                      setManualDrafts((current) => ({
                        ...current,
                        [candidate.sourceKey]: {
                          ...manual,
                          paid: event.currentTarget.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`balance-${candidate.sourceKey}`} size="sm">
                    Corrected balance
                  </Label>
                  <Input
                    id={`balance-${candidate.sourceKey}`}
                    inputMode="decimal"
                    value={manual.balance}
                    onChange={(event) =>
                      setManualDrafts((current) => ({
                        ...current,
                        [candidate.sourceKey]: {
                          ...manual,
                          balance: event.currentTarget.value,
                        },
                      }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="sm:col-span-2 sm:justify-self-end"
                  onClick={() => {
                    onResolvePayment(candidate.sourceKey, 'manual', manual);
                    setManualKey(null);
                  }}
                >
                  Apply corrected figures
                </Button>
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

/**
 * Corrections for the rows whose own values are unreadable. Every field
 * commits on blur, so a half-typed date never re-runs validation for the
 * whole file.
 */
function FieldCorrectionResolver({
  group,
  fields,
  onPatch,
  onSetDisposition,
}: {
  group: IssueGroup;
  fields: {
    key: keyof MemberImportDraftValues;
    label: string;
    inputMode?: 'decimal';
  }[];
  onPatch: ImportMembersPreviewProps['onPatch'];
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  return (
    <IssueRows
      group={group}
      onSetDisposition={onSetDisposition}
      stacked
      renderControl={(candidate) => (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map((field) => {
            const id = `${field.key}-${candidate.sourceKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            return (
              <div key={field.key} className="min-w-0 space-y-1.5">
                <Label htmlFor={id} size="sm">
                  {field.label}
                </Label>
                <Input
                  id={id}
                  aria-label={`${field.label} for source row ${candidate.sourceRow}`}
                  inputMode={field.inputMode}
                  defaultValue={
                    (candidate.draftValues[field.key] as string | undefined) ??
                    ''
                  }
                  onBlur={(event) =>
                    onPatch(candidate.sourceKey, {
                      [field.key]: event.currentTarget.value,
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    />
  );
}

const SERVICE_CORRECTION_FIELDS = [
  { key: 'serviceStart', label: 'Service start' },
  { key: 'serviceEnd', label: 'Service expiry' },
  {
    key: 'serviceSoldPrice',
    label: 'Service sold price',
    inputMode: 'decimal',
  },
  { key: 'fee', label: 'Row total', inputMode: 'decimal' },
] as const satisfies readonly {
  key: keyof MemberImportDraftValues;
  label: string;
  inputMode?: 'decimal';
}[];

const MEMBERSHIP_CORRECTION_FIELDS = [
  { key: 'startDate', label: 'Start date' },
  { key: 'endDate', label: 'Expiry' },
  { key: 'status', label: 'Status' },
  { key: 'freezeDate', label: 'Freeze date' },
  { key: 'fee', label: 'Fee', inputMode: 'decimal' },
  { key: 'amountPaid', label: 'Amount paid', inputMode: 'decimal' },
  { key: 'paidAt', label: 'Payment date' },
  { key: 'dateOfBirth', label: 'Date of birth' },
] as const satisfies readonly {
  key: keyof MemberImportDraftValues;
  label: string;
  inputMode?: 'decimal';
}[];

function GroupResolver({
  group,
  plans,
  catalogItems,
  trainers,
  onResolveGroupedPlan,
  onResolveGroupedOffering,
  onResolveGroupedService,
  onResolvePayment,
  onResolveExistingContact,
  onPatch,
  onSetDisposition,
}: {
  group: IssueGroup;
  plans: MembershipPlan[];
  catalogItems: CatalogItem[];
  trainers: Trainer[];
  onResolveGroupedPlan: ImportMembersPreviewProps['onResolveGroupedPlan'];
  onResolveGroupedOffering: ImportMembersPreviewProps['onResolveGroupedOffering'];
  onResolveGroupedService: ImportMembersPreviewProps['onResolveGroupedService'];
  onResolvePayment: ImportMembersPreviewProps['onResolvePayment'];
  onResolveExistingContact: ImportMembersPreviewProps['onResolveExistingContact'];
  onPatch: ImportMembersPreviewProps['onPatch'];
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const first = group.candidates[0];
  const sourceKeys = group.candidates.map((candidate) => candidate.sourceKey);

  if (
    group.code === 'missing-phone' ||
    group.code === 'invalid-phone' ||
    group.code === 'shared-phone'
  ) {
    return (
      <PhoneIssueResolver
        group={group}
        onPatch={onPatch}
        onSetDisposition={onSetDisposition}
      />
    );
  }

  if (group.code === 'offering-needs-classification') {
    const sourceLabel = first.originalValues.offering || '(blank)';
    return (
      <GroupChoice
        group={group}
        sourceLabel={sourceLabel}
        ariaLabel={`Classify ${sourceLabel}`}
        placeholder="Choose plan or service"
        onSetDisposition={onSetDisposition}
        onValueChange={(value) => {
          const [kind, primaryId, optionId] = value.split('::');
          if (kind === 'membership') {
            onResolveGroupedOffering(sourceKeys, {
              kind: 'membership',
              planId: primaryId,
              pricingOptionId: optionId,
            });
          } else {
            onResolveGroupedOffering(sourceKeys, {
              kind: 'service',
              itemId: primaryId,
              optionId,
            });
          }
        }}
      >
        {plans.flatMap((plan) =>
          (plan.pricing_options ?? [])
            .filter((option) => option.is_active)
            .map((option) => (
              <SelectItem
                key={`membership::${plan.id}::${option.id}`}
                value={`membership::${plan.id}::${option.id}`}
              >
                Membership · {plan.name} ·{' '}
                {durationLabel(option.duration_count, option.duration_unit)}
              </SelectItem>
            ))
        )}
        {catalogItems
          .filter((item) => item.kind === 'service' && item.is_active)
          .flatMap((item) =>
            (item.catalog_options ?? [])
              .filter(
                (option) =>
                  option.is_active &&
                  option.duration_count !== null &&
                  option.duration_unit !== null
              )
              .map((option) => (
                <SelectItem
                  key={`service::${item.id}::${option.id}`}
                  value={`service::${item.id}::${option.id}`}
                >
                  Service · {item.name} ·{' '}
                  {durationLabel(option.duration_count!, option.duration_unit!)}
                </SelectItem>
              ))
          )}
      </GroupChoice>
    );
  }

  if (group.code === 'service-needs-resolution') {
    const sourceLabel = `${first.originalValues.serviceName || first.originalValues.offering || '(blank)'} · ${first.originalValues.serviceOption || '(no option)'}`;
    const serviceChoices = catalogItems
      .filter((item) => item.kind === 'service' && item.is_active)
      .flatMap((item) =>
        (item.catalog_options ?? [])
          .filter(
            (option) =>
              option.is_active &&
              option.duration_count !== null &&
              option.duration_unit !== null
          )
          .flatMap((option) => {
            const validTrainers = item.requires_trainer
              ? trainers.filter(
                  (trainer) =>
                    trainer.is_active &&
                    (option.trainer_rates ?? []).some(
                      (rate) => rate.is_active && rate.trainer_id === trainer.id
                    )
                )
              : [null];
            return validTrainers.map((trainer) => ({ item, option, trainer }));
          })
      );
    return (
      <GroupChoice
        group={group}
        sourceLabel={sourceLabel}
        ariaLabel={`Map ${sourceLabel}`}
        placeholder="Choose service, option, and trainer"
        onSetDisposition={onSetDisposition}
        onValueChange={(value) => {
          const [itemId, optionId, trainerId] = value.split('::');
          onResolveGroupedService(sourceKeys, {
            itemId,
            optionId,
            trainerId: trainerId === '-' ? null : trainerId,
          });
        }}
        unavailable={
          serviceChoices.length === 0 ? (
            <p className="text-amber-foreground text-sm">
              No active service option matches this row. Add one in Settings →
              Products &amp; services, then reopen this import.
            </p>
          ) : undefined
        }
      >
        {serviceChoices.map(({ item, option, trainer }) => (
          <SelectItem
            key={`${item.id}::${option.id}::${trainer?.id ?? '-'}`}
            value={`${item.id}::${option.id}::${trainer?.id ?? '-'}`}
          >
            {item.name} ·{' '}
            {durationLabel(option.duration_count!, option.duration_unit!)}
            {trainer ? ` · ${trainer.display_name}` : ''}
          </SelectItem>
        ))}
      </GroupChoice>
    );
  }

  if (
    group.code === 'plan-needs-resolution' ||
    group.code === 'pricing-option-needs-resolution'
  ) {
    const sourceLabel = `${first.originalValues.planName || '(blank)'} · ${first.originalValues.pricingOption || '(no billing option)'}`;
    return (
      <GroupChoice
        group={group}
        sourceLabel={sourceLabel}
        ariaLabel={`Map ${sourceLabel}`}
        placeholder="Choose plan and billing option"
        onSetDisposition={onSetDisposition}
        onValueChange={(value) => {
          const [planId, pricingOptionId] = value.split('::');
          onResolveGroupedPlan(sourceKeys, { planId, pricingOptionId });
        }}
      >
        {plans.flatMap((plan) =>
          (plan.pricing_options ?? [])
            .filter((option) => option.is_active)
            .map((option) => (
              <SelectItem
                key={`${plan.id}::${option.id}`}
                value={`${plan.id}::${option.id}`}
              >
                {plan.name} ·{' '}
                {durationLabel(option.duration_count, option.duration_unit)}
              </SelectItem>
            ))
        )}
      </GroupChoice>
    );
  }

  if (
    group.code === 'service-values-invalid' ||
    group.code === 'duplicate-service' ||
    group.code === 'purchase-total-mismatch'
  ) {
    return (
      <FieldCorrectionResolver
        group={group}
        fields={[...SERVICE_CORRECTION_FIELDS]}
        onPatch={onPatch}
        onSetDisposition={onSetDisposition}
      />
    );
  }

  if (
    group.code === 'invalid-membership-values' ||
    group.code === 'expiry-not-after-start'
  ) {
    return (
      <FieldCorrectionResolver
        group={group}
        fields={[...MEMBERSHIP_CORRECTION_FIELDS]}
        onPatch={onPatch}
        onSetDisposition={onSetDisposition}
      />
    );
  }

  if (group.code === 'payment-conflict') {
    return (
      <PaymentConflictResolver
        group={group}
        onResolvePayment={onResolvePayment}
        onSetDisposition={onSetDisposition}
      />
    );
  }

  if (group.code === 'existing-contact') {
    return (
      <IssueRows
        group={group}
        onSetDisposition={onSetDisposition}
        renderControl={(candidate) => (
          <Select
            value={candidate.resolutions.existingContact}
            onValueChange={(value) =>
              value &&
              onResolveExistingContact(
                candidate.sourceKey,
                value as MemberImportExistingContactResolution
              )
            }
          >
            <SelectTrigger
              className="w-full"
              aria-label={`Resolve existing contact for source row ${candidate.sourceRow}`}
            >
              <SelectValue placeholder="Choose which details to keep" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep_existing">Keep saved details</SelectItem>
              <SelectItem value="use_csv">
                Use details from your file
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      />
    );
  }

  return <IssueRows group={group} onSetDisposition={onSetDisposition} />;
}

/**
 * What this row will create. The kind badge is shown only when the row is
 * NOT a plain membership: twenty identical "Membership" pills teach nothing,
 * while a service or a combined purchase is exactly what an operator has to
 * catch before committing. `wrap` gives the phone card its full width; the
 * table cell truncates to one line so it fits the inline editor's box.
 */
function CandidateOffering({
  candidate,
  wrap = false,
}: {
  candidate: MemberImportCandidate;
  wrap?: boolean;
}) {
  const service = candidate.serviceComponent?.intent;
  const membershipLabel = candidate.draftValues.planName
    ? [candidate.draftValues.planName, candidate.draftValues.pricingOption]
        .filter(Boolean)
        .join(' · ')
    : null;
  const serviceLabel = service
    ? [service.itemName, service.optionLabel, service.trainerName]
        .filter(Boolean)
        .join(' · ')
    : candidate.draftValues.serviceName || null;
  const label = [membershipLabel, serviceLabel].filter(Boolean).join(' + ');
  // A row that carries an offering the catalog could not match is the one
  // an operator must act on; a row that simply has none is a state, not a
  // failure, so only the first earns the warning tint.
  const unmatched = candidate.outcomeKind === 'none' && label.length > 0;
  const exception =
    candidate.outcomeKind === 'membership_service'
      ? 'Membership + service'
      : candidate.outcomeKind === 'service'
        ? 'Service'
        : unmatched
          ? 'Unmatched'
          : null;
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-2',
        wrap && 'flex-wrap items-baseline'
      )}
    >
      {exception ? (
        <Badge variant={unmatched ? 'warning' : 'neutral'} className="shrink-0">
          {exception}
        </Badge>
      ) : null}
      <span
        className={cn(
          'min-w-0 text-sm',
          wrap ? 'break-words' : 'flex-1 truncate',
          label ? 'text-foreground' : 'text-muted-foreground'
        )}
        title={wrap ? undefined : label || undefined}
      >
        {label || 'No offering'}
      </span>
    </span>
  );
}

/** The amount this row was sold for — the membership fee plus any service. */
function CandidateFee({ candidate }: { candidate: MemberImportCandidate }) {
  const { fmt } = useLocale();
  if (candidate.purchaseTotal === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span className="text-sm tabular-nums">
      {fmt.money(candidate.purchaseTotal)}
    </span>
  );
}

/**
 * The column is called Expiry, so the cell states the date rather than
 * restating the column. A combined purchase adds its service end beneath;
 * a service-only row promotes that date to the primary line.
 */
function CandidateDates({ candidate }: { candidate: MemberImportCandidate }) {
  const { fmt } = useLocale();
  const membershipEnd = candidate.built.membership?.end_date;
  const serviceEnd = candidate.serviceComponent?.intent.endDate;
  const primary = membershipEnd ?? serviceEnd;
  if (!primary) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate tabular-nums">{fmt.date(primary)}</span>
      {membershipEnd && serviceEnd ? (
        <span className="truncate tabular-nums">
          Service to {fmt.dateShort(serviceEnd)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Why an automatic exclusion happened, in the domain's own words. `manual` is
 * deliberately absent: the operator excluded that row and needs no reminder.
 */
const AUTOMATIC_EXCLUSION_LABELS: Partial<
  Record<MemberImportCandidateExclusionReason, string>
> = {
  'membership-history': 'Older membership',
  'summary-row': 'Summary row',
  'existing-member': 'Already a member',
};

function CandidateStatus({ candidate }: { candidate: MemberImportCandidate }) {
  if (candidate.disposition === 'excluded') {
    const reason = candidate.exclusionReason
      ? AUTOMATIC_EXCLUSION_LABELS[candidate.exclusionReason]
      : null;
    return (
      <span className="text-muted-foreground flex min-w-0 flex-col text-xs">
        <span className="inline-flex items-center gap-1.5">
          <XCircle className="size-3.5 shrink-0" /> Excluded
        </span>
        {/* An automatic exclusion cannot be toggled, so the row has to say
            why it is out — otherwise the disabled action is the only clue. */}
        {reason ? <span className="truncate pl-5">{reason}</span> : null}
      </span>
    );
  }
  if (candidate.isReady) {
    const noticeCount = candidate.issues.filter(
      (issue) => issue.severity === 'notice'
    ).length;
    return (
      <span className="text-emerald-foreground inline-flex items-center gap-1.5 text-xs">
        <CheckCircle className="size-3.5 shrink-0" /> Ready
        {noticeCount > 0 &&
          ` · ${noticeCount} notice${noticeCount === 1 ? '' : 's'}`}
      </span>
    );
  }
  return (
    <span className="text-amber-foreground inline-flex items-center gap-1.5 text-xs">
      <AlertTriangle className="size-3.5 shrink-0" /> Needs resolution
    </span>
  );
}

function DispositionAction({
  candidate,
  onSetDisposition,
}: {
  candidate: MemberImportCandidate;
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const automatic =
    candidate.exclusionReason === 'membership-history' ||
    candidate.exclusionReason === 'summary-row' ||
    candidate.exclusionReason === 'existing-member';
  const name = candidateName(candidate);
  if (automatic) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Info className="size-3.5 shrink-0" /> Automatic
      </span>
    );
  }
  const included = candidate.disposition === 'included';
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={`${included ? 'Exclude' : 'Include'} ${name}, source row ${candidate.sourceRow}`}
      onClick={() =>
        onSetDisposition(
          candidate.sourceKey,
          included ? 'excluded' : 'included'
        )
      }
    >
      {included ? 'Exclude' : 'Include'}
    </Button>
  );
}

/**
 * Shared by the table and the phone card so one filter state cannot show two
 * different dead ends. The reset is the recovery: a filtered-away ledger with
 * no way back is the state operators actually get stuck in.
 */
function EmptyRows({
  filtered,
  onReset,
}: {
  filtered: boolean;
  onReset: () => void;
}) {
  return (
    // Top-weighted on a phone, where the frame is tall enough that a centred
    // message lands well below the fold; centred once the table surface takes
    // over and the frame is short.
    <div className="border-border flex min-h-0 flex-1 flex-col items-center justify-start gap-3 rounded-xl border px-6 pt-16 pb-12 text-center md:justify-center md:pt-12">
      <p className="text-sm font-medium">No rows match this view</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        {filtered
          ? 'Every row is hidden by the current search or filter.'
          : 'This import has no rows to review.'}
      </p>
      {filtered ? (
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          Show all rows
        </Button>
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { fmt } = useLocale();
  return (
    <div className="border-border flex h-11 shrink-0 items-center justify-between gap-3 border-t px-3">
      <p className="text-muted-foreground text-xs tabular-nums">
        {fmt.number(total)} row{total === 1 ? '' : 's'}
      </p>
      {/* A single page needs no pager: two dead arrows and "Page 1 of 1"
          are chrome that says nothing. */}
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={page === 0}
            aria-label="Previous page"
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground px-2 text-xs tabular-nums">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={page >= pageCount - 1}
            aria-label="Next page"
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export type { ImportMembersPreviewProps };
