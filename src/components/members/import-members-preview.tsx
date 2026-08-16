'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Info,
  XCircle,
} from 'lucide-react';

import { EditableCell } from '@/components/leads/editable-cell';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  filterMemberImportCandidates,
  searchMemberImportCandidates,
  summarizeMemberImportCandidates,
  type MemberImportCandidate,
  type MemberImportCandidateDisposition,
  type MemberImportCandidateFilter,
  type MemberImportDraftValues,
  type MemberImportExistingContactResolution,
  type MemberImportCandidateResolutions,
  type MemberImportPaymentCorrection,
  type MemberImportPaymentResolution,
} from '@/lib/memberships/member-import-candidates';
import { parseMoney } from '@/lib/memberships/import-commit';
import { durationLabel } from '@/lib/memberships/pricing';
import type { CatalogItem, MembershipPlan, Trainer } from '@/types';
import { MemberIdentity } from './member-identity';

const PAGE_SIZE = 50;

type CandidatePatch = Partial<MemberImportDraftValues>;
type EditingCell = {
  sourceKey: string;
  key: string;
  surface: 'desktop' | 'mobile';
} | null;

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
  code: MemberImportCandidate['issues'][number]['code'];
  candidates: MemberImportCandidate[];
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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MemberImportCandidateFilter>('all');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [manualPaymentKey, setManualPaymentKey] = useState<string | null>(null);
  const [manualPayments, setManualPayments] = useState<
    Record<string, { paid: string; balance: string }>
  >({});

  const summary = useMemo(
    () => summarizeMemberImportCandidates(candidates),
    [candidates]
  );
  const groups = useMemo(() => unresolvedGroups(candidates), [candidates]);
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder="Search customers or Member ID"
          aria-label="Search import candidates"
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
          aria-label="Import candidate filters"
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

      {groups.length > 0 && (
        <section aria-labelledby="member-import-resolutions-heading">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3
                id="member-import-resolutions-heading"
                className="text-foreground text-sm font-medium"
              >
                Grouped resolutions
              </h3>
              <p className="text-muted-foreground text-xs">
                Resolve a source pattern once, then review individual rows.
              </p>
            </div>
            <Badge variant="warning">
              {fmt.number(summary.needsResolution)} need resolution
            </Badge>
          </div>
          <Accordion multiple defaultValue={groups.map((group) => group.key)}>
            {groups.map((group) => (
              <AccordionItem key={group.key} value={group.key}>
                <AccordionTrigger>
                  <span className="flex min-w-0 items-center gap-2">
                    <AlertTriangle className="text-amber-foreground size-4 shrink-0" />
                    <span className="truncate">{groupTitle(group)}</span>
                    <Badge variant="neutral" size="count">
                      {group.candidates.length}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <GroupResolver
                    group={group}
                    plans={plans}
                    catalogItems={catalogItems}
                    trainers={trainers}
                    manualPaymentKey={manualPaymentKey}
                    manualPayments={manualPayments}
                    onManualPaymentKey={setManualPaymentKey}
                    onManualPaymentChange={(sourceKey, patch) =>
                      setManualPayments((current) => ({
                        ...current,
                        [sourceKey]: {
                          paid:
                            patch.paid ??
                            current[sourceKey]?.paid ??
                            group.candidates.find(
                              (candidate) => candidate.sourceKey === sourceKey
                            )?.draftValues.amountPaid ??
                            '',
                          balance:
                            patch.balance ??
                            current[sourceKey]?.balance ??
                            group.candidates.find(
                              (candidate) => candidate.sourceKey === sourceKey
                            )?.draftValues.balance ??
                            '',
                        },
                      }))
                    }
                    onResolveGroupedPlan={onResolveGroupedPlan}
                    onResolveGroupedOffering={onResolveGroupedOffering}
                    onResolveGroupedService={onResolveGroupedService}
                    onResolvePayment={onResolvePayment}
                    onResolveExistingContact={onResolveExistingContact}
                    onPatch={onPatch}
                    onSetDisposition={onSetDisposition}
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      <div
        data-testid="member-import-desktop"
        className="border-border ring-border/50 hidden min-h-0 flex-1 overflow-auto rounded-xl border ring-1 md:block"
      >
        <Table className="min-w-[980px] table-fixed">
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-56">Name</TableHead>
              <TableHead className="w-32">Member ID</TableHead>
              <TableHead className="w-44">Phone</TableHead>
              <TableHead className="w-56">Offering</TableHead>
              <TableHead className="w-28">Expiry</TableHead>
              <TableHead className="w-44">Import check</TableHead>
              <TableHead className="w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((candidate) => (
              <TableRow key={candidate.sourceKey}>
                <TableCell>
                  <MemberIdentity
                    name={candidate.draftValues.name || 'Unnamed member'}
                    secondary={`Source row ${candidate.sourceRow}`}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground truncate text-xs">
                  {candidate.legacyMemberId || '—'}
                </TableCell>
                <TableCell className="p-0">
                  <EditableCell
                    editing={isEditing(candidate.sourceKey, 'phone', 'desktop')}
                    saving={false}
                    kind="phone"
                    value={candidate.draftValues.phone}
                    display={
                      <span className="text-foreground truncate text-sm">
                        {candidate.draftValues.phone || 'Add phone'}
                      </span>
                    }
                    onStart={() =>
                      startEditing(candidate.sourceKey, 'phone', 'desktop')
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
                      value={candidate.built.membership?.plan_id ?? ''}
                      options={plans.map((plan) => ({
                        value: plan.id,
                        label: plan.name,
                      }))}
                      display={<CandidateOffering candidate={candidate} />}
                      onStart={() =>
                        startEditing(candidate.sourceKey, 'plan', 'desktop')
                      }
                      onCancel={() => setEditing(null)}
                      onCommit={(planId) => {
                        const plan = plans.find((item) => item.id === planId);
                        const option = plan?.pricing_options?.find(
                          (item) => item.is_active
                        );
                        if (plan && option) {
                          onResolveGroupedPlan([candidate.sourceKey], {
                            planId: plan.id,
                            pricingOptionId: option.id,
                          });
                        }
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <div className="px-3 py-2">
                      <CandidateOffering candidate={candidate} />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  <CandidateDates candidate={candidate} />
                </TableCell>
                <TableCell>
                  <CandidateStatus candidate={candidate} />
                </TableCell>
                <TableCell>
                  <DispositionAction
                    candidate={candidate}
                    onSetDisposition={onSetDisposition}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={visible.length}
          onPageChange={setPage}
        />
      </div>

      <div className="space-y-3 md:hidden" data-testid="member-import-mobile">
        {paged.map((candidate) => (
          <article
            key={candidate.sourceKey}
            className="border-border bg-background/40 space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <MemberIdentity
                name={candidate.draftValues.name || 'Unnamed member'}
                secondary={candidate.draftValues.phone || 'Phone required'}
                meta={`Source row ${candidate.sourceRow} · ${candidate.legacyMemberId || 'No Member ID'}`}
              />
              <CandidateStatus candidate={candidate} />
            </div>
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Offering</dt>
              <dd className="text-foreground min-w-0 break-words">
                <CandidateOffering candidate={candidate} />
              </dd>
              <dt className="text-muted-foreground">Dates</dt>
              <dd className="text-foreground">
                <CandidateDates candidate={candidate} />
              </dd>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  startEditing(candidate.sourceKey, 'phone', 'mobile')
                }
              >
                {candidate.draftValues.phone ? 'Edit phone' : 'Add phone'}
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
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={visible.length}
          onPageChange={setPage}
        />
      </div>

      {visible.length === 0 && (
        <div className="border-border text-muted-foreground rounded-xl border py-10 text-center text-sm">
          No candidates match this view.
        </div>
      )}
    </div>
  );
}

function groupTitle(group: IssueGroup) {
  switch (group.code) {
    case 'plan-needs-resolution':
    case 'pricing-option-needs-resolution':
      return 'Match plan and billing option';
    case 'offering-needs-classification':
      return 'Classify plan or service';
    case 'service-needs-resolution':
      return 'Match service, option, and trainer';
    case 'service-values-invalid':
      return 'Correct service dates or price';
    case 'duplicate-service':
      return 'Resolve duplicate service purchase';
    case 'purchase-total-mismatch':
      return 'Correct purchase total';
    case 'payment-conflict':
      return 'Payment figures conflict';
    case 'missing-phone':
    case 'invalid-phone':
    case 'shared-phone':
      return 'Repair phone numbers';
    case 'existing-contact':
      return 'Choose how to attach existing contacts';
    default:
      return 'Correct membership details';
  }
}

function GroupResolver({
  group,
  plans,
  catalogItems,
  trainers,
  manualPaymentKey,
  manualPayments,
  onManualPaymentKey,
  onManualPaymentChange,
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
  manualPaymentKey: string | null;
  manualPayments: Record<string, { paid: string; balance: string }>;
  onManualPaymentKey: (sourceKey: string | null) => void;
  onManualPaymentChange: (
    sourceKey: string,
    patch: Partial<{ paid: string; balance: string }>
  ) => void;
  onResolveGroupedPlan: ImportMembersPreviewProps['onResolveGroupedPlan'];
  onResolveGroupedOffering: ImportMembersPreviewProps['onResolveGroupedOffering'];
  onResolveGroupedService: ImportMembersPreviewProps['onResolveGroupedService'];
  onResolvePayment: ImportMembersPreviewProps['onResolvePayment'];
  onResolveExistingContact: ImportMembersPreviewProps['onResolveExistingContact'];
  onPatch: ImportMembersPreviewProps['onPatch'];
  onSetDisposition: ImportMembersPreviewProps['onSetDisposition'];
}) {
  const { fmt } = useLocale();
  const first = group.candidates[0];

  if (group.code === 'offering-needs-classification') {
    const sourceLabel = first.originalValues.offering || '(blank)';
    return (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] sm:items-center">
        <div>
          <p className="text-foreground text-sm font-medium break-words">
            {sourceLabel}
          </p>
          <p className="text-muted-foreground text-xs">
            Applies to {group.candidates.length} source row
            {group.candidates.length === 1 ? '' : 's'}.
          </p>
        </div>
        <Select<string>
          value={null}
          onValueChange={(value) => {
            if (!value) return;
            const [kind, primaryId, optionId] = value.split('::');
            const sourceKeys = group.candidates.map(
              (candidate) => candidate.sourceKey
            );
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
          <SelectTrigger
            className="w-full"
            aria-label={`Classify ${sourceLabel}`}
          >
            <SelectValue placeholder="Choose plan or service" />
          </SelectTrigger>
          <SelectContent>
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
                      {durationLabel(
                        option.duration_count!,
                        option.duration_unit!
                      )}
                    </SelectItem>
                  ))
              )}
          </SelectContent>
        </Select>
      </div>
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
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] sm:items-center">
        <div>
          <p className="text-foreground text-sm font-medium break-words">
            {sourceLabel}
          </p>
          <p className="text-muted-foreground text-xs">
            Only active service options and valid trainer rates are offered.
          </p>
        </div>
        {serviceChoices.length > 0 ? (
          <Select<string>
            value={null}
            onValueChange={(value) => {
              if (!value) return;
              const [itemId, optionId, trainerId] = value.split('::');
              onResolveGroupedService(
                group.candidates.map((candidate) => candidate.sourceKey),
                {
                  itemId,
                  optionId,
                  trainerId: trainerId === '-' ? null : trainerId,
                }
              );
            }}
          >
            <SelectTrigger className="w-full" aria-label={`Map ${sourceLabel}`}>
              <SelectValue placeholder="Choose service, option, and trainer" />
            </SelectTrigger>
            <SelectContent>
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
            </SelectContent>
          </Select>
        ) : (
          <p className="text-amber-foreground text-sm">
            No active matching service rate is available. Configure it in
            Settings → Products &amp; services, then reload this import.
          </p>
        )}
      </div>
    );
  }

  if (
    group.code === 'service-values-invalid' ||
    group.code === 'duplicate-service' ||
    group.code === 'purchase-total-mismatch'
  ) {
    return (
      <div className="space-y-3">
        {group.candidates.map((candidate) => {
          const prefix = `service-correction-${candidate.sourceKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          const fields: {
            key: keyof Pick<
              MemberImportDraftValues,
              'serviceStart' | 'serviceEnd' | 'serviceSoldPrice' | 'fee'
            >;
            label: string;
            value: string | undefined;
          }[] = [
            {
              key: 'serviceStart',
              label: 'Service start',
              value: candidate.draftValues.serviceStart,
            },
            {
              key: 'serviceEnd',
              label: 'Service expiry',
              value: candidate.draftValues.serviceEnd,
            },
            {
              key: 'serviceSoldPrice',
              label: 'Service sold price',
              value: candidate.draftValues.serviceSoldPrice,
            },
            {
              key: 'fee',
              label: 'Row total',
              value: candidate.draftValues.fee,
            },
          ];
          return (
            <div
              key={candidate.sourceKey}
              className="border-border grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-5"
            >
              <div className="sm:col-span-2 lg:col-span-1">
                <p className="text-foreground text-sm font-medium">
                  Source row {candidate.sourceRow}
                </p>
                <p className="text-muted-foreground text-xs">
                  {candidate.draftValues.serviceName || 'Service purchase'}
                </p>
              </div>
              {fields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`${prefix}-${field.key}`}>
                    {field.label}
                  </Label>
                  <Input
                    id={`${prefix}-${field.key}`}
                    defaultValue={field.value}
                    inputMode={
                      field.key === 'serviceSoldPrice' || field.key === 'fee'
                        ? 'decimal'
                        : undefined
                    }
                    onBlur={(event) =>
                      onPatch(candidate.sourceKey, {
                        [field.key]: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              ))}
              <div className="sm:col-span-2 lg:col-span-5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onSetDisposition(candidate.sourceKey, 'excluded')
                  }
                >
                  Exclude source row {candidate.sourceRow}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (
    group.code === 'plan-needs-resolution' ||
    group.code === 'pricing-option-needs-resolution'
  ) {
    const sourceLabel = `${first.originalValues.planName || '(blank)'} · ${first.originalValues.pricingOption || '(no billing option)'}`;
    return (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] sm:items-center">
        <div>
          <p className="text-foreground text-sm font-medium break-words">
            {sourceLabel}
          </p>
          <p className="text-muted-foreground text-xs">
            Applies to {group.candidates.length} source row
            {group.candidates.length === 1 ? '' : 's'}.
          </p>
        </div>
        <Select<string>
          value={null}
          onValueChange={(value) => {
            if (!value) return;
            const [planId, pricingOptionId] = value.split('::');
            onResolveGroupedPlan(
              group.candidates.map((candidate) => candidate.sourceKey),
              { planId, pricingOptionId }
            );
          }}
        >
          <SelectTrigger className="w-full" aria-label={`Map ${sourceLabel}`}>
            <SelectValue placeholder="Choose plan and billing option" />
          </SelectTrigger>
          <SelectContent>
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
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (group.code === 'payment-conflict') {
    return (
      <div className="space-y-4">
        {group.candidates.map((candidate) => {
          const fee = parseMoney(candidate.draftValues.fee ?? '') ?? 0;
          const paid = parseMoney(candidate.draftValues.amountPaid ?? '') ?? 0;
          const balance = parseMoney(candidate.draftValues.balance ?? '') ?? 0;
          const difference = fee - paid - balance;
          const manual = manualPayments[candidate.sourceKey] ?? {
            paid: candidate.draftValues.amountPaid ?? '',
            balance: candidate.draftValues.balance ?? '',
          };
          return (
            <div
              key={candidate.sourceKey}
              className="border-border grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] lg:items-start"
            >
              <div>
                <p className="text-foreground text-sm font-medium">
                  {candidate.draftValues.name || 'Unnamed member'} · source row{' '}
                  {candidate.sourceRow}
                </p>
                <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                  Fee {fmt.money(fee)} · Paid {fmt.money(paid)} · Balance{' '}
                  {fmt.money(balance)} · Difference {fmt.money(difference)}
                </p>
              </div>
              <div className="space-y-3">
                <Select
                  value={candidate.resolutions.payment}
                  onValueChange={(value) => {
                    if (!value) return;
                    if (value === 'manual') {
                      onManualPaymentKey(candidate.sourceKey);
                      return;
                    }
                    onManualPaymentKey(null);
                    onResolvePayment(
                      candidate.sourceKey,
                      value as MemberImportPaymentResolution
                    );
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`Resolve payment for source row ${candidate.sourceRow}`}
                  >
                    <SelectValue placeholder="Choose payment handling" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trust_paid">Trust paid</SelectItem>
                    <SelectItem value="trust_balance">Trust balance</SelectItem>
                    <SelectItem value="member_only">
                      Import member without payment
                    </SelectItem>
                    <SelectItem value="manual">
                      Enter corrected values
                    </SelectItem>
                  </SelectContent>
                </Select>
                {manualPaymentKey === candidate.sourceKey && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`paid-${candidate.sourceKey}`} size="sm">
                        Corrected paid
                      </Label>
                      <Input
                        id={`paid-${candidate.sourceKey}`}
                        inputMode="decimal"
                        value={manual.paid}
                        onChange={(event) =>
                          onManualPaymentChange(candidate.sourceKey, {
                            paid: event.currentTarget.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`balance-${candidate.sourceKey}`}
                        size="sm"
                      >
                        Corrected balance
                      </Label>
                      <Input
                        id={`balance-${candidate.sourceKey}`}
                        inputMode="decimal"
                        value={manual.balance}
                        onChange={(event) =>
                          onManualPaymentChange(candidate.sourceKey, {
                            balance: event.currentTarget.value,
                          })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="sm:col-span-2 sm:justify-self-end"
                      onClick={() => {
                        onResolvePayment(candidate.sourceKey, 'manual', manual);
                        onManualPaymentKey(null);
                      }}
                    >
                      Apply corrected values
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (group.code === 'existing-contact') {
    return (
      <div className="space-y-3">
        {group.candidates.map((candidate) => (
          <div
            key={candidate.sourceKey}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center"
          >
            <p className="text-foreground text-sm">
              {candidate.draftValues.name || 'Unnamed member'} · source row{' '}
              {candidate.sourceRow}
            </p>
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
                <SelectValue placeholder="Choose contact values" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep_existing">Keep existing</SelectItem>
                <SelectItem value="use_csv">Use CSV values</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    );
  }

  if (group.code === 'invalid-membership-values') {
    const fields: {
      key: keyof Pick<
        MemberImportDraftValues,
        | 'startDate'
        | 'endDate'
        | 'status'
        | 'freezeDate'
        | 'fee'
        | 'amountPaid'
        | 'paidAt'
        | 'dateOfBirth'
      >;
      label: string;
      inputMode?: 'decimal';
    }[] = [
      { key: 'startDate', label: 'Start date' },
      { key: 'endDate', label: 'Expiry' },
      { key: 'status', label: 'Status' },
      { key: 'freezeDate', label: 'Freeze date' },
      { key: 'fee', label: 'Fee', inputMode: 'decimal' },
      { key: 'amountPaid', label: 'Amount paid', inputMode: 'decimal' },
      { key: 'paidAt', label: 'Payment date' },
      { key: 'dateOfBirth', label: 'Date of birth' },
    ];
    return (
      <div className="space-y-3">
        {group.candidates.map((candidate) => (
          <div
            key={candidate.sourceKey}
            className="border-border space-y-3 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {candidate.draftValues.name || 'Unnamed member'} · source row{' '}
                  {candidate.sourceRow}
                </p>
                <p className="text-muted-foreground text-xs">
                  Correct invalid dates, status, or amounts. Changes are checked
                  immediately.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  onSetDisposition(candidate.sourceKey, 'excluded')
                }
              >
                Exclude source row {candidate.sourceRow}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((field) => {
                const id = `${field.key}-${candidate.sourceKey}`;
                return (
                  <div key={field.key} className="min-w-0 space-y-1.5">
                    <Label htmlFor={id} size="sm">
                      {field.label}
                    </Label>
                    <Input
                      id={id}
                      aria-label={`${field.label} for source row ${candidate.sourceRow}`}
                      inputMode={field.inputMode}
                      value={candidate.draftValues[field.key] ?? ''}
                      onChange={(event) =>
                        onPatch(candidate.sourceKey, {
                          [field.key]: event.currentTarget.value,
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        Edit the affected rows below, or explicitly exclude a row from this
        import.
      </p>
      <div className="flex flex-wrap gap-2">
        {group.candidates.map((candidate) => (
          <Button
            key={candidate.sourceKey}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSetDisposition(candidate.sourceKey, 'excluded')}
          >
            Exclude source row {candidate.sourceRow}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CandidateOffering({
  candidate,
}: {
  candidate: MemberImportCandidate;
}) {
  const { fmt } = useLocale();
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
  const badgeLabel =
    candidate.outcomeKind === 'membership_service'
      ? 'Membership + service'
      : candidate.outcomeKind === 'service'
        ? 'Service'
        : candidate.outcomeKind === 'membership'
          ? 'Membership'
          : 'Unresolved';
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant="neutral">{badgeLabel}</Badge>
      <span className="text-foreground truncate text-sm">
        {[membershipLabel, serviceLabel].filter(Boolean).join(' + ') ||
          'Choose offering'}
      </span>
      {service && (
        <span className="text-muted-foreground text-xs tabular-nums">
          Sold for {fmt.money(service.soldAmount)}
        </span>
      )}
    </span>
  );
}

function CandidateDates({ candidate }: { candidate: MemberImportCandidate }) {
  const { fmt } = useLocale();
  const membershipEnd = candidate.built.membership?.end_date;
  const service = candidate.serviceComponent?.intent;
  const parts = [
    membershipEnd ? `Membership to ${fmt.date(membershipEnd)}` : null,
    service
      ? `Service ${fmt.date(service.startDate)}–${fmt.date(service.endDate)}`
      : null,
  ].filter(Boolean);
  return <>{parts.join(' · ') || '—'}</>;
}

function CandidateStatus({ candidate }: { candidate: MemberImportCandidate }) {
  if (candidate.disposition === 'excluded') {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <XCircle className="size-3.5" /> Excluded
      </span>
    );
  }
  if (candidate.isReady) {
    const noticeCount = candidate.issues.filter(
      (issue) => issue.severity === 'notice'
    ).length;
    return (
      <span className="text-emerald-foreground inline-flex items-center gap-1.5 text-xs">
        <CheckCircle className="size-3.5" /> Ready
        {noticeCount > 0 &&
          ` · ${noticeCount} notice${noticeCount === 1 ? '' : 's'}`}
      </span>
    );
  }
  return (
    <span className="text-amber-foreground inline-flex items-start gap-1.5 text-xs">
      <AlertTriangle className="mt-px size-3.5 shrink-0" /> Needs resolution
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
  if (automatic) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Info className="size-3.5" /> Automatic
      </span>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="link"
      onClick={() =>
        onSetDisposition(
          candidate.sourceKey,
          candidate.disposition === 'included' ? 'excluded' : 'included'
        )
      }
    >
      {candidate.disposition === 'included' ? 'Exclude' : 'Include'}
    </Button>
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
  return (
    <div className="border-border flex items-center justify-between gap-3 border-t px-3 py-2">
      <p className="text-muted-foreground text-xs">
        {total} candidate{total === 1 ? '' : 's'}
      </p>
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
        <span className="text-muted-foreground px-2 text-xs">
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
    </div>
  );
}

export type { ImportMembersPreviewProps };
