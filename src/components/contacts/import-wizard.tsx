'use client';

// CSV import wizard, shared by Contacts and Leads via the `variant` prop.
//
//   variant="contacts" (default) — the original 3-step flow, unchanged:
//     Upload → Map (mode radio lives here) → Review & import.
//   variant="leads" — the 4-step flow from PRDs/import_leads_ux.md:
//     Upload → Map columns → Preview & edit → Confirm.
//     Map gains lead-field targets (Status/Source/Gender/Assigned to), a
//     searchable field picker, heuristic type detection on inline field
//     creation, and a DD/MM chip for ambiguous date columns. Preview is
//     an editable grid rendered with the leads table's own cell
//     renderers plus the value-level "Fix values" panel. Confirm owns
//     the write policy (add/update/both) + consent, and the commit
//     consumes the EDITED PreviewRow[] — not a re-run of the mapping.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { importDateOrder } from '@/lib/locale/config';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import {
  applyMapping,
  autoMapColumns,
  buildLeadTargets,
  buildTargets,
  customFieldId,
  CUSTOM_FIELD_TYPES,
  IGNORE_KEY,
  parseCsvRaw,
  RESERVED_FIELD_NAMES,
  validateMapping,
  type CustomFieldRef,
  type MappedRow,
  type RawCsv,
  type TargetField,
} from '@/lib/contacts/field-mapping';
import {
  buildPreviewRows,
  detectDateOrder,
  detectFieldType,
  type DateOrder,
  type FixableField,
  type PreviewRow,
} from '@/lib/leads/import-coerce';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import { useLeadFieldOptions } from '@/hooks/use-lead-field-options';
import { useAccountStaff } from '@/components/members/use-account-staff';
import {
  ImportPreviewGrid,
  type PendingInvite,
} from '@/components/leads/import-preview-grid';
import { StatusBadge } from '@/components/leads/lead-cell-renderers';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxGroup } from '@/components/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Download,
  Wand2,
  RotateCcw,
  Pencil,
  Trash2,
} from 'lucide-react';

type ImportMode = 'add' | 'update' | 'both';
type ImportVariant = 'contacts' | 'leads';

const SAMPLE_LIMIT = 3;
/** Values scanned per column for type/date detection (create-field prefill). */
const DETECT_LIMIT = 40;
const INSERT_CHUNK = 50;
const CUSTOM_VALUE_CHUNK = 100;

const TEMPLATE_CSV: Record<ImportVariant, { filename: string; content: string }> = {
  contacts: {
    filename: 'contacts-template.csv',
    content:
      'phone,name,email,company,tags\n' +
      '+15551234567,Jane Doe,jane@example.com,Acme Inc,"VIP, Lead"\n' +
      '+15559876543,John Roe,john@example.com,Globex,Customer\n',
  },
  leads: {
    filename: 'leads-template.csv',
    content:
      'phone,name,email,status,source,gender,assigned to\n' +
      '+919876543210,Priya Sharma,priya@example.com,Interested,Instagram,Female,Aakash\n' +
      '+919812345678,Rahul Verma,,New,Walk-in,Male,\n',
  },
};

const MODE_LABELS: Record<ImportVariant, Record<ImportMode, { title: string; hint: string }>> = {
  contacts: {
    add: {
      title: 'Add new contacts',
      hint: 'Insert rows as new contacts. Numbers already in this account are skipped.',
    },
    update: {
      title: 'Update existing only',
      hint: 'Match rows to existing contacts by phone and update them. Unmatched rows are skipped.',
    },
    both: {
      title: 'Add & update',
      hint: 'Update contacts that already exist and add the rest as new.',
    },
  },
  leads: {
    both: {
      title: 'Add new & update existing',
      hint: 'Recommended — new phones become leads, known phones get updated.',
    },
    add: {
      title: 'Only add new leads',
      hint: 'Rows matching an existing lead by phone are skipped.',
    },
    update: {
      title: 'Only update existing',
      hint: 'No new leads are created. Unmatched rows are skipped.',
    },
  },
};

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  tagsAssigned: number;
  customValues: number;
  invalidValues: number;
  /** Rows cleaned by value-level fixes in the preview (leads only). */
  remapped: number;
}

/** One value-level fix from the preview's Fix-values panel, for the audit. */
interface RemapEntry {
  field: FixableField;
  raw: string;
  key: string;
  count: number;
}

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  /** 'leads' opts into the 4-step preview flow; default keeps Contacts as-is. */
  variant?: ImportVariant;
}

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

/** Up to DETECT_LIMIT non-empty values of a column, for detection. */
function columnValues(raw: RawCsv | null, col: number): string[] {
  if (!raw) return [];
  const vals: string[] = [];
  for (const row of raw.rows) {
    const v = row[col]?.trim();
    if (v) vals.push(v);
    if (vals.length >= DETECT_LIMIT) break;
  }
  return vals;
}

function downloadTemplate(variant: ImportVariant) {
  const { filename, content } = TEMPLATE_CSV[variant];
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard({
  open,
  onOpenChange,
  onImported,
  variant = 'contacts',
}: ImportWizardProps) {
  const supabase = createClient();
  const { user, accountId, canEditSettings, defaultCurrency } = useAuth();
  const { locale } = useLocale();
  // Ambiguous numeric dates parse with the account's order (055).
  const accountDateOrder = importDateOrder(locale);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLeads = variant === 'leads';

  // Account option lists + staff roster — the leads variant's coercion
  // targets. Cheap account-scoped reads; unused by the contacts variant.
  const fieldOptions = useLeadFieldOptions();
  const { staff, nameById, avatarById, loading: staffLoading } =
    useAccountStaff();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<RawCsv | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldRef[]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>(isLeads ? 'both' : 'add');
  const [dontOverwriteEmpty, setDontOverwriteEmpty] = useState(true);
  const [compliance, setCompliance] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Leads variant: the editable preview + its bookkeeping.
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState({
    droppedNoPhone: 0,
    dupes: 0,
    invalid: 0,
  });
  const [remaps, setRemaps] = useState<RemapEntry[]>([]);
  const [dateOrder, setDateOrder] = useState<DateOrder>(accountDateOrder);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // Not-yet-redeemed teammate invites — assignee targets for the preview's
  // Fix-values panel (leads variant, admin only). Loaded at preview build.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  // Inline custom-field editor. `createCol` set → creating for that column;
  // `editFieldId` set → editing that existing field. At most one at a time.
  const [createCol, setCreateCol] = useState<number | null>(null);
  const [editFieldId, setEditFieldId] = useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [savingField, setSavingField] = useState(false);

  const targets = useMemo(
    () => (isLeads ? buildLeadTargets(customFields) : buildTargets(customFields)),
    [customFields, isLeads]
  );
  const fieldTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of customFields) map.set(f.id, f.field_type ?? 'text');
    return map;
  }, [customFields]);

  // Load the account's custom fields once the dialog opens so they show up as
  // mapping targets. Cheap, and keeps the wizard self-contained.
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
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

  function reset() {
    setStep(1);
    setFile(null);
    setRaw(null);
    setMapping([]);
    setMode(isLeads ? 'both' : 'add');
    setDontOverwriteEmpty(true);
    setCompliance(false);
    setResult(null);
    setCreateCol(null);
    setEditFieldId(null);
    setPreviewRows(null);
    setPreviewMeta({ droppedNoPhone: 0, dupes: 0, invalid: 0 });
    setRemaps([]);
    setPendingInvites([]);
    setDateOrder(accountDateOrder);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function closeFieldDialog() {
    setCreateCol(null);
    setEditFieldId(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const parsed = parseCsvRaw(text);

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error('No rows found. Ensure the file has a header row and data.');
      setRaw(null);
      setMapping([]);
      return;
    }

    setRaw(parsed);
    setMapping(autoMapColumns(parsed.headers, targets));
  }

  const validation = useMemo(() => validateMapping(mapping), [mapping]);

  // First few non-empty sample values per column, for the mapping table.
  const samples = useMemo(() => {
    if (!raw) return [];
    return raw.headers.map((_, col) => {
      const vals: string[] = [];
      for (const row of raw.rows) {
        const v = row[col]?.trim();
        if (v) vals.push(v);
        if (vals.length >= SAMPLE_LIMIT) break;
      }
      return vals;
    });
  }, [raw]);

  // Columns currently mapped to a date-type custom field whose sample
  // values can't self-disambiguate DD/MM vs MM/DD — they get the chip.
  const ambiguousDateCols = useMemo(() => {
    const set = new Set<number>();
    if (!isLeads || !raw) return set;
    mapping.forEach((key, col) => {
      const id = customFieldId(key);
      if (!id || fieldTypeById.get(id) !== 'date') return;
      if (detectDateOrder(columnValues(raw, col)) === 'ambiguous') set.add(col);
    });
    return set;
  }, [isLeads, raw, mapping, fieldTypeById]);

  // The order actually used at parse time: hard evidence in the data wins;
  // the user's chip choice only decides genuinely ambiguous files.
  const effectiveDateOrder = useMemo<DateOrder>(() => {
    if (!raw) return dateOrder;
    const vals: string[] = [];
    mapping.forEach((key, col) => {
      const id = customFieldId(key);
      if (id && fieldTypeById.get(id) === 'date')
        vals.push(...columnValues(raw, col));
    });
    const detected = detectDateOrder(vals);
    return detected === 'ambiguous' ? dateOrder : detected;
  }, [raw, mapping, fieldTypeById, dateOrder]);

  const mappedPreview = useMemo(() => {
    if (!raw)
      return {
        rows: [] as MappedRow[],
        droppedNoPhone: 0,
        invalidCustomValues: 0,
      };
    return applyMapping(raw, mapping, fieldTypeById);
  }, [raw, mapping, fieldTypeById]);

  const mappedKeys = useMemo(
    () => new Set(mapping.filter((k) => k !== IGNORE_KEY)),
    [mapping]
  );

  function setColumn(col: number, key: string) {
    setMapping((prev) => {
      const next = [...prev];
      next[col] = key;
      return next;
    });
  }

  function handleAutoMap() {
    if (!raw) return;
    setMapping(autoMapColumns(raw.headers, targets));
  }

  function handleReset() {
    if (!raw) return;
    setMapping(raw.headers.map(() => IGNORE_KEY));
  }

  function requestCreateField(col: number) {
    setEditFieldId(null);
    setCreateCol(col);
    if (isLeads) {
      // Scan the column and prefill label + type (HubSpot's "scanning
      // column data" with plain heuristics — see import-coerce).
      const detected = detectFieldType(
        raw?.headers[col] ?? '',
        columnValues(raw, col)
      );
      setNewFieldName(detected.label);
      setNewFieldType(detected.type);
    } else {
      setNewFieldName(raw?.headers[col]?.trim() ?? '');
      setNewFieldType('text');
    }
  }

  function requestEditField(fieldId: string) {
    const field = customFields.find((f) => f.id === fieldId);
    if (!field) return;
    setCreateCol(null);
    setEditFieldId(fieldId);
    setNewFieldName(field.field_name);
    setNewFieldType(field.field_type ?? 'text');
  }

  async function handleSaveField() {
    const name = newFieldName.trim();
    const isEdit = editFieldId !== null;
    if (!name || (!isEdit && createCol === null)) return;
    if (!accountId || !user) {
      toast.error('Your profile is not linked to an account.');
      return;
    }

    const lower = name.toLowerCase();
    const clash =
      RESERVED_FIELD_NAMES.includes(lower) ||
      customFields.some(
        (f) => f.id !== editFieldId && f.field_name.trim().toLowerCase() === lower
      );
    if (clash) {
      toast.error(`A field named "${name}" already exists.`);
      return;
    }

    setSavingField(true);

    if (isEdit) {
      const { data, error } = await supabase
        .from('custom_fields')
        .update({ field_name: name, field_type: newFieldType })
        .eq('id', editFieldId)
        .select('id, field_name, field_type')
        .single();
      setSavingField(false);
      if (error || !data) {
        toast.error('Could not update field. You may not have permission.');
        return;
      }
      const updated = data as CustomFieldRef;
      setCustomFields((prev) =>
        prev.map((f) => (f.id === updated.id ? updated : f))
      );
      toast.success(`Updated "${updated.field_name}".`);
      setEditFieldId(null);
      return;
    }

    const { data, error } = await supabase
      .from('custom_fields')
      .insert({
        field_name: name,
        field_type: newFieldType,
        user_id: user.id,
        account_id: accountId,
      })
      .select('id, field_name, field_type')
      .single();
    setSavingField(false);

    if (error || !data) {
      toast.error('Could not create field. You may not have permission.');
      return;
    }

    const created = data as CustomFieldRef;
    setCustomFields((prev) => [...prev, created]);
    if (createCol !== null) setColumn(createCol, `custom:${created.id}`);
    toast.success(`Created "${created.field_name}".`);
    setCreateCol(null);
  }

  async function handleDeleteField(fieldId: string) {
    const field = customFields.find((f) => f.id === fieldId);
    if (!field) return;
    if (
      !window.confirm(
        `Delete "${field.field_name}"? This removes its stored value on every contact and cannot be undone.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', fieldId);
    if (error) {
      toast.error('Could not delete field. You may not have permission.');
      return;
    }

    setCustomFields((prev) => prev.filter((f) => f.id !== fieldId));
    // Unmap any column that pointed at the deleted field.
    const key = `custom:${fieldId}`;
    setMapping((prev) => prev.map((k) => (k === key ? IGNORE_KEY : k)));
    toast.success(`Deleted "${field.field_name}".`);
  }

  /** Leads: structure + dedupe + coerce, then land on the Preview step. */
  async function buildPreview() {
    if (!raw || !accountId) return;
    setLoadingPreview(true);
    try {
      const {
        rows: mappedAll,
        droppedNoPhone,
        invalidCustomValues,
      } = applyMapping(raw, mapping, fieldTypeById, effectiveDateOrder);
      const { unique, duplicates } = dedupeByPhone(mappedAll);

      // Label rows that already exist (the UPDATE flag). One read of the
      // generated phone_normalized column — same lookup the commit uses.
      const { data } = await supabase
        .from('contacts')
        .select('phone_normalized')
        .eq('account_id', accountId);
      const existingKeys = new Set<string>();
      for (const r of data ?? []) {
        const k = (r as { phone_normalized: string | null }).phone_normalized;
        if (k) existingKeys.add(k);
      }

      setPreviewRows(
        buildPreviewRows({
          rows: unique,
          statusOptions: fieldOptions.statuses,
          sourceOptions: fieldOptions.sources,
          genderOptions: fieldOptions.genders,
          staff,
          existingKeys,
        })
      );
      setPreviewMeta({
        droppedNoPhone,
        dupes: duplicates,
        invalid: invalidCustomValues,
      });
      setRemaps([]);

      // Existing pending invites → assignee targets (admin only; the
      // endpoint is admin-gated, so a 403 for agents just yields []).
      if (canEditSettings) {
        try {
          const res = await fetch('/api/account/invitations');
          if (res.ok) {
            const body = (await res.json()) as {
              invitations?: {
                id: string;
                full_name?: string | null;
                label?: string | null;
              }[];
            };
            setPendingInvites(
              (body.invitations ?? [])
                .map((i) => ({
                  id: i.id,
                  name: (i.full_name || i.label || '').trim(),
                }))
                .filter((i) => i.name)
            );
          }
        } catch {
          // Non-fatal — the panel just won't offer existing invites.
        }
      }

      setStep(3);
    } catch {
      toast.error('Could not prepare the preview. Please try again.');
    } finally {
      setLoadingPreview(false);
    }
  }

  function recordRemap(fix: RemapEntry) {
    setRemaps((prev) => [...prev, fix]);
  }

  /**
   * Create — or reuse — a pending teammate invite for `name`. Dedups
   * against already-loaded pending invites (case-insensitive) so a
   * repeat import doesn't mint a second "Rahul". Admin only (endpoint
   * enforces it too). Returns the invite, or null on failure.
   */
  async function createTeammate(name: string): Promise<PendingInvite | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = pendingInvites.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing;
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'agent',
          full_name: trimmed,
          label: trimmed,
        }),
      });
      if (!res.ok) {
        toast.error('Could not create teammate. You may not have permission.');
        return null;
      }
      const body = (await res.json()) as { invitation?: { id: string } };
      if (!body.invitation?.id) return null;
      const invite: PendingInvite = { id: body.invitation.id, name: trimmed };
      setPendingInvites((prev) => [...prev, invite]);
      toast.success(`Invite created for "${trimmed}" — share the link later from Settings → Team.`);
      return invite;
    } catch {
      toast.error('Could not create teammate.');
      return null;
    }
  }

  // ---- Contacts commit (unchanged behaviour) ------------------------------

  async function handleImport() {
    if (!raw) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      // Structure rows via the chosen mapping, then de-dupe within the file.
      const {
        rows: mappedAll,
        droppedNoPhone,
        invalidCustomValues,
      } = applyMapping(raw, mapping, fieldTypeById);
      skipped += droppedNoPhone;
      const { unique, duplicates } = dedupeByPhone(mappedAll);
      skipped += duplicates;

      // One read of the generated phone_normalized column → id lookup for
      // matching existing contacts (update/both) or skipping them (add).
      const { data: existingRows } = await supabase
        .from('contacts')
        .select('id, phone_normalized')
        .eq('account_id', accountId);
      const idByKey = new Map<string, string>();
      for (const r of existingRows ?? []) {
        const row = r as { id: string; phone_normalized: string | null };
        if (row.phone_normalized) idByKey.set(row.phone_normalized, row.id);
      }

      const toInsert: MappedRow[] = [];
      const toUpdate: { row: MappedRow; id: string }[] = [];
      for (const row of unique) {
        const existingId = idByKey.get(normalizeKey(row.phone));
        if (existingId) {
          if (mode === 'add') {
            skipped++;
            continue;
          }
          toUpdate.push({ row, id: existingId });
        } else {
          if (mode === 'update') {
            skipped++;
            continue;
          }
          toInsert.push(row);
        }
      }

      // Resolve tag names → ids once for every row we're about to write.
      const writeRows = [...toInsert, ...toUpdate.map((u) => u.row)];
      const allTagNames = writeRows.flatMap((r) => r.tagNames);
      let tagIdByKey = new Map<string, string>();
      let skippedNames: string[] = [];
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
          accountId,
          userId: user.id,
          tagNames: allTagNames,
          canCreateTags: canEditSettings,
        }));
      }

      const tagAssignments: ContactTagAssignment[] = [];
      const customValueRows: {
        contact_id: string;
        custom_field_id: string;
        value: string;
      }[] = [];

      function recordWritten(contactId: string, row: MappedRow) {
        if (row.tagNames.length > 0) {
          tagAssignments.push({ contactId, tagNames: row.tagNames });
        }
        for (const cv of row.customValues) {
          customValueRows.push({
            contact_id: contactId,
            custom_field_id: cv.fieldId,
            value: cv.value,
          });
        }
      }

      // INSERT new contacts in chunks; fall back to per-row on chunk error so
      // one bad/duplicate row doesn't sink the batch (mirrors the DB unique
      // index as backstop — 23505 counts as skipped, not failed).
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        const payload = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
          // Imported leads default to the importer as owner (PRD:
          // every new lead has an owner) — bulk-reassign later.
          assigned_to: user.id,
          // Origin (migration 048): bulk CSV import — a human action, so
          // the "Received By" column shows the importer.
          received_via: 'import' as const,
        }));

        const { data, error } = await supabase
          .from('contacts')
          .insert(payload)
          .select('id');

        if (error) {
          for (let j = 0; j < payload.length; j++) {
            const { data: single, error: singleErr } = await supabase
              .from('contacts')
              .insert(payload[j])
              .select('id')
              .single();
            if (!singleErr && single) {
              imported++;
              recordWritten(single.id, chunk[j]);
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              failed++;
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          // inserted[j] ↔ chunk[j] holds: a single INSERT preserves
          // RETURNING order.
          for (let j = 0; j < inserted.length; j++) {
            if (chunk[j]) recordWritten(inserted[j].id, chunk[j]);
          }
        }
      }

      // UPDATE existing contacts one at a time (each row patches different
      // values). Empty source cells are skipped unless the user opted to let
      // blanks overwrite.
      for (const { row, id } of toUpdate) {
        const patch: Record<string, string | null> = {};
        const setField = (key: 'name' | 'email' | 'company', value?: string) => {
          if (value && value.trim()) patch[key] = value;
          else if (!dontOverwriteEmpty) patch[key] = null;
        };
        setField('name', row.name);
        setField('email', row.email);
        setField('company', row.company);

        if (Object.keys(patch).length > 0) {
          const { error } = await supabase
            .from('contacts')
            .update(patch)
            .eq('id', id)
            .eq('account_id', accountId);
          if (error) {
            failed++;
            continue;
          }
        }
        updated++;
        recordWritten(id, row);
      }

      // Upsert custom field values (unique on contact_id,custom_field_id).
      let customValues = 0;
      for (let i = 0; i < customValueRows.length; i += CUSTOM_VALUE_CHUNK) {
        const chunk = customValueRows.slice(i, i + CUSTOM_VALUE_CHUNK);
        const { error } = await supabase
          .from('contact_custom_values')
          .upsert(chunk, { onConflict: 'contact_id,custom_field_id' });
        if (!error) customValues += chunk.length;
      }

      // Wire tags onto written contacts. A failure here must not mask a
      // successful contact import.
      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(
          supabase,
          tagAssignments,
          tagIdByKey
        );
      } catch {
        toast.warning('Contacts imported, but some tag assignments failed.');
      }

      setResult({
        imported,
        updated,
        skipped,
        failed,
        tagsAssigned,
        customValues,
        invalidValues: invalidCustomValues,
        remapped: 0,
      });
      setStep(3);

      if (imported > 0 || updated > 0) onImported();
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more =
          skippedNames.length > 3 ? ` (+${skippedNames.length - 3} more)` : '';
        toast.info(`Unknown tags skipped: ${sample}${more}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed';
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  // ---- Leads commit — consumes the EDITED preview rows ---------------------

  async function handleLeadImport() {
    if (!previewRows) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authUser = session?.user;
      if (!authUser) throw new Error('Not authenticated');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      let imported = 0;
      let updated = 0;
      let skipped = previewMeta.droppedNoPhone + previewMeta.dupes;
      let failed = 0;

      // Fresh id lookup at commit time (preview edits may have changed
      // phones; the preview's `exists` flag is display-only).
      const { data: existingRows } = await supabase
        .from('contacts')
        .select('id, phone_normalized')
        .eq('account_id', accountId);
      const idByKey = new Map<string, string>();
      for (const r of existingRows ?? []) {
        const row = r as { id: string; phone_normalized: string | null };
        if (row.phone_normalized) idByKey.set(row.phone_normalized, row.id);
      }

      const hasStatus = mappedKeys.has('lead_status');
      const hasSource = mappedKeys.has('source');
      const hasGender = mappedKeys.has('gender');

      /** lead_status column value for a resolved key ('new' = NULL bucket). */
      const statusValue = (key: string | null) =>
        key && key !== 'new' ? key : null;

      const toInsert: PreviewRow[] = [];
      const toUpdate: { row: PreviewRow; id: string }[] = [];
      for (const row of previewRows) {
        const existingId = idByKey.get(normalizeKey(row.base.phone));
        if (existingId) {
          if (mode === 'add') {
            skipped++;
            continue;
          }
          toUpdate.push({ row, id: existingId });
        } else {
          if (mode === 'update') {
            skipped++;
            continue;
          }
          toInsert.push(row);
        }
      }

      // Resolve tag names → ids once for every row we're about to write.
      const writeRows = [...toInsert, ...toUpdate.map((u) => u.row)];
      const allTagNames = writeRows.flatMap((r) => r.base.tagNames);
      let tagIdByKey = new Map<string, string>();
      let skippedNames: string[] = [];
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames } = await resolveImportTagIds(supabase, {
          accountId,
          userId: authUser.id,
          tagNames: allTagNames,
          canCreateTags: canEditSettings,
        }));
      }

      const tagAssignments: ContactTagAssignment[] = [];
      const customValueRows: {
        contact_id: string;
        custom_field_id: string;
        value: string;
      }[] = [];

      function recordWritten(contactId: string, row: MappedRow) {
        if (row.tagNames.length > 0) {
          tagAssignments.push({ contactId, tagNames: row.tagNames });
        }
        for (const cv of row.customValues) {
          customValueRows.push({
            contact_id: contactId,
            custom_field_id: cv.fieldId,
            value: cv.value,
          });
        }
      }

      // INSERT new leads in chunks with the same per-row fallback as the
      // contacts path; the payload adds the resolved lead fields.
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        const payload = chunk.map((row) => ({
          user_id: authUser.id,
          account_id: accountId,
          phone: row.base.phone,
          name: row.base.name || null,
          email: row.base.email || null,
          company: row.base.company || null,
          // A mapped Assigned-to cell overrides the importer-as-owner
          // default; unmatched/empty cells fall back to the importer.
          // A pending-invite owner keeps the importer in assigned_to (the
          // fallback) and parks the real assignment on pending_invitation_id.
          assigned_to: row.assignedTo ?? authUser.id,
          pending_invitation_id: row.pendingInvitationId ?? null,
          pending_assignee_name: row.pendingAssigneeName ?? null,
          received_via: 'import' as const,
          ...(hasStatus ? { lead_status: statusValue(row.leadStatus) } : {}),
          ...(hasSource ? { source: row.source } : {}),
          ...(hasGender ? { gender: row.gender } : {}),
        }));

        const { data, error } = await supabase
          .from('contacts')
          .insert(payload)
          .select('id');

        if (error) {
          for (let j = 0; j < payload.length; j++) {
            const { data: single, error: singleErr } = await supabase
              .from('contacts')
              .insert(payload[j])
              .select('id')
              .single();
            if (!singleErr && single) {
              imported++;
              recordWritten(single.id, chunk[j].base);
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              failed++;
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          for (let j = 0; j < inserted.length; j++) {
            if (chunk[j]) recordWritten(inserted[j].id, chunk[j].base);
          }
        }
      }

      // UPDATE existing leads. Lead fields follow the same blank policy as
      // the standard fields; ownership is never cleared by an import.
      for (const { row, id } of toUpdate) {
        const patch: Record<string, string | null> = {};
        const setField = (key: 'name' | 'email' | 'company', value?: string) => {
          if (value && value.trim()) patch[key] = value;
          else if (!dontOverwriteEmpty) patch[key] = null;
        };
        setField('name', row.base.name);
        setField('email', row.base.email);
        setField('company', row.base.company);

        if (hasStatus) {
          if (row.leadStatus) patch.lead_status = statusValue(row.leadStatus);
          else if (!dontOverwriteEmpty) patch.lead_status = null;
        }
        if (hasSource) {
          if (row.source) patch.source = row.source;
          else if (!dontOverwriteEmpty) patch.source = null;
        }
        if (hasGender) {
          if (row.gender) patch.gender = row.gender;
          else if (!dontOverwriteEmpty) patch.gender = null;
        }
        // Ownership: a real assignee wins; a pending-invite parks the
        // assignment (importer stays the fallback in assigned_to). Only
        // touch assigned_to when we actually resolved someone, so an
        // un-mapped assignee never clears an existing owner.
        if (row.pendingInvitationId) {
          patch.pending_invitation_id = row.pendingInvitationId;
          patch.pending_assignee_name = row.pendingAssigneeName ?? null;
        } else if (row.assignedTo) {
          patch.assigned_to = row.assignedTo;
          patch.pending_invitation_id = null;
          patch.pending_assignee_name = null;
        }

        if (Object.keys(patch).length > 0) {
          const { error } = await supabase
            .from('contacts')
            .update(patch)
            .eq('id', id)
            .eq('account_id', accountId);
          if (error) {
            failed++;
            continue;
          }
        }
        updated++;
        recordWritten(id, row.base);
      }

      // Upsert custom field values (unique on contact_id,custom_field_id).
      let customValues = 0;
      for (let i = 0; i < customValueRows.length; i += CUSTOM_VALUE_CHUNK) {
        const chunk = customValueRows.slice(i, i + CUSTOM_VALUE_CHUNK);
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
        toast.warning('Leads imported, but some tag assignments failed.');
      }

      setResult({
        imported,
        updated,
        skipped,
        failed,
        tagsAssigned,
        customValues,
        invalidValues: previewMeta.invalid,
        remapped: remaps.reduce((n, r) => n + r.count, 0),
      });

      if (imported > 0 || updated > 0) onImported();
      if (skippedNames.length > 0) {
        const sample = skippedNames.slice(0, 3).join(', ');
        const more =
          skippedNames.length > 3 ? ` (+${skippedNames.length - 3} more)` : '';
        toast.info(`Unknown tags skipped: ${sample}${more}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed';
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const canProceedFromUpload = !!raw && raw.rows.length > 0;
  const canImport = validation.ok && compliance && !importing;

  // Leads: rows the current write policy will actually process.
  const leadWriteCount = useMemo(() => {
    if (!previewRows) return 0;
    if (mode === 'both') return previewRows.length;
    const existing = previewRows.filter((r) => r.exists).length;
    return mode === 'update' ? existing : previewRows.length - existing;
  }, [previewRows, mode]);

  const stepLabels = isLeads
    ? ['Upload', 'Map columns', 'Preview & edit', 'Confirm']
    : ['Upload', 'Map Fields', 'Review'];

  const description = (() => {
    if (result) return 'Import complete.';
    if (step === 1)
      return isLeads
        ? 'Upload a CSV of leads to begin.'
        : 'Upload a CSV of contacts to begin.';
    if (step === 2)
      return isLeads
        ? 'Map your file columns to lead fields.'
        : 'Map your file columns to contact fields.';
    if (step === 3)
      return isLeads
        ? 'Check and edit the leads exactly as they will appear.'
        : 'Review and confirm the import.';
    return 'Choose the write policy and confirm.';
  })();

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[min(92vh,760px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground',
          isLeads ? 'sm:max-w-[1200px]' : 'sm:max-w-3xl'
        )}
      >
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle size="lg" className="text-popover-foreground">
              {isLeads ? 'Import Leads' : 'Import Contacts'}
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground">
              {description}
            </DialogDescription>
          </DialogHeader>

          <StepIndicator step={result ? stepLabels.length : step} labels={stepLabels} />
        </div>

        {/* The Preview step owns its own scroll (the grid fills the height
            and scrolls x/y), so the body must NOT vertically scroll there —
            else the horizontal scrollbar ends up below the fold. Every other
            step keeps the normal vertical scroll. */}
        <div
          className={cn(
            'min-h-0 flex-1 px-6 py-5',
            isLeads && !result && step === 3
              ? 'flex flex-col overflow-hidden'
              : 'overflow-y-auto'
          )}
        >
          {result ? (
            isLeads ? (
              <LeadsResultPanel result={result} remaps={remaps} fieldOptions={fieldOptions} nameById={nameById} />
            ) : (
              <ContactsResultPanel result={result} />
            )
          ) : (
            // Crossfade between wizard steps. Opacity-only (no transform) so
            // step 3's sticky-header preview grid is unaffected; `mode="wait"`
            // keeps a single step mounted at a time.
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.13, ease: 'easeOut' }}
                className={cn(
                  'min-h-0',
                  step === 3 && isLeads && 'flex flex-1 flex-col'
                )}
              >
              {step === 1 && (
                <UploadStep
                  file={file}
                  raw={raw}
                  isLeads={isLeads}
                  fileInputRef={fileInputRef}
                  onFileChange={handleFileChange}
                />
              )}

              {step === 2 && raw && (
                <MapStep
                  raw={raw}
                  targets={targets}
                  mapping={mapping}
                  samples={samples}
                  showMode={!isLeads}
                  variant={variant}
                  mode={mode}
                  dontOverwriteEmpty={dontOverwriteEmpty}
                  canCreateFields={canEditSettings}
                  ambiguousDateCols={ambiguousDateCols}
                  dateOrder={dateOrder}
                  onToggleDateOrder={() =>
                    setDateOrder((o) => (o === 'DMY' ? 'MDY' : 'DMY'))
                  }
                  onSetColumn={setColumn}
                  onSetMode={setMode}
                  onSetDontOverwriteEmpty={setDontOverwriteEmpty}
                  onAutoMap={handleAutoMap}
                  onReset={handleReset}
                  onRequestCreateField={requestCreateField}
                  onRequestEditField={requestEditField}
                  onDeleteField={handleDeleteField}
                />
              )}

              {step === 3 && !isLeads && (
                <ReviewStep
                  mode={mode}
                  variant={variant}
                  mappedPreview={mappedPreview}
                  compliance={compliance}
                  onSetCompliance={setCompliance}
                />
              )}

              {step === 3 && isLeads && previewRows && (
                <ImportPreviewGrid
                  rows={previewRows}
                  onRowsChange={setPreviewRows}
                  onRemapLogged={recordRemap}
                  mappedKeys={mappedKeys}
                  customFields={customFields}
                  fieldOptions={fieldOptions}
                  staff={staff}
                  nameById={nameById}
                  avatarById={avatarById}
                  pendingInvites={pendingInvites}
                  canCreateTeammate={canEditSettings}
                  onCreateTeammate={createTeammate}
                  defaultCurrency={defaultCurrency}
                  dateOrder={effectiveDateOrder}
                  skippedNoPhone={previewMeta.droppedNoPhone}
                  skippedDupes={previewMeta.dupes}
                />
              )}

              {step === 4 && isLeads && previewRows && (
                <ConfirmStep
                  rows={previewRows}
                  meta={previewMeta}
                  mode={mode}
                  onSetMode={setMode}
                  dontOverwriteEmpty={dontOverwriteEmpty}
                  onSetDontOverwriteEmpty={setDontOverwriteEmpty}
                  compliance={compliance}
                  onSetCompliance={setCompliance}
                  remaps={remaps}
                  fieldOptions={fieldOptions}
                  nameById={nameById}
                />
              )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 mt-0 shrink-0 items-center gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-between">
          {/* Left slot: step-1 sample link, and — dedicated — the mapping
              step's validation errors. Pinned here on the sticky footer so a
              required-field error can't scroll out of sight behind the
              mapping table. */}
          <div className="min-w-0 flex-1">
            {step === 1 && !result && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => downloadTemplate(variant)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="size-4" />
                Sample CSV
              </Button>
            )}
            {step === 2 && !result && !validation.ok && (
              <div className="flex flex-col gap-0.5">
                {!validation.phoneMapped && (
                  <p className="flex items-center gap-1.5 text-xs text-red-foreground">
                    <XCircle className="size-3.5 shrink-0" />
                    Map one column to{' '}
                    <span className="font-medium">Phone</span> to continue —
                    it&apos;s required.
                  </p>
                )}
                {validation.duplicateTargets.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-red-foreground">
                    <XCircle className="size-3.5 shrink-0" />
                    Each field can be mapped once. Duplicated:{' '}
                    {validation.duplicateTargets
                      .map((k) => customFieldId(k) ?? k)
                      .join(', ')}
                    .
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {result ? (
              <Button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    step === 1
                      ? handleOpenChange(false)
                      : setStep((s) => (s - 1) as 1 | 2 | 3)
                  }
                  className="border-border text-muted-foreground hover:bg-muted"
                >
                  {step === 1 ? 'Cancel' : 'Back'}
                </Button>

                {step === 1 && (
                  <Button
                    type="button"
                    disabled={!canProceedFromUpload}
                    onClick={() => setStep(2)}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Next
                  </Button>
                )}
                {step === 2 &&
                  (isLeads ? (
                    <Button
                      type="button"
                      // Gate on staff + option lists being loaded — coercion
                      // reads them, and building the preview with an empty
                      // roster would false-flag every mapped assignee.
                      disabled={
                        !validation.ok ||
                        loadingPreview ||
                        staffLoading ||
                        fieldOptions.loading
                      }
                      onClick={buildPreview}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {(loadingPreview || staffLoading) && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      Preview {raw?.rows.length ?? 0} row
                      {raw?.rows.length !== 1 ? 's' : ''}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={!validation.ok}
                      onClick={() => setStep(3)}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      Next
                    </Button>
                  ))}
                {step === 3 && isLeads && (
                  <Button
                    type="button"
                    onClick={() => setStep(4)}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Next: Confirm
                  </Button>
                )}
                {step === 3 && !isLeads && (
                  <Button
                    type="button"
                    disabled={!canImport}
                    onClick={handleImport}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {importing && <Loader2 className="size-4 animate-spin" />}
                    Import {mappedPreview.rows.length} contact
                    {mappedPreview.rows.length !== 1 ? 's' : ''}
                  </Button>
                )}
                {step === 4 && isLeads && (
                  <Button
                    type="button"
                    disabled={!compliance || importing || leadWriteCount === 0}
                    onClick={handleLeadImport}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {importing && <Loader2 className="size-4 animate-spin" />}
                    Import {leadWriteCount} lead
                    {leadWriteCount !== 1 ? 's' : ''}
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={createCol !== null || editFieldId !== null}
      onOpenChange={(o) => !o && closeFieldDialog()}
    >
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {editFieldId !== null ? 'Edit custom field' : 'Create custom field'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {editFieldId !== null
              ? 'Rename or change the type. Existing stored values are not re-validated.'
              : 'Adds a new field to every contact, then maps this column to it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Field name</Label>
            <Input
              value={newFieldName}
              autoFocus
              onChange={(e) => setNewFieldName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !savingField) {
                  e.preventDefault();
                  void handleSaveField();
                }
              }}
              placeholder="e.g. Lead Source"
              className="text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Data type</Label>
            <Select
              value={newFieldType}
              onValueChange={(v) => v && setNewFieldType(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {isLeads && createCol !== null
                ? 'Name and type were suggested by scanning this column — adjust if wrong.'
                : 'Values import as text today; the type is saved for validation and formatting.'}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={closeFieldDialog}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!newFieldName.trim() || savingField}
            onClick={handleSaveField}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {savingField && <Loader2 className="size-4 animate-spin" />}
            {editFieldId !== null ? 'Save changes' : 'Create & map'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
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
              {done ? <CheckCircle className="size-3.5" /> : n}
            </div>
            <span
              className={cn(
                'text-xs font-medium whitespace-nowrap',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <span className="mx-1 h-px flex-1 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function UploadStep({
  file,
  raw,
  isLeads,
  fileInputRef,
  onFileChange,
}: {
  file: File | null;
  raw: RawCsv | null;
  isLeads: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 transition-all',
          file
            ? 'border-primary/35 bg-primary/[0.04]'
            : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
        )}
      >
        {file ? (
          <>
            <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
              <FileText className="text-primary-text size-5" />
            </div>
            <p
              className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
              title={file.name}
            >
              {truncateFilename(file.name)}
            </p>
            <Badge variant="neutral" className="px-2.5 text-[11px]">
              {raw?.rows.length ?? 0} row{raw?.rows.length !== 1 ? 's' : ''} ·{' '}
              {raw?.headers.length ?? 0} column
              {raw?.headers.length !== 1 ? 's' : ''}
            </Badge>
          </>
        ) : (
          <>
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
              <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Click to choose a CSV file
            </p>
            <p className="text-[11px] text-muted-foreground">
              Any column layout — you&apos;ll map fields next
            </p>
          </>
        )}
      </div>

      {isLeads && (
        <p className="text-center text-xs text-muted-foreground">
          Exported from Excel or Google Sheets? Use{' '}
          <span className="font-medium text-foreground">
            File → Save as → .csv
          </span>{' '}
          first — only CSV files are supported.
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}

function MapStep({
  raw,
  targets,
  mapping,
  samples,
  showMode,
  variant,
  mode,
  dontOverwriteEmpty,
  canCreateFields,
  ambiguousDateCols,
  dateOrder,
  onToggleDateOrder,
  onSetColumn,
  onSetMode,
  onSetDontOverwriteEmpty,
  onAutoMap,
  onReset,
  onRequestCreateField,
  onRequestEditField,
  onDeleteField,
}: {
  raw: RawCsv;
  targets: TargetField[];
  mapping: string[];
  samples: string[][];
  /** Contacts keeps the mode radio here; leads moves it to Confirm. */
  showMode: boolean;
  variant: ImportVariant;
  mode: ImportMode;
  dontOverwriteEmpty: boolean;
  canCreateFields: boolean;
  /** Columns mapped to a date field whose samples can't self-disambiguate. */
  ambiguousDateCols: Set<number>;
  dateOrder: DateOrder;
  onToggleDateOrder: () => void;
  onSetColumn: (col: number, key: string) => void;
  onSetMode: (mode: ImportMode) => void;
  onSetDontOverwriteEmpty: (v: boolean) => void;
  onAutoMap: () => void;
  onReset: () => void;
  onRequestCreateField: (col: number) => void;
  onRequestEditField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
}) {
  const showEmptyToggle = mode === 'update' || mode === 'both';
  const modeLabels = MODE_LABELS[variant];

  const targetByKey = useMemo(() => {
    const map = new Map<string, TargetField>();
    targets.forEach((t) => map.set(t.key, t));
    return map;
  }, [targets]);

  const mappedCount = mapping.filter((k) => k !== IGNORE_KEY).length;
  const unmappedCount = mapping.length - mappedCount;

  // Grouped, searchable picker — "Don't import" first, then the field
  // groups, custom fields last with their data type as a hint.
  const comboGroups = useMemo<ComboboxGroup[]>(() => {
    const groups: ComboboxGroup[] = [
      { options: [{ value: IGNORE_KEY, label: "Don't import" }] },
      {
        label: 'Standard',
        options: targets
          .filter((t) => t.kind === 'standard')
          .map((t) => ({
            value: t.key,
            label: t.label,
            hint: t.required ? 'required' : undefined,
          })),
      },
    ];
    const leadFields = targets.filter(
      (t) => t.kind === 'option' || t.kind === 'assignee'
    );
    if (leadFields.length > 0) {
      groups.push({
        label: 'Lead fields',
        options: leadFields.map((t) => ({ value: t.key, label: t.label })),
      });
    }
    groups.push({
      label: 'Tags',
      options: targets
        .filter((t) => t.kind === 'tags')
        .map((t) => ({ value: t.key, label: t.label })),
    });
    const custom = targets.filter((t) => t.kind === 'custom');
    if (custom.length > 0) {
      groups.push({
        label: 'Custom fields',
        options: custom.map((t) => ({ value: t.key, label: t.label })),
      });
    }
    return groups;
  }, [targets]);

  return (
    <div className="space-y-5">
      {/* Action mode — contacts variant only; leads decides at Confirm. */}
      {showMode && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            How to process rows
          </p>
          <RadioGroup
            value={mode}
            onValueChange={(v) => v && onSetMode(v as ImportMode)}
            className="gap-2"
          >
            {(Object.keys(modeLabels) as ImportMode[]).map((key) => (
              <label
                key={key}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  mode === key
                    ? 'border-primary/40 bg-primary/[0.04]'
                    : 'border-border/80 hover:border-border-hover'
                )}
              >
                <RadioGroupItem value={key} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-foreground">
                    {modeLabels[key].title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {modeLabels[key].hint}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>

          {showEmptyToggle && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-background/40 px-3 py-2.5">
              <span className="text-sm text-foreground">
                Don&apos;t overwrite existing values with empty cells
              </span>
              <Switch
                checked={dontOverwriteEmpty}
                onCheckedChange={(v) => onSetDontOverwriteEmpty(!!v)}
              />
            </label>
          )}

          {mode !== 'add' && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-foreground">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              Updates applied via import cannot be undone.
            </p>
          )}
        </div>
      )}

      {/* Mapping table */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Column mapping
          </p>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAutoMap}
              className="h-7 border-border text-muted-foreground hover:bg-muted"
            >
              <Wand2 className="size-3.5" />
              Auto map
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReset}
              className="h-7 border-border text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
          <div className="overflow-x-auto">
            {/* table-fixed: column widths come from these <th>s, NOT cell
                content — so the phone note / date chip appearing can grow the
                row's height but never shift column widths. */}
            <table className="w-full min-w-[38rem] table-fixed text-xs">
              <thead>
                <tr className="border-b border-border bg-background/60">
                  <th className="w-[18%] px-3 py-2 text-left font-medium text-muted-foreground">
                    File column
                  </th>
                  <th className="w-[24%] px-3 py-2 text-left font-medium text-muted-foreground">
                    Sample data
                  </th>
                  <th className="w-[42%] px-3 py-2 text-left font-medium text-muted-foreground">
                    {variant === 'leads' ? 'Lead field' : 'Contact field'}
                  </th>
                  <th className="w-[16%] px-3 py-2 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {raw.headers.map((header, col) => {
                  const key = mapping[col] ?? IGNORE_KEY;
                  const isMapped = key !== IGNORE_KEY;
                  const cfId = customFieldId(key);
                  return (
                    <tr key={col} className="bg-popover/40">
                      <td className="max-w-[10rem] truncate px-3 py-2 font-medium text-foreground">
                        {header || (
                          <span className="text-muted-foreground italic">
                            (unnamed)
                          </span>
                        )}
                      </td>
                      <td className="max-w-[12rem] px-3 py-2 text-muted-foreground">
                        <span className="block truncate font-mono text-[11px]">
                          {samples[col]?.join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Combobox
                            groups={comboGroups}
                            value={key}
                            onSelect={(v) => onSetColumn(col, v)}
                            searchPlaceholder="Search fields…"
                            footer={
                              canCreateFields
                                ? {
                                    label: 'Create new field…',
                                    onSelect: () => onRequestCreateField(col),
                                  }
                                : null
                            }
                            className={cn(
                              'min-w-[11rem] text-xs',
                              !isMapped && 'text-muted-foreground'
                            )}
                            contentClassName="w-60"
                          >
                            <span
                              className={cn(
                                'truncate',
                                !isMapped && 'text-muted-foreground'
                              )}
                            >
                              {isMapped
                                ? (targetByKey.get(key)?.label ?? key)
                                : "Don't import"}
                            </span>
                          </Combobox>

                          {cfId && canCreateFields && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                title="Edit field"
                                onClick={() => onRequestEditField(cfId)}
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="destructive-ghost"
                                size="icon-sm"
                                title="Delete field"
                                onClick={() => onDeleteField(cfId)}
                                className="shrink-0"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>

                        {key === 'phone' && (
                          <p className="mt-1 max-w-[24rem] text-[10px] leading-snug text-muted-foreground">
                            Leads are matched by phone — duplicates in your
                            file and existing records are handled
                            automatically.
                          </p>
                        )}

                        {ambiguousDateCols.has(col) && (
                          <button
                            type="button"
                            onClick={onToggleDateOrder}
                            title="Toggle day/month order"
                            className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary-text hover:bg-primary/20"
                          >
                            {dateOrder === 'DMY' ? 'DD/MM' : 'MM/DD'} ▾
                            <span className="font-sans font-normal text-muted-foreground">
                              {dateOrder === 'DMY'
                                ? '02/07 = 2 July'
                                : '02/07 = Feb 7'}
                            </span>
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isMapped ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-foreground">
                            <CheckCircle className="size-3.5 shrink-0" />
                            Mapped
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-current opacity-50" />
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

        <p className="text-[11px] text-muted-foreground">
          {unmappedCount === 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-foreground">
              <CheckCircle className="size-3" />
              All {mapping.length} columns mapped
            </span>
          ) : (
            <>
              {unmappedCount} column{unmappedCount === 1 ? '' : 's'} won&apos;t
              be imported
            </>
          )}
        </p>

        {/* Validation errors render on the sticky footer (see DialogFooter's
            left slot) so they stay visible above the mapping table's scroll. */}
      </div>
    </div>
  );
}

/** Contacts variant's pre-import review (mode summary + consent). */
function ReviewStep({
  mode,
  variant,
  mappedPreview,
  compliance,
  onSetCompliance,
}: {
  mode: ImportMode;
  variant: ImportVariant;
  mappedPreview: {
    rows: MappedRow[];
    droppedNoPhone: number;
    invalidCustomValues: number;
  };
  compliance: boolean;
  onSetCompliance: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Rows to process: </span>
            <span className="font-medium text-foreground">
              {mappedPreview.rows.length}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Mode: </span>
            <span className="font-medium text-foreground">
              {MODE_LABELS[variant][mode].title}
            </span>
          </div>
          {mappedPreview.droppedNoPhone > 0 && (
            <div>
              <span className="text-muted-foreground">Rows without phone: </span>
              <span className="font-medium text-amber-foreground">
                {mappedPreview.droppedNoPhone} skipped
              </span>
            </div>
          )}
          {mappedPreview.invalidCustomValues > 0 && (
            <div>
              <span className="text-muted-foreground">
                Wrong-format values:{' '}
              </span>
              <span className="font-medium text-amber-foreground">
                {mappedPreview.invalidCustomValues} will be skipped
              </span>
            </div>
          )}
        </div>
      </div>

      <ConsentCheckbox compliance={compliance} onSetCompliance={onSetCompliance} />
    </div>
  );
}

function ConsentCheckbox({
  compliance,
  onSetCompliance,
}: {
  compliance: boolean;
  onSetCompliance: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-background/40 p-4">
      <Checkbox
        checked={compliance}
        onCheckedChange={(v) => onSetCompliance(!!v)}
        className="mt-0.5"
      />
      <span className="text-xs leading-relaxed text-muted-foreground">
        I confirm these contacts have consented to be messaged, or that I have
        a legitimate business interest to contact them, in line with WhatsApp
        and anti-spam policies.
      </span>
    </label>
  );
}

/** Leads Step 4 — write policy + consent + the import receipt. */
/** One remap's resolved target — a status pill, a source/gender label, or
 *  a staff name for assignee fixes. Shared by the Confirm receipt and the
 *  result audit so the two can't drift. */
function RemapTarget({
  entry,
  fieldOptions,
  nameById,
}: {
  entry: RemapEntry;
  fieldOptions: ReturnType<typeof useLeadFieldOptions>;
  nameById: Map<string, string>;
}) {
  if (entry.field === 'status') {
    return <StatusBadge column={fieldOptions.statusFor(entry.key)} />;
  }
  if (entry.field === 'assignee') {
    return (
      <span className="truncate text-foreground">
        {entry.key ? (nameById.get(entry.key) ?? 'Teammate') : 'You (importer)'}
      </span>
    );
  }
  return (
    <span className="truncate text-foreground">
      {entry.field === 'source'
        ? fieldOptions.sourceLabel(entry.key)
        : fieldOptions.genderLabel(entry.key)}
    </span>
  );
}

function ConfirmStep({
  rows,
  meta,
  mode,
  onSetMode,
  dontOverwriteEmpty,
  onSetDontOverwriteEmpty,
  compliance,
  onSetCompliance,
  remaps,
  fieldOptions,
  nameById,
}: {
  rows: PreviewRow[];
  meta: { droppedNoPhone: number; dupes: number; invalid: number };
  mode: ImportMode;
  onSetMode: (mode: ImportMode) => void;
  dontOverwriteEmpty: boolean;
  onSetDontOverwriteEmpty: (v: boolean) => void;
  compliance: boolean;
  onSetCompliance: (v: boolean) => void;
  remaps: RemapEntry[];
  fieldOptions: ReturnType<typeof useLeadFieldOptions>;
  nameById: Map<string, string>;
}) {
  const existing = rows.filter((r) => r.exists).length;
  const fresh = rows.length - existing;
  const modeLabels = MODE_LABELS.leads;
  const showEmptyToggle = mode === 'update' || mode === 'both';

  const receipt: [string, number][] = [
    ['New leads', mode === 'update' ? 0 : fresh],
    ['Updates (matched by phone)', mode === 'add' ? 0 : existing],
    ...(mode === 'add' && existing > 0
      ? ([['Skipped — already exist', existing]] as [string, number][])
      : []),
    ...(mode === 'update' && fresh > 0
      ? ([['Skipped — not found', fresh]] as [string, number][])
      : []),
    ...(meta.droppedNoPhone > 0
      ? ([['Skipped — no phone', meta.droppedNoPhone]] as [string, number][])
      : []),
    ...(meta.dupes > 0
      ? ([['Skipped — duplicate in file', meta.dupes]] as [string, number][])
      : []),
  ];

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_minmax(15rem,0.8fr)]">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          How to process rows
        </p>
        <RadioGroup
          value={mode}
          onValueChange={(v) => v && onSetMode(v as ImportMode)}
          className="gap-2"
        >
          {(Object.keys(modeLabels) as ImportMode[]).map((key) => (
            <label
              key={key}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                mode === key
                  ? 'border-primary/40 bg-primary/[0.04]'
                  : 'border-border/80 hover:border-border-hover'
              )}
            >
              <RadioGroupItem value={key} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-foreground">
                  {modeLabels[key].title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {modeLabels[key].hint}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>

        {showEmptyToggle && (
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-background/40 px-3 py-2.5">
            <span className="text-sm text-foreground">
              Don&apos;t overwrite existing values with empty cells
            </span>
            <Switch
              checked={dontOverwriteEmpty}
              onCheckedChange={(v) => onSetDontOverwriteEmpty(!!v)}
            />
          </label>
        )}

        {mode !== 'add' && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-foreground">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            Updates applied via import cannot be undone.
          </p>
        )}

        <div className="pt-2">
          <ConsentCheckbox
            compliance={compliance}
            onSetCompliance={onSetCompliance}
          />
        </div>
      </div>

      {/* Import receipt — counts + the value-remap audit. */}
      <aside className="h-fit rounded-xl border border-border bg-background/40 p-4">
        <p className="text-[11px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
          Import receipt
        </p>
        <div className="mt-2 space-y-1">
          {receipt.map(([label, n]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium text-foreground tabular-nums">
                {n}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 border-t border-dashed border-border pt-3">
          <p className="text-[11px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
            Values remapped · {remaps.reduce((n, r) => n + r.count, 0)}
          </p>
          {remaps.length === 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              No fixes applied — unmatched values import as-is.
            </p>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              {remaps.map((r, i) => (
                <div
                  key={i}
                  className="flex min-w-0 items-center gap-1.5 text-xs"
                >
                  <span className="truncate font-mono text-muted-foreground line-through">
                    {r.raw}
                  </span>
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                  <RemapTarget
                    entry={r}
                    fieldOptions={fieldOptions}
                    nameById={nameById}
                  />
                  <span className="shrink-0 text-muted-foreground">
                    ×{r.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Contacts result — the original compact banner. */
function ContactsResultPanel({ result }: { result: ImportResult }) {
  const stats: [string, number, string][] = [
    ['imported', result.imported, 'text-primary-text'],
    ['updated', result.updated, 'text-cyan-foreground'],
    ['skipped', result.skipped, 'text-amber-foreground'],
    ['failed', result.failed, 'text-red-foreground'],
  ];
  return (
    <div className="rounded-xl border border-border bg-background/50 p-5">
      <p className="text-sm font-medium text-popover-foreground">
        Import complete
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        {stats
          .filter(([, n]) => n > 0)
          .map(([label, n, color]) => (
            <div
              key={label}
              className={cn('flex items-center gap-1.5 text-sm', color)}
            >
              {label === 'failed' ? (
                <XCircle className="size-4 shrink-0" />
              ) : label === 'skipped' ? (
                <AlertTriangle className="size-4 shrink-0" />
              ) : (
                <CheckCircle className="size-4 shrink-0" />
              )}
              {n} {label}
            </div>
          ))}
      </div>
      {(result.tagsAssigned > 0 || result.customValues > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {result.tagsAssigned > 0 &&
            `${result.tagsAssigned} tag assignment${result.tagsAssigned !== 1 ? 's' : ''}`}
          {result.tagsAssigned > 0 && result.customValues > 0 && ' · '}
          {result.customValues > 0 &&
            `${result.customValues} custom value${result.customValues !== 1 ? 's' : ''}`}{' '}
          applied.
        </p>
      )}
      {result.invalidValues > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-foreground">
          <AlertTriangle className="size-3.5 shrink-0" />
          {result.invalidValues} value
          {result.invalidValues !== 1 ? 's' : ''} skipped — wrong format for
          the field type.
        </p>
      )}
    </div>
  );
}

/** Leads result — big scannable tiles + the remap audit (the trust moment). */
function LeadsResultPanel({
  result,
  remaps,
  fieldOptions,
  nameById,
}: {
  result: ImportResult;
  remaps: RemapEntry[];
  fieldOptions: ReturnType<typeof useLeadFieldOptions>;
  nameById: Map<string, string>;
}) {
  const tiles: { label: string; n: number; className: string }[] = [
    {
      label: 'Leads added',
      n: result.imported,
      className: 'text-emerald-foreground',
    },
    {
      label: 'Updated',
      n: result.updated,
      className: 'text-cyan-foreground',
    },
    { label: 'Skipped', n: result.skipped, className: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle className="size-5 shrink-0 text-emerald-foreground" />
        <p className="text-sm font-medium text-popover-foreground">
          Import complete
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-xl border border-border bg-background/50 px-4 py-3.5"
          >
            <p
              className={cn(
                'font-heading text-3xl leading-none font-semibold tabular-nums',
                t.className
              )}
            >
              {t.n}
            </p>
            <p className="mt-1.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {t.label}
            </p>
          </div>
        ))}
      </div>

      {result.failed > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-red-foreground">
          <XCircle className="size-3.5 shrink-0" />
          {result.failed} row{result.failed !== 1 ? 's' : ''} failed to write.
        </p>
      )}

      {result.remapped > 0 && remaps.length > 0 && (
        <div className="rounded-xl border border-border bg-background/40 p-4">
          <p className="text-[11px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
            {result.remapped} value{result.remapped !== 1 ? 's' : ''} remapped
            to your options
          </p>
          <div className="mt-2 space-y-1.5">
            {remaps.map((r, i) => (
              <div key={i} className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className="truncate font-mono text-muted-foreground line-through">
                  {r.raw}
                </span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                <RemapTarget
                  entry={r}
                  fieldOptions={fieldOptions}
                  nameById={nameById}
                />
                <span className="shrink-0 text-muted-foreground">
                  ×{r.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(result.tagsAssigned > 0 ||
        result.customValues > 0 ||
        result.invalidValues > 0) && (
        <p className="text-xs text-muted-foreground">
          {result.tagsAssigned > 0 &&
            `${result.tagsAssigned} tag assignment${result.tagsAssigned !== 1 ? 's' : ''} applied`}
          {result.tagsAssigned > 0 && result.customValues > 0 && ' · '}
          {result.customValues > 0 &&
            `${result.customValues} custom value${result.customValues !== 1 ? 's' : ''} applied`}
          {result.invalidValues > 0 && (
            <>
              {(result.tagsAssigned > 0 || result.customValues > 0) && ' · '}
              <span className="text-amber-foreground">
                {result.invalidValues} wrong-format value
                {result.invalidValues !== 1 ? 's' : ''} skipped
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
