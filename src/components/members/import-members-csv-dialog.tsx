'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  Download,
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Upload,
  Wand2,
  XCircle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { ImportMembersPreview } from './import-members-preview';
import { useAccountStaff } from './use-account-staff';
import { useMembershipPlans } from './use-membership-plans';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxGroup } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { useMemberImportDraft } from '@/hooks/use-member-import-draft';
import {
  customFieldId,
  CUSTOM_FIELD_TYPES,
  normalizeImportHeader,
  type CustomFieldRef,
  type RawCsv,
  type TargetField,
} from '@/lib/contacts/field-mapping';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import { downloadCsv, toCsv } from '@/lib/csv/export';
import { getErrorMessage } from '@/lib/errors';
import { dateAtNoonInTz } from '@/lib/locale/format';
import { importDateOrder } from '@/lib/locale/config';
import {
  detectDateOrder,
  detectFieldType,
  type DateOrder,
} from '@/lib/leads/import-coerce';
import {
  applyMemberMappingPreservingRows,
  autoMapMemberColumns,
  buildMemberTargets,
  buildMemberImportReceiptRows,
  MEMBER_IGNORE_KEY,
  MEMBER_TEMPLATE_CSV,
  serializeMemberImportReceiptCsv,
  validateMemberMapping,
} from '@/lib/memberships/import-commit';
import {
  MEMBER_IMPORT_DRAFT_VERSION,
  validateDraftState,
  type MemberImportDraftState,
} from '@/lib/memberships/import-draft';
import {
  MemberImportFileError,
  memberImportFileKind,
  parseMemberImportWorkbook,
  type MemberImportSheet,
} from '@/lib/memberships/import-workbook';
import {
  memberImportSourceKey,
  normalizeMemberImportCsv,
  type MemberImportExcludedSourceRow,
} from '@/lib/memberships/import-source';
import {
  loadMemberImportMatchIndex,
  preserveMemberImportCandidateSnapshots,
  rematchMemberImportCandidates,
} from '@/lib/memberships/member-import-matching';
import {
  MEMBER_IMPORT_FIELDS,
  MEMBER_IMPORT_GROUP_LABEL,
  MEMBER_IMPORT_GROUP_ORDER,
  type MemberImportGroup,
} from '@/lib/memberships/member-field-registry';
import {
  buildMigrationAnalysis,
  normalizeMemberMigrationStatus,
  splitPlanDuration,
  suggestMemberMigrationRecipe,
  type MemberMigrationRecipe,
} from '@/lib/memberships/migration-recipe';
import {
  buildMemberImportCandidates,
  patchMemberImportCandidate,
  revalidateMemberImportCandidates,
  resolveExistingContact,
  resolveGroupedOffering,
  resolveGroupedPlan,
  resolveGroupedService,
  resolveMembershipTerm,
  resolveCancelledMembershipDebt,
  resolvePaymentConflict,
  summarizeMemberImportCandidates,
  type MemberImportCandidate,
} from '@/lib/memberships/member-import-candidates';
import {
  commitMemberImportGroups,
  type MemberImportTransactionCheckpoint,
} from '@/lib/memberships/member-import-transaction';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type {
  CatalogItem,
  CatalogOption,
  MembershipPlan,
  Trainer,
  TrainerRate,
} from '@/types';

type Step = 1 | 2 | 3 | 4;
const SAMPLE_LIMIT = 3;
const CUSTOM_VALUE_CHUNK = 100;
const IMPORT_RULES =
  'Fix every row before you confirm. Your fixes are saved in this draft. Members and payments are saved only when you click Import. Rows you skip are not added.';
const DATE_KEYS = new Set([
  'start_date',
  'end_date',
  'freeze_date',
  'paid_at',
  'date_of_birth',
]);

interface ImportMembersCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface ImportResult {
  imported: number;
  attached: number;
  skipped: number;
  invalid: number;
  failed: number;
  payments: number;
  paymentFailed: number;
  statusFailed: number;
  tagsAssigned: number;
  tagsFailed: number;
  customValues: number;
  customValuesFailed: number;
  /** Conflicting contact-level values were resolved from the latest source row. */
  customValueConflicts: number;
  receiptCsv: string;
}

interface ImportProgress {
  completed: number;
  total: number;
  label: string;
}

function mappingForRecipe(
  raw: RawCsv,
  recipe: MemberMigrationRecipe,
  customFields: CustomFieldRef[]
): string[] {
  const mapping = autoMapMemberColumns(raw.headers, customFields);
  for (const [target, header] of Object.entries(recipe.mappings)) {
    if (!header) continue;
    const index = raw.headers.indexOf(header);
    if (index >= 0) mapping[index] = target;
  }
  return mapping;
}

export function ImportMembersCsvDialog({
  open,
  onOpenChange,
  onSaved,
}: ImportMembersCsvDialogProps) {
  const supabase = createClient();
  const { accountId, user, canEditSettings } = useAuth();
  const { locale, fmt } = useLocale();
  const accountDateOrder = importDateOrder(locale);
  const { plans, loading: plansLoading } = useMembershipPlans(false);
  const { staff, loading: staffLoading } = useAccountStaff();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReadSequence = useRef(0);
  const draftManager = useMemberImportDraft();

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [workbookSheets, setWorkbookSheets] = useState<MemberImportSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [raw, setRaw] = useState<RawCsv | null>(null);
  const [sourceRaw, setSourceRaw] = useState<RawCsv | null>(null);
  const [sourceRows, setSourceRows] = useState<number[]>([]);
  const [sourceExclusions, setSourceExclusions] = useState<
    MemberImportExcludedSourceRow[]
  >([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedRecipe, setSuggestedRecipe] =
    useState<MemberMigrationRecipe | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>(accountDateOrder);
  const [customFields, setCustomFields] = useState<CustomFieldRef[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainerRates, setTrainerRates] = useState<TrainerRate[]>([]);
  const [serviceFactsLoading, setServiceFactsLoading] = useState(false);
  const [candidates, setCandidates] = useState<MemberImportCandidate[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [compliance, setCompliance] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [executionJournal, setExecutionJournal] = useState<
    MemberImportTransactionCheckpoint[]
  >([]);
  const executionJournalRef = useRef<MemberImportTransactionCheckpoint[]>([]);
  const [resumingDraft, setResumingDraft] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [startFreshConfirm, setStartFreshConfirm] = useState(false);
  const [draftAction, setDraftAction] = useState<
    'closing' | 'reloading' | 'discarding' | 'retrying' | null
  >(null);

  const [createCol, setCreateCol] = useState<number | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [savingField, setSavingField] = useState(false);

  // Reset only when a new open cycle begins; render-time state adjustment
  // avoids the repository's set-state-in-effect lint trap.
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) {
      setStep(1);
      setFile(null);
      setReadingFile(false);
      setWorkbookSheets([]);
      setSelectedSheet('');
      setRaw(null);
      setSourceRaw(null);
      setSourceRows([]);
      setSourceExclusions([]);
      setMapping([]);
      setAnalyzing(false);
      setSuggestedRecipe(null);
      setDateOrder(accountDateOrder);
      setCandidates([]);
      setCompliance(false);
      setImporting(false);
      setImportProgress(null);
      setResult(null);
      setResumingDraft(false);
      setResumeError(null);
      setStartFreshConfirm(false);
      setCreateCol(null);
    }
  }

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('custom_fields')
        .select('id, field_name, field_type')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
      if (!cancelled) setCustomFields((data as CustomFieldRef[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    void (async () => {
      setServiceFactsLoading(true);
      const [itemsResult, trainersResult] = await Promise.all([
        supabase
          .from('catalog_items')
          .select('*, catalog_options(*, trainer_rates(*))')
          .eq('account_id', accountId),
        supabase.from('trainers').select('*').eq('account_id', accountId),
      ]);
      if (cancelled) return;
      if (itemsResult.error || trainersResult.error) {
        toast.error('Could not load services and trainers.');
        setCatalogItems([]);
        setTrainers([]);
        setTrainerRates([]);
      } else {
        const items = (itemsResult.data ?? []) as (CatalogItem & {
          catalog_options: (CatalogOption & {
            trainer_rates?: TrainerRate[];
          })[];
        })[];
        setCatalogItems(items);
        setTrainers((trainersResult.data as Trainer[]) ?? []);
        setTrainerRates(
          items.flatMap((item) =>
            (item.catalog_options ?? []).flatMap(
              (option) => option.trainer_rates ?? []
            )
          )
        );
      }
      setServiceFactsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  const targets = useMemo(
    () => buildMemberTargets(customFields),
    [customFields]
  );
  const targetByKey = useMemo(
    () => new Map(targets.map((target) => [target.key, target])),
    [targets]
  );
  const customFieldTypes = useMemo(
    () =>
      new Map(
        customFields.map((field) => [field.id, field.field_type ?? 'text'])
      ),
    [customFields]
  );
  const validation = useMemo(() => validateMemberMapping(mapping), [mapping]);
  const duplicateKeys = useMemo(
    () => new Set(validation.duplicateTargets),
    [validation.duplicateTargets]
  );
  // One sentence next to the blocked button instead of a stack of rules.
  const mappingIssue = useMemo(() => {
    if (validation.ok) return null;
    const parts: string[] = [];
    if (!validation.phoneMapped) parts.push('Choose which column has the phone number.');
    if (!validation.planMapped) {
      parts.push('Choose which column has the plan or service.');
    }
    if (validation.duplicateTargets.length > 0) {
      const labels = validation.duplicateTargets.map(
        (key) => targetByKey.get(key)?.label ?? key
      );
      parts.push(
        `${labels.join(', ')} ${labels.length === 1 ? 'is' : 'are'} picked for more than one column.`
      );
    }
    return parts.join(' ');
  }, [validation, targetByKey]);
  const samples = useMemo(() => {
    if (!raw) return [];
    return raw.headers.map((_, column) =>
      raw.rows
        .map((row) => row[column]?.trim())
        .filter(Boolean)
        .slice(0, SAMPLE_LIMIT)
    );
  }, [raw]);
  const ambiguousDateCols = useMemo(() => {
    const cols = new Set<number>();
    if (!raw) return cols;
    mapping.forEach((key, column) => {
      const fieldId = customFieldId(key);
      const isDate =
        DATE_KEYS.has(key) ||
        (fieldId && customFieldTypes.get(fieldId) === 'date');
      if (!isDate) return;
      const values = raw.rows.slice(0, 50).map((row) => row[column] ?? '');
      if (detectDateOrder(values) === 'ambiguous') cols.add(column);
    });
    return cols;
  }, [raw, mapping, customFieldTypes]);

  const candidateContext = useMemo(
    () => ({
      plans,
      catalogItems,
      trainers,
      trainerRates,
      dateOrder,
      today: fmt.today(),
      staff,
      importJobId: draftManager.draft?.id,
      attemptedSourceKeys: new Set(
        executionJournal.flatMap((entry) => entry.sourceKeys)
      ),
    }),
    [
      catalogItems,
      dateOrder,
      draftManager.draft?.id,
      executionJournal,
      fmt,
      plans,
      staff,
      trainerRates,
      trainers,
    ]
  );
  const candidateSummary = useMemo(
    () => summarizeMemberImportCandidates(candidates),
    [candidates]
  );
  const readyRows = candidates.filter((candidate) => candidate.isReady);
  const hasJournalWork = executionJournal.some(
    (entry) =>
      entry.status === 'pending' ||
      entry.status === 'uncertain' ||
      entry.status === 'imported'
  );
  const lockedSourceKeys = useMemo(() => {
    const attempted = new Set(
      executionJournal
        .filter(
          (entry) =>
            entry.status === 'pending' ||
            entry.status === 'imported' ||
            entry.status === 'uncertain'
        )
        .flatMap((entry) => entry.sourceKeys)
    );
    const attemptedGroups = new Set(
      candidates
        .filter((candidate) => attempted.has(candidate.sourceKey))
        .map((candidate) => candidate.customerGroupKey)
    );
    return new Set(
      candidates
        .filter((candidate) => attemptedGroups.has(candidate.customerGroupKey))
        .map((candidate) => candidate.sourceKey)
    );
  }, [candidates, executionJournal]);
  const hasUnresolvedNewCandidates = candidates.some(
    (candidate) =>
      !lockedSourceKeys.has(candidate.sourceKey) &&
      candidate.disposition === 'included' &&
      !candidate.isReady
  );
  const draftState = useMemo<MemberImportDraftState>(
    () => ({
      version: MEMBER_IMPORT_DRAFT_VERSION,
      step,
      worksheet: selectedSheet || null,
      mapping,
      dateOrder,
      recipe: suggestedRecipe,
      candidates,
      resolutions: { execution: executionJournal },
      exclusions: candidates
        .filter((candidate) => candidate.disposition === 'excluded')
        .map((candidate) => candidate.sourceKey),
      receipt: result,
    }),
    [
      candidates,
      dateOrder,
      executionJournal,
      mapping,
      result,
      selectedSheet,
      step,
      suggestedRecipe,
    ]
  );
  const activeDraftId = draftManager.draft?.id ?? null;
  const scheduleDraftSave = draftManager.save;

  useEffect(() => {
    if (
      !open ||
      !file ||
      !activeDraftId ||
      readingFile ||
      resumingDraft ||
      importing
    ) {
      return;
    }
    scheduleDraftSave(draftState);
  }, [
    activeDraftId,
    draftState,
    file,
    importing,
    open,
    readingFile,
    resumingDraft,
    scheduleDraftSave,
  ]);

  async function requestClose() {
    if (importing) return;
    setDraftAction('closing');
    try {
      if (draftManager.draft && file) {
        const saved = await draftManager.flush();
        if (!saved) return;
      }
      fileReadSequence.current++;
      setReadingFile(false);
      onOpenChange(false);
    } finally {
      setDraftAction(null);
    }
  }

  function handleOpenChange(next: boolean) {
    if (next) onOpenChange(true);
    else void requestClose();
  }

  function resetWorkingImport() {
    fileReadSequence.current++;
    setStep(1);
    setFile(null);
    setReadingFile(false);
    setWorkbookSheets([]);
    setSelectedSheet('');
    setRaw(null);
    setSourceRaw(null);
    setSourceRows([]);
    setSourceExclusions([]);
    setMapping([]);
    setSuggestedRecipe(null);
    setDateOrder(accountDateOrder);
    setCandidates([]);
    setCompliance(false);
    setImportProgress(null);
    setResult(null);
    setExecutionJournal([]);
    executionJournalRef.current = [];
    setResumeError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function startFresh() {
    setDraftAction('discarding');
    try {
      const discarded = await draftManager.discard();
      if (!discarded) return;
      resetWorkingImport();
      setStartFreshConfirm(false);
    } finally {
      setDraftAction(null);
    }
  }

  async function reloadSavedDraft() {
    setDraftAction('reloading');
    try {
      const saved = await draftManager.reload();
      if (saved) await resumeSavedDraft(saved);
    } finally {
      setDraftAction(null);
    }
  }

  async function retryDraftSave() {
    setDraftAction('retrying');
    try {
      draftManager.save(draftState);
      await draftManager.flush();
    } finally {
      setDraftAction(null);
    }
  }

  function prepareRawTable(parsed: RawCsv) {
    const nextMapping = autoMapMemberColumns(parsed.headers, customFields);
    setRaw(parsed);
    setSourceRaw(parsed);
    setMapping(nextMapping);
    setSuggestedRecipe(null);
    setCandidates([]);
    setResult(null);

    const dateColumns = nextMapping
      .map((key, index) => (DATE_KEYS.has(key) ? index : -1))
      .filter((index) => index >= 0);
    const detected = detectDateOrder(
      dateColumns.flatMap((index) =>
        parsed.rows.slice(0, 50).map((row) => row[index] ?? '')
      )
    );
    const nextDateOrder =
      detected === 'ambiguous' ? accountDateOrder : detected;
    setDateOrder(nextDateOrder);
    return { mapping: nextMapping, dateOrder: nextDateOrder };
  }

  async function analyzeFile() {
    const input = sourceRaw ?? raw;
    if (!input) return;
    setAnalyzing(true);
    try {
      const response = await fetch('/api/members/import-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMigrationAnalysis(input)),
      });
      const data = (await response.json()) as {
        error?: string;
        configured?: boolean;
        recipe?: MemberMigrationRecipe;
        warning?: string;
      };
      if (!response.ok || !data.recipe) {
        throw new Error(data.error || 'Could not read this file');
      }
      setSuggestedRecipe(data.recipe);
      setRaw(input);
      setMapping(mappingForRecipe(input, data.recipe, customFields));
      setStep(2);
      if (!data.configured) {
        toast.info(
          'Columns were matched by their names. Check them before you continue.'
        );
      } else if (data.warning) {
        toast.warning(data.warning);
      }
    } catch (error) {
      const fallback = suggestMemberMigrationRecipe(input.headers);
      setSuggestedRecipe(fallback);
      setRaw(input);
      setMapping(mappingForRecipe(input, fallback, customFields));
      setStep(2);
      toast.warning(
        `${getErrorMessage(error, 'Automatic matching is not working')} Columns were matched by their names. Check them before you continue.`
      );
    } finally {
      setAnalyzing(false);
    }
  }

  // Single bulk action behind the mapping table's "Match for me": re-derive every
  // column from its header name, which necessarily discards a suggested recipe.
  function remapFromColumnNames() {
    const source = sourceRaw ?? raw;
    if (!source) return;
    setRaw(source);
    setMapping(autoMapMemberColumns(source.headers, customFields));
    setSuggestedRecipe(null);
    setCandidates([]);
  }

  function restoreDraftState(state: MemberImportDraftState) {
    const savedStep =
      typeof state.step === 'number'
        ? state.step
        : state.step === 'map'
          ? 2
          : state.step === 'resolve'
            ? 3
            : state.step === 'confirm' || state.step === 'receipt'
              ? 4
              : 1;
    setStep(savedStep as Step);
    setSelectedSheet(state.worksheet ?? '');
    if (Array.isArray(state.mapping)) setMapping(state.mapping);
    setDateOrder(state.dateOrder);
    setSuggestedRecipe((state.recipe as MemberMigrationRecipe | null) ?? null);
    setCandidates((state.candidates as MemberImportCandidate[]) ?? []);
    setResult((state.receipt as ImportResult | null) ?? null);
    const savedJournal = (state.resolutions as { execution?: unknown })
      .execution;
    if (
      Array.isArray(savedJournal) &&
      savedJournal.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { customerGroupKey?: unknown }).customerGroupKey ===
            'string' &&
          typeof (entry as { payload?: unknown }).payload === 'object'
      )
    ) {
      const next = savedJournal as MemberImportTransactionCheckpoint[];
      executionJournalRef.current = next;
      setExecutionJournal(next);
    }
  }

  async function revalidateSavedDraftState(state: MemberImportDraftState) {
    if (!accountId || !Array.isArray(state.candidates)) return;
    const [plansResult, itemsResult, trainersResult] = await Promise.all([
      supabase
        .from('membership_plans')
        .select('*, pricing_options:plan_pricing_options(*)')
        .eq('account_id', accountId),
      supabase
        .from('catalog_items')
        .select('*, catalog_options(*, trainer_rates(*))')
        .eq('account_id', accountId),
      supabase.from('trainers').select('*').eq('account_id', accountId),
    ]);
    const loadError =
      plansResult.error ?? itemsResult.error ?? trainersResult.error ?? null;
    if (loadError) throw loadError;

    const freshPlans = (plansResult.data as MembershipPlan[]) ?? [];
    const freshItems = (itemsResult.data ?? []) as (CatalogItem & {
      catalog_options: (CatalogOption & { trainer_rates?: TrainerRate[] })[];
    })[];
    const freshTrainers = (trainersResult.data as Trainer[]) ?? [];
    const freshRates = freshItems.flatMap((item) =>
      (item.catalog_options ?? []).flatMap(
        (option) => option.trainer_rates ?? []
      )
    );
    const savedCandidates = state.candidates as MemberImportCandidate[];
    const freshContext = {
      plans: freshPlans,
      catalogItems: freshItems,
      trainers: freshTrainers,
      trainerRates: freshRates,
      dateOrder: state.dateOrder,
      today: fmt.today(),
      staff,
      importJobId: draftManager.draft?.id,
      attemptedSourceKeys: new Set(
        executionJournalRef.current.flatMap((entry) => entry.sourceKeys)
      ),
    };
    const rebuilt = revalidateMemberImportCandidates(
      savedCandidates,
      freshContext
    );
    const lockedSourceKeys = new Set(
      executionJournalRef.current
        .filter(
          (entry) =>
            entry.status === 'pending' ||
            entry.status === 'imported' ||
            entry.status === 'uncertain'
        )
        .flatMap((entry) => entry.sourceKeys)
    );
    const preliminary = rebuilt.map((candidate, index) =>
      lockedSourceKeys.has(candidate.sourceKey)
        ? (savedCandidates[index] ?? candidate)
        : candidate
    );
    const matchIndex = await loadMemberImportMatchIndex({
      contactsPage: (from, to) =>
        supabase
          .from('contacts')
          .select(
            'id, phone_normalized, received_via, name, email, company, date_of_birth, gender, nickname, height_cm, weight_kg, address_line1, address_line2, city, state, postal_code, country, assigned_arrival_time'
          )
          .eq('account_id', accountId)
          .order('id')
          .range(from, to),
      membershipsPage: (from, to) =>
        supabase
          .from('memberships')
          .select('contact_id')
          .eq('account_id', accountId)
          .order('id')
          .range(from, to),
    });
    setCatalogItems(freshItems);
    setTrainers(freshTrainers);
    setTrainerRates(freshRates);
    const rematched = rematchMemberImportCandidates(
      preliminary,
      matchIndex,
      freshContext,
      true
    );
    // A journal-owned row is a snapshot of the exact payload and outcome we
    // can safely recover. A resume lookup informs only unattempted rows.
    setCandidates(
      rematched.map((candidate, index) =>
        lockedSourceKeys.has(candidate.sourceKey)
          ? (savedCandidates[index] ?? candidate)
          : candidate
      )
    );
  }

  async function processSelectedFile(
    selected: File,
    options: {
      initializeDraft: boolean;
      restore?: MemberImportDraftState;
    }
  ) {
    const kind = memberImportFileKind(selected.name);
    if (!kind) {
      toast.error(
        selected.name.toLowerCase().endsWith('.xls')
          ? 'Old .xls files do not work. In Excel, save the file as .xlsx or .csv and try again.'
          : 'This file type does not work. Choose a .csv or .xlsx file.'
      );
      return false;
    }

    const sequence = ++fileReadSequence.current;
    setFile(selected);
    setReadingFile(true);
    setWorkbookSheets([]);
    setSelectedSheet('');
    setRaw(null);
    setMapping([]);
    setResult(null);

    try {
      let initialState: MemberImportDraftState = {
        version: MEMBER_IMPORT_DRAFT_VERSION,
        step: 1,
        worksheet: null,
        mapping: [],
        dateOrder: accountDateOrder,
        recipe: null,
        candidates: [],
        resolutions: {},
        exclusions: [],
        receipt: null,
      };
      if (kind === 'csv') {
        const normalized = normalizeMemberImportCsv(
          selected.name,
          await selected.text()
        );
        const parsed = normalized.raw;
        if (sequence !== fileReadSequence.current) return false;
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          throw new MemberImportFileError(
            'No rows found. The first row of the file must have column names.'
          );
        }
        const prepared = prepareRawTable(parsed);
        setSourceRows(normalized.sourceRows);
        setSourceExclusions(normalized.excludedRows);
        initialState = {
          ...initialState,
          mapping: prepared.mapping,
          dateOrder: prepared.dateOrder,
        };
      } else {
        const sheets = await parseMemberImportWorkbook(selected);
        if (sequence !== fileReadSequence.current) return false;
        setWorkbookSheets(sheets);
        const requestedSheet = options.restore?.worksheet
          ? sheets.find((sheet) => sheet.name === options.restore?.worksheet)
          : null;
        const selectedWorksheet =
          requestedSheet ??
          (sheets.length === 1 && sheets[0].raw ? sheets[0] : null);
        if (selectedWorksheet?.raw) {
          setSelectedSheet(selectedWorksheet.name);
          const prepared = prepareRawTable(selectedWorksheet.raw);
          setSourceRows(selectedWorksheet.sourceRows);
          setSourceExclusions(selectedWorksheet.excludedRows);
          initialState = {
            ...initialState,
            worksheet: selectedWorksheet.name,
            mapping: prepared.mapping,
            dateOrder: prepared.dateOrder,
          };
        } else {
          const firstUsable = sheets.find((sheet) => sheet.raw);
          if (!firstUsable) {
            throw new MemberImportFileError(
              sheets[0]?.error ?? 'No sheet in this file has member data.'
            );
          }
        }
      }
      if (options.restore) restoreDraftState(options.restore);
      if (options.initializeDraft) {
        const created = await draftManager.initialize(
          selected,
          initialState.dateOrder,
          initialState
        );
        if (!created) {
          if (sequence === fileReadSequence.current) {
            resetWorkingImport();
          }
          toast.error(
            'Could not save your progress. Choose your file again to try again.'
          );
          return false;
        }
      }
      return true;
    } catch (error) {
      if (sequence !== fileReadSequence.current) return false;
      setFile(null);
      setWorkbookSheets([]);
      setSelectedSheet('');
      setRaw(null);
      setMapping([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.error(
        error instanceof MemberImportFileError
          ? error.message
          : getErrorMessage(error, 'Could not read this file')
      );
      return false;
    } finally {
      if (sequence === fileReadSequence.current) setReadingFile(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const succeeded = await processSelectedFile(selected, {
      initializeDraft: true,
    });
    if (!succeeded) event.target.value = '';
  }

  async function resumeSavedDraft(
    saved: NonNullable<typeof draftManager.draft>
  ) {
    if (!saved.signedUrl) {
      setResumeError(
        'Could not open the saved file. Reload to try again, or start again with your file.'
      );
      return false;
    }
    setResumingDraft(true);
    setResumeError(null);
    try {
      const response = await fetch(saved.signedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load the saved file');
      const bytes = await response.arrayBuffer();
      if (
        saved.sourceSize !== undefined &&
        bytes.byteLength !== saved.sourceSize
      ) {
        throw new Error('The saved file has changed');
      }
      if (saved.sourceSha256) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const actual = [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        if (actual !== saved.sourceSha256) {
          throw new Error('The saved file has changed');
        }
      }
      const source = new File([bytes], saved.sourceFilename, {
        type:
          saved.sourceKind === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
      });
      const restored = await processSelectedFile(source, {
        initializeDraft: false,
        restore: saved.state,
      });
      if (restored) await revalidateSavedDraftState(saved.state);
      return restored;
    } catch (error) {
      setResumeError(
        `${getErrorMessage(error, 'Could not continue the saved import')}. Reload to try again, or start again with your file.`
      );
      return false;
    } finally {
      setResumingDraft(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const saved = await draftManager.load();
      if (cancelled || !saved) return;
      await resumeSavedDraft(saved);
    })();
    return () => {
      cancelled = true;
    };
    // A new open cycle mounts a fresh continuation check. The manager callbacks
    // are stable; processing functions intentionally read current account data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftManager.load]);

  function handleWorksheetChange(name: string) {
    const sheet = workbookSheets.find((item) => item.name === name);
    if (!sheet?.raw) return;
    setSelectedSheet(name);
    setSourceRows(sheet.sourceRows);
    setSourceExclusions(sheet.excludedRows);
    prepareRawTable(sheet.raw);
  }

  function setColumn(column: number, key: string) {
    setMapping((current) => {
      const next = [...current];
      next[column] = key;
      return next;
    });
  }

  function requestCreateField(column: number) {
    if (!raw) return;
    const detected = detectFieldType(raw.headers[column] ?? '', [
      ...(samples[column] ?? []),
      ...raw.rows.slice(0, 40).map((row) => row[column] ?? ''),
    ]);
    setCreateCol(column);
    setNewFieldName(detected.label);
    setNewFieldType(detected.type);
  }

  async function saveCustomField() {
    if (createCol === null || !accountId || !user) return;
    const name = newFieldName.trim();
    if (!name) return toast.error('Enter a field name');
    const normalized = normalizeImportHeader(name);
    const reserved = MEMBER_IMPORT_FIELDS.some(
      (item) =>
        normalizeImportHeader(item.label) === normalized ||
        item.synonyms.some(
          (synonym) => normalizeImportHeader(synonym) === normalized
        )
    );
    if (reserved) {
      return toast.error('A member detail with this name already exists.');
    }
    if (
      customFields.some(
        (field) => normalizeImportHeader(field.field_name) === normalized
      )
    ) {
      return toast.error('An extra detail with this name already exists.');
    }

    setSavingField(true);
    const { data, error } = await supabase
      .from('custom_fields')
      .insert({
        user_id: user.id,
        account_id: accountId,
        field_name: name,
        field_type: newFieldType,
      })
      .select('id, field_name, field_type')
      .single();
    setSavingField(false);
    if (error || !data) {
      toast.error(getErrorMessage(error, 'Could not add the extra detail'));
      return;
    }
    const created = data as CustomFieldRef;
    setCustomFields((current) => [...current, created]);
    setColumn(createCol, `custom:${created.id}`);
    setCreateCol(null);
    toast.success(`Added “${created.field_name}”`);
  }

  async function buildPreview() {
    if (!raw || !accountId) return;
    setLoadingPreview(true);
    try {
      const mapped = applyMemberMappingPreservingRows(raw.rows, mapping, {
        dialCode: locale.phoneCountryCode,
        customFieldTypes,
        dateOrder,
      });
      const recipe =
        suggestedRecipe ?? suggestMemberMigrationRecipe(raw.headers);
      const inputs = mapped.rows.map((mappedRow, index) => {
        const source = raw.rows[index] ?? [];
        const originalValues = { ...mappedRow };
        if (recipe.splitPlanDuration && originalValues.planName) {
          const split = splitPlanDuration(originalValues.planName);
          originalValues.planName = split.plan;
          if (split.option) originalValues.pricingOption = split.option;
        }
        originalValues.status = normalizeMemberMigrationStatus(
          originalValues.status,
          originalValues.endDate,
          dateOrder,
          fmt.today()
        );
        // Only a reviewed mapping can establish an identity or financial fact.
        // Recipe guesses are presentation help, never a hidden import fallback.
        const legacyMemberId = mappedRow.legacyMemberId?.trim() || '';
        if (recipe.legacyId !== 'exclude' && legacyMemberId) {
          originalValues.notes = [
            originalValues.notes,
            `Old Member ID: ${legacyMemberId}`,
          ]
            .filter(Boolean)
            .join(' · ');
        }
        return {
          sourceKey: memberImportSourceKey(
            selectedSheet || file?.name || 'csv',
            sourceRows[index] ?? index + 2
          ),
          sourceRow: sourceRows[index] ?? index + 2,
          legacyMemberId,
          originalValues,
          isSummaryRow:
            recipe.excludeSummaryRows &&
            source.some((value) =>
              /^number of records\s*:/i.test(value.trim())
            ),
        };
      });
      const preliminary = buildMemberImportCandidates(inputs, candidateContext);
      const matchIndex = await loadMemberImportMatchIndex({
        contactsPage: (from, to) =>
          supabase
            .from('contacts')
            .select(
              'id, phone_normalized, received_via, name, email, company, date_of_birth, gender, nickname, height_cm, weight_kg, address_line1, address_line2, city, state, postal_code, country, assigned_arrival_time'
            )
            .eq('account_id', accountId)
            .order('id')
            .range(from, to),
        membershipsPage: (from, to) =>
          supabase
            .from('memberships')
            .select('contact_id')
            .eq('account_id', accountId)
            .order('id')
            .range(from, to),
      });
      const nextCandidates = rematchMemberImportCandidates(
        preliminary,
        matchIndex,
        candidateContext
      );
      if (
        !validateDraftState({ ...draftState, candidates: nextCandidates }).ok
      ) {
        throw new Error(
          'This file is too big. Split it into smaller files and add them one by one.'
        );
      }
      setCandidates(nextCandidates);
      setStep(3);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not show the preview'));
    } finally {
      setLoadingPreview(false);
    }
  }

  function patchCandidate(
    sourceKey: string,
    patch: Parameters<typeof patchMemberImportCandidate>[2]
  ) {
    if (lockedSourceKeys.has(sourceKey)) return;
    setCandidates((current) => {
      const next = patchMemberImportCandidate(
        current,
        sourceKey,
        patch,
        candidateContext
      );
      void rematchEditedCandidates();
      return next;
    });
  }

  function canEditSources(sourceKeys: string[]) {
    return sourceKeys.every((sourceKey) => !lockedSourceKeys.has(sourceKey));
  }

  async function rematchEditedCandidates() {
    if (!accountId) return;
    try {
      const index = await loadMemberImportMatchIndex({
        contactsPage: (from, to) =>
          supabase
            .from('contacts')
            .select(
              'id, phone_normalized, received_via, name, email, company, date_of_birth, gender, nickname, height_cm, weight_kg, address_line1, address_line2, city, state, postal_code, country, assigned_arrival_time'
            )
            .eq('account_id', accountId)
            .order('id')
            .range(from, to),
        membershipsPage: (from, to) =>
          supabase
            .from('memberships')
            .select('contact_id')
            .eq('account_id', accountId)
            .order('id')
            .range(from, to),
      });
      setCandidates((current) =>
        preserveMemberImportCandidateSnapshots(
          current,
          rematchMemberImportCandidates(current, index, candidateContext, true),
          lockedSourceKeys
        )
      );
    } catch (error) {
      // A stale contact id is never safe to send. Removing it forces the
      // reviewer back through the existing-contact decision once lookup works.
      setCandidates((current) => {
        const revalidated = revalidateMemberImportCandidates(
          current.map((candidate) =>
            lockedSourceKeys.has(candidate.sourceKey)
              ? candidate
              : {
                  ...candidate,
                  existingMatch: null,
                  resolutions: {
                    ...candidate.resolutions,
                    existingContact: null,
                  },
                }
          ),
          candidateContext
        );
        return preserveMemberImportCandidateSnapshots(
          current,
          revalidated,
          lockedSourceKeys
        );
      });
      toast.error(
        getErrorMessage(
          error,
          'Could not check for people already saved. Check the row again before you import.'
        )
      );
    }
  }

  async function handleImport() {
    if (!accountId || !user) return;
    setImporting(true);
    try {
      const importJobId = draftManager.draft?.id;
      if (!importJobId) {
        throw new Error(
          'Your progress is not saved yet. Save it before you import.'
        );
      }
      const journalOwnedSourceKeys = new Set(
        executionJournalRef.current.flatMap((entry) => entry.sourceKeys)
      );
      const matchIndex = await loadMemberImportMatchIndex({
        contactsPage: (from, to) =>
          supabase
            .from('contacts')
            .select(
              'id, phone_normalized, received_via, name, email, company, date_of_birth, gender, nickname, height_cm, weight_kg, address_line1, address_line2, city, state, postal_code, country, assigned_arrival_time'
            )
            .eq('account_id', accountId)
            .order('id')
            .range(from, to),
        membershipsPage: (from, to) =>
          supabase
            .from('memberships')
            .select('contact_id')
            .eq('account_id', accountId)
            .order('id')
            .range(from, to),
      });
      // Match every unattempted row immediately before payload construction.
      // Attempted rows retain their candidate snapshot because their exact
      // payload is already durable and must never be rebuilt.
      const rematched = rematchMemberImportCandidates(
        candidates,
        matchIndex,
        candidateContext,
        true
      );
      const activeCandidates = rematched.map((candidate, index) =>
        journalOwnedSourceKeys.has(candidate.sourceKey)
          ? (candidates[index] ?? candidate)
          : candidate
      );
      const replayableGroups = new Set(
        executionJournalRef.current
          .filter(
            (entry) =>
              entry.status === 'pending' ||
              entry.status === 'uncertain' ||
              entry.status === 'imported'
          )
          .map((entry) => entry.customerGroupKey)
      );
      const enrichmentCandidates = activeCandidates.filter(
        (candidate) =>
          candidate.isReady || replayableGroups.has(candidate.customerGroupKey)
      );
      // Show new lookup facts before returning. In particular, a changed
      // existing contact must visibly reopen its keep/use decision.
      setCandidates(activeCandidates);
      if (
        enrichmentCandidates.length === 0 ||
        activeCandidates.some(
          (candidate) =>
            !journalOwnedSourceKeys.has(candidate.sourceKey) &&
            candidate.disposition === 'included' &&
            !candidate.isReady
        )
      ) {
        setStep(3);
        toast.warning(
          'Some rows now match people already saved. Check those rows before you import.'
        );
        return;
      }
      setImportProgress({
        completed: 0,
        total: Math.max(1, enrichmentCandidates.length),
        label: 'Getting ready…',
      });
      if (
        !validateDraftState({
          ...draftState,
          candidates: activeCandidates,
          resolutions: {
            ...draftState.resolutions,
            execution: executionJournalRef.current,
          },
        }).ok
      ) {
        throw new Error(
          'This file is too big. Split it into smaller files and add them one by one.'
        );
      }
      const allTagNames = enrichmentCandidates.flatMap(
        (candidate) => candidate.draftValues.tagNames
      );
      const { tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
        accountId,
        userId: user.id,
        tagNames: allTagNames,
        canCreateTags: canEditSettings,
      });

      const transaction = await commitMemberImportGroups(activeCandidates, {
        accountId,
        importJobId,
        rpc: (functionName, args) => supabase.rpc(functionName, args),
        paidAt: (date) =>
          (dateAtNoonInTz(date, locale.timeZone) ?? new Date()).toISOString(),
        checkpoints: executionJournalRef.current,
        prepare: async (pending) => {
          const byGroup = new Map(
            executionJournalRef.current.map((entry) => [
              entry.customerGroupKey,
              entry,
            ])
          );
          for (const checkpoint of pending) {
            byGroup.set(checkpoint.customerGroupKey, checkpoint);
          }
          const next = [...byGroup.values()];
          if (
            !validateDraftState({
              ...draftState,
              candidates: activeCandidates,
              resolutions: { ...draftState.resolutions, execution: next },
            }).ok
          ) {
            toast.error(
              'This file is too big. Split it into smaller files and add them one by one.'
            );
            return false;
          }
          executionJournalRef.current = next;
          setExecutionJournal(next);
          return draftManager.saveAndFlush({
            ...draftState,
            candidates: activeCandidates,
            resolutions: { ...draftState.resolutions, execution: next },
          });
        },
        checkpoint: async (checkpoint) => {
          const previous = executionJournalRef.current;
          const index = previous.findIndex(
            (entry) => entry.customerGroupKey === checkpoint.customerGroupKey
          );
          const next = [...previous];
          if (index >= 0) next[index] = checkpoint;
          else next.push(checkpoint);
          executionJournalRef.current = next;
          setExecutionJournal(next);
          // The payload is written before its RPC and is the only retry source.
          if (
            !validateDraftState({
              ...draftState,
              candidates: activeCandidates,
              resolutions: { ...draftState.resolutions, execution: next },
            }).ok
          ) {
            toast.error(
              'This file is too big. Split it into smaller files and add them one by one.'
            );
            return false;
          }
          return draftManager.saveAndFlush({
            ...draftState,
            candidates: activeCandidates,
            resolutions: { ...draftState.resolutions, execution: next },
          });
        },
        onProgress: (completed, total, label) =>
          setImportProgress({ completed, total, label }),
      });
      const groupByKey = new Map(
        transaction.groups.map((group) => [group.customerGroupKey, group])
      );
      const results = activeCandidates.map((candidate) => {
        // A confirmed journal entry owns recovery. A live re-match may now
        // call this contact an existing member, but that must not erase the
        // confirmed outcome or skip its pending metadata enrichment.
        const confirmed = groupByKey.get(candidate.customerGroupKey);
        if (
          confirmed?.status === 'imported' &&
          confirmed.sourceKeys.includes(candidate.sourceKey)
        ) {
          return {
            sourceRowIndex: candidate.sourceRow,
            disposition: 'imported' as const,
            memberOutcome: candidate.existingMatch
              ? ('attached' as const)
              : ('created' as const),
            paymentOutcome: candidate.built.payment
              ? ('recorded' as const)
              : ('not-requested' as const),
            reason: null,
            contactId: confirmed.contactId,
            membershipId: candidate.membershipComponent?.included
              ? confirmed.membershipId
              : null,
          };
        }
        if (candidate.disposition === 'excluded') {
          return {
            sourceRowIndex: candidate.sourceRow,
            disposition: 'excluded' as const,
            memberOutcome: 'not-processed' as const,
            paymentOutcome: 'not-processed' as const,
            reason: candidate.exclusionReason ?? 'Skipped by you',
            contactId: null,
            membershipId: null,
          };
        }
        if (!candidate.isReady) {
          return {
            sourceRowIndex: candidate.sourceRow,
            disposition: 'unresolved' as const,
            memberOutcome: 'not-processed' as const,
            paymentOutcome: 'not-processed' as const,
            reason: 'Fix this row before you import',
            contactId: null,
            membershipId: null,
          };
        }
        const group = confirmed;
        if (!group || group.status !== 'imported') {
          return {
            sourceRowIndex: candidate.sourceRow,
            disposition: 'failed' as const,
            memberOutcome: 'failed' as const,
            paymentOutcome: candidate.built.payment
              ? ('failed' as const)
              : ('not-requested' as const),
            reason: group?.error ?? 'Could not save this member',
            contactId: null,
            membershipId: null,
          };
        }
        return {
          sourceRowIndex: candidate.sourceRow,
          disposition: 'imported' as const,
          memberOutcome: candidate.existingMatch
            ? ('attached' as const)
            : ('created' as const),
          paymentOutcome: candidate.built.payment
            ? ('recorded' as const)
            : ('not-requested' as const),
          reason: null,
          contactId: group.contactId,
          membershipId: candidate.membershipComponent?.included
            ? group.membershipId
            : null,
        };
      });
      const statusFailed = 0;

      const candidateByRow = new Map(
        activeCandidates.map((candidate) => [candidate.sourceRow, candidate])
      );
      const persisted = results.filter((item) => item.contactId);
      const tagAssignments: ContactTagAssignment[] = persisted.flatMap(
        (item) => {
          const candidate = candidateByRow.get(item.sourceRowIndex);
          return candidate && candidate.draftValues.tagNames.length > 0
            ? [
                {
                  contactId: item.contactId!,
                  tagNames: candidate.draftValues.tagNames,
                },
              ]
            : [];
        }
      );
      const customValueRows = persisted.flatMap((item) => {
        const candidate = candidateByRow.get(item.sourceRowIndex);
        return (candidate?.draftValues.customValues ?? []).map((custom) => ({
          contact_id: item.contactId!,
          custom_field_id: custom.fieldId,
          value: custom.value,
          sourceRow: item.sourceRowIndex,
        }));
      });
      // Contact custom values are customer-scoped whereas an import group can
      // contain several purchases. Collapse exact repeats and let the last
      // physical source row win a conflicting value, so one bulk upsert never
      // contains the same conflict target twice. The warning makes that
      // deterministic choice inspectable without creating an unfixable retry.
      const customValueByContactField = new Map<
        string,
        (typeof customValueRows)[number]
      >();
      let conflictingCustomValues = 0;
      for (const row of customValueRows) {
        const key = `${row.contact_id}:${row.custom_field_id}`;
        const previous = customValueByContactField.get(key);
        if (previous && previous.value !== row.value)
          conflictingCustomValues += 1;
        if (!previous || row.sourceRow >= previous.sourceRow) {
          customValueByContactField.set(key, row);
        }
      }
      const deduplicatedCustomValueRows = [
        ...customValueByContactField.values(),
      ].map(({ contact_id, custom_field_id, value }) => ({
        contact_id,
        custom_field_id,
        value,
      }));

      let customValues = 0;
      let customValuesFailed = 0;
      for (
        let index = 0;
        index < deduplicatedCustomValueRows.length;
        index += CUSTOM_VALUE_CHUNK
      ) {
        const chunk = deduplicatedCustomValueRows.slice(
          index,
          index + CUSTOM_VALUE_CHUNK
        );
        try {
          const { error } = await supabase
            .from('contact_custom_values')
            .upsert(chunk, { onConflict: 'contact_id,custom_field_id' });
          if (!error) customValues += chunk.length;
          else customValuesFailed += chunk.length;
        } catch {
          customValuesFailed += chunk.length;
        }
      }
      if (conflictingCustomValues > 0) {
        toast.warning(
          `${conflictingCustomValues} extra ${conflictingCustomValues === 1 ? 'detail had' : 'details had'} different values in your file. We kept the value from the last row.`
        );
      }
      let tagsAssigned = 0;
      let tagsFailed = 0;
      try {
        tagsAssigned = await assignImportedContactTags(
          supabase,
          tagAssignments,
          tagIdByKey
        );
      } catch {
        tagsFailed = tagAssignments.length;
        toast.warning('Members added, but some tags were not added.');
      }
      const successfulGroups = transaction.groups.filter(
        (group) => group.status === 'imported'
      );
      const imported = successfulGroups.filter((group) => {
        const source = activeCandidates.find(
          (candidate) => candidate.customerGroupKey === group.customerGroupKey
        );
        return !source?.existingMatch;
      }).length;
      const attached = successfulGroups.length - imported;
      const failed = transaction.groups.filter(
        (group) => group.status !== 'imported'
      ).length;
      const payments = results.filter(
        (item) => item.paymentOutcome === 'recorded'
      ).length;
      // Financial failures roll back the whole customer group atomically.
      const paymentFailed = 0;
      const skipped = results.filter(
        (item) =>
          item.disposition === 'excluded' || item.disposition === 'unresolved'
      ).length;
      const nextResult: ImportResult = {
        imported,
        attached,
        skipped,
        invalid: 0,
        failed,
        payments,
        paymentFailed,
        statusFailed,
        tagsAssigned,
        tagsFailed,
        customValues,
        customValuesFailed,
        customValueConflicts: conflictingCustomValues,
        receiptCsv: serializeMemberImportReceiptCsv(
          buildMemberImportReceiptRows(activeCandidates, results)
        ),
      };
      setResult(nextResult);
      const receiptSaved = await draftManager.saveAndFlush({
        ...draftState,
        candidates: activeCandidates,
        resolutions: {
          ...draftState.resolutions,
          execution: executionJournalRef.current,
        },
        receipt: nextResult,
      });
      if (!receiptSaved) {
        toast.warning(
          'The results are still being saved. Wait before closing.'
        );
      }
      if (
        draftManager.draft &&
        receiptSaved &&
        failed === 0 &&
        tagsFailed === 0 &&
        customValuesFailed === 0
      ) {
        const cleaned = await draftManager.discard();
        if (!cleaned) {
          toast.warning(
            'Import done, but the saved draft could not be cleared.'
          );
        }
      }
      if (imported + attached > 0) onSaved();
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        toast.info(
          `These tags do not exist, so they were skipped: ${sample}${skippedNames.length > 3 ? ` (+${skippedNames.length - 3} more)` : ''}`
        );
      }
    } catch (error) {
      setImportProgress((current) =>
        current
          ? { ...current, label: 'The import stopped before it finished.' }
          : current
      );
      toast.error(getErrorMessage(error, 'Could not import members'));
    } finally {
      setImporting(false);
    }
  }

  const descriptions: Record<Step, string> = {
    1: 'Upload your member file. You will check it before anything is saved.',
    2: 'Tell us what each column means. Choose “Skip this column” to leave it out.',
    3: 'Fix each problem, or skip those rows.',
    4: 'Check the totals, then import.',
  };
  const currentDescription = descriptions[step];
  const resolveSourceSummary =
    !result && step === 3
      ? `${file?.name ?? draftManager.draft?.sourceFilename ?? 'Member file'} · ${fmt.number(candidateSummary.source)} rows in file`
      : null;
  /* The two-pane resolve workspace, as opposed to a single scrolling step.
     The result panel replaces the step content, so it is not one. */
  const resolveWorkspace = !result && step === 3;
  const uploadStep = !result && step === 1;
  const draftNeedsRecovery =
    draftManager.saveState === 'error' ||
    draftManager.saveState === 'conflict' ||
    draftAction === 'retrying' ||
    Boolean(resumeError);
  const draftStatusLabel =
    draftManager.saveState === 'saving'
      ? 'Saving progress…'
      : draftManager.saveState === 'saved'
        ? 'Progress saved'
        : draftManager.saveState === 'conflict'
          ? 'Draft changed on another screen'
          : draftManager.saveState === 'error'
            ? 'Could not save progress'
            : draftManager.saveState === 'loading' || resumingDraft
              ? 'Loading saved draft…'
              : '';

  const draftControls =
    (draftManager.saveState === 'error' || draftAction === 'retrying') &&
    draftManager.draft ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-destructive text-xs">
          {draftManager.lastError ?? 'Could not save your progress.'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={draftAction === 'retrying'}
          disabled={draftAction !== null}
          onClick={() => void retryDraftSave()}
        >
          Try saving again
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStartFreshConfirm(true)}
        >
          Delete draft
        </Button>
      </div>
    ) : draftManager.saveState === 'conflict' && draftManager.draft ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-destructive text-xs">
          This draft was changed on another screen. Reloading will remove your unsaved changes.
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={draftAction === 'reloading'}
          disabled={draftAction !== null}
          onClick={() => void reloadSavedDraft()}
        >
          Reload saved draft
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStartFreshConfirm(true)}
        >
          Start again
        </Button>
      </div>
    ) : resumeError && draftManager.draft ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={draftAction === 'reloading'}
          disabled={draftAction !== null}
          onClick={() => void reloadSavedDraft()}
        >
          Reload saved draft
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStartFreshConfirm(true)}
        >
          Start again
        </Button>
      </div>
    ) : draftManager.draft && !result ? (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="text-muted-foreground shrink-0 text-xs whitespace-nowrap"
          title={draftManager.draft.sourceFilename}
          role="status"
          aria-live="polite"
        >
          {draftStatusLabel}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStartFreshConfirm(true)}
        >
          Start again
        </Button>
      </div>
    ) : null;
  const closeAction = (
    <DialogClose
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          loading={draftAction === 'closing'}
          disabled={importing || draftAction !== null}
        />
      }
    >
      <X />
      <span className="sr-only">Close</span>
    </DialogClose>
  );
  const wizardHeader = (
    <div className="shrink-0 space-y-5 px-4 py-5 sm:px-6">
      <DialogHeader className="gap-1.5">
        <div
          className={cn(
            'flex min-h-7 items-center gap-2',
            resolveWorkspace && 'pr-10 xl:pr-0'
          )}
        >
          {!result && step > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Back"
              disabled={importing || draftAction !== null}
              onClick={() => setStep((value) => (value - 1) as Step)}
            >
              <ChevronLeft />
            </Button>
          )}
          <DialogTitle size="lg" className="min-w-0">
            Import members
          </DialogTitle>
          {!resolveWorkspace && <div className="ml-auto">{closeAction}</div>}
        </div>
        <DialogDescription
          className={cn('break-words', !result && step > 1 && 'pl-9')}
          aria-live="polite"
        >
          {result ? 'See the results below.' : currentDescription}
        </DialogDescription>
      </DialogHeader>
      {!result && <StepIndicator step={step} />}
      {resumeError ? (
        <p className="text-destructive text-sm" role="alert">
          {resumeError}
        </p>
      ) : null}
      <SourceExclusionNotice exclusions={sourceExclusions} />
    </div>
  );
  const hasPrimaryAction =
    Boolean(result) || step !== 3 || candidateSummary.needsResolution === 0;
  const primaryAction = result ? (
    <Button type="button" onClick={() => void requestClose()}>
      Done
    </Button>
  ) : (
    <>
      {step === 1 && (
        <Button
          type="button"
          disabled={readingFile || analyzing || !sourceRaw?.rows.length}
          loading={analyzing}
          onClick={analyzeFile}
        >
          <Wand2 className="size-4" />
          Match columns
        </Button>
      )}
      {step === 2 && (
        <Button
          type="button"
          disabled={
            !validation.ok ||
            plansLoading ||
            staffLoading ||
            serviceFactsLoading ||
            loadingPreview
          }
          onClick={buildPreview}
          loading={
            loadingPreview ||
            plansLoading ||
            staffLoading ||
            serviceFactsLoading
          }
        >
          Review {fmt.number(raw?.rows.length ?? 0)} row
          {raw?.rows.length === 1 ? '' : 's'}
        </Button>
      )}

      {step === 3 && candidateSummary.needsResolution === 0 && (
        <Button
          type="button"
          disabled={
            candidateSummary.needsResolution > 0 || candidateSummary.ready === 0
          }
          onClick={() => setStep(4)}
        >
          Check import
        </Button>
      )}

      {step === 4 && (
        <Button
          type="button"
          disabled={
            !compliance ||
            importing ||
            (readyRows.length === 0 && !hasJournalWork) ||
            hasUnresolvedNewCandidates
          }
          onClick={handleImport}
          loading={importing}
        >
          Import {fmt.number(candidateSummary.uniqueCustomers)} member
          {candidateSummary.uniqueCustomers === 1 ? '' : 's'}
        </Button>
      )}
    </>
  );
  const wizardFooter = (
    <DialogFooter className="mx-0 mt-0 mb-0 shrink-0 flex-row flex-wrap items-center sm:justify-between">
      {!uploadStep && (resolveSourceSummary || draftControls) && (
        <div
          role="group"
          aria-label="Import draft"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
        >
          {resolveSourceSummary && (
            <p
              className="text-muted-foreground min-w-0 basis-full truncate text-xs sm:basis-auto"
              title={
                file?.name ??
                draftManager.draft?.sourceFilename ??
                'Import worksheet'
              }
            >
              {resolveSourceSummary}
            </p>
          )}
          {draftControls}
        </div>
      )}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {uploadStep && (sourceRaw ?? raw)?.rows.length ? (
          <Button
            type="button"
            variant="ghost"
            disabled={readingFile || analyzing}
            onClick={() => setStep(2)}
          >
            Match by hand
          </Button>
        ) : null}
        {!result && !uploadStep && (
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
              <Info /> How import works
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-80">
              <p className="text-sm font-medium">Before you import</p>
              <p className="text-muted-foreground text-sm">{IMPORT_RULES}</p>
            </PopoverContent>
          </Popover>
        )}
        {hasPrimaryAction && primaryAction}
      </div>
      {step === 2 && !result && mappingIssue && (
        <div className="basis-full">
          <ValidationMessage>{mappingIssue}</ValidationMessage>
        </div>
      )}
    </DialogFooter>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            'flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(720px,calc(100%-2rem))]',
            // A definite mapping-step height lets ScrollArea's percentage-height
            // viewport shrink with the dialog instead of growing past its footer.
            !result &&
              step === 2 &&
              'h-[min(92dvh,880px)] sm:max-w-[min(1040px,calc(100%-2rem))]',
            resolveWorkspace &&
              'h-[min(92dvh,880px)] sm:max-w-[min(1320px,calc(100%-2rem))]'
          )}
        >
          {resolveWorkspace ? (
            <div
              role="region"
              aria-label="Problems to fix"
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <ImportMembersPreview
                header={wizardHeader}
                closeAction={closeAction}
                footer={wizardFooter}
                candidates={candidates}
                lockedSourceKeys={lockedSourceKeys}
                context={candidateContext}
                plans={plans}
                catalogItems={catalogItems}
                trainers={trainers}
                onPatch={patchCandidate}
                onResolveGroupedPlan={(sourceKeys, resolution) => {
                  if (!canEditSources(sourceKeys)) return;
                  setCandidates((current) =>
                    resolveGroupedPlan(
                      current,
                      sourceKeys,
                      resolution,
                      candidateContext
                    )
                  );
                }}
                onResolveGroupedOffering={(sourceKeys, resolution) => {
                  if (!canEditSources(sourceKeys)) return;
                  setCandidates((current) =>
                    resolveGroupedOffering(
                      current,
                      sourceKeys,
                      resolution,
                      candidateContext
                    )
                  );
                }}
                onResolveGroupedService={(sourceKeys, resolution) => {
                  if (!canEditSources(sourceKeys)) return;
                  setCandidates((current) =>
                    resolveGroupedService(
                      current,
                      sourceKeys,
                      resolution,
                      candidateContext
                    )
                  );
                }}
                onResolvePayment={(sourceKey, resolution, correction) => {
                  if (!canEditSources([sourceKey])) return;
                  setCandidates((current) =>
                    resolvePaymentConflict(
                      current,
                      sourceKey,
                      resolution,
                      correction,
                      candidateContext
                    )
                  );
                }}
                onResolveExistingContact={(sourceKey, resolution) => {
                  if (!canEditSources([sourceKey])) return;
                  setCandidates((current) =>
                    resolveExistingContact(
                      current,
                      sourceKey,
                      resolution,
                      candidateContext
                    )
                  );
                }}
                onResolveMembershipTerm={(legacyMemberId, sourceKey) => {
                  if (!canEditSources([sourceKey])) return;
                  setCandidates((current) =>
                    resolveMembershipTerm(
                      current,
                      legacyMemberId,
                      sourceKey,
                      candidateContext
                    )
                  );
                }}
                onResolveCancelledDebt={(sourceKey) => {
                  if (!canEditSources([sourceKey])) return;
                  setCandidates((current) =>
                    resolveCancelledMembershipDebt(
                      current,
                      sourceKey,
                      'write_off',
                      candidateContext
                    )
                  );
                }}
                onSetDisposition={(sourceKey, disposition) =>
                  patchCandidate(sourceKey, { disposition })
                }
              />
            </div>
          ) : (
            <>
              {wizardHeader}
              <Separator />

              <div
                /* A bounded flex frame lets each step's ScrollArea shrink while
               the header and footer stay put. Resolve owns two scrollports. */
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <ImportStepBody>
                  {result ? (
                    <ResultPanel
                      result={result}
                      sourceExclusions={sourceExclusions}
                      onRetry={() => {
                        setResult(null);
                        setStep(4);
                        setCompliance(true);
                      }}
                      onReviewFailed={() => {
                        const next = executionJournalRef.current.filter(
                          (entry) => entry.status !== 'failed'
                        );
                        executionJournalRef.current = next;
                        setExecutionJournal(next);
                        setResult(null);
                        setStep(3);
                        void draftManager.saveAndFlush({
                          ...draftState,
                          candidates,
                          resolutions: {
                            ...draftState.resolutions,
                            execution: next,
                          },
                        });
                      }}
                    />
                  ) : (
                    <div key={step} className="min-h-0 shrink-0">
                      {step === 1 && (
                        <div className="space-y-3">
                          <UploadStep
                            file={file}
                            readingFile={readingFile}
                            raw={sourceRaw ?? raw}
                            workbookSheets={workbookSheets}
                            selectedSheet={selectedSheet}
                            inputRef={fileInputRef}
                            onFileChange={handleFileChange}
                            onWorksheetChange={handleWorksheetChange}
                            draftStatus={
                              draftManager.draft && !draftNeedsRecovery
                                ? draftStatusLabel
                                : ''
                            }
                            draftRecovery={
                              draftNeedsRecovery ? draftControls : null
                            }
                            onStartFresh={
                              draftManager.draft && !draftNeedsRecovery
                                ? () => setStartFreshConfirm(true)
                                : undefined
                            }
                          />
                        </div>
                      )}
                      {step === 2 && raw && (
                        <MappingStep
                          raw={raw}
                          targets={targets}
                          targetByKey={targetByKey}
                          mapping={mapping}
                          samples={samples}
                          duplicateKeys={duplicateKeys}
                          ambiguousDateCols={ambiguousDateCols}
                          dateOrder={dateOrder}
                          phoneDialCode={locale.phoneCountryCode}
                          canCreateFields={canEditSettings}
                          onSetColumn={setColumn}
                          onDateOrderChange={setDateOrder}
                          onAutoMap={remapFromColumnNames}
                          onReset={() =>
                            setMapping(raw.headers.map(() => MEMBER_IGNORE_KEY))
                          }
                          onRequestCreateField={requestCreateField}
                        />
                      )}

                      {step === 4 && (
                        <ConfirmStep
                          candidates={candidates}
                          compliance={compliance}
                          progress={importProgress}
                          onComplianceChange={setCompliance}
                        />
                      )}
                    </div>
                  )}
                </ImportStepBody>
              </div>

              {wizardFooter}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={createCol !== null}
        onOpenChange={(next) => !next && setCreateCol(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add extra detail</DialogTitle>
            <DialogDescription>
              Adds a new detail for all members, and uses this column for it. Values are saved when you import.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="member-import-field-name">Name</Label>
              <Input
                id="member-import-field-name"
                value={newFieldName}
                onChange={(event) => setNewFieldName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-import-field-type">Type</Label>
              <Select
                value={newFieldType}
                onValueChange={(value) => value && setNewFieldType(value)}
              >
                <SelectTrigger id="member-import-field-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateCol(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={savingField}
              onClick={saveCustomField}
            >
              {savingField && <Loader2 className="size-4 animate-spin" />}
              Add and use
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startFreshConfirm} onOpenChange={setStartFreshConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start again?</DialogTitle>
            <DialogDescription>
              This deletes the saved progress and uploaded file for{' '}
              {draftManager.draft?.sourceFilename ?? 'this import'}. It does not
              affect another team member or branch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStartFreshConfirm(false)}
              disabled={draftAction === 'discarding'}
            >
              Keep draft
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void startFresh()}
              loading={draftAction === 'discarding'}
              disabled={draftAction === 'discarding'}
            >
              Delete and start again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportStepBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-5 sm:px-6">{children}</div>
    </ScrollArea>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ['Upload', 'Match columns', 'Fix problems', 'Confirm'];
  return (
    <ol aria-label="Import steps" className="flex items-center gap-2">
      {labels.map((label, index) => {
        const number = (index + 1) as Step;
        const active = number === step;
        const done = number < step;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2',
              index < labels.length - 1 && 'flex-1'
            )}
          >
            <div
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                active && 'bg-primary text-primary-foreground',
                done && 'bg-primary/20 text-primary-text',
                !active && !done && 'bg-muted text-muted-foreground'
              )}
            >
              {done ? <CheckCircle className="size-3.5" /> : number}
            </div>
            {/* Four labels do not fit a phone-width dialog, and the old
                `overflow-x-auto` answer clipped `Confirm` off the end with
                no affordance. Below `sm` only the step you are on is named;
                the numbered circles and connectors still show the whole
                flow, and the other names stay in the accessibility tree. */}
            <span
              className={cn(
                'text-xs font-medium whitespace-nowrap',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground sr-only sm:not-sr-only'
              )}
            >
              {label}
              <span className="sr-only">
                {done ? ', completed' : active ? ', current step' : ''}
              </span>
            </span>
            {index < labels.length - 1 && (
              <span className="bg-border mx-1 h-px flex-1" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function UploadStep({
  file,
  readingFile,
  raw,
  workbookSheets,
  selectedSheet,
  inputRef,
  onFileChange,
  onWorksheetChange,
  draftStatus,
  draftRecovery,
  onStartFresh,
}: {
  file: File | null;
  readingFile: boolean;
  raw: RawCsv | null;
  workbookSheets: MemberImportSheet[];
  selectedSheet: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onWorksheetChange: (name: string) => void;
  draftStatus: string;
  draftRecovery: React.ReactNode;
  onStartFresh?: () => void;
}) {
  const { fmt } = useLocale();
  const usableSheetCount = workbookSheets.filter((sheet) => sheet.raw).length;
  const unavailableSheets = workbookSheets.filter((sheet) => sheet.error);

  return (
    <div className="space-y-5">
      <div
        aria-busy={readingFile}
        role="group"
        aria-label="Import draft"
        className={cn(
          'min-w-0 gap-3',
          file
            ? 'grid grid-cols-[auto_minmax(0,1fr)] items-center sm:grid-cols-[auto_minmax(0,1fr)_auto]'
            : 'flex flex-col items-center py-5 text-center'
        )}
      >
        {file ? (
          <>
            <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              {readingFile ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <FileText className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-foreground text-sm font-medium break-words">
                {file.name}
              </p>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span role="status" className="tabular-nums">
                  {readingFile ? (
                    'Reading file…'
                  ) : raw ? (
                    <>
                      {fmt.number(raw.rows.length)} row
                      {raw.rows.length === 1 ? '' : 's'} ·{' '}
                      {fmt.number(raw.headers.length)} column
                      {raw.headers.length === 1 ? '' : 's'}
                    </>
                  ) : workbookSheets.length > 0 ? (
                    <>
                      {fmt.number(workbookSheets.length)} worksheet
                      {workbookSheets.length === 1 ? '' : 's'}
                    </>
                  ) : null}
                </span>
                {draftStatus && (
                  <span role="status" aria-live="polite">
                    <span aria-hidden="true">· </span>
                    <span>{draftStatus}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-1 sm:col-start-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readingFile}
                onClick={() => inputRef.current?.click()}
              >
                Change file
              </Button>
              {onStartFresh && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onStartFresh}
                >
                  Start again
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
              <Upload className="text-muted-foreground size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Choose your member file</p>
              <p className="text-muted-foreground text-sm">
                CSV or Excel (.xlsx). Columns can be in any order.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </Button>
            {(draftStatus || onStartFresh) && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-muted-foreground text-xs" role="status">
                  {draftStatus}
                </span>
                {onStartFresh && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onStartFresh}
                  >
                    Start again
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {draftRecovery && <div className="col-span-full">{draftRecovery}</div>}
      </div>
      {workbookSheets.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="member-import-worksheet">Sheet</Label>
          <Select
            value={selectedSheet || undefined}
            onValueChange={(value) => value && onWorksheetChange(value)}
          >
            <SelectTrigger id="member-import-worksheet" className="w-full">
              <SelectValue placeholder="Choose a sheet" />
            </SelectTrigger>
            <SelectContent>
              {workbookSheets.map((sheet) => (
                <SelectItem
                  key={sheet.name}
                  value={sheet.name}
                  disabled={!sheet.raw}
                >
                  {sheet.name} (
                  {sheet.raw ? `${sheet.rowCount} rows` : 'unavailable'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {usableSheetCount === 0 ? (
            <p className="text-destructive text-xs">
              {unavailableSheets[0]?.error ??
                'No sheet has column names and member data.'}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-xs">
                Pick the sheet that has your members.
              </p>
              {unavailableSheets.length > 0 && (
                <p className="text-amber-foreground text-xs">
                  {unavailableSheets[0].error}
                  {unavailableSheets.length > 1
                    ? ` ${unavailableSheets.length - 1} more ${unavailableSheets.length === 2 ? 'sheet has' : 'sheets have'} no member data.`
                    : ''}
                </p>
              )}
            </>
          )}
        </div>
      )}
      {workbookSheets.length === 1 && !workbookSheets[0].raw && (
        <p className="text-destructive text-center text-xs">
          {workbookSheets[0].error}
        </p>
      )}
      <Accordion>
        <AccordionItem value="file-guidance">
          <AccordionTrigger>
            What your file needs
          </AccordionTrigger>
          <AccordionContent>
            <div className="text-muted-foreground space-y-3">
              <p>
                Every member needs a phone number and a plan or service. You can check everything before you import.
              </p>
              <p>Old .xls file? Save it as .xlsx or .csv first.</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() =>
                  downloadCsv('members-template.csv', MEMBER_TEMPLATE_CSV)
                }
              >
                <Download /> Download sample file
              </Button>
              <p>
                Your file and progress are saved. You can close this and continue later from Import.
              </p>
              <p>
                To match columns, we only look at column names and counts. Names, phone numbers, and notes are not shared.
              </p>
              <p>{IMPORT_RULES}</p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={readingFile}
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}

function MappingStep({
  raw,
  targets,
  targetByKey,
  mapping,
  samples,
  duplicateKeys,
  ambiguousDateCols,
  dateOrder,
  phoneDialCode,
  canCreateFields,
  onSetColumn,
  onDateOrderChange,
  onAutoMap,
  onReset,
  onRequestCreateField,
}: {
  raw: RawCsv;
  targets: TargetField[];
  targetByKey: Map<string, TargetField>;
  mapping: string[];
  samples: string[][];
  duplicateKeys: Set<string>;
  ambiguousDateCols: Set<number>;
  dateOrder: DateOrder;
  phoneDialCode: string;
  canCreateFields: boolean;
  onSetColumn: (column: number, key: string) => void;
  onDateOrderChange: (value: DateOrder) => void;
  onAutoMap: () => void;
  onReset: () => void;
  onRequestCreateField: (column: number) => void;
}) {
  const { fmt } = useLocale();
  // Groups come from the field registry so membership and service each read
  // as a complete, self-contained purchase; inside a group the short label is
  // enough because the heading already supplies the context.
  const groups = useMemo<ComboboxGroup[]>(() => {
    const registered = new Set<string>(
      MEMBER_IMPORT_FIELDS.map((item) => item.key)
    );
    const byGroup = new Map<MemberImportGroup, ComboboxGroup['options']>();
    for (const item of MEMBER_IMPORT_FIELDS) {
      byGroup.set(item.group, [
        ...(byGroup.get(item.group) ?? []),
        {
          value: item.key,
          label: item.groupLabel ?? item.label,
          hint: item.required ? 'required' : undefined,
        },
      ]);
    }
    const custom = targets
      .filter((target) => !registered.has(target.key))
      .map((target) => ({ value: target.key, label: target.label }));
    return [
      { options: [{ value: MEMBER_IGNORE_KEY, label: "Skip this column" }] },
      ...MEMBER_IMPORT_GROUP_ORDER.map((group) => ({
        label: MEMBER_IMPORT_GROUP_LABEL[group],
        options: byGroup.get(group) ?? [],
      })),
      { label: 'Extra details', options: custom },
    ].filter((group) => group.options.length > 0);
  }, [targets]);
  const unmapped = mapping.filter((key) => key === MEMBER_IGNORE_KEY).length;
  const hasAmbiguousDates = ambiguousDateCols.size > 0;
  const rows = raw.headers.map((header, column) => {
    const key = mapping[column] ?? MEMBER_IGNORE_KEY;
    return {
      column,
      header,
      sample: samples[column]?.join(' · ') || '—',
      key,
      isMapped: key !== MEMBER_IGNORE_KEY,
      isDuplicate: duplicateKeys.has(key),
    };
  });

  // Plain render helper, not a nested component: keeps one picker definition
  // for the table and the stacked layout without remounting on every render.
  function renderPicker(row: (typeof rows)[number]) {
    return (
      <>
        <Combobox
          groups={groups}
          value={row.key}
          onSelect={(value) => onSetColumn(row.column, value)}
          searchPlaceholder="Search details…"
          footer={
            canCreateFields
              ? {
                  label: 'Add new detail…',
                  onSelect: () => onRequestCreateField(row.column),
                }
              : null
          }
          contentClassName="w-64"
        >
          <span className="sr-only">
            Map {row.header || `column ${row.column + 1}`} to:{' '}
          </span>
          {/* Muted "Don't import" is the row's status; no status column needed. */}
          <span
            className={cn('truncate', !row.isMapped && 'text-muted-foreground')}
          >
            {row.isMapped
              ? (targetByKey.get(row.key)?.label ?? row.key)
              : "Skip this column"}
          </span>
        </Combobox>
        {row.isDuplicate && (
          <ValidationMessage>
            This detail is picked for more than one column. Pick another detail or skip this column.
          </ValidationMessage>
        )}
        {row.key === 'phone' && (
          <p className="text-muted-foreground mt-1 text-xs">
            We use this column to find members already saved. Numbers without a country code get{' '}
            {phoneDialCode}.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium">
          {unmapped === 0
            ? `All ${fmt.number(mapping.length)} columns matched`
            : `${fmt.number(mapping.length - unmapped)} matched · ${fmt.number(unmapped)} skipped`}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {/* One control for one global setting, not one per ambiguous column. */}
          {hasAmbiguousDates && (
            <div className="flex items-center gap-2">
              <Label htmlFor="member-import-date-order" size="sm">
                Date order
              </Label>
              <Select
                value={dateOrder}
                onValueChange={(value) => {
                  if (value === 'DMY' || value === 'MDY')
                    onDateOrderChange(value);
                }}
              >
                <SelectTrigger
                  id="member-import-date-order"
                  size="sm"
                  aria-label="Date order"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DMY">Day / month</SelectItem>
                  <SelectItem value="MDY">Month / day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onAutoMap}>
            <Wand2 className="size-3.5" /> Match for me
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onReset}>
            <RotateCcw className="size-3.5" /> Clear all
          </Button>
        </div>
      </div>

      <div>
        {/* Phone: one question per column, stacked. No sideways scroll to
            reach the picker, which is the only control on this step. */}
        <ul className="sm:hidden">
          {rows.map((row) => (
            <li key={row.column} className="space-y-2 py-3">
              <p className="text-foreground text-sm font-medium break-words">
                {row.header || (
                  <span className="text-muted-foreground italic">
                    (unnamed)
                  </span>
                )}
              </p>
              <p className="text-muted-foreground text-xs break-words">
                {row.sample}
              </p>
              {renderPicker(row)}
              <Separator />
            </li>
          ))}
        </ul>

        <Table
          containerClassName="hidden sm:block"
          className="table-fixed"
          aria-label="Match columns"
        >
          <TableHeader>
            <TableRow interactive={false}>
              <TableHead className="w-[25%]">Column in your file</TableHead>
              <TableHead className="w-[32%]">Example value</TableHead>
              <TableHead className="w-[43%]">Member detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.column} interactive={false}>
                <TableCell className="whitespace-normal">
                  <span className="font-medium break-words">
                    {row.header || (
                      <span className="text-muted-foreground italic">
                        (unnamed)
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span
                    className="text-muted-foreground line-clamp-2 break-words"
                    title={row.sample}
                  >
                    {row.sample}
                  </span>
                </TableCell>
                <TableCell className="py-3 whitespace-normal">
                  {renderPicker(row)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ConfirmStep({
  candidates,
  compliance,
  progress,
  onComplianceChange,
}: {
  candidates: MemberImportCandidate[];
  compliance: boolean;
  progress: ImportProgress | null;
  onComplianceChange: (checked: boolean) => void;
}) {
  const { fmt } = useLocale();
  const summary = summarizeMemberImportCandidates(candidates);

  return (
    <div className="space-y-5">
      {progress ? (
        <div className="space-y-3" role="status">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">Adding members</span>
            <span className="text-muted-foreground tabular-nums">
              {fmt.number(
                Math.round(
                  (progress.completed / Math.max(1, progress.total)) * 100
                )
              )}
              %
            </span>
          </div>
          <Progress
            value={progress.completed}
            max={progress.total}
            aria-label="Member import progress"
          />
          <p className="text-muted-foreground text-sm">{progress.label}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <h3 className="text-base font-medium">
            {fmt.number(summary.uniqueCustomers)} member
            {summary.uniqueCustomers === 1 ? '' : 's'} ready to import
          </h3>
          <p className="text-muted-foreground text-sm">
            {fmt.number(summary.ready)} of {fmt.number(summary.source)} rows in file
            {summary.exclusions > 0
              ? ` · ${fmt.number(summary.exclusions)} excluded`
              : ''}
            .
          </p>
        </div>
      )}
      <dl className="grid grid-cols-3 gap-4">
        <SummaryValue label="Memberships" value={summary.memberships} />
        <SummaryValue label="Services" value={summary.services} />
        <SummaryValue label="Payments to record" value={summary.payments} />
      </dl>
      <p className="text-muted-foreground text-sm">
        Import adds the memberships, services, and payments shown here. It only records past payments. It does not take any money.
      </p>
      <Accordion>
        <AccordionItem value="import-breakdown">
          <AccordionTrigger>Row and invoice details</AccordionTrigger>
          <AccordionContent>
            <p className="text-muted-foreground mb-4 text-sm">
              Member totals join rows for the same person. Row totals count each line in your file.
            </p>
            <dl className="space-y-3">
              {(
                [
                  ['Ready', summary.ready],
                  ['Need fixing', summary.needsResolution],
                  ['Skipped automatically', summary.automaticExcluded],
                  ['Skipped by you', summary.explicitlyExcluded],
                  ['Membership and service invoices', summary.combinedInvoices],
                  ['Service invoices', summary.serviceOnlyInvoices],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{fmt.number(value)}</dd>
                </div>
              ))}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <div className="flex items-start gap-3">
        <Checkbox
          id="member-import-confirm"
          checked={compliance}
          onCheckedChange={(value) => onComplianceChange(value === true)}
        />
        <label
          htmlFor="member-import-confirm"
          className="text-sm leading-relaxed"
        >
          I confirm my gym is allowed to save and contact these people, and I have checked the details.
        </label>
      </div>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  const { fmt } = useLocale();
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-base font-medium tabular-nums">
        {fmt.number(value)}
      </dd>
    </div>
  );
}

function ResultPanel({
  result,
  onRetry,
  onReviewFailed,
  sourceExclusions,
}: {
  result: ImportResult;
  onRetry: () => void;
  onReviewFailed: () => void;
  sourceExclusions: MemberImportExcludedSourceRow[];
}) {
  const { fmt } = useLocale();
  const successful = result.imported + result.attached;
  const needsAttention =
    result.failed > 0 ||
    result.paymentFailed > 0 ||
    result.statusFailed > 0 ||
    (result.tagsFailed ?? 0) > 0 ||
    (result.customValuesFailed ?? 0) > 0;
  const StatusIcon = needsAttention
    ? AlertTriangle
    : successful > 0
      ? CheckCircle
      : Info;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <StatusIcon
          className={cn(
            'mt-0.5 size-5 shrink-0',
            needsAttention
              ? 'text-amber-foreground'
              : successful > 0
                ? 'text-emerald-foreground'
                : 'text-muted-foreground'
          )}
        />
        <div className="space-y-1">
          <h3 className="text-base font-medium">
            {successful > 0
              ? `${fmt.number(successful)} ${successful === 1 ? 'member' : 'members'} added`
              : 'No members added'}
          </h3>
          <p className="text-muted-foreground text-sm">
            {needsAttention
              ? 'Download the report to see which rows worked and which need fixing.'
              : successful > 0
                ? 'Your members are now in Members.'
                : 'Download the report to see why each row was skipped.'}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <SummaryValue label="New people" value={result.imported} />
        <SummaryValue label="Already saved" value={result.attached} />
        <SummaryValue label="Payments recorded" value={result.payments} />
        <SummaryValue
          label="Rows skipped"
          value={result.skipped + result.invalid}
        />
      </dl>
      {needsAttention && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Some rows need fixing</AlertTitle>
          <AlertDescription>
            {result.failed > 0 &&
              `${fmt.number(result.failed)} ${result.failed === 1 ? 'member' : 'members'} could not be added. `}
            {result.paymentFailed > 0 &&
              `${fmt.number(result.paymentFailed)} payment${result.paymentFailed === 1 ? '' : 's'} could not be recorded. `}
            {result.statusFailed > 0 &&
              `${fmt.number(result.statusFailed)} cancelled ${result.statusFailed === 1 ? 'membership needs' : 'memberships need'} the status fixed.`}
            {(result.tagsFailed ?? 0) > 0 &&
              ` ${fmt.number(result.tagsFailed ?? 0)} ${result.tagsFailed === 1 ? 'tag was' : 'tags were'} not added. Try again.`}
            {(result.customValuesFailed ?? 0) > 0 &&
              ` ${fmt.number(result.customValuesFailed ?? 0)} extra ${result.customValuesFailed === 1 ? 'detail was' : 'details were'} not saved. Try again.`}
          </AlertDescription>
        </Alert>
      )}
      {(result.tagsAssigned > 0 || result.customValues > 0) && (
        <p className="text-muted-foreground text-xs">
          {fmt.number(result.tagsAssigned)} tags ·{' '}
          {fmt.number(result.customValues)} extra details saved
        </p>
      )}
      {(result.customValueConflicts ?? 0) > 0 && (
        <p className="text-muted-foreground text-xs">
          {fmt.number(result.customValueConflicts ?? 0)} extra{' '}
          {result.customValueConflicts === 1 ? 'detail had' : 'details had'}{' '}
          different values. We kept the value from the last row.
        </p>
      )}
      <Separator />
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          downloadCsv('member-import-receipt.csv', result.receiptCsv)
        }
      >
        <Download /> Download report
      </Button>
      {sourceExclusions.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            downloadCsv(
              'member-import-source-exclusions.csv',
              sourceExclusionsCsv(sourceExclusions)
            )
          }
        >
          <Download /> Download skipped rows
        </Button>
      ) : null}
      {needsAttention ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          Try again for the rest
        </Button>
      ) : null}
      {result.failed > 0 ? (
        <Button type="button" variant="outline" onClick={onReviewFailed}>
          See members not added
        </Button>
      ) : null}
    </div>
  );
}

function sourceExclusionsCsv(exclusions: MemberImportExcludedSourceRow[]) {
  return toCsv(
    ['Row', 'Reason', 'Values'],
    exclusions.map((row) => [
      row.sourceRow,
      row.reason.replace('_', ' '),
      row.values.join(' | '),
    ])
  );
}

function SourceExclusionNotice({
  exclusions,
}: {
  exclusions: MemberImportExcludedSourceRow[];
}) {
  const inspected = exclusions.filter(
    (row) => row.reason === 'repeated_header' || row.reason === 'footer_summary'
  );
  if (inspected.length === 0) return null;
  return (
    <Alert>
      <Info />
      <AlertTitle>
        {inspected.length} row{inspected.length === 1 ? '' : 's'}{' '}
        skipped automatically
      </AlertTitle>
      <AlertDescription className="space-y-2">
        Repeated column names and total rows are not members, so we skipped them. You can still see them here and in the report.
        <Accordion>
          <AccordionItem value="source-exclusions" className="border-b-0">
            <AccordionTrigger className="py-1 text-sm">
              See skipped rows
            </AccordionTrigger>
            <AccordionContent>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow interactive={false}>
                    <TableHead>Row</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Values</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inspected.map((row) => (
                    <TableRow
                      key={`${row.reason}:${row.sourceRow}`}
                      interactive={false}
                    >
                      <TableCell>{row.sourceRow}</TableCell>
                      <TableCell>{row.reason.replace('_', ' ')}</TableCell>
                      <TableCell className="break-all">
                        {row.values.join(' | ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </AlertDescription>
    </Alert>
  );
}

function ValidationMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="text-red-foreground flex items-start gap-1.5 text-xs"
    >
      <XCircle className="size-3.5 shrink-0" /> {children}
    </p>
  );
}
