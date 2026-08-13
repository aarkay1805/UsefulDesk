'use client';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapse } from '@/components/ui/collapse';
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
    label: 'Plans, products & services',
    description: 'Active plans, prices, products, and services',
  },
  lead_setup: {
    label: 'Lead fields & tags',
    description: 'Lead fields, tags, custom fields, and a disabled form',
  },
  reminders: {
    label: 'Reminder schedule',
    description: 'Renewal reminder timing, kept off in the new branch',
  },
  automations: {
    label: 'Automations',
    description: 'Copied inactive so you can check them first',
  },
  flows: {
    label: 'Flows',
    description: 'Supported conversation flows copied as drafts',
  },
};

const BASIC_PACKS: BranchSetupPack[] = ['membership_catalog', 'lead_setup'];
const ADVANCED_PACKS: BranchSetupPack[] = ['reminders', 'automations', 'flows'];

type PackAvailability = Partial<
  Record<BranchSetupPack, { count: number; eligible: boolean }>
>;

const REASON_COPY: Record<BranchSetupReasonCode, string> = {
  SOURCE_NOT_ACTIVE: 'The source branch is not active.',
  SNAPSHOT_TOO_LARGE: 'The selected setup is too large to copy safely.',
  ROW_LIMIT_EXCEEDED: 'The selected setup exceeds the copy row limit.',
  CURRENCY_MISMATCH:
    'Memberships and products cannot be copied across currencies.',
};

function sourceIneligibility(branch: BranchAccount): string | null {
  if (branch.branch_status !== 'active') return 'Source branch must be active';
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
  const [packAvailability, setPackAvailability] =
    useState<PackAvailability | null>(null);
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
              const availability = Object.fromEntries(
                BRANCH_SETUP_PACKS.map((pack) => [
                  pack,
                  {
                    count: branchSetupPackRowCount(payload, pack),
                    eligible: payload.packEligibility[pack]?.eligible !== false,
                  },
                ])
              ) as Record<
                BranchSetupPack,
                { count: number; eligible: boolean }
              >;
              setPackAvailability(availability);

              const basicDefaults = BASIC_PACKS.filter((pack) => {
                const packStatus = payload.packEligibility[pack];
                return (
                  packStatus?.eligible !== false &&
                  branchSetupPackRowCount(payload, pack) > 0
                );
              });
              setPreview(null);
              setPacks(normalizeBranchSetupPacks(basicDefaults));
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
    setPackAvailability(null);
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
    setPackAvailability(null);
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
    setPackAvailability(null);
    initializedPacksForRef.current = null;
  }

  function togglePack(pack: BranchSetupPack, checked: boolean) {
    let next = checked
      ? [...packs, pack]
      : packs.filter((candidate) => candidate !== pack);
    if (!checked && pack === 'lead_setup') {
      next = next.filter(
        (candidate) => candidate !== 'automations' && candidate !== 'flows'
      );
    }
    setPacks(normalizeBranchSetupPacks(next));
    setPreview(null);
    setPreviewError(null);
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

  const branchDetailsReady = Boolean(branchName.trim() && legalEntityId);
  const copySourceReady = Boolean(
    sourceAccountId &&
    selectedSource &&
    sourceIneligibility(selectedSource) === null
  );
  const selectedSetupReady = Boolean(
    !previewLoading && !previewError && preview?.eligible && packs.length > 0
  );
  const blankBranchReady = Boolean(
    branchDetailsReady && !previewLoading && !previewError && preview?.eligible
  );
  const packIsAvailable = (pack: BranchSetupPack) =>
    packAvailability?.[pack]?.eligible !== false &&
    (packAvailability?.[pack]?.count ?? 0) > 0 &&
    (pack !== 'membership_catalog' || !currencyMismatch);
  const basicPacks = BASIC_PACKS.filter(packIsAvailable);
  const leadSetupAvailable = basicPacks.includes('lead_setup');
  const advancedPacks = ADVANCED_PACKS.filter(
    (pack) =>
      packIsAvailable(pack) && (pack === 'reminders' || leadSetupAvailable)
  );
  const hasReusableSettings = basicPacks.length + advancedPacks.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        showCloseButton={!submitting && !switching}
      >
        <DialogHeader>
          <DialogTitle size="lg">Add branch</DialogTitle>
          <DialogDescription>
            {created
              ? 'The branch is ready. Open it to continue setup.'
              : step === 1
                ? 'Name the branch, then choose how to set it up.'
                : `Choose what ${branchName.trim()} should reuse from ${selectedSource?.account_name ?? 'the source branch'}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[calc(100dvh-15rem)] overflow-y-auto px-1 py-1 sm:max-h-[58vh]">
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

              {options.legalEntities.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor="new-branch-legal-entity">
                    Billing business
                  </Label>
                  <Select
                    value={legalEntityId}
                    onValueChange={(value) => {
                      setLegalEntityId(value);
                      setPreview(null);
                      setPreviewError(null);
                      setPackAvailability(null);
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
                      <SelectValue placeholder="Select billing business" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.legalEntities.map((entity) => (
                        <SelectItem key={entity.id} value={entity.id}>
                          {entity.name} · {entity.defaultCurrency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Used for invoices and currency.
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Start with</Label>
                <RadioGroup
                  aria-label="Start with"
                  value={startMode}
                  onValueChange={(value) =>
                    value && chooseMode(value as BranchSetupStartMode)
                  }
                  className="sm:grid-cols-2"
                >
                  <Label
                    className={cn(
                      'min-h-full cursor-pointer items-start rounded-xl border p-3 transition-colors sm:p-4',
                      startMode === 'blank'
                        ? 'border-primary bg-primary/[0.04]'
                        : 'border-border hover:border-border-hover'
                    )}
                  >
                    <RadioGroupItem value="blank" className="mt-0.5" />
                    <span>
                      <span className="block font-medium">Start fresh</span>
                      <span className="text-muted-foreground mt-1 block text-xs font-normal">
                        Create an empty branch. Add plans and settings later.
                      </span>
                    </span>
                  </Label>
                  <Label
                    className={cn(
                      'min-h-full items-start rounded-xl border p-3 transition-colors sm:p-4',
                      eligibleSources.length > 0
                        ? 'cursor-pointer'
                        : 'cursor-not-allowed opacity-60',
                      startMode === 'copy'
                        ? 'border-primary bg-primary/[0.04]'
                        : 'border-border hover:border-border-hover'
                    )}
                  >
                    <RadioGroupItem
                      value="copy"
                      disabled={eligibleSources.length === 0}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium">
                        Use settings from another branch
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs font-normal">
                        Reuse selected plans and settings. Members and payments
                        stay separate.
                      </span>
                      {eligibleSources.length === 0 ? (
                        <span className="text-amber-foreground mt-1 block text-xs font-normal">
                          No active branch is available to copy from.
                        </span>
                      ) : null}
                    </span>
                  </Label>
                </RadioGroup>
              </div>

              <Collapse open={startMode === 'copy'}>
                <div className="-mx-1 space-y-2 px-1 py-1">
                  <Label htmlFor="branch-copy-source">Copy settings from</Label>
                  <Select
                    value={sourceAccountId}
                    onValueChange={(value) => value && chooseSource(value)}
                  >
                    <SelectTrigger id="branch-copy-source" className="w-full">
                      <SelectValue placeholder="Select a branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleSources.map((branch) => (
                        <SelectItem
                          key={branch.account_id}
                          value={branch.account_id}
                        >
                          {branch.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedSource ? (
                    <p className="text-muted-foreground text-xs">
                      {selectedSource.legal_entity_name} ·{' '}
                      {selectedSource.default_currency}
                    </p>
                  ) : null}
                </div>
              </Collapse>

              <PreviewProblem
                preview={preview}
                error={previewError}
                loading={false}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1">
                <p className="font-medium">Settings to copy</p>
                <p className="text-muted-foreground text-xs">
                  Common settings are selected. Advanced settings stay off
                  unless you choose them.
                </p>
              </div>

              {!packAvailability ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Checking available
                  settings…
                </p>
              ) : !hasReusableSettings ? (
                <Alert>
                  <CircleAlert />
                  <AlertTitle>No reusable settings found</AlertTitle>
                  <AlertDescription>
                    Go back and choose another branch, or start fresh.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {basicPacks.length > 0 ? (
                    <div className="space-y-2">
                      {basicPacks.map((pack) => (
                        <PackChoice
                          key={pack}
                          pack={pack}
                          checked={packs.includes(pack)}
                          onCheckedChange={(checked) =>
                            togglePack(pack, checked)
                          }
                        />
                      ))}
                    </div>
                  ) : null}

                  {currencyMismatch ? (
                    <p className="text-amber-foreground text-xs">
                      Plans, products, and services are unavailable because the
                      two branches use different currencies.
                    </p>
                  ) : null}

                  {advancedPacks.length > 0 ? (
                    <Accordion
                      key={`${sourceAccountId}:${basicPacks.length}`}
                      defaultValue={
                        basicPacks.length === 0 ? ['advanced'] : undefined
                      }
                    >
                      <AccordionItem value="advanced">
                        <AccordionTrigger>Advanced settings</AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2">
                            {advancedPacks.map((pack) => (
                              <PackChoice
                                key={pack}
                                pack={pack}
                                checked={packs.includes(pack)}
                                onCheckedChange={(checked) =>
                                  togglePack(pack, checked)
                                }
                              />
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : null}

                  <Alert>
                    <ShieldCheck />
                    <AlertTitle>Your branch data stays separate</AlertTitle>
                    <AlertDescription>
                      Members, leads, payments, attendance, team access,
                      WhatsApp, and Razorpay stay separate. Reminders and
                      automations are copied off.
                    </AlertDescription>
                  </Alert>
                </>
              )}

              <PreviewProblem
                preview={preview}
                error={previewError}
                loading={previewLoading}
              />
            </div>
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
            {step === 1 && startMode === 'copy' ? (
              <Button
                type="button"
                onClick={() => setStep(2)}
                disabled={
                  optionsError !== null ||
                  !branchDetailsReady ||
                  !copySourceReady ||
                  packAvailability === null ||
                  previewError !== null
                }
              >
                {packAvailability === null && previewLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {packAvailability === null ? 'Checking…' : 'Choose settings'}
                {packAvailability !== null ? (
                  <ArrowRight data-icon="inline-end" />
                ) : null}
              </Button>
            ) : step === 1 ? (
              <Button
                type="button"
                onClick={() => void createBranch()}
                disabled={submitting || !blankBranchReady}
              >
                {submitting || (branchDetailsReady && previewLoading) ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Create branch
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void createBranch()}
                disabled={submitting || !selectedSetupReady}
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

function PackChoice({
  pack,
  checked,
  onCheckedChange,
}: {
  pack: BranchSetupPack;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Label
      className={cn(
        'cursor-pointer items-start rounded-xl border p-3 transition-colors',
        checked
          ? 'border-primary bg-primary/[0.04]'
          : 'border-border hover:border-border-hover'
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{PACK_META[pack].label}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
          {PACK_META[pack].description}
        </span>
      </span>
    </Label>
  );
}

function PreviewProblem({
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
        <Loader2 className="size-4 animate-spin" /> Checking branch settings…
      </p>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Branch setup could not be checked</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!preview || preview.eligible) return null;

  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>These settings cannot be copied</AlertTitle>
      <AlertDescription>
        {preview.reasonCodes.map((code) => REASON_COPY[code]).join(' ')}
      </AlertDescription>
    </Alert>
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
          {result.setup.startMode === 'copy'
            ? 'Selected settings were copied. Members and connected accounts remain separate.'
            : 'Your new branch is ready to use.'}
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
