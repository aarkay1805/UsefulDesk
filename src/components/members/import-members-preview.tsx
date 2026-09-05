'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Info,
  XCircle,
} from 'lucide-react';

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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocale } from '@/hooks/use-locale';
import {
  effectiveBalance,
  resolvePaymentConflict,
  type MemberImportCandidateContext,
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
import { downloadCsv, toCsv } from '@/lib/csv/export';
import { durationLabel } from '@/lib/memberships/pricing';
import { cn } from '@/lib/utils';
import type { CatalogItem, MembershipPlan, Trainer } from '@/types';
import { MemberIdentity } from './member-identity';

const PAGE_SIZE = 50;

type CandidatePatch = Partial<MemberImportDraftValues>;
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
  'pricing-mismatch': 'Correct membership pricing',
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
  context?: MemberImportCandidateContext;
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

interface IssueSection {
  key: string;
  title: string;
  groups: IssueGroup[];
  sourceKeys: Set<string>;
}

const ISSUE_SECTION_LABELS: Partial<Record<IssueCode, string>> = {
  'missing-phone': 'Missing phones',
  'invalid-phone': 'Invalid phones',
  'shared-phone': 'Duplicate phones',
  'offering-needs-classification': 'Plan or service',
  'service-needs-resolution': 'Service matching',
  'service-values-invalid': 'Service details',
  'duplicate-service': 'Duplicate services',
  'existing-contact': 'Contact details',
  'invalid-membership-values': 'Member details',
  'expiry-not-after-start': 'Membership dates',
};

/** Group navigation by problem, without expanding the scope of a bulk fix. */
function issueSections(groups: IssueGroup[]): IssueSection[] {
  const sections = new Map<string, IssueSection>();
  for (const group of groups) {
    const billing = [
      'payment-conflict',
      'pricing-mismatch',
      'purchase-total-mismatch',
    ].includes(group.code);
    const plan = [
      'plan-needs-resolution',
      'pricing-option-needs-resolution',
    ].includes(group.code);
    const key = billing ? 'billing' : plan ? 'plans' : group.code;
    const title = billing
      ? 'Billing issues'
      : plan
        ? 'Plan matching'
        : (ISSUE_SECTION_LABELS[group.code] ?? group.title);
    let section = sections.get(key);
    if (!section) {
      section = { key, title, groups: [], sourceKeys: new Set() };
      sections.set(key, section);
    }
    section.groups.push(group);
    for (const candidate of group.candidates) {
      section.sourceKeys.add(candidate.sourceKey);
    }
  }
  const order = [
    'billing',
    'missing-phone',
    'invalid-phone',
    'shared-phone',
    'plans',
  ];
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index < 0 ? order.length : index;
  };
  return [...sections.values()].sort((a, b) => rank(a.key) - rank(b.key));
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

/** Issue groups lead to a worksheet whose table and resolver share a selection. */
export function ImportMembersPreview(props: ImportMembersPreviewProps) {
  const { candidates, plans, catalogItems, trainers } = props;
  const { fmt } = useLocale();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MemberImportCandidateFilter>(() =>
    candidates.some((row) => row.disposition === 'included' && !row.isReady)
      ? 'needs-resolution'
      : 'all'
  );
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(
    null
  );
  const [showRules, setShowRules] = useState(false);
  const [detailEditor, setDetailEditor] = useState<'phone' | 'plan' | null>(
    null
  );
  const summary = useMemo(
    () => summarizeMemberImportCandidates(candidates),
    [candidates]
  );
  const groups = useMemo(() => unresolvedGroups(candidates), [candidates]);
  const sections = useMemo(() => issueSections(groups), [groups]);
  const activeSection =
    filter === 'needs-resolution'
      ? (sections.find((section) => section.key === selectedSectionKey) ??
        sections[0])
      : undefined;
  const visible = useMemo(() => {
    const filtered = filterMemberImportCandidates(
      searchMemberImportCandidates(candidates, search),
      filter
    );
    return activeSection
      ? filtered.filter((row) => activeSection.sourceKeys.has(row.sourceKey))
      : filtered;
  }, [candidates, search, filter, activeSection]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const selectedIndex = visible.findIndex(
    (row) => row.sourceKey === selectedKey
  );
  const safePage =
    selectedIndex >= 0
      ? Math.floor(selectedIndex / PAGE_SIZE)
      : Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selected =
    paged.find((row) => row.sourceKey === selectedKey) ?? paged[0] ?? null;
  const rowGroups = selected
    ? (activeSection?.groups ?? groups).filter((group) =>
        group.candidates.some((row) => row.sourceKey === selected.sourceKey)
      )
    : [];
  const unresolvedGroup =
    rowGroups.find((group) => group.key === selectedIssueKey) ?? rowGroups[0];
  const activeGroup: IssueGroup | undefined =
    selected && detailEditor
      ? {
          key: `edit:${detailEditor}:${selected.sourceKey}`,
          code:
            detailEditor === 'phone'
              ? 'invalid-phone'
              : 'plan-needs-resolution',
          title:
            detailEditor === 'phone'
              ? 'Edit phone'
              : 'Change plan and billing option',
          explanation:
            detailEditor === 'phone'
              ? 'Use this member’s own phone number.'
              : 'Choose the plan and billing option for this row.',
          nextAction: '',
          candidates: [selected],
        }
      : unresolvedGroup;
  const counts: Record<MemberImportCandidateFilter, number> = {
    all: summary.source,
    'needs-resolution': summary.needsResolution,
    ready: summary.ready,
    excluded: summary.exclusions,
  };
  const context = props.context ?? {
    plans,
    catalogItems,
    trainers,
    dateOrder: 'DMY',
    today: fmt.today(),
  };

  function changeFilter(value: MemberImportCandidateFilter) {
    setDetailEditor(null);
    setFilter(value);
    setPage(0);
    setSelectedKey(null);
    setSelectedIssueKey(null);
    setInspectorOpen(false);
  }
  function changeSection(key: string) {
    setSelectedSectionKey(key);
    setDetailEditor(null);
    setSelectedIssueKey(null);
    setSelectedKey(null);
    setPage(0);
    setSearch('');
    setInspectorOpen(false);
  }
  function selectRow(row: MemberImportCandidate) {
    setDetailEditor(null);
    setSelectedKey(row.sourceKey);
    setSelectedIssueKey(null);
    setInspectorOpen(true);
  }
  function nextRow() {
    setDetailEditor(null);
    const index = visible.findIndex(
      (row) => row.sourceKey === selected?.sourceKey
    );
    const next = visible[index + 1] ?? visible[index - 1];
    if (next) {
      setSelectedKey(next.sourceKey);
      setPage(Math.floor(visible.indexOf(next) / PAGE_SIZE));
    } else setInspectorOpen(false);
    setSelectedIssueKey(null);
  }
  function exportExcluded() {
    // Preserve source text for recovery, with spreadsheet formula cells escaped.
    const safe = (value: string | null | undefined) =>
      value && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    downloadCsv(
      'member-import-excluded.csv',
      toCsv(
        [
          'Source row',
          'Member ID',
          'Name',
          'Phone',
          'Plan',
          'Service',
          'Fee',
          'Paid',
          'Balance',
          'Reason',
        ],
        candidates
          .filter((row) => row.disposition === 'excluded')
          .map((row) => [
            row.sourceRow,
            safe(row.legacyMemberId),
            safe(row.originalValues.name),
            safe(row.originalValues.phone),
            safe(row.originalValues.planName),
            safe(row.originalValues.serviceName),
            safe(row.originalValues.fee),
            safe(row.originalValues.amountPaid),
            safe(effectiveBalance(row.originalValues)),
            row.issues.map((issue) => issue.explanation).join(' ') ||
              'Excluded by you',
          ])
      )
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      aria-label="Import worksheet"
    >
      <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_auto_24rem]">
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col',
            inspectorOpen ? 'hidden xl:flex' : 'flex'
          )}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 py-4">
            <SearchInput
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                setPage(0);
                setSelectedKey(null);
                setSelectedIssueKey(null);
                setDetailEditor(null);
              }}
              placeholder="Search name or ID"
              aria-label="Search import rows"
            />
            <ChipGroup<MemberImportCandidateFilter>
              className="basis-full sm:basis-0"
              selectionMode="single"
              value={[filter]}
              onValueChange={(values) => values[0] && changeFilter(values[0])}
              aria-label="Import row filters"
            >
              {(
                [
                  ['needs-resolution', 'Needs review'],
                  ['ready', 'Ready'],
                  ['excluded', 'Excluded'],
                  ['all', 'All'],
                ] as const
              ).map(([value, label]) => (
                <Chip key={value} value={value}>
                  {label} <ChipCount count={counts[value]} />
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <Separator />
          {activeSection && (
            <>
              <div className="shrink-0 space-y-2 px-6 py-3">
                <ChipGroup<string>
                  className="hidden sm:block"
                  selectionMode="single"
                  value={[activeSection.key]}
                  onValueChange={(values) =>
                    values[0] && changeSection(values[0])
                  }
                  aria-label="Issue groups"
                >
                  {sections.map((section) => (
                    <Chip key={section.key} value={section.key}>
                      {section.title}{' '}
                      <ChipCount count={section.sourceKeys.size} />
                    </Chip>
                  ))}
                </ChipGroup>
                <div className="sm:hidden">
                  <Select<string>
                    value={activeSection.key}
                    onValueChange={(value) => value && changeSection(value)}
                  >
                    <SelectTrigger className="w-full" aria-label="Issue group">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((section) => (
                        <SelectItem key={section.key} value={section.key}>
                          {section.title} ·{' '}
                          {fmt.number(section.sourceKeys.size)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-muted-foreground text-xs">
                  Rows with more than one issue appear in each relevant group.
                </p>
              </div>
              <Separator />
            </>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-6 py-2">
            <p
              className="text-muted-foreground text-xs tabular-nums"
              role="status"
            >
              {fmt.number(visible.length)} row{visible.length === 1 ? '' : 's'}{' '}
              {activeSection
                ? `in ${activeSection.title.toLowerCase()}`
                : 'in this view'}
            </p>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowRules(!showRules)}
              aria-expanded={showRules}
            >
              {showRules ? 'Hide import rules' : 'View import rules'}
            </Button>
          </div>
          {showRules && (
            <div className="shrink-0 px-6 pb-3">
              <Alert>
                <Info />
                <AlertDescription>
                  Resolve every included row before confirming. Matched plan and
                  service choices apply to the matching rows named in the
                  inspector. Older membership rows, summary rows, and existing
                  memberships are excluded automatically. Review each exclusion
                  before importing.
                </AlertDescription>
              </Alert>
            </div>
          )}
          {visible.length === 0 ? (
            <div className="flex min-h-0 flex-1 px-6 pb-4">
              <EmptyRows
                filtered={search.trim().length > 0 || filter !== 'all'}
                onReset={() => {
                  setSearch('');
                  changeFilter('all');
                }}
              />
            </div>
          ) : (
            <>
              <Table
                containerClassName="hidden min-h-0 flex-1 overflow-auto md:block"
                className="min-w-[780px] table-fixed"
                aria-label="Import rows"
                data-testid="member-import-desktop"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48 pl-6">Name</TableHead>
                    <TableHead className="w-40">Plan</TableHead>
                    <TableHead className="w-22 text-right">Fee</TableHead>
                    <TableHead className="w-22 text-right">Paid</TableHead>
                    <TableHead className="w-22 text-right">Balance</TableHead>
                    <TableHead className="w-44 pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((row) => (
                    <TableRow
                      key={row.sourceKey}
                      data-state={
                        selected?.sourceKey === row.sourceKey
                          ? 'selected'
                          : undefined
                      }
                      className="cursor-pointer"
                      onClick={() => selectRow(row)}
                    >
                      <TableCell className="py-3 pl-6">
                        <MemberIdentity
                          name={candidateName(row)}
                          secondary={`Source row ${row.sourceRow}`}
                        />
                      </TableCell>
                      <TableCell>
                        <CandidateOffering candidate={row} />
                      </TableCell>
                      <TableCell className="text-right">
                        <SourceMoney value={row.draftValues.fee} />
                      </TableCell>
                      <TableCell className="text-right">
                        <SourceMoney value={row.draftValues.amountPaid} />
                      </TableCell>
                      <TableCell className="text-right">
                        <SourceMoney
                          value={effectiveBalance(row.draftValues)}
                        />
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center justify-between gap-2">
                          <CandidateStatus candidate={row} />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Review ${candidateName(row)}, source row ${row.sourceRow}`}
                            aria-pressed={selected?.sourceKey === row.sourceKey}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectRow(row);
                            }}
                          >
                            <ChevronRight />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ScrollArea
                className="min-h-0 flex-1 md:hidden"
                data-testid="member-import-mobile"
              >
                <div className="space-y-3 px-6 pb-4">
                  {paged.map((row) => (
                    <article key={row.sourceKey} className="space-y-3 py-3">
                      <MemberIdentity
                        name={candidateName(row)}
                        secondary={
                          row.draftValues.phone
                            ? fmt.phone(row.draftValues.phone)
                            : 'No phone'
                        }
                        meta={`Source row ${row.sourceRow} · ${row.legacyMemberId || 'No Member ID'}`}
                      />
                      <CandidateOffering candidate={row} wrap />
                      <div className="flex items-center justify-between gap-2">
                        <CandidateStatus candidate={row} />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => selectRow(row)}
                          aria-label={`Review ${candidateName(row)}, source row ${row.sourceRow}`}
                        >
                          Review row
                        </Button>
                      </div>
                      <Separator />
                    </article>
                  ))}
                </div>
              </ScrollArea>
              <Pagination
                page={safePage}
                pageCount={pageCount}
                total={visible.length}
                onPageChange={(value) => {
                  setPage(value);
                  setSelectedKey(null);
                }}
              />
            </>
          )}
          {summary.exclusions > 0 && (
            <>
              <Separator />
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-6 py-3">
                <Info className="text-muted-foreground size-4" aria-hidden />
                <p className="text-muted-foreground text-xs">
                  {fmt.number(summary.exclusions)} rows will not be imported.
                </p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    changeFilter('excluded');
                  }}
                >
                  Review excluded rows
                </Button>
                <Button variant="link" size="sm" onClick={exportExcluded}>
                  <Download />
                  Download excluded rows
                </Button>
              </div>
            </>
          )}
        </div>
        <Separator orientation="vertical" className="hidden xl:block" />
        <div
          role={selected ? 'region' : undefined}
          aria-label={selected ? 'Row inspector' : undefined}
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col',
            inspectorOpen ? 'flex' : 'hidden xl:flex'
          )}
        >
          {selected ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 px-6 pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="xl:hidden"
                  onClick={() => setInspectorOpen(false)}
                >
                  <ChevronLeft />
                  Back to rows
                </Button>
                <p className="text-muted-foreground text-xs">
                  Row {selected.sourceRow} details
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Previous row"
                    disabled={visible[0]?.sourceKey === selected.sourceKey}
                    onClick={() => {
                      const index = visible.indexOf(selected) - 1;
                      selectRow(visible[index]);
                      setPage(Math.floor(index / PAGE_SIZE));
                    }}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Next row"
                    disabled={visible.at(-1)?.sourceKey === selected.sourceKey}
                    onClick={() => {
                      const index = visible.indexOf(selected) + 1;
                      selectRow(visible[index]);
                      setPage(Math.floor(index / PAGE_SIZE));
                    }}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
              <div className="shrink-0 px-6 pt-4 pb-3">
                <MemberIdentity
                  name={candidateName(selected)}
                  secondary={
                    selected.draftValues.phone
                      ? fmt.phone(selected.draftValues.phone)
                      : 'No phone'
                  }
                  meta={
                    <p className="text-muted-foreground text-xs">
                      Member ID {selected.legacyMemberId || 'not set'}
                    </p>
                  }
                />
              </div>
              <Separator />
              <ScrollArea key={selected.sourceKey} className="min-h-0 flex-1">
                <div className="@container space-y-4 px-6 py-4">
                  {rowGroups.length > 1 && (
                    <Select
                      value={activeGroup?.key}
                      onValueChange={(value) =>
                        value &&
                        (setDetailEditor(null), setSelectedIssueKey(value))
                      }
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label="Choose issue"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rowGroups.map((group) => (
                          <SelectItem key={group.key} value={group.key}>
                            {group.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {activeGroup ? (
                    <section aria-label="Focused issue" className="space-y-3">
                      <h3 className="flex items-start gap-2 text-sm font-semibold">
                        <AlertTriangle
                          className="text-amber-foreground mt-0.5 size-4 shrink-0"
                          aria-hidden
                        />
                        {activeGroup.title}
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        {activeGroup.explanation} {activeGroup.nextAction}
                      </p>
                      <GroupResolver
                        key={`${selected.sourceKey}:${activeGroup.key}`}
                        {...props}
                        context={context}
                        group={activeGroup}
                        onResolvePayment={(...args) => {
                          props.onResolvePayment(...args);
                          nextRow();
                        }}
                      />
                    </section>
                  ) : (
                    <div className="space-y-4">
                      <CandidateStatus candidate={selected} />
                      {selected.disposition === 'included' && (
                        <>
                          <CandidateOffering candidate={selected} wrap />
                          <dl className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <dt className="text-muted-foreground">Fee</dt>
                              <dd>
                                <CandidateFee candidate={selected} />
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Expiry</dt>
                              <dd>
                                <CandidateDates candidate={selected} />
                              </dd>
                            </div>
                          </dl>
                        </>
                      )}
                      <DispositionAction
                        candidate={selected}
                        onSetDisposition={props.onSetDisposition}
                      />
                    </div>
                  )}
                  {selected.disposition === 'included' && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          setDetailEditor(
                            detailEditor === 'phone' ? null : 'phone'
                          )
                        }
                      >
                        {detailEditor === 'phone'
                          ? 'Cancel phone edit'
                          : 'Edit phone'}
                      </Button>
                      {selected.outcomeKind === 'membership' && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() =>
                            setDetailEditor(
                              detailEditor === 'plan' ? null : 'plan'
                            )
                          }
                        >
                          {detailEditor === 'plan'
                            ? 'Cancel plan change'
                            : 'Change plan'}
                        </Button>
                      )}
                    </div>
                  )}
                  {selected.issues.some(
                    (issue) => issue.severity === 'notice'
                  ) && (
                    <div className="space-y-3">
                      <Separator />
                      <h3 className="text-sm font-semibold">Import notices</h3>
                      {selected.issues
                        .filter((issue) => issue.severity === 'notice')
                        .map((issue) => (
                          <div
                            key={`${issue.code}:${issue.groupKey}`}
                            className="space-y-1"
                          >
                            <p className="text-sm">{issue.explanation}</p>
                            <p className="text-muted-foreground text-xs">
                              {issue.nextAction}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="text-muted-foreground px-6 py-8 text-sm">
              Select a row to inspect its values and import notices.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceMoney({ value }: { value?: string }) {
  const { fmt } = useLocale();
  const amount = parseMoney(value ?? '');
  return (
    <span
      className="block truncate tabular-nums"
      title={amount === null ? value : undefined}
    >
      {amount === null ? value || '—' : fmt.money(amount)}
    </span>
  );
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
  if (group.candidates.length === 1) {
    const candidate = group.candidates[0];
    return (
      <div className="space-y-3">
        {renderControl?.(candidate)}
        <ExcludeAction
          candidate={candidate}
          onSetDisposition={onSetDisposition}
        />
      </div>
    );
  }
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
  const [choice, setChoice] = useState<string | null>(null);
  const affected = group.candidates.map(candidateName);
  const shown = affected.slice(0, 3).join(', ');
  const remaining = affected.length - 3;
  return (
    <div className="space-y-3">
      {/* One choice maps rows the operator cannot see here, so the container
          and its caption name exactly who the mapping lands on. */}
      <div className="border-border grid gap-3 rounded-xl border p-3 @xl:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] @xl:items-center">
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
          <Select<string> value={choice} onValueChange={setChoice}>
            <SelectTrigger className="w-full" aria-label={ariaLabel}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>{children}</SelectContent>
          </Select>
        )}
      </div>
      {!unavailable && (
        <Button
          className="w-full"
          disabled={!choice}
          onClick={() => choice && onValueChange(choice)}
        >
          Save mapping
          {group.candidates.length > 1
            ? ` for ${group.candidates.length} rows`
            : ''}
          <ArrowRight />
        </Button>
      )}
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

      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
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
  context,
  onResolvePayment,
  onSetDisposition,
}: {
  group: IssueGroup;
  context: MemberImportCandidateContext;
  onResolvePayment: ImportMembersPreviewProps['onResolvePayment'];
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const { fmt } = useLocale();
  const candidate = group.candidates[0];
  const [choice, setChoice] = useState<string | null>(null);
  const [manual, setManual] = useState({
    paid: candidate.draftValues.amountPaid ?? '',
    balance: effectiveBalance(candidate.draftValues) ?? '',
  });
  const fee = parseMoney(candidate.draftValues.fee ?? '');
  const paid = parseMoney(candidate.draftValues.amountPaid ?? '');
  const balance = parseMoney(effectiveBalance(candidate.draftValues) ?? '');
  const resolution =
    choice === 'keep_fee_paid'
      ? 'manual'
      : (choice as MemberImportPaymentResolution | null);
  const correction =
    choice === 'keep_fee_paid' && fee !== null && paid !== null
      ? {
          paid: String(paid),
          balance: String(Math.round((fee - paid) * 100) / 100),
        }
      : choice === 'manual'
        ? manual
        : undefined;
  const preview = resolution
    ? resolvePaymentConflict(
        [candidate],
        candidate.sourceKey,
        resolution,
        correction,
        context
      )[0]
    : null;
  const previewPaid = preview?.built.payment?.amount ?? 0;
  const previewFee = preview?.purchaseTotal ?? null;
  const previewBalance = preview
    ? parseMoney(effectiveBalance(preview.draftValues) ?? '')
    : null;
  const inputsValid =
    choice === 'manual'
      ? parseMoney(manual.paid) !== null &&
        parseMoney(manual.paid)! >= 0 &&
        parseMoney(manual.balance) !== null
      : choice === 'keep_fee_paid'
        ? fee !== null && paid !== null && paid >= 0
        : choice === 'trust_balance'
          ? fee !== null && balance !== null && balance <= fee
          : choice === 'trust_paid'
            ? paid !== null && paid >= 0 && balance !== null
            : false;
  const figuresValid =
    inputsValid &&
    previewFee !== null &&
    previewFee >= 0 &&
    previewPaid <= previewFee &&
    previewBalance !== null &&
    previewBalance >= 0 &&
    Math.abs(previewFee - previewPaid - previewBalance) <= 0.01 &&
    !preview?.issues.some(
      (issue) =>
        !issue.resolved &&
        issue.severity !== 'notice' &&
        [
          'payment-conflict',
          'invalid-membership-values',
          'pricing-mismatch',
          'purchase-total-mismatch',
        ].includes(issue.code)
    );

  return (
    <div className="space-y-4">
      <dl className="space-y-2 text-sm">
        {(
          [
            ['Fee', candidate.draftValues.fee],
            ['Paid', candidate.draftValues.amountPaid],
            ['Balance', effectiveBalance(candidate.draftValues)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>
              <SourceMoney value={value} />
            </dd>
          </div>
        ))}
      </dl>
      {fee !== null && paid !== null && balance !== null && (
        <p className="text-amber-foreground text-sm">
          Difference:{' '}
          <span className="tabular-nums">
            {fmt.money(Math.abs(fee - paid - balance))}
          </span>
        </p>
      )}
      <Separator />
      <div className="space-y-2">
        <Label htmlFor={`payment-choice-${candidate.sourceKey}`}>
          Use these figures
        </Label>
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger
            id={`payment-choice-${candidate.sourceKey}`}
            className="w-full"
            aria-label={`Resolve payment for source row ${candidate.sourceRow}`}
          >
            <SelectValue placeholder="Choose which figures to keep" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value="keep_fee_paid"
              disabled={fee === null || paid === null || paid > fee}
            >
              Keep fee and paid amount
            </SelectItem>
            <SelectItem value="trust_balance">Keep fee and balance</SelectItem>
            <SelectItem value="trust_paid">
              Keep paid and balance, recalculate fee
            </SelectItem>
            <SelectItem value="manual">Enter corrected figures</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {choice === 'manual' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label size="sm" htmlFor={`paid-${candidate.sourceKey}`}>
              Corrected paid
            </Label>
            <Input
              id={`paid-${candidate.sourceKey}`}
              inputMode="decimal"
              value={manual.paid}
              onChange={(event) =>
                setManual({ ...manual, paid: event.currentTarget.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label size="sm" htmlFor={`balance-${candidate.sourceKey}`}>
              Corrected balance
            </Label>
            <Input
              id={`balance-${candidate.sourceKey}`}
              inputMode="decimal"
              value={manual.balance}
              onChange={(event) =>
                setManual({ ...manual, balance: event.currentTarget.value })
              }
            />
          </div>
        </div>
      )}
      {preview && (
        <section aria-label="After correction" className="space-y-3">
          <Separator />
          <h4 className="text-sm font-medium">After correction</h4>
          <dl className="space-y-2 text-sm">
            {(
              [
                ['Fee', previewFee],
                ['Already paid', previewPaid],
                [
                  'Opening dues',
                  previewFee === null ? null : previewFee - previewPaid,
                ],
              ] as const
            ).map(([label, amount]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">
                  {amount === null ? '—' : fmt.money(amount)}
                </dd>
              </div>
            ))}
          </dl>
          {figuresValid ? (
            <p className="text-emerald-foreground flex items-center gap-2 text-sm">
              <CheckCircle className="size-4" />
              Figures reconcile
            </p>
          ) : (
            <p role="alert" className="text-amber-foreground text-sm">
              These figures still conflict. Check the fee, paid amount, and
              balance.
            </p>
          )}
          {choice !== 'manual' && (
            <Button
              variant="link"
              size="sm"
              onClick={() => setChoice('manual')}
            >
              Enter amounts manually
            </Button>
          )}
        </section>
      )}
      <Button
        className="w-full"
        disabled={!resolution || !figuresValid}
        onClick={() => {
          if (resolution && figuresValid)
            onResolvePayment(candidate.sourceKey, resolution, correction);
        }}
      >
        Save &amp; next row
        <ArrowRight />
      </Button>
      <ExcludeGroupAction group={group} onSetDisposition={onSetDisposition} />
    </div>
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
        <div className="grid gap-3 @xs:grid-cols-2">
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
    key: 'serviceListPrice',
    label: 'Service list price',
    inputMode: 'decimal',
  },
  {
    key: 'serviceDiscountAmount',
    label: 'Service discount',
    inputMode: 'decimal',
  },
  {
    key: 'serviceDiscountPercent',
    label: 'Service discount %',
    inputMode: 'decimal',
  },
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
  context,
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
  context: MemberImportCandidateContext;
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

  if (group.code === 'pricing-mismatch') {
    return (
      <FieldCorrectionResolver
        group={group}
        fields={[
          { key: 'listPrice', label: 'List price', inputMode: 'decimal' },
          { key: 'discountAmount', label: 'Discount', inputMode: 'decimal' },
          { key: 'discountPercent', label: 'Discount %', inputMode: 'decimal' },
          { key: 'fee', label: 'Fee', inputMode: 'decimal' },
        ]}
        onPatch={onPatch}
        onSetDisposition={onSetDisposition}
      />
    );
  }

  if (group.code === 'payment-conflict') {
    return (
      <PaymentConflictResolver
        group={group}
        context={context}
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
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="min-w-0 whitespace-normal">
        {candidate.issues.find(
          (issue) => issue.severity !== 'notice' && !issue.resolved
        )?.code === 'payment-conflict'
          ? 'Payment mismatch'
          : 'Needs review'}
      </span>
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
