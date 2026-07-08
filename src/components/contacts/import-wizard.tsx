'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import {
  applyMapping,
  autoMapColumns,
  buildTargets,
  customFieldId,
  CREATE_FIELD_KEY,
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
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
  Download,
  Wand2,
  RotateCcw,
  Pencil,
  Trash2,
} from 'lucide-react';

type ImportMode = 'add' | 'update' | 'both';

const SAMPLE_LIMIT = 3;
const INSERT_CHUNK = 50;
const CUSTOM_VALUE_CHUNK = 100;

const TEMPLATE_CSV =
  'phone,name,email,company,tags\n' +
  '+15551234567,Jane Doe,jane@example.com,Acme Inc,"VIP, Lead"\n' +
  '+15559876543,John Roe,john@example.com,Globex,Customer\n';

const MODE_LABELS: Record<ImportMode, { title: string; hint: string }> = {
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
};

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  tagsAssigned: number;
  customValues: number;
  invalidValues: number;
}

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contacts-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard({
  open,
  onOpenChange,
  onImported,
}: ImportWizardProps) {
  const supabase = createClient();
  const { user, accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<RawCsv | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldRef[]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>('add');
  const [dontOverwriteEmpty, setDontOverwriteEmpty] = useState(true);
  const [compliance, setCompliance] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Inline custom-field editor. `createCol` set → creating for that column;
  // `editFieldId` set → editing that existing field. At most one at a time.
  const [createCol, setCreateCol] = useState<number | null>(null);
  const [editFieldId, setEditFieldId] = useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [savingField, setSavingField] = useState(false);

  const targets = useMemo(() => buildTargets(customFields), [customFields]);
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
    setMode('add');
    setDontOverwriteEmpty(true);
    setCompliance(false);
    setResult(null);
    setCreateCol(null);
    setEditFieldId(null);
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
    setMapping(autoMapColumns(parsed.headers, buildTargets(customFields)));
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

  const mappedPreview = useMemo(() => {
    if (!raw)
      return {
        rows: [] as MappedRow[],
        droppedNoPhone: 0,
        invalidCustomValues: 0,
      };
    return applyMapping(raw, mapping, fieldTypeById);
  }, [raw, mapping, fieldTypeById]);

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
    setNewFieldName(raw?.headers[col]?.trim() ?? '');
    setNewFieldType('text');
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

  const canProceedFromUpload = !!raw && raw.rows.length > 0;
  const canImport = validation.ok && compliance && !importing;

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,760px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-3xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              Import Contacts
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground">
              {step === 1 && 'Upload a CSV of contacts to begin.'}
              {step === 2 && 'Map your file columns to contact fields.'}
              {step === 3 && !result && 'Review and confirm the import.'}
              {step === 3 && result && 'Import complete.'}
            </DialogDescription>
          </DialogHeader>

          <StepIndicator step={step} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <UploadStep
              file={file}
              raw={raw}
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
              mode={mode}
              dontOverwriteEmpty={dontOverwriteEmpty}
              validation={validation}
              canCreateFields={canEditSettings}
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

          {step === 3 && (
            <ReviewStep
              result={result}
              mode={mode}
              mappedPreview={mappedPreview}
              compliance={compliance}
              onSetCompliance={setCompliance}
            />
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 items-center gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-between">
          <div>
            {step === 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={downloadTemplate}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="size-4" />
                Sample CSV
              </Button>
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
                {step === 2 && (
                  <Button
                    type="button"
                    disabled={!validation.ok}
                    onClick={() => setStep(3)}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Next
                  </Button>
                )}
                {step === 3 && (
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
              className="bg-muted text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Data type</Label>
            <Select
              value={newFieldType}
              onValueChange={(v) => v && setNewFieldType(v)}
            >
              <SelectTrigger className="w-full bg-muted">
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
              Values import as text today; the type is saved for validation and
              formatting.
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

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Upload', 'Map Fields', 'Review'];
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                active && 'bg-primary text-primary-foreground',
                done && 'bg-primary/20 text-primary',
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
            {i < steps.length - 1 && (
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
  fileInputRef,
  onFileChange,
}: {
  file: File | null;
  raw: RawCsv | null;
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
              <FileText className="text-primary size-5" />
            </div>
            <p
              className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
              title={file.name}
            >
              {truncateFilename(file.name)}
            </p>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {raw?.rows.length ?? 0} row{raw?.rows.length !== 1 ? 's' : ''} ·{' '}
              {raw?.headers.length ?? 0} column
              {raw?.headers.length !== 1 ? 's' : ''}
            </span>
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
  mode,
  dontOverwriteEmpty,
  validation,
  canCreateFields,
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
  mode: ImportMode;
  dontOverwriteEmpty: boolean;
  validation: ReturnType<typeof validateMapping>;
  canCreateFields: boolean;
  onSetColumn: (col: number, key: string) => void;
  onSetMode: (mode: ImportMode) => void;
  onSetDontOverwriteEmpty: (v: boolean) => void;
  onAutoMap: () => void;
  onReset: () => void;
  onRequestCreateField: (col: number) => void;
  onRequestEditField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
}) {
  const standardTargets = targets.filter((t) => t.kind !== 'custom');
  const customTargets = targets.filter((t) => t.kind === 'custom');
  const showEmptyToggle = mode === 'update' || mode === 'both';

  const labelForKey = (key: string): string => {
    if (key === IGNORE_KEY) return "Don't import";
    return targets.find((t) => t.key === key)?.label ?? key;
  };

  return (
    <div className="space-y-5">
      {/* Action mode */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          How to process rows
        </p>
        <RadioGroup
          value={mode}
          onValueChange={(v) => v && onSetMode(v as ImportMode)}
          className="gap-2"
        >
          {(Object.keys(MODE_LABELS) as ImportMode[]).map((key) => (
            <label
              key={key}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                mode === key
                  ? 'border-primary/40 bg-primary/[0.04]'
                  : 'border-border/80 hover:bg-muted/40'
              )}
            >
              <RadioGroupItem value={key} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-foreground">
                  {MODE_LABELS[key].title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {MODE_LABELS[key].hint}
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
          <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            Updates applied via import cannot be undone.
          </p>
        )}
      </div>

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
            <table className="w-full min-w-[34rem] text-xs">
              <thead>
                <tr className="border-b border-border bg-background/60">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    File column
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Sample data
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Contact field
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {raw.headers.map((header, col) => (
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
                      <Select
                        value={mapping[col] ?? IGNORE_KEY}
                        onValueChange={(v) => {
                          if (!v) return;
                          if (v === CREATE_FIELD_KEY) {
                            onRequestCreateField(col);
                            return;
                          }
                          onSetColumn(col, v);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full min-w-[9rem] bg-background/60"
                        >
                          <SelectValue>
                            {(value) => (
                              <span
                                className={cn(
                                  (value ?? IGNORE_KEY) === IGNORE_KEY &&
                                    'text-muted-foreground'
                                )}
                              >
                                {labelForKey((value as string) ?? IGNORE_KEY)}
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={IGNORE_KEY}>
                            <span className="text-muted-foreground">
                              Don&apos;t import
                            </span>
                          </SelectItem>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel>Standard</SelectLabel>
                            {standardTargets.map((t) => (
                              <SelectItem key={t.key} value={t.key}>
                                {t.label}
                                {t.required && (
                                  <span className="text-primary"> *</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          {customTargets.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Custom fields</SelectLabel>
                              {customTargets.map((t) => (
                                <SelectItem key={t.key} value={t.key}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {canCreateFields && (
                            <>
                              <SelectSeparator />
                              <SelectItem value={CREATE_FIELD_KEY}>
                                <span className="text-primary">
                                  + Create new field…
                                </span>
                              </SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>

                      {(() => {
                        const cfId = customFieldId(mapping[col] ?? '');
                        if (!cfId || !canCreateFields) return null;
                        return (
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
                              variant="ghost"
                              size="icon-sm"
                              title="Delete field"
                              onClick={() => onDeleteField(cfId)}
                              className="shrink-0 text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        );
                      })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Validation */}
        {!validation.phoneMapped && (
          <p className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
            <XCircle className="size-3.5 shrink-0" />
            Map one column to <span className="font-medium">Phone</span> to
            continue — it&apos;s required.
          </p>
        )}
        {validation.duplicateTargets.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
            <XCircle className="size-3.5 shrink-0" />
            Each field can be mapped once. Duplicated:{' '}
            {validation.duplicateTargets
              .map((k) => customFieldId(k) ?? k)
              .join(', ')}
            .
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  result,
  mode,
  mappedPreview,
  compliance,
  onSetCompliance,
}: {
  result: ImportResult | null;
  mode: ImportMode;
  mappedPreview: {
    rows: MappedRow[];
    droppedNoPhone: number;
    invalidCustomValues: number;
  };
  compliance: boolean;
  onSetCompliance: (v: boolean) => void;
}) {
  if (result) {
    const stats: [string, number, string][] = [
      ['imported', result.imported, 'text-primary'],
      ['updated', result.updated, 'text-cyan-700 dark:text-cyan-400'],
      ['skipped', result.skipped, 'text-amber-700 dark:text-amber-400'],
      ['failed', result.failed, 'text-red-700 dark:text-red-400'],
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
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            {result.invalidValues} value
            {result.invalidValues !== 1 ? 's' : ''} skipped — wrong format for
            the field type.
          </p>
        )}
      </div>
    );
  }

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
              {MODE_LABELS[mode].title}
            </span>
          </div>
          {mappedPreview.droppedNoPhone > 0 && (
            <div>
              <span className="text-muted-foreground">Rows without phone: </span>
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {mappedPreview.droppedNoPhone} skipped
              </span>
            </div>
          )}
          {mappedPreview.invalidCustomValues > 0 && (
            <div>
              <span className="text-muted-foreground">
                Wrong-format values:{' '}
              </span>
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {mappedPreview.invalidCustomValues} will be skipped
              </span>
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
