'use client';

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Copy,
  FileCheck2,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth, type BranchAccount } from '@/hooks/use-auth';
import {
  BRANCH_SETUP_PACKS,
  BRANCH_SETUP_WARNING_REGISTRY,
  normalizeBranchSetupPacks,
  type BranchSetupCreationResult,
  type BranchSetupPack,
  type BranchSetupPreview,
  type BranchSetupReasonCode,
  type BranchSetupStartMode,
} from '@/lib/branches/setup';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

interface LegalEntityOption {
  id: string;
  name: string;
  defaultCurrency: string;
}

interface BranchesResponse {
  selectedAccountId: string;
  branches: BranchAccount[];
  legalEntities: LegalEntityOption[];
}

const PACK_META: Record<
  BranchSetupPack,
  { label: string; description: string }
> = {
  membership_catalog: {
    label: 'Memberships & products',
    description: 'Active plans, pricing options, products, and services',
  },
  lead_setup: {
    label: 'Lead setup',
    description: 'Lead fields, tags, custom fields, and a disabled lead form',
  },
  reminders: {
    label: 'Reminder timing',
    description: 'Membership and service offsets, copied disabled',
  },
  automations: {
    label: 'Automations',
    description: 'Supported definitions copied inactive for review',
  },
  flows: {
    label: 'Flows',
    description: 'Supported conversation flows copied as drafts',
  },
};

const STEP_LABELS = ['Branch', 'Start point', 'Setup packs', 'Review'];

const REASON_COPY: Record<BranchSetupReasonCode, string> = {
  SOURCE_NOT_ACTIVE: 'The source branch is not active.',
  SOURCE_NOT_READY: 'The source branch setup is not ready.',
  SOURCE_NOT_REVIEWED: 'The source configuration has not been reviewed.',
  SNAPSHOT_TOO_LARGE: 'The selected setup is too large to copy safely.',
  ROW_LIMIT_EXCEEDED: 'The selected setup exceeds the copy row limit.',
  CURRENCY_MISMATCH:
    'Memberships and products cannot be copied across currencies.',
};

function sourceIneligibility(branch: BranchAccount): string | null {
  if (branch.branch_status !== 'active') return 'Source branch must be active';
  if (branch.readiness_state !== 'ready') {
    return 'Finish and review this branch’s setup first';
  }
  if (!branch.setup_reviewed_at) {
    return 'Mark this branch’s configuration as reviewed first';
  }
  return null;
}

export function branchSetupPackRowCount(
  preview: BranchSetupPreview,
  pack: BranchSetupPack
): number {
  const b = preview.copied.breakdown;
  switch (pack) {
    case 'membership_catalog':
      return (
        b.membershipPlans +
        b.planPricingOptions +
        b.catalogItems +
        b.catalogOptions
      );
    case 'lead_setup':
      return b.leadFieldOptions + b.tags + b.customFields + b.leadForms;
    case 'reminders':
      return b.reminderSettings;
    case 'automations':
      return b.automations + b.automationSteps;
    case 'flows':
      return b.flows + b.flowNodes;
  }
}

function previewUrl(input: {
  legalEntityId: string;
  startMode: BranchSetupStartMode;
  sourceAccountId: string | null;
  packs: BranchSetupPack[];
}): string {
  const params = new URLSearchParams({
    legalEntityId: input.legalEntityId,
    startMode: input.startMode,
  });
  if (input.startMode === 'copy' && input.sourceAccountId) {
    params.set('sourceAccountId', input.sourceAccountId);
    for (const pack of input.packs) params.append('pack', pack);
  }
  return `/api/branches/setup-preview?${params.toString()}`;
}

export function BranchCreationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { account, switchBranch } = useAuth();
  const [step, setStep] = useState(1);
  const [branchName, setBranchName] = useState('');
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);
  const [startMode, setStartMode] = useState<BranchSetupStartMode>('blank');
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [packs, setPacks] = useState<BranchSetupPack[]>([]);
  const [options, setOptions] = useState<BranchesResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BranchSetupPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<BranchSetupCreationResult | null>(
    null
  );
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const previewSequenceRef = useRef(0);
  const submitRef = useRef(false);
  const initializedPacksForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setOptions(null);
      setOptionsError(null);
      setRequestId((current) => current ?? crypto.randomUUID());

      try {
        const response = await fetch('/api/branches', { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as
          BranchesResponse | { error?: string };
        if (!response.ok || !('branches' in payload)) {
          throw new Error(
            ('error' in payload && payload.error) || 'Could not load branches'
          );
        }
        if (cancelled) return;
        setOptions(payload);
        setLegalEntityId(
          (current) =>
            current ??
            payload.legalEntities.find(
              (entity) => entity.id === account?.legal_entity_id
            )?.id ??
            payload.legalEntities[0]?.id ??
            null
        );
      } catch (error) {
        if (!cancelled) {
          setOptionsError(getErrorMessage(error, 'Could not load branches.'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, account?.legal_entity_id]);

  const eligibleSources = useMemo(
    () =>
      (options?.branches ?? []).filter(
        (branch) => sourceIneligibility(branch) === null
      ),
    [options?.branches]
  );
  const selectedSource = (options?.branches ?? []).find(
    (branch) => branch.account_id === sourceAccountId
  );
  const selectedEntity = options?.legalEntities.find(
    (entity) => entity.id === legalEntityId
  );
  const currencyMismatch = Boolean(
    selectedSource &&
    selectedEntity &&
    selectedSource.default_currency !== selectedEntity.defaultCurrency
  );

  useEffect(() => {
    if (!open || !legalEntityId) return;
    if (startMode === 'copy' && (!sourceAccountId || packs.length === 0)) {
      return;
    }

    const sequence = ++previewSequenceRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setPreviewLoading(true);
        setPreviewError(null);
        try {
          const response = await fetch(
            previewUrl({
              legalEntityId,
              startMode,
              sourceAccountId,
              packs,
            }),
            { signal: controller.signal, cache: 'no-store' }
          );
          const payload = (await response.json().catch(() => ({}))) as
            BranchSetupPreview | { error?: string };
          if (!response.ok || !('eligible' in payload)) {
            throw new Error(
              ('error' in payload && payload.error) ||
                'Could not preview branch setup'
            );
          }
          if (sequence !== previewSequenceRef.current) return;
          setPreview(payload);

          if (startMode === 'copy' && sourceAccountId) {
            const initializationKey = `${legalEntityId}:${sourceAccountId}`;
            if (initializedPacksForRef.current !== initializationKey) {
              initializedPacksForRef.current = initializationKey;
              let eligibleNonempty = BRANCH_SETUP_PACKS.filter((pack) => {
                const packStatus = payload.packEligibility[pack];
                return (
                  packStatus?.eligible !== false &&
                  branchSetupPackRowCount(payload, pack) > 0
                );
              });
              if (!eligibleNonempty.includes('lead_setup')) {
                eligibleNonempty = eligibleNonempty.filter(
                  (pack) => pack !== 'automations' && pack !== 'flows'
                );
              }
              setPacks(normalizeBranchSetupPacks(eligibleNonempty));
            }
          }
        } catch (error) {
          if (
            controller.signal.aborted ||
            sequence !== previewSequenceRef.current
          ) {
            return;
          }
          setPreview(null);
          setPreviewError(
            getErrorMessage(error, 'Could not preview branch setup.')
          );
        } finally {
          if (sequence === previewSequenceRef.current) {
            setPreviewLoading(false);
          }
        }
      })();
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, legalEntityId, startMode, sourceAccountId, packs]);

  function resetAttempt() {
    previewSequenceRef.current += 1;
    submitRef.current = false;
    initializedPacksForRef.current = null;
    setStep(1);
    setBranchName('');
    setLegalEntityId(null);
    setStartMode('blank');
    setSourceAccountId(null);
    setPacks([]);
    setOptions(null);
    setOptionsError(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setRequestId(null);
    setSubmitting(false);
    setCreated(null);
    setSwitching(false);
    setSwitchError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && (submitRef.current || switching)) return;
    onOpenChange(nextOpen);
    if (!nextOpen) resetAttempt();
  }

  function chooseMode(mode: BranchSetupStartMode) {
    setStartMode(mode);
    setPreview(null);
    setPreviewError(null);
    initializedPacksForRef.current = null;
    if (mode === 'blank') {
      setSourceAccountId(null);
      setPacks([]);
      return;
    }

    const source = eligibleSources[0]?.account_id ?? null;
    setSourceAccountId(source);
    setPacks(source ? initialPacksForSource(source) : []);
  }

  function chooseSource(accountId: string) {
    setSourceAccountId(accountId);
    setPacks(initialPacksForSource(accountId));
    setPreview(null);
    setPreviewError(null);
    initializedPacksForRef.current = null;
  }

  function togglePack(pack: BranchSetupPack, checked: boolean) {
    const next = checked
      ? [...packs, pack]
      : packs.filter((candidate) => candidate !== pack);
    setPacks(normalizeBranchSetupPacks(next));
    setPreview(null);
    setPreviewError(null);
  }

  function packDisabled(pack: BranchSetupPack): boolean {
    if (
      pack === 'lead_setup' &&
      (packs.includes('automations') || packs.includes('flows'))
    ) {
      return true;
    }
    if (pack === 'membership_catalog' && currencyMismatch) return true;
    return (
      preview?.packEligibility[pack]?.eligible === false &&
      !packs.includes(pack)
    );
  }

  function initialPacksForSource(accountId: string): BranchSetupPack[] {
    const source = options?.branches.find(
      (branch) => branch.account_id === accountId
    );
    const entity = options?.legalEntities.find(
      (candidate) => candidate.id === legalEntityId
    );
    return BRANCH_SETUP_PACKS.filter(
      (pack) =>
        pack !== 'membership_catalog' ||
        !source ||
        !entity ||
        source.default_currency === entity.defaultCurrency
    );
  }

  async function switchToCreatedBranch(accountId: string) {
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchBranch(accountId);
    } catch (error) {
      console.error('[BranchCreationDialog] switch failed:', error);
      setSwitchError('The branch was created, but switching failed.');
      setSwitching(false);
    }
  }

  async function createBranch() {
    if (
      submitRef.current ||
      !requestId ||
      !legalEntityId ||
      !branchName.trim() ||
      !preview?.eligible ||
      (startMode === 'copy' && (!sourceAccountId || packs.length === 0))
    ) {
      return;
    }

    submitRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          name: branchName.trim(),
          legalEntityId,
          startMode,
          ...(startMode === 'copy' ? { sourceAccountId } : {}),
          packs: startMode === 'copy' ? packs : [],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        BranchSetupCreationResult | { error?: string };
      if (!response.ok || !('accountId' in payload)) {
        throw new Error(
          ('error' in payload && payload.error) || 'Could not create branch'
        );
      }

      setCreated(payload);
      toast.success(
        payload.replayed ? 'Branch creation recovered' : 'Branch created'
      );
      setSubmitting(false);
      submitRef.current = false;
      await switchToCreatedBranch(payload.accountId);
    } catch (error) {
      console.error('[BranchCreationDialog] create failed:', error);
      toast.error(getErrorMessage(error, 'Could not create branch.'));
      setSubmitting(false);
      submitRef.current = false;
    }
  }

  const stepOneReady = Boolean(branchName.trim() && legalEntityId);
  const stepTwoReady =
    startMode === 'blank' ||
    Boolean(
      sourceAccountId &&
      selectedSource &&
      sourceIneligibility(selectedSource) === null
    );
  const stepThreeReady = Boolean(
    !previewLoading &&
    !previewError &&
    preview?.eligible &&
    (startMode === 'blank' || packs.length > 0)
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        showCloseButton={!submitting && !switching}
      >
        <DialogHeader>
          <DialogTitle size="lg">Add branch</DialogTitle>
          <DialogDescription>
            Create an isolated branch, then review its setup before marking it
            ready.
          </DialogDescription>
        </DialogHeader>

        <ol className="grid grid-cols-4 gap-2" aria-label="Branch setup steps">
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            const active = number === step;
            const done = number < step || created !== null;
            return (
              <li key={label} className="min-w-0 text-center">
                <span
                  className={cn(
                    'mx-auto flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                    done
                      ? 'bg-primary text-primary-foreground'
                      : active
                        ? 'bg-primary-soft text-primary-text'
                        : 'bg-muted text-muted-foreground'
                  )}
                >
                  {done ? <Check className="size-3.5" /> : number}
                </span>
                <span className="text-muted-foreground mt-1 block truncate text-xs">
                  {label}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="-mx-1 max-h-[58vh] overflow-y-auto px-1 py-1">
          {optionsError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Branches could not be loaded</AlertTitle>
              <AlertDescription>{optionsError}</AlertDescription>
            </Alert>
          ) : !options ? (
            <div className="text-muted-foreground flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : created ? (
            <CreationSuccess
              result={created}
              switching={switching}
              switchError={switchError}
              onRetry={() => void switchToCreatedBranch(created.accountId)}
            />
          ) : step === 1 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-branch-name">Branch name</Label>
                <Input
                  id="new-branch-name"
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  maxLength={80}
                  placeholder="Koramangala"
                  autoFocus
                />
                <p className="text-muted-foreground text-xs">
                  Use the location or operating name your team recognizes.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-branch-legal-entity">Legal entity</Label>
                <Select
                  value={legalEntityId}
                  onValueChange={(value) => {
                    setLegalEntityId(value);
                    setPreview(null);
                    initializedPacksForRef.current = null;
                    if (startMode === 'copy' && sourceAccountId) {
                      const source = options.branches.find(
                        (branch) => branch.account_id === sourceAccountId
                      );
                      const entity = options.legalEntities.find(
                        (candidate) => candidate.id === value
                      );
                      setPacks(
                        BRANCH_SETUP_PACKS.filter(
                          (pack) =>
                            pack !== 'membership_catalog' ||
                            !source ||
                            !entity ||
                            source.default_currency === entity.defaultCurrency
                        )
                      );
                    }
                  }}
                >
                  <SelectTrigger
                    id="new-branch-legal-entity"
                    className="w-full"
                  >
                    <SelectValue placeholder="Select legal entity" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.legalEntities.map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>
                        {entity.name} · {entity.defaultCurrency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-5">
              <RadioGroup
                value={startMode}
                onValueChange={(value) =>
                  value && chooseMode(value as BranchSetupStartMode)
                }
              >
                <Label
                  className={cn(
                    'border-border hover:border-border-hover items-start rounded-xl border p-4 transition-colors',
                    startMode === 'blank' && 'border-primary'
                  )}
                >
                  <RadioGroupItem value="blank" />
                  <span>
                    <span className="block font-medium">Start blank</span>
                    <span className="text-muted-foreground mt-1 block text-xs font-normal">
                      Create only the branch and system defaults.
                    </span>
                  </span>
                </Label>
                <Label
                  className={cn(
                    'border-border items-start rounded-xl border p-4 transition-colors',
                    eligibleSources.length > 0
                      ? 'hover:border-border-hover'
                      : 'opacity-60',
                    startMode === 'copy' && 'border-primary'
                  )}
                >
                  <RadioGroupItem
                    value="copy"
                    disabled={eligibleSources.length === 0}
                  />
                  <span>
                    <span className="block font-medium">
                      Copy reviewed setup
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs font-normal">
                      Copy selected configuration from an eligible branch.
                    </span>
                    {eligibleSources.length === 0 ? (
                      <span className="text-amber-foreground mt-1 block text-xs font-normal">
                        No active, reviewed, ready source branch is available.
                      </span>
                    ) : null}
                  </span>
                </Label>
              </RadioGroup>

              {startMode === 'copy' ? (
                <div className="space-y-2">
                  <Label>Source branch</Label>
                  <RadioGroup
                    value={sourceAccountId}
                    onValueChange={(value) => value && chooseSource(value)}
                  >
                    {options.branches.map((branch) => {
                      const reason = sourceIneligibility(branch);
                      return (
                        <Label
                          key={branch.account_id}
                          className={cn(
                            'border-border items-start rounded-xl border p-3 transition-colors',
                            reason ? 'opacity-60' : 'hover:border-border-hover',
                            sourceAccountId === branch.account_id &&
                              'border-primary'
                          )}
                        >
                          <RadioGroupItem
                            value={branch.account_id}
                            disabled={reason !== null}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {branch.account_name}
                            </span>
                            <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
                              {branch.legal_entity_name} ·{' '}
                              {branch.default_currency}
                            </span>
                            {reason ? (
                              <span className="text-amber-foreground mt-0.5 block text-xs font-normal">
                                {reason}
                              </span>
                            ) : null}
                          </span>
                        </Label>
                      );
                    })}
                  </RadioGroup>
                </div>
              ) : null}
            </div>
          ) : step === 3 ? (
            <div className="space-y-4">
              {startMode === 'blank' ? (
                <Alert>
                  <Sparkles />
                  <AlertTitle>Blank branch setup</AlertTitle>
                  <AlertDescription>
                    No configuration will be copied. UsefulDesk will add only
                    system-seeded defaults such as expense categories.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2">
                  {BRANCH_SETUP_PACKS.map((pack) => {
                    const disabled = packDisabled(pack);
                    const locked =
                      pack === 'lead_setup' &&
                      (packs.includes('automations') ||
                        packs.includes('flows'));
                    const count = preview
                      ? branchSetupPackRowCount(preview, pack)
                      : null;
                    return (
                      <Label
                        key={pack}
                        className={cn(
                          'border-border items-start rounded-xl border p-3 transition-colors',
                          disabled ? 'opacity-60' : 'hover:border-border-hover',
                          packs.includes(pack) && 'border-primary'
                        )}
                      >
                        <Checkbox
                          checked={packs.includes(pack)}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            togglePack(pack, checked === true)
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {PACK_META[pack].label}
                            </span>
                            {count !== null ? (
                              <Badge variant="neutral">
                                {count} row{count === 1 ? '' : 's'}
                              </Badge>
                            ) : null}
                            {locked ? (
                              <Badge variant="info">Required dependency</Badge>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
                            {PACK_META[pack].description}
                          </span>
                          {pack === 'membership_catalog' && currencyMismatch ? (
                            <span className="text-amber-foreground mt-0.5 block text-xs font-normal">
                              Not available because source and target currencies
                              differ.
                            </span>
                          ) : null}
                        </span>
                      </Label>
                    );
                  })}
                </div>
              )}

              <PreviewSummary
                preview={preview}
                loading={previewLoading}
                error={previewError}
              />
            </div>
          ) : (
            <ReviewStep
              branchName={branchName.trim()}
              entity={selectedEntity}
              startMode={startMode}
              source={selectedSource}
              packs={packs}
              preview={preview}
            />
          )}
        </div>

        {!created ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                step === 1 ? handleOpenChange(false) : setStep(step - 1)
              }
              disabled={submitting}
            >
              {step === 1 ? (
                'Cancel'
              ) : (
                <>
                  <ArrowLeft /> Back
                </>
              )}
            </Button>
            {step < 4 ? (
              <Button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={
                  optionsError !== null ||
                  (step === 1 && !stepOneReady) ||
                  (step === 2 && !stepTwoReady) ||
                  (step === 3 && !stepThreeReady)
                }
              >
                Continue <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void createBranch()}
                disabled={submitting || !stepThreeReady}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Create branch
              </Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewSummary({
  preview,
  loading,
  error,
}: {
  preview: BranchSetupPreview | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Checking what can be copied…
      </p>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Preview unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!preview) return null;

  return (
    <div className="space-y-3">
      <Alert>
        <FileCheck2 />
        <AlertTitle>
          {preview.eligible
            ? `${preview.copied.totalRows} configuration row${preview.copied.totalRows === 1 ? '' : 's'} ready`
            : 'This setup cannot be created yet'}
        </AlertTitle>
        <AlertDescription>
          {preview.eligible
            ? 'Counts and warnings come from the authoritative branch snapshot.'
            : preview.reasonCodes.map((code) => REASON_COPY[code]).join(' ')}
        </AlertDescription>
      </Alert>

      {preview.warnings.length > 0 ? (
        <div>
          <p className="text-sm font-medium">Review notes</p>
          <ul className="text-muted-foreground mt-1 space-y-1 text-xs">
            {preview.warnings.map((warning, index) => (
              <li key={`${warning.code}:${warning.pack ?? ''}:${index}`}>
                {BRANCH_SETUP_WARNING_REGISTRY[warning.code]}
                {warning.count ? ` (${warning.count})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-medium">Never copied</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {preview.exclusions.join(', ')}
        </p>
      </div>
    </div>
  );
}

function ReviewStep({
  branchName,
  entity,
  startMode,
  source,
  packs,
  preview,
}: {
  branchName: string;
  entity: LegalEntityOption | undefined;
  startMode: BranchSetupStartMode;
  source: BranchAccount | undefined;
  packs: BranchSetupPack[];
  preview: BranchSetupPreview | null;
}) {
  return (
    <div className="space-y-4">
      <div className="border-border rounded-xl border p-4">
        <div className="flex items-center gap-3">
          <span className="bg-muted flex size-9 items-center justify-center rounded-lg">
            <Building2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{branchName}</p>
            <p className="text-muted-foreground text-xs">
              {entity?.name} · {entity?.defaultCurrency}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Start point</dt>
          <dd className="mt-0.5 font-medium">
            {startMode === 'blank'
              ? 'Blank branch'
              : `Copy from ${source?.account_name}`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Configuration rows</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {preview?.copied.totalRows ?? 0}
          </dd>
        </div>
      </dl>

      {packs.length > 0 ? (
        <div>
          <p className="text-muted-foreground text-xs">Setup packs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {packs.map((pack) => (
              <Badge key={pack} variant="neutral">
                {PACK_META[pack].label}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <Alert>
        <Copy />
        <AlertTitle>Configuration only</AlertTitle>
        <AlertDescription>
          Credentials, providers, WhatsApp, payments, templates, staff,
          trainers, members, and operational history are not copied or made
          operational. The new branch starts in Setup until an admin reviews its
          configuration.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function CreationSuccess({
  result,
  switching,
  switchError,
  onRetry,
}: {
  result: BranchSetupCreationResult;
  switching: boolean;
  switchError: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="text-emerald-foreground flex size-11 items-center justify-center rounded-lg bg-emerald-500/10">
        <Check className="size-5" />
      </span>
      <div>
        <p className="font-semibold">
          {result.replayed ? 'Branch creation recovered' : 'Branch created'}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {result.copied.totalRows} configuration row
          {result.copied.totalRows === 1 ? '' : 's'} copied. Credentials and
          provider connections were not copied.
        </p>
      </div>
      {switching ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Switching branch…
        </p>
      ) : switchError ? (
        <>
          <p className="text-amber-foreground text-sm">{switchError}</p>
          <Button onClick={onRetry}>
            <RefreshCw /> Retry switch
          </Button>
        </>
      ) : null}
    </div>
  );
}
