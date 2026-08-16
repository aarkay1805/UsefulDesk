'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { ImportMembersPreview } from './import-members-preview';
import { useAccountStaff } from './use-account-staff';
import { useMembershipPlans } from './use-membership-plans';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxGroup } from '@/components/ui/combobox';
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
import { Progress } from '@/components/ui/progress';
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
  parseCsvRaw,
  type CustomFieldRef,
  type RawCsv,
  type TargetField,
} from '@/lib/contacts/field-mapping';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import { isUniqueViolation, normalizeKey } from '@/lib/contacts/dedupe';
import { downloadCsv } from '@/lib/csv/export';
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
  commitMemberImportCandidates,
  MEMBER_IGNORE_KEY,
  MEMBER_TEMPLATE_CSV,
  serializeMemberImportReceiptCsv,
  validateMemberMapping,
} from '@/lib/memberships/import-commit';
import {
  MEMBER_IMPORT_DRAFT_VERSION,
  type MemberImportDraftState,
} from '@/lib/memberships/import-draft';
import {
  MemberImportFileError,
  memberImportFileKind,
  parseMemberImportWorkbook,
  type MemberImportSheet,
} from '@/lib/memberships/import-workbook';
import { MEMBER_IMPORT_FIELDS } from '@/lib/memberships/member-field-registry';
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
  resolveExistingContact,
  resolveGroupedPlan,
  resolvePaymentConflict,
  summarizeMemberImportCandidates,
  type MemberImportCandidate,
} from '@/lib/memberships/member-import-candidates';
import { setMembershipCancellation } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3 | 4;
const SAMPLE_LIMIT = 3;
const CUSTOM_VALUE_CHUNK = 100;
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
  customValues: number;
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
  const [mapping, setMapping] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedRecipe, setSuggestedRecipe] =
    useState<MemberMigrationRecipe | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>(accountDateOrder);
  const [customFields, setCustomFields] = useState<CustomFieldRef[]>([]);
  const [candidates, setCandidates] = useState<MemberImportCandidate[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [compliance, setCompliance] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resumingDraft, setResumingDraft] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [startFreshConfirm, setStartFreshConfirm] = useState(false);

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
  const mappedKeys = useMemo(
    () => new Set(mapping.filter((key) => key !== MEMBER_IGNORE_KEY)),
    [mapping]
  );
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
    () => ({ plans, dateOrder, today: fmt.today(), staff }),
    [dateOrder, fmt, plans, staff]
  );
  const candidateSummary = useMemo(
    () => summarizeMemberImportCandidates(candidates),
    [candidates]
  );
  const readyRows = candidates.filter((candidate) => candidate.isReady);
  const draftState = useMemo<MemberImportDraftState>(
    () => ({
      version: MEMBER_IMPORT_DRAFT_VERSION,
      step,
      worksheet: selectedSheet || null,
      mapping,
      dateOrder,
      recipe: suggestedRecipe,
      candidates,
      resolutions: {},
      exclusions: candidates
        .filter((candidate) => candidate.disposition === 'excluded')
        .map((candidate) => candidate.sourceKey),
      receipt: result,
    }),
    [
      candidates,
      dateOrder,
      mapping,
      result,
      selectedSheet,
      step,
      suggestedRecipe,
    ]
  );
  const activeDraftForAutosave = draftManager.draft;
  const scheduleDraftSave = draftManager.save;

  useEffect(() => {
    if (
      !open ||
      !file ||
      !activeDraftForAutosave ||
      readingFile ||
      resumingDraft ||
      importing
    ) {
      return;
    }
    scheduleDraftSave(draftState);
  }, [
    activeDraftForAutosave,
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
    if (draftManager.draft && file && !result) {
      const saved = await draftManager.flush();
      if (!saved) return;
    }
    fileReadSequence.current++;
    setReadingFile(false);
    onOpenChange(false);
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
    setMapping([]);
    setSuggestedRecipe(null);
    setDateOrder(accountDateOrder);
    setCandidates([]);
    setCompliance(false);
    setImportProgress(null);
    setResult(null);
    setResumeError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function startFresh() {
    const discarded = await draftManager.discard();
    if (!discarded) return;
    resetWorkingImport();
    setStartFreshConfirm(false);
  }

  async function reloadSavedDraft() {
    const saved = await draftManager.reload();
    if (saved) await resumeSavedDraft(saved);
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
        throw new Error(data.error || 'Could not analyze this file');
      }
      setSuggestedRecipe(data.recipe);
      setRaw(input);
      setMapping(mappingForRecipe(input, data.recipe, customFields));
      setStep(2);
      if (!data.configured) {
        toast.info(
          'AI is not configured. A safe local interpretation is shown; you can still map fields manually.'
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
        `${getErrorMessage(error, 'Analysis unavailable')} Safe local mapping is shown instead.`
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function useManualMapping() {
    if (!sourceRaw) return;
    setRaw(sourceRaw);
    setMapping(autoMapMemberColumns(sourceRaw.headers, customFields));
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
          ? 'Legacy .xls files are not supported. Save the workbook as .xlsx or .csv and try again.'
          : 'Unsupported file. Choose a .csv or .xlsx file.'
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
        const parsed = parseCsvRaw(await selected.text());
        if (sequence !== fileReadSequence.current) return false;
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          throw new MemberImportFileError(
            'No rows found. Ensure the file has a header row and data.'
          );
        }
        const prepared = prepareRawTable(parsed);
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
              sheets[0]?.error ?? 'No usable worksheets found in this workbook.'
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
          toast.error('Couldn’t save the private import draft. Try again.');
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
      setResumeError('The saved workbook could not be opened.');
      return false;
    }
    setResumingDraft(true);
    setResumeError(null);
    try {
      const response = await fetch(saved.signedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('Private workbook download failed');
      const bytes = await response.arrayBuffer();
      if (
        saved.sourceSize !== undefined &&
        bytes.byteLength !== saved.sourceSize
      ) {
        throw new Error('Saved workbook size no longer matches its draft');
      }
      if (saved.sourceSha256) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const actual = [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        if (actual !== saved.sourceSha256) {
          throw new Error('Saved workbook content no longer matches its draft');
        }
      }
      const source = new File([bytes], saved.sourceFilename, {
        type:
          saved.sourceKind === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
      });
      return await processSelectedFile(source, {
        initializeDraft: false,
        restore: saved.state,
      });
    } catch (error) {
      setResumeError(getErrorMessage(error, 'Could not resume saved import'));
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
      return toast.error('That name is already a standard member field.');
    }
    if (
      customFields.some(
        (field) => normalizeImportHeader(field.field_name) === normalized
      )
    ) {
      return toast.error('A custom field with that name already exists.');
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
      toast.error(getErrorMessage(error, 'Could not create the custom field'));
      return;
    }
    const created = data as CustomFieldRef;
    setCustomFields((current) => [...current, created]);
    setColumn(createCol, `custom:${created.id}`);
    setCreateCol(null);
    toast.success(`Created “${created.field_name}”`);
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
      const headerIndex = new Map(
        raw.headers.map((header, index) => [header, index])
      );
      const sourceCell = (row: string[], header: string | null | undefined) =>
        header ? (row[headerIndex.get(header) ?? -1] ?? '').trim() : '';
      const inputs = mapped.rows.map((mappedRow, index) => {
        const source = raw.rows[index] ?? [];
        const originalValues = {
          ...mappedRow,
          balance: sourceCell(source, recipe.money.balanceColumn),
        };
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
        const legacyMemberId = sourceCell(source, recipe.identityColumn);
        if (recipe.legacyId === 'notes' && legacyMemberId) {
          originalValues.notes = [
            originalValues.notes,
            `Legacy Member ID: ${legacyMemberId}`,
          ]
            .filter(Boolean)
            .join(' · ');
        }
        return {
          sourceKey: `${selectedSheet || file?.name || 'csv'}:${index + 2}`,
          sourceRow: index + 2,
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
      const [
        { data: contacts, error: contactsError },
        { data: memberships, error: membersError },
      ] = await Promise.all([
        supabase
          .from('contacts')
          .select(
            'id, phone_normalized, received_via, name, email, company, date_of_birth, gender, nickname, height_cm, weight_kg, address_line1, address_line2, city, state, postal_code, country'
          )
          .eq('account_id', accountId),
        supabase
          .from('memberships')
          .select('contact_id')
          .eq('account_id', accountId),
      ]);
      if (contactsError) throw contactsError;
      if (membersError) throw membersError;

      const contactByPhone = new Map<string, Record<string, unknown>>();
      for (const contact of contacts ?? []) {
        const item = contact as Record<string, unknown>;
        const phone = item.phone_normalized;
        if (typeof phone === 'string') contactByPhone.set(phone, item);
      }
      const memberContactIds = new Set(
        (memberships ?? []).map(
          (membership) => (membership as { contact_id: string }).contact_id
        )
      );

      const withMatches = inputs.map((input, index) => {
        const candidate = preliminary[index];
        const existing = contactByPhone.get(
          normalizeKey(candidate.draftValues.phone)
        );
        if (!existing) return input;
        const contactId = String(existing.id);
        const profileConflict = Object.entries(candidate.built.contact).some(
          ([key, value]) =>
            value !== null && String(existing[key] ?? '') !== String(value)
        );
        return {
          ...input,
          existingMatch: {
            contactId,
            isMember: memberContactIds.has(contactId),
            receivedVia:
              typeof existing.received_via === 'string'
                ? existing.received_via
                : null,
            profileConflict,
          },
        };
      });
      setCandidates(buildMemberImportCandidates(withMatches, candidateContext));
      setStep(3);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not prepare the preview'));
    } finally {
      setLoadingPreview(false);
    }
  }

  function patchCandidate(
    sourceKey: string,
    patch: Parameters<typeof patchMemberImportCandidate>[2]
  ) {
    setCandidates((current) =>
      patchMemberImportCandidate(current, sourceKey, patch, candidateContext)
    );
  }

  async function handleImport() {
    if (
      !accountId ||
      !user ||
      readyRows.length === 0 ||
      candidateSummary.needsResolution > 0
    )
      return;
    setImporting(true);
    setImportProgress({
      completed: 0,
      total: Math.max(1, readyRows.length),
      label: 'Preparing member import…',
    });
    try {
      const allTagNames = readyRows.flatMap(
        (candidate) => candidate.draftValues.tagNames
      );
      const { tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
        accountId,
        userId: user.id,
        tagNames: allTagNames,
        canCreateTags: canEditSettings,
      });

      let statusFailed = 0;
      let completedWork = 0;
      const results = await commitMemberImportCandidates(candidates, {
        createContact: async (candidate) => {
          const built = candidate.built;
          const { data, error } = await supabase
            .from('contacts')
            .insert({
              user_id: user.id,
              account_id: accountId,
              phone: candidate.draftValues.phone,
              assigned_to: built.assignedTo ?? user.id,
              received_via: 'import' as const,
              churn_risk: built.churnRisk ?? false,
              ...built.contact,
            })
            .select('id')
            .single();
          if (error || !data?.id) {
            throw new Error(
              isUniqueViolation(error)
                ? 'contact-already-exists'
                : getErrorMessage(error, 'contact-create-failed')
            );
          }
          return { contactId: data.id };
        },
        attachExistingContact: async (contactId, candidate) => {
          if (candidate.resolutions.existingContact !== 'use_csv') return;
          const built = candidate.built;
          const patch: Record<string, string | number | boolean | null> = {};
          const contactField = (
            importKey: string,
            dbKey: keyof typeof built.contact
          ) => {
            const value = built.contact[dbKey];
            if (mappedKeys.has(importKey) && value !== null)
              patch[dbKey] = value;
          };
          contactField('name', 'name');
          contactField('email', 'email');
          contactField('company', 'company');
          contactField('date_of_birth', 'date_of_birth');
          contactField('gender', 'gender');
          contactField('nickname', 'nickname');
          contactField('height_cm', 'height_cm');
          contactField('weight_kg', 'weight_kg');
          contactField('address_line1', 'address_line1');
          contactField('address_line2', 'address_line2');
          contactField('city', 'city');
          contactField('state', 'state');
          contactField('postal_code', 'postal_code');
          contactField('country', 'country');
          if (mappedKeys.has('churn_risk') && built.churnRisk !== null) {
            patch.churn_risk = built.churnRisk;
          }
          // Automated lead ownership is immutable; preserve it when a CSV
          // row happens to match an auto-captured contact.
          if (
            mappedKeys.has('assigned_to') &&
            built.assignedTo &&
            (!candidate.existingMatch?.receivedVia ||
              candidate.existingMatch.receivedVia === 'manual' ||
              candidate.existingMatch.receivedVia === 'import')
          ) {
            patch.assigned_to = built.assignedTo;
          }
          if (Object.keys(patch).length > 0) {
            const { data, error } = await supabase
              .from('contacts')
              .update(patch)
              .eq('id', contactId)
              .eq('account_id', accountId)
              .select('id');
            if (error || !data?.length) {
              throw new Error(getErrorMessage(error, 'contact-update-failed'));
            }
          }
        },
        createMembership: async (candidate, contactId) => {
          const membership = candidate.built.membership!;
          const deferCancellation =
            membership.status === 'cancelled' && !!candidate.built.payment;
          const membershipInsert = deferCancellation
            ? { ...membership, status: 'active' as const, frozen_at: null }
            : membership;
          const { data, error } = await supabase
            .from('memberships')
            .insert({
              account_id: accountId,
              contact_id: contactId,
              user_id: user.id,
              is_trial: false,
              ...membershipInsert,
            })
            .select('id')
            .single();
          if (error || !data?.id) {
            throw new Error(
              isUniqueViolation(error)
                ? 'membership-already-exists'
                : getErrorMessage(error, 'membership-create-failed')
            );
          }
          completedWork++;
          setImportProgress({
            completed: completedWork,
            total: Math.max(1, readyRows.length),
            label: `Processed ${completedWork} of ${readyRows.length} members`,
          });
          return { membershipId: data.id };
        },
        recordPayment: async (candidate, membershipId) => {
          const payment = candidate.built.payment!;
          const membership = candidate.built.membership!;
          const paidAt = (
            dateAtNoonInTz(payment.paidOn, locale.timeZone) ?? new Date()
          ).toISOString();
          const { error: paymentError } = await supabase.rpc(
            'record_joining_payment',
            {
              p_membership_id: membershipId,
              p_period_end: membership.end_date,
              p_amount: payment.amount,
              p_method: payment.method,
              p_paid_at: paidAt,
              p_note: 'Imported payment',
              p_receipt_path: null,
              p_idempotency_key: crypto.randomUUID(),
            }
          );
          if (membership.status === 'cancelled') {
            const { error } = await setMembershipCancellation(
              supabase,
              membershipId,
              true
            );
            if (error) statusFailed++;
          }
          if (paymentError) throw paymentError;
        },
      });

      const candidateByRow = new Map(
        candidates.map((candidate) => [candidate.sourceRow, candidate])
      );
      const persisted = results.filter(
        (item) =>
          item.contactId &&
          (item.disposition === 'imported' || item.disposition === 'partial')
      );
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
        }));
      });

      let customValues = 0;
      for (
        let index = 0;
        index < customValueRows.length;
        index += CUSTOM_VALUE_CHUNK
      ) {
        const chunk = customValueRows.slice(index, index + CUSTOM_VALUE_CHUNK);
        const { error } = await supabase
          .from('contact_custom_values')
          .upsert(chunk, { onConflict: 'contact_id,custom_field_id' });
        if (!error) customValues += chunk.length;
      }
      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(
          supabase,
          tagAssignments,
          tagIdByKey
        );
      } catch {
        toast.warning('Members imported, but some tag assignments failed.');
      }
      const imported = results.filter(
        (item) => item.memberOutcome === 'created'
      ).length;
      const attached = results.filter(
        (item) => item.memberOutcome === 'attached'
      ).length;
      const failed = results.filter(
        (item) => item.memberOutcome === 'failed'
      ).length;
      const payments = results.filter(
        (item) => item.paymentOutcome === 'recorded'
      ).length;
      const paymentFailed = results.filter(
        (item) => item.paymentOutcome === 'failed'
      ).length;
      const skipped = results.filter(
        (item) =>
          item.disposition === 'excluded' ||
          item.disposition === 'unresolved' ||
          item.disposition === 'invalid'
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
        customValues,
        receiptCsv: serializeMemberImportReceiptCsv(
          buildMemberImportReceiptRows(candidates, results)
        ),
      };
      setResult(nextResult);
      if (draftManager.draft) {
        const cleaned = await draftManager.discard();
        if (!cleaned) {
          toast.warning(
            'Import completed, but the saved draft still needs cleanup.'
          );
        }
      }
      if (imported + attached > 0) onSaved();
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        toast.info(
          `Unknown tags skipped: ${sample}${skippedNames.length > 3 ? ` (+${skippedNames.length - 3} more)` : ''}`
        );
      }
    } catch (error) {
      setImportProgress((current) =>
        current
          ? { ...current, label: 'Import stopped before completion.' }
          : current
      );
      toast.error(getErrorMessage(error, 'Member import failed'));
    } finally {
      setImporting(false);
    }
  }

  const descriptions: Record<Step, string> = {
    1: 'Upload a CSV or Excel workbook of members to begin.',
    2: 'Map your file columns to member fields.',
    3: 'Resolve every blocking issue or explicitly exclude the row.',
    4: 'Review the exact source equation and confirm.',
  };
  const draftStatusLabel =
    draftManager.saveState === 'saving'
      ? 'Saving…'
      : draftManager.saveState === 'saved'
        ? 'Saved just now'
        : draftManager.saveState === 'conflict'
          ? 'Saved draft changed elsewhere'
          : draftManager.saveState === 'error'
            ? 'Couldn’t save draft'
            : draftManager.saveState === 'loading' || resumingDraft
              ? 'Loading saved draft…'
              : '';

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="border-border/80 bg-popover text-popover-foreground flex max-h-[min(92vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
          <div className="border-border/80 shrink-0 space-y-4 border-b px-6 pt-6 pb-5">
            <DialogHeader className="gap-1.5">
              <DialogTitle size="lg">Import Members</DialogTitle>
              <DialogDescription>
                {result ? 'Import complete.' : descriptions[step]}
              </DialogDescription>
            </DialogHeader>
            <StepIndicator step={result ? 4 : step} />
            {draftManager.draft && !result ? (
              <div className="border-border bg-muted/20 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                <span className="text-foreground min-w-0 truncate font-medium">
                  Continuing {draftManager.draft.sourceFilename}
                </span>
                <span
                  className="text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {draftStatusLabel}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setStartFreshConfirm(true)}
                >
                  Start fresh
                </Button>
              </div>
            ) : null}
            {resumeError ? (
              <p className="text-destructive text-sm" role="alert">
                {resumeError}
              </p>
            ) : null}
          </div>

          <div
            role={!result && step === 3 ? 'region' : undefined}
            aria-label={
              !result && step === 3 ? 'Resolve issues content' : undefined
            }
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          >
            {result ? (
              <ResultPanel result={result} />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.13, ease: 'easeOut' }}
                  className="min-h-0"
                >
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
                      />
                      {(sourceRaw ?? raw) && (
                        <p className="text-muted-foreground text-xs">
                          Analysis is local-first. Only headers and aggregate
                          type, blank, distinct, and format counts may leave
                          this browser—never names, phones, IDs, notes, sample
                          values, or raw financial values.
                        </p>
                      )}
                    </div>
                  )}
                  {step === 2 && raw && (
                    <div className="space-y-5">
                      {suggestedRecipe && (
                        <div className="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                          <p className="text-muted-foreground text-sm">
                            Safe local mapping is active. You remain in control
                            of every field below.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={useManualMapping}
                          >
                            Use manual mapping
                          </Button>
                        </div>
                      )}
                      <MappingStep
                        raw={raw}
                        targets={targets}
                        targetByKey={targetByKey}
                        mapping={mapping}
                        samples={samples}
                        ambiguousDateCols={ambiguousDateCols}
                        dateOrder={dateOrder}
                        canCreateFields={canEditSettings}
                        onSetColumn={setColumn}
                        onToggleDateOrder={() =>
                          setDateOrder((value) =>
                            value === 'DMY' ? 'MDY' : 'DMY'
                          )
                        }
                        onAutoMap={() =>
                          setMapping(
                            autoMapMemberColumns(raw.headers, customFields)
                          )
                        }
                        onReset={() =>
                          setMapping(raw.headers.map(() => MEMBER_IGNORE_KEY))
                        }
                        onRequestCreateField={requestCreateField}
                      />
                    </div>
                  )}
                  {step === 3 && (
                    <ImportMembersPreview
                      candidates={candidates}
                      plans={plans}
                      onPatch={patchCandidate}
                      onResolveGroupedPlan={(sourceKeys, resolution) =>
                        setCandidates((current) =>
                          resolveGroupedPlan(
                            current,
                            sourceKeys,
                            resolution,
                            candidateContext
                          )
                        )
                      }
                      onResolvePayment={(sourceKey, resolution, correction) =>
                        setCandidates((current) =>
                          resolvePaymentConflict(
                            current,
                            sourceKey,
                            resolution,
                            correction,
                            candidateContext
                          )
                        )
                      }
                      onResolveExistingContact={(sourceKey, resolution) =>
                        setCandidates((current) =>
                          resolveExistingContact(
                            current,
                            sourceKey,
                            resolution,
                            candidateContext
                          )
                        )
                      }
                      onSetDisposition={(sourceKey, disposition) =>
                        patchCandidate(sourceKey, { disposition })
                      }
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
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          <DialogFooter className="border-border/80 bg-background/50 mx-0 mt-0 mb-0 shrink-0 items-center gap-2 border-t px-6 py-4 sm:justify-between">
            <div className="min-w-0 flex-1">
              {draftManager.saveState === 'error' && draftManager.draft ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-destructive text-xs">
                    Couldn’t save draft.
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      draftManager.save(draftState);
                      void draftManager.flush();
                    }}
                  >
                    Retry
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStartFreshConfirm(true)}
                  >
                    Discard draft
                  </Button>
                </div>
              ) : draftManager.saveState === 'conflict' &&
                draftManager.draft ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-destructive text-xs">
                    This draft changed in another tab or device.
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
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
                    Start fresh
                  </Button>
                </div>
              ) : null}
              {step === 1 && !result && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    downloadCsv('members-template.csv', MEMBER_TEMPLATE_CSV)
                  }
                >
                  <Download className="size-4" /> Sample CSV
                </Button>
              )}
              {step === 2 && !result && !validation.ok && (
                <div className="flex flex-col gap-0.5">
                  {!validation.phoneMapped && (
                    <ValidationMessage>
                      Map one column to Phone.
                    </ValidationMessage>
                  )}
                  {!validation.planMapped && (
                    <ValidationMessage>
                      Map one column to Plan.
                    </ValidationMessage>
                  )}
                  {validation.duplicateTargets.length > 0 && (
                    <ValidationMessage>
                      Each field can be mapped once. Duplicated:{' '}
                      {validation.duplicateTargets.join(', ')}.
                    </ValidationMessage>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {result ? (
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={importing}
                    onClick={() =>
                      step === 1
                        ? void requestClose()
                        : setStep((value) => (value - 1) as Step)
                    }
                  >
                    {step === 1
                      ? draftManager.draft
                        ? 'Save & close'
                        : 'Cancel'
                      : 'Back'}
                  </Button>
                  {step === 1 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={readingFile || !sourceRaw?.rows.length}
                        onClick={() => setStep(2)}
                      >
                        Map manually
                      </Button>
                      <Button
                        type="button"
                        disabled={
                          readingFile || analyzing || !sourceRaw?.rows.length
                        }
                        onClick={analyzeFile}
                      >
                        {analyzing ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Wand2 className="size-4" />
                        )}
                        Analyze file
                      </Button>
                    </>
                  )}
                  {step === 2 && (
                    <Button
                      type="button"
                      disabled={
                        !validation.ok ||
                        plansLoading ||
                        staffLoading ||
                        loadingPreview ||
                        plans.length === 0
                      }
                      onClick={buildPreview}
                    >
                      {(loadingPreview || plansLoading || staffLoading) && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      Preview {raw?.rows.length ?? 0} row
                      {raw?.rows.length === 1 ? '' : 's'}
                    </Button>
                  )}
                  {step === 3 && (
                    <Button
                      type="button"
                      disabled={
                        candidateSummary.needsResolution > 0 ||
                        candidateSummary.ready === 0
                      }
                      onClick={() => setStep(4)}
                    >
                      Next: Confirm
                    </Button>
                  )}
                  {step === 4 && (
                    <Button
                      type="button"
                      disabled={
                        !compliance ||
                        importing ||
                        readyRows.length === 0 ||
                        candidateSummary.needsResolution > 0
                      }
                      onClick={handleImport}
                    >
                      {importing && <Loader2 className="size-4 animate-spin" />}
                      Import {readyRows.length} member
                      {readyRows.length === 1 ? '' : 's'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createCol !== null}
        onOpenChange={(next) => !next && setCreateCol(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create custom field</DialogTitle>
            <DialogDescription>
              Adds the field to every contact, then maps this file column to it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="member-import-field-name">Field name</Label>
              <Input
                id="member-import-field-name"
                value={newFieldName}
                onChange={(event) => setNewFieldName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-import-field-type">Data type</Label>
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
              Create & map
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startFreshConfirm} onOpenChange={setStartFreshConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start a fresh import?</DialogTitle>
            <DialogDescription>
              This deletes the saved progress and private uploaded file for{' '}
              {draftManager.draft?.sourceFilename ?? 'this import'}. It does not
              affect another teammate or branch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStartFreshConfirm(false)}
            >
              Keep draft
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void startFresh()}
            >
              Delete draft and start fresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ['Upload', 'Map columns', 'Resolve issues', 'Confirm'];
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {labels.map((label, index) => {
        const number = (index + 1) as Step;
        const active = number === step;
        const done = number < step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                active && 'bg-primary text-primary-foreground',
                done && 'bg-primary/20 text-primary-text',
                !active && !done && 'bg-muted text-muted-foreground'
              )}
            >
              {done ? <CheckCircle className="size-3.5" /> : number}
            </div>
            <span
              className={cn(
                'text-xs font-medium whitespace-nowrap',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {index < labels.length - 1 && (
              <span className="bg-border mx-1 h-px flex-1" />
            )}
          </div>
        );
      })}
    </div>
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
}: {
  file: File | null;
  readingFile: boolean;
  raw: RawCsv | null;
  workbookSheets: MemberImportSheet[];
  selectedSheet: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onWorksheetChange: (name: string) => void;
}) {
  const usableSheetCount = workbookSheets.filter((sheet) => sheet.raw).length;
  const unavailableSheets = workbookSheets.filter((sheet) => sheet.error);

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={readingFile ? -1 : 0}
        aria-disabled={readingFile}
        onClick={() => !readingFile && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!readingFile && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 transition-colors',
          file
            ? 'border-primary/35 bg-primary/[0.04]'
            : 'border-border/80 bg-background/40 hover:border-border-hover'
        )}
      >
        {readingFile ? (
          <>
            <div className="bg-muted/80 ring-border/80 flex size-10 items-center justify-center rounded-lg ring-1">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
            <p className="text-foreground max-w-full truncate px-2 text-sm font-medium">
              {file?.name}
            </p>
            <p className="text-muted-foreground text-[11px]">Reading file…</p>
          </>
        ) : file ? (
          <>
            <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
              <FileText className="text-primary-text size-5" />
            </div>
            <p className="text-foreground max-w-full truncate px-2 text-sm font-medium">
              {file.name}
            </p>
            {raw ? (
              <Badge variant="neutral">
                {raw.rows.length} row{raw.rows.length === 1 ? '' : 's'} ·{' '}
                {raw.headers.length} column
                {raw.headers.length === 1 ? '' : 's'}
              </Badge>
            ) : workbookSheets.length > 0 ? (
              <Badge variant="neutral">
                {workbookSheets.length} worksheet
                {workbookSheets.length === 1 ? '' : 's'}
              </Badge>
            ) : null}
          </>
        ) : (
          <>
            <div className="bg-muted/80 ring-border/80 flex size-10 items-center justify-center rounded-lg ring-1">
              <Upload className="text-muted-foreground size-5" />
            </div>
            <p className="text-muted-foreground text-sm">
              Click to choose a CSV or Excel file
            </p>
            <p className="text-muted-foreground text-[11px]">
              Any column layout — you&apos;ll map fields next
            </p>
          </>
        )}
      </div>
      {workbookSheets.length > 1 && (
        <div className="mx-auto max-w-sm space-y-1.5">
          <Label htmlFor="member-import-worksheet">Worksheet</Label>
          <Select
            value={selectedSheet || undefined}
            onValueChange={(value) => value && onWorksheetChange(value)}
          >
            <SelectTrigger id="member-import-worksheet" className="w-full">
              <SelectValue placeholder="Choose a worksheet" />
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
                'No worksheet has both a header row and usable member data.'}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-xs">
                Select the worksheet that contains your member table.
              </p>
              {unavailableSheets.length > 0 && (
                <p className="text-amber-foreground text-xs">
                  {unavailableSheets[0].error}
                  {unavailableSheets.length > 1
                    ? ` ${unavailableSheets.length - 1} more worksheet${unavailableSheets.length === 2 ? ' is' : 's are'} unavailable.`
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
      <p className="text-muted-foreground text-center text-xs">
        Supports .csv and .xlsx. For legacy .xls files, save as .xlsx or .csv.
      </p>
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
  ambiguousDateCols,
  dateOrder,
  canCreateFields,
  onSetColumn,
  onToggleDateOrder,
  onAutoMap,
  onReset,
  onRequestCreateField,
}: {
  raw: RawCsv;
  targets: TargetField[];
  targetByKey: Map<string, TargetField>;
  mapping: string[];
  samples: string[][];
  ambiguousDateCols: Set<number>;
  dateOrder: DateOrder;
  canCreateFields: boolean;
  onSetColumn: (column: number, key: string) => void;
  onToggleDateOrder: () => void;
  onAutoMap: () => void;
  onReset: () => void;
  onRequestCreateField: (column: number) => void;
}) {
  const groups = useMemo<ComboboxGroup[]>(() => {
    const make = (label: string, kinds: TargetField['kind'][]) => ({
      label,
      options: targets
        .filter((target) => kinds.includes(target.kind))
        .map((target) => ({
          value: target.key,
          label: target.label,
          hint: target.required ? 'required' : undefined,
        })),
    });
    return [
      { options: [{ value: MEMBER_IGNORE_KEY, label: "Don't import" }] },
      make('Contact', ['standard']),
      make('Membership', ['member', 'assignee']),
      make('Payments', ['payment']),
      make('Profile', ['profile']),
      make('Tags', ['tags']),
      make('Custom fields', ['custom']),
    ].filter((group) => group.options.length > 0);
  }, [targets]);
  const unmapped = mapping.filter((key) => key === MEMBER_IGNORE_KEY).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
          Column mapping
        </p>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={onAutoMap}>
            <Wand2 className="size-3.5" /> Auto map
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onReset}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        </div>
      </div>

      <div className="border-border ring-border/50 overflow-hidden rounded-xl border ring-1">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] table-fixed text-xs">
            <thead>
              <tr className="border-border bg-background/60 border-b">
                <th className="text-muted-foreground w-[18%] px-3 py-2 text-left font-medium">
                  File column
                </th>
                <th className="text-muted-foreground w-[25%] px-3 py-2 text-left font-medium">
                  Sample data
                </th>
                <th className="text-muted-foreground w-[42%] px-3 py-2 text-left font-medium">
                  Member field
                </th>
                <th className="text-muted-foreground w-[15%] px-3 py-2 text-left font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-border/70 divide-y">
              {raw.headers.map((header, column) => {
                const key = mapping[column] ?? MEMBER_IGNORE_KEY;
                const isMapped = key !== MEMBER_IGNORE_KEY;
                return (
                  <tr key={column} className="bg-popover/40">
                    <td className="text-foreground truncate px-3 py-2 font-medium">
                      {header || (
                        <span className="text-muted-foreground italic">
                          (unnamed)
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-3 py-2">
                      <span className="block truncate font-mono text-[11px]">
                        {samples[column]?.join(' · ') || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Combobox
                        groups={groups}
                        value={key}
                        onSelect={(value) => onSetColumn(column, value)}
                        searchPlaceholder="Search fields…"
                        footer={
                          canCreateFields
                            ? {
                                label: 'Create new field…',
                                onSelect: () => onRequestCreateField(column),
                              }
                            : null
                        }
                        className="min-w-[12rem] text-xs"
                        contentClassName="w-64"
                      >
                        <span className="truncate">
                          {isMapped
                            ? (targetByKey.get(key)?.label ?? key)
                            : "Don't import"}
                        </span>
                      </Combobox>
                      {key === 'phone' && (
                        <p className="text-muted-foreground mt-1 max-w-[25rem] text-[10px] leading-snug">
                          Members are matched by phone; local numbers are
                          qualified with the account&apos;s country code.
                        </p>
                      )}
                      {ambiguousDateCols.has(column) && (
                        <button
                          type="button"
                          onClick={onToggleDateOrder}
                          title="Toggle day/month order"
                          className="bg-primary/10 text-primary-text hover:bg-primary/20 mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                        >
                          {dateOrder === 'DMY' ? 'DD/MM' : 'MM/DD'} ▾
                          <span className="text-muted-foreground font-sans font-normal">
                            {dateOrder === 'DMY'
                              ? '02/07 = 2 July'
                              : '02/07 = Feb 7'}
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isMapped ? (
                        <span className="text-emerald-foreground inline-flex items-center gap-1 text-[11px] font-medium">
                          <CheckCircle className="size-3.5" /> Mapped
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">
                          Skipped
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-muted-foreground text-[11px]">
        {unmapped === 0
          ? `All ${mapping.length} columns mapped`
          : `${unmapped} column${unmapped === 1 ? '' : 's'} won’t be imported`}
      </p>
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
      {progress && (
        <div
          className="border-border bg-muted/20 space-y-2 rounded-lg border p-4"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-foreground font-medium">
              Importing members
            </span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {Math.round((progress.completed / progress.total) * 100)}%
            </span>
          </div>
          <Progress
            value={progress.completed}
            max={progress.total}
            aria-label="Member import progress"
          />
          <p className="text-muted-foreground text-xs">{progress.label}</p>
        </div>
      )}
      <div className="border-border bg-background/40 rounded-lg border p-4">
        <p className="text-foreground text-sm font-medium">
          Exact source equation
        </p>
        <p className="text-muted-foreground mt-1 text-sm tabular-nums">
          {fmt.number(summary.source)} source rows = {fmt.number(summary.ready)}{' '}
          ready + {fmt.number(summary.needsResolution)} needs resolution +{' '}
          {fmt.number(summary.automaticExcluded)} automatic exclusions +{' '}
          {fmt.number(summary.explicitlyExcluded)} explicit exclusions
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="New contacts" value={summary.newContacts} />
        <SummaryCard
          label="Attached contacts"
          value={summary.attachedContacts}
        />
        <SummaryCard label="Memberships" value={summary.memberships} />
        <SummaryCard label="Payments" value={summary.payments} />
        <SummaryCard
          label="Member-only imports"
          value={summary.memberOnlyImports}
        />
        <SummaryCard label="Notices" value={summary.notices} />
        <SummaryCard label="Exclusions" value={summary.exclusions} />
      </div>
      <label className="border-border flex items-start gap-3 rounded-lg border p-4">
        <Checkbox
          checked={compliance}
          onCheckedChange={(value) => onComplianceChange(value === true)}
        />
        <span className="text-foreground text-sm">
          I confirm this gym is allowed to store and contact the people in this
          file, and I have reviewed the rows above.
        </span>
      </label>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border bg-background/40 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-1 text-xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  const successful = result.imported + result.attached;
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
          <CheckCircle className="text-emerald-foreground size-6" />
        </div>
        <div>
          <p className="text-foreground text-lg font-semibold">
            {successful} member{successful === 1 ? '' : 's'} imported
          </p>
          <p className="text-muted-foreground text-sm">
            The Members action lists are ready to use.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="New members" value={result.imported} />
        <SummaryCard label="Attached to contacts" value={result.attached} />
        <SummaryCard label="Payments recorded" value={result.payments} />
        <SummaryCard label="Skipped" value={result.skipped + result.invalid} />
      </div>
      {(result.failed > 0 ||
        result.paymentFailed > 0 ||
        result.statusFailed > 0) && (
        <div className="border-border bg-background/40 text-amber-foreground flex items-start gap-2 rounded-lg border p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {result.failed > 0 && `${result.failed} member rows failed. `}
            {result.paymentFailed > 0 &&
              `${result.paymentFailed} payment records failed; those members remain imported with fees due. `}
            {result.statusFailed > 0 &&
              `${result.statusFailed} imported cancellations need their status corrected.`}
          </span>
        </div>
      )}
      {(result.tagsAssigned > 0 || result.customValues > 0) && (
        <p className="text-muted-foreground text-center text-xs">
          {result.tagsAssigned} tag assignments · {result.customValues} custom
          values saved
        </p>
      )}
      <div className="flex justify-center">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            downloadCsv('member-import-receipt.csv', result.receiptCsv)
          }
        >
          <Download className="size-4" /> Download CSV receipt
        </Button>
      </div>
    </div>
  );
}

function ValidationMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-red-foreground flex items-center gap-1.5 text-xs">
      <XCircle className="size-3.5 shrink-0" /> {children}
    </p>
  );
}
