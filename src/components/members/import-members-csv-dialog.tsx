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

import {
  ImportMembersPreview,
  type MemberImportPreviewRow,
} from './import-members-preview';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
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
  applyMemberMapping,
  autoMapMemberColumns,
  buildMemberTargets,
  buildMembershipRow,
  MEMBER_IGNORE_KEY,
  MEMBER_TEMPLATE_CSV,
  validateMemberMapping,
  type MemberImportRow,
} from '@/lib/memberships/import-commit';
import {
  MemberImportFileError,
  memberImportFileKind,
  parseMemberImportWorkbook,
  type MemberImportSheet,
} from '@/lib/memberships/import-workbook';
import { MEMBER_IMPORT_FIELDS } from '@/lib/memberships/member-field-registry';
import {
  applyMemberMigrationRecipe,
  buildMigrationAnalysis,
  summarizeMigrationIssues,
  type MemberMigrationRecipe,
  type MigrationIssue,
} from '@/lib/memberships/migration-recipe';
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

interface PreviewMeta {
  skippedNoPhone: number;
  skippedInvalidPhone: number;
  skippedDuplicate: number;
  invalidCustomValues: number;
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
}

interface ImportProgress {
  completed: number;
  total: number;
  label: string;
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
  const {
    staff,
    nameById,
    avatarById,
    loading: staffLoading,
  } = useAccountStaff();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReadSequence = useRef(0);

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [workbookSheets, setWorkbookSheets] = useState<MemberImportSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [raw, setRaw] = useState<RawCsv | null>(null);
  const [sourceRaw, setSourceRaw] = useState<RawCsv | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [fileExplanation, setFileExplanation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedRecipe, setSuggestedRecipe] =
    useState<MemberMigrationRecipe | null>(null);
  const [migrationIssues, setMigrationIssues] = useState<MigrationIssue[]>([]);
  const [migrationCounts, setMigrationCounts] = useState<{
    ready: number;
    needsReview: number;
    excluded: number;
  } | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>(accountDateOrder);
  const [customFields, setCustomFields] = useState<CustomFieldRef[]>([]);
  const [previewRows, setPreviewRows] = useState<MemberImportPreviewRow[]>([]);
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta>({
    skippedNoPhone: 0,
    skippedInvalidPhone: 0,
    skippedDuplicate: 0,
    invalidCustomValues: 0,
  });
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [compliance, setCompliance] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  );
  const [result, setResult] = useState<ImportResult | null>(null);

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
      setFileExplanation('');
      setAnalyzing(false);
      setSuggestedRecipe(null);
      setMigrationIssues([]);
      setMigrationCounts(null);
      setDateOrder(accountDateOrder);
      setPreviewRows([]);
      setPreviewMeta({
        skippedNoPhone: 0,
        skippedInvalidPhone: 0,
        skippedDuplicate: 0,
        invalidCustomValues: 0,
      });
      setCompliance(false);
      setImporting(false);
      setImportProgress(null);
      setResult(null);
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

  const readyRows = previewRows.filter(
    (row) => row.built.membership && !row.alreadyMember
  );

  function handleOpenChange(next: boolean) {
    if (importing) return;
    if (!next) {
      fileReadSequence.current++;
      setReadingFile(false);
    }
    onOpenChange(next);
  }

  function prepareRawTable(parsed: RawCsv) {
    const nextMapping = autoMapMemberColumns(parsed.headers, customFields);
    setRaw(parsed);
    setSourceRaw(parsed);
    setMapping(nextMapping);
    setSuggestedRecipe(null);
    setMigrationIssues([]);
    setMigrationCounts(null);
    setResult(null);

    const dateColumns = nextMapping
      .map((key, index) => (DATE_KEYS.has(key) ? index : -1))
      .filter((index) => index >= 0);
    const detected = detectDateOrder(
      dateColumns.flatMap((index) =>
        parsed.rows.slice(0, 50).map((row) => row[index] ?? '')
      )
    );
    setDateOrder(detected === 'ambiguous' ? accountDateOrder : detected);
  }

  async function analyzeFile() {
    const input = sourceRaw ?? raw;
    if (!input) return;
    setAnalyzing(true);
    try {
      const response = await fetch('/api/members/import-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildMigrationAnalysis(input),
          explanation: fileExplanation,
        }),
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
      const transformed = applyMemberMigrationRecipe(input, data.recipe, {
        today: fmt.today(),
        dialCode: locale.phoneCountryCode,
      });
      setSuggestedRecipe(data.recipe);
      setMigrationIssues(transformed.issues);
      setMigrationCounts(transformed.counts);
      setRaw(transformed.raw);
      setMapping(transformed.mapping);
      setStep(2);
      if (!data.configured) {
        toast.info(
          'AI is not configured. A safe local interpretation is shown; you can still map fields manually.'
        );
      } else if (data.warning) {
        toast.warning(data.warning);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not analyze this file'));
    } finally {
      setAnalyzing(false);
    }
  }

  function useManualMapping() {
    if (!sourceRaw) return;
    setRaw(sourceRaw);
    setMapping(autoMapMemberColumns(sourceRaw.headers, customFields));
    setSuggestedRecipe(null);
    setMigrationIssues([]);
    setMigrationCounts(null);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const kind = memberImportFileKind(selected.name);
    if (!kind) {
      toast.error(
        selected.name.toLowerCase().endsWith('.xls')
          ? 'Legacy .xls files are not supported. Save the workbook as .xlsx or .csv and try again.'
          : 'Unsupported file. Choose a .csv or .xlsx file.'
      );
      event.target.value = '';
      return;
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
      if (kind === 'csv') {
        const parsed = parseCsvRaw(await selected.text());
        if (sequence !== fileReadSequence.current) return;
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          throw new MemberImportFileError(
            'No rows found. Ensure the file has a header row and data.'
          );
        }
        prepareRawTable(parsed);
        return;
      }

      const sheets = await parseMemberImportWorkbook(selected);
      if (sequence !== fileReadSequence.current) return;
      setWorkbookSheets(sheets);
      if (sheets.length === 1 && sheets[0].raw) {
        setSelectedSheet(sheets[0].name);
        prepareRawTable(sheets[0].raw);
      } else {
        const firstUsable = sheets.find((sheet) => sheet.raw);
        if (!firstUsable) {
          toast.error(
            sheets[0]?.error ?? 'No usable worksheets found in this workbook.'
          );
        }
      }
    } catch (error) {
      if (sequence !== fileReadSequence.current) return;
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
    } finally {
      if (sequence === fileReadSequence.current) setReadingFile(false);
    }
  }

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
      const mapped = applyMemberMapping(raw.rows, mapping, {
        dialCode: locale.phoneCountryCode,
        customFieldTypes,
        dateOrder,
      });
      const [
        { data: contacts, error: contactsError },
        { data: memberships, error: membersError },
      ] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, phone_normalized, received_via')
          .eq('account_id', accountId),
        supabase
          .from('memberships')
          .select('contact_id')
          .eq('account_id', accountId),
      ]);
      if (contactsError) throw contactsError;
      if (membersError) throw membersError;

      const contactByPhone = new Map<
        string,
        { id: string; receivedVia: string | null }
      >();
      for (const contact of contacts ?? []) {
        const item = contact as {
          id: string;
          phone_normalized: string | null;
          received_via: string | null;
        };
        if (item.phone_normalized) {
          contactByPhone.set(item.phone_normalized, {
            id: item.id,
            receivedVia: item.received_via,
          });
        }
      }
      const memberContactIds = new Set(
        (memberships ?? []).map(
          (membership) => (membership as { contact_id: string }).contact_id
        )
      );

      const issuesByRow = new Map<number, MigrationIssue[]>();
      for (const issue of migrationIssues) {
        issuesByRow.set(issue.rowIndex, [
          ...(issuesByRow.get(issue.rowIndex) ?? []),
          issue,
        ]);
      }

      setPreviewRows(
        mapped.rows.map((source) => {
          const existing = contactByPhone.get(normalizeKey(source.phone));
          return {
            source,
            built: buildMembershipRow(
              source,
              plans,
              dateOrder,
              fmt.today(),
              staff
            ),
            existingContactId: existing?.id ?? null,
            existingReceivedVia: existing?.receivedVia ?? null,
            alreadyMember: existing ? memberContactIds.has(existing.id) : false,
            migrationIssues: issuesByRow.get(source.sourceRowIndex ?? -1) ?? [],
          } satisfies MemberImportPreviewRow;
        })
      );
      setPreviewMeta({
        skippedNoPhone: mapped.skippedNoPhone,
        skippedInvalidPhone: mapped.skippedInvalidPhone,
        skippedDuplicate: mapped.skippedDuplicate,
        invalidCustomValues: mapped.invalidCustomValues,
      });
      setStep(3);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not prepare the preview'));
    } finally {
      setLoadingPreview(false);
    }
  }

  function rebuild(
    row: MemberImportPreviewRow,
    source: MemberImportRow
  ): MemberImportPreviewRow {
    return {
      ...row,
      source,
      built: buildMembershipRow(source, plans, dateOrder, fmt.today(), staff),
    };
  }

  function patchPreviewRow(index: number, patch: Partial<MemberImportRow>) {
    setPreviewRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? rebuild(row, { ...row.source, ...patch }) : row
      )
    );
  }

  function bulkFixPlan(rawPlan: string, planId: string) {
    const plan = plans.find((item) => item.id === planId);
    if (!plan) return;
    setPreviewRows((current) =>
      current.map((row) => {
        const value = row.source.planName?.trim() || '(blank)';
        return value === rawPlan
          ? rebuild(row, {
              ...row.source,
              planName: plan.name,
              pricingOption: '',
            })
          : row;
      })
    );
  }

  async function handleImport() {
    if (!accountId || !user || readyRows.length === 0) return;
    const totalWork = readyRows.length + 2;
    let completedWork = 0;
    const advanceProgress = (label: string) => {
      completedWork++;
      setImportProgress({
        completed: completedWork,
        total: totalWork,
        label,
      });
    };
    setImporting(true);
    setImportProgress({
      completed: 0,
      total: totalWork,
      label: 'Preparing member import…',
    });
    try {
      const allTagNames = readyRows.flatMap((row) => row.source.tagNames);
      const { tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
        accountId,
        userId: user.id,
        tagNames: allTagNames,
        canCreateTags: canEditSettings,
      });

      let imported = 0;
      let attached = 0;
      let skipped = previewRows.filter((row) => row.alreadyMember).length;
      let failed = 0;
      let payments = 0;
      let paymentFailed = 0;
      let statusFailed = 0;
      const tagAssignments: ContactTagAssignment[] = [];
      const customValueRows: {
        contact_id: string;
        custom_field_id: string;
        value: string;
      }[] = [];

      for (const row of readyRows) {
        const built = row.built;
        const membership = built.membership;
        if (!membership) {
          advanceProgress('Skipping an invalid member…');
          continue;
        }

        let contactId = row.existingContactId;
        const existed = !!contactId;
        if (!contactId) {
          const { data, error } = await supabase
            .from('contacts')
            .insert({
              user_id: user.id,
              account_id: accountId,
              phone: row.source.phone,
              assigned_to: built.assignedTo ?? user.id,
              received_via: 'import' as const,
              churn_risk: built.churnRisk ?? false,
              ...built.contact,
            })
            .select('id')
            .single();
          if (error || !data?.id) {
            if (isUniqueViolation(error)) skipped++;
            else failed++;
            advanceProgress(
              `Processed ${completedWork + 1} of ${readyRows.length} members`
            );
            continue;
          }
          contactId = data.id;
        } else {
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
            (!row.existingReceivedVia ||
              row.existingReceivedVia === 'manual' ||
              row.existingReceivedVia === 'import')
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
              failed++;
              advanceProgress(
                `Processed ${completedWork + 1} of ${readyRows.length} members`
              );
              continue;
            }
          }
        }

        // A cancelled cycle is void and therefore rejects ledger writes.
        // For a paid historical cancellation, create the open cycle, record
        // its real payment, then use the lifecycle RPC to cancel/void it.
        const deferCancellation =
          membership.status === 'cancelled' && !!built.payment;
        const membershipInsert = deferCancellation
          ? { ...membership, status: 'active' as const, frozen_at: null }
          : membership;
        const { data: createdMembership, error: membershipError } =
          await supabase
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
        if (membershipError || !createdMembership?.id) {
          if (isUniqueViolation(membershipError)) skipped++;
          else failed++;
          advanceProgress(
            `Processed ${completedWork + 1} of ${readyRows.length} members`
          );
          continue;
        }

        if (built.payment) {
          const paidAt = (
            dateAtNoonInTz(built.payment.paidOn, locale.timeZone) ?? new Date()
          ).toISOString();
          const { error: paymentError } = await supabase.rpc(
            'record_membership_payment',
            {
              p_membership_id: createdMembership.id,
              p_period_end: membership.end_date,
              p_amount: built.payment.amount,
              p_method: built.payment.method,
              p_paid_at: paidAt,
              p_note: 'Imported payment',
              p_receipt_path: null,
              p_idempotency_key: crypto.randomUUID(),
            }
          );
          if (paymentError) paymentFailed++;
          else payments++;
        }

        if (deferCancellation) {
          const { error: cancellationError } = await setMembershipCancellation(
            supabase,
            createdMembership.id,
            true
          );
          if (cancellationError) statusFailed++;
        }

        if (existed) attached++;
        else imported++;
        if (row.source.tagNames.length > 0) {
          tagAssignments.push({
            contactId: contactId!,
            tagNames: row.source.tagNames,
          });
        }
        for (const custom of row.source.customValues) {
          customValueRows.push({
            contact_id: contactId!,
            custom_field_id: custom.fieldId,
            value: custom.value,
          });
        }
        advanceProgress(
          `Processed ${completedWork + 1} of ${readyRows.length} members`
        );
      }

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
      advanceProgress('Saved profile and custom-field details');

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
      advanceProgress('Finalizing import receipt…');

      const nextResult: ImportResult = {
        imported,
        attached,
        skipped,
        invalid: previewRows.filter(
          (row) => !row.alreadyMember && row.built.errors.length > 0
        ).length,
        failed,
        payments,
        paymentFailed,
        statusFailed,
        tagsAssigned,
        customValues,
      };
      setResult(nextResult);
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
    3: 'Check and edit members exactly as they will appear.',
    4: 'Review the import receipt and confirm.',
  };

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
          </div>

          <div
            className={cn(
              'min-h-0 flex-1 px-6 py-5',
              !result && step === 3
                ? 'flex flex-col overflow-hidden'
                : 'overflow-y-auto'
            )}
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
                  className={cn(
                    'min-h-0',
                    step === 3 && 'flex flex-1 flex-col'
                  )}
                >
                  {step === 1 && (
                    <div className="space-y-5">
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
                        <div className="space-y-2">
                          <Label htmlFor="member-import-explanation">
                            Explain your file
                          </Label>
                          <Textarea
                            id="member-import-explanation"
                            value={fileExplanation}
                            onChange={(event) =>
                              setFileExplanation(event.target.value)
                            }
                            placeholder="Example: repeated Member IDs are membership history; import the latest row and keep the old ID in notes."
                            maxLength={2000}
                          />
                          <p className="text-muted-foreground text-xs">
                            Analyze file sends headers, a few representative
                            values, counts, and this explanation—not the full
                            file. You will review every suggestion before
                            import.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {step === 2 && raw && (
                    <div className="space-y-5">
                      {suggestedRecipe && migrationCounts && (
                        <MigrationAnalysisSummary
                          recipe={suggestedRecipe}
                          counts={migrationCounts}
                          issues={migrationIssues}
                          onUseManualMapping={useManualMapping}
                        />
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
                      rows={previewRows}
                      mappedKeys={mappedKeys}
                      plans={plans}
                      staff={staff}
                      nameById={nameById}
                      avatarById={avatarById}
                      skippedNoPhone={previewMeta.skippedNoPhone}
                      skippedInvalidPhone={previewMeta.skippedInvalidPhone}
                      skippedDuplicates={previewMeta.skippedDuplicate}
                      onPatch={patchPreviewRow}
                      onBulkPlanFix={bulkFixPlan}
                    />
                  )}
                  {step === 4 && (
                    <ConfirmStep
                      rows={previewRows}
                      meta={previewMeta}
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
                        ? onOpenChange(false)
                        : setStep((value) => (value - 1) as Step)
                    }
                  >
                    {step === 1 ? 'Cancel' : 'Back'}
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
                    <Button type="button" onClick={() => setStep(4)}>
                      Next: Confirm
                    </Button>
                  )}
                  {step === 4 && (
                    <Button
                      type="button"
                      disabled={
                        !compliance || importing || readyRows.length === 0
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
    </>
  );
}

function MigrationAnalysisSummary({
  recipe,
  counts,
  issues,
  onUseManualMapping,
}: {
  recipe: MemberMigrationRecipe;
  counts: { ready: number; needsReview: number; excluded: number };
  issues: MigrationIssue[];
  onUseManualMapping: () => void;
}) {
  const { fmt } = useLocale();
  const summary = summarizeMigrationIssues(issues);
  const totalMembers = counts.ready + counts.needsReview;
  const outcomes = [
    summary.expiryDatesKept > 0
      ? {
          key: 'expiry',
          badge: 'No action needed',
          badgeVariant: 'success' as const,
          text: `We’ll keep the expiry date from your file for ${fmt.number(summary.expiryDatesKept)} member${summary.expiryDatesKept === 1 ? '' : 's'} where it differs from the plan length.`,
        }
      : null,
    summary.missingPhones > 0
      ? {
          key: 'missing-phone',
          badge: 'Will be skipped',
          badgeVariant: 'warning' as const,
          text: `${fmt.number(summary.missingPhones)} member${summary.missingPhones === 1 ? '' : 's'} ${summary.missingPhones === 1 ? 'has' : 'have'} no usable phone number. Add ${summary.missingPhones === 1 ? 'it' : 'them'} to the file and upload again.`,
        }
      : null,
    summary.sharedPhones > 0
      ? {
          key: 'shared-phone',
          badge: 'Will be skipped',
          badgeVariant: 'warning' as const,
          text: `${fmt.number(summary.sharedPhones)} member${summary.sharedPhones === 1 ? '' : 's'} share a phone number with another member. Give each person a unique number in the file and upload again.`,
        }
      : null,
    summary.paymentsSkipped > 0
      ? {
          key: 'payment',
          badge: 'Payment skipped',
          badgeVariant: 'warning' as const,
          text: `${fmt.number(summary.paymentsSkipped)} member${summary.paymentsSkipped === 1 ? '' : 's'} will import with the fee due because the payment totals don’t match. Correct the source amounts and upload again to record ${summary.paymentsSkipped === 1 ? 'this payment' : 'these payments'}.`,
        }
      : null,
  ].filter((outcome) => outcome !== null);

  return (
    <div className="border-border bg-muted/20 space-y-3 rounded-lg border p-4">
      <div className="space-y-2">
        <p className="text-foreground font-medium">
          How this file will be imported
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm">
            {fmt.number(totalMembers)} member record
            {totalMembers === 1 ? '' : 's'} found
          </span>
          <Badge variant="success">{fmt.number(counts.ready)} ready</Badge>
          {counts.needsReview > 0 && (
            <Badge variant="warning">
              {fmt.number(counts.needsReview)} need attention
            </Badge>
          )}
          {counts.excluded > 0 && (
            <Badge variant="secondary">
              {fmt.number(counts.excluded)} older or summary row
              {counts.excluded === 1 ? '' : 's'} won’t import
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {recipe.identityColumn && recipe.latestByDateColumn
            ? 'We’ll use the latest membership row for each member and leave older history out of this import.'
            : 'Review the proposed column mapping below before previewing the members.'}
        </p>
      </div>

      {outcomes.length > 0 && (
        <div className="border-border divide-border divide-y rounded-lg border">
          {outcomes.map((outcome) => (
            <div
              key={outcome.key}
              className="grid gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
            >
              <Badge variant={outcome.badgeVariant}>{outcome.badge}</Badge>
              <p className="text-muted-foreground text-sm">{outcome.text}</p>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" onClick={onUseManualMapping}>
        Use manual mapping instead
      </Button>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ['Upload', 'Map columns', 'Preview & edit', 'Confirm'];
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
  rows,
  meta,
  compliance,
  progress,
  onComplianceChange,
}: {
  rows: MemberImportPreviewRow[];
  meta: PreviewMeta;
  compliance: boolean;
  progress: ImportProgress | null;
  onComplianceChange: (checked: boolean) => void;
}) {
  const ready = rows.filter(
    (row) => row.built.membership && !row.alreadyMember
  );
  const invalid = rows.filter(
    (row) => !row.alreadyMember && row.built.errors.length > 0
  ).length;
  const existingContacts = ready.filter((row) => row.existingContactId).length;
  const payments = ready.filter((row) => row.built.payment).length;
  const profileValues = ready.filter((row) =>
    Object.values(row.built.contact).some((value) => value !== null)
  ).length;

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Ready to import" value={ready.length} />
        <SummaryCard
          label="New contacts"
          value={ready.length - existingContacts}
        />
        <SummaryCard label="Existing contacts" value={existingContacts} />
        <SummaryCard label="Payments to record" value={payments} />
      </div>
      <div className="border-border bg-background/40 rounded-lg border p-4">
        <p className="text-foreground text-sm font-medium">Import handling</p>
        <ul className="text-muted-foreground mt-2 space-y-1.5 text-xs">
          <li>{invalid} rows needing attention will be skipped.</li>
          <li>
            {rows.filter((row) => row.alreadyMember).length} existing members
            will be skipped instead of duplicated.
          </li>
          <li>{profileValues} rows include profile information.</li>
          <li>
            {meta.skippedNoPhone + meta.skippedInvalidPhone} rows have no usable
            phone; {meta.skippedDuplicate} in-file duplicates were removed.
          </li>
          {meta.invalidCustomValues > 0 && (
            <li>
              {meta.invalidCustomValues} invalid custom-field values were
              ignored; the member rows remain importable.
            </li>
          )}
          <li>
            Paid rows create real payment-ledger entries, so Fee status remains
            database-derived.
          </li>
        </ul>
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
