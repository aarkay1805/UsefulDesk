'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Pencil,
  RotateCcw,
  Upload,
  LayoutTemplate,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { BubbleTail } from '@/components/inbox/message-bubble';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GatedButton } from '@/components/ui/gated-button';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';
import { resolveTemplateStatusDisplay } from '@/lib/template-status';
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';
import {
  TEMPLATE_PRESETS,
  type TemplatePreset,
} from '@/lib/whatsapp/template-presets';
import { getErrorMessage } from '@/lib/errors';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = [
  'none',
  'text',
  'image',
  'video',
  'document',
];

type TemplateBadgeVariant =
  'success' | 'danger' | 'warning' | 'info' | 'violet' | 'orange' | 'neutral';

const PRESET_GROUPS: Array<{
  id: TemplatePreset['galleryGroup'];
  title: string;
  description: string;
}> = [
  {
    id: 'feature',
    title: 'UsefulDesk features',
    description:
      'UsefulDesk sends these for you, from member actions, payment links, and reminders. The name and wording are locked so those sends keep working.',
  },
  {
    id: 'account_update',
    title: 'Account updates',
    description:
      'Starting points you name and edit yourself, about a membership, invoice, or payment a member already has.',
  },
  {
    id: 'marketing',
    title: 'Marketing',
    description:
      'Starting points you name and edit yourself, for members who opted in to marketing.',
  },
];

// A preset's body reads as `Hi {{1}}, your {{2}} membership ends on {{3}}`,
// which forces the reader to zip placeholder indices against a separate
// parameter list. Splitting the body into literal and filled segments lets
// the gallery render the message the way it will actually arrive, with the
// slots marked, so the "Parameters:" row stops being needed at all. Indices
// are 1-based and can appear out of order, so map by number, never by
// position of appearance.
type PreviewSegment =
  | { kind: 'text'; value: string }
  | { kind: 'slot'; value: string; label: string };

function previewSegments(preset: TemplatePreset): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  const pattern = /\{\{(\d+)\}\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(preset.fields.body_text)) !== null) {
    if (match.index > cursor) {
      segments.push({
        kind: 'text',
        value: preset.fields.body_text.slice(cursor, match.index),
      });
    }
    const slot = Number(match[1]) - 1;
    const label = preset.parameterLabels[slot] ?? `Detail ${match[1]}`;
    segments.push({
      kind: 'slot',
      value: preset.fields.body_samples[slot]?.trim() || label,
      label,
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < preset.fields.body_text.length) {
    segments.push({
      kind: 'text',
      value: preset.fields.body_text.slice(cursor),
    });
  }
  return segments;
}

const categoryVariants: Record<string, TemplateBadgeVariant> = {
  Marketing: 'violet',
  Utility: 'info',
  Authentication: 'warning',
};

/**
 * One preset in the gallery.
 *
 * The sample is drawn as a real WhatsApp bubble on the inbox's own chat
 * canvas — same fill and meta tokens, same tail geometry, same doodle
 * wallpaper — because the question being answered here is "does this read
 * well on my member's phone?", and a grey quote block cannot answer it. The
 * footer and quick-reply rows render for the same reason: the marketing
 * bodies say "Use the buttons below to respond", so a preview without them
 * contradicts its own copy. The inbox bubble omits both because a sent row
 * only persists its body text; the preset knows its whole payload.
 *
 * Card, not a rule-separated block: at two columns a shared hairline no
 * longer says which preset owns which message, so each one needs its own
 * bounded surface. The chat band takes the slack (`flex-1`) so the footer
 * strips of two side-by-side cards land on the same line whatever their
 * messages measure.
 */
function PresetCard({
  preset,
  canAct,
  onUse,
}: {
  preset: TemplatePreset;
  canAct: boolean;
  onUse: (preset: TemplatePreset) => void;
}) {
  const buttons = preset.fields.buttons ?? [];
  const footerText = preset.fields.footer_text;

  return (
    <Card data-slot="preset" size="sm">
      <CardHeader className="min-h-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="text-foreground text-sm font-medium">
            {preset.title}
          </h4>
          <Badge variant={categoryVariants[preset.category] || 'neutral'}>
            {preset.category}
          </Badge>
        </div>
        <CardDescription className="text-xs leading-[1.5]">
          {preset.blurb}
        </CardDescription>
      </CardHeader>

      {/* A direct child of Card, not CardContent: the band wants the card's
          full width the way a card's leading image does, and the message is
          the thing being chosen, so it gets its own plane. The card then
          reads as three zones — what it is, what it says, when and how to
          take it. Matching the header's `px-3` puts the bubble body on the
          title's left edge and leaves the tail to hang into the gutter the
          way it does in the thread. */}
      <div className="bg-chat-canvas relative flex flex-1 flex-col items-start overflow-hidden px-3 py-3">
        <div
          aria-hidden
          className="chat-doodle pointer-events-none absolute inset-0"
        />
        {/* Received side, not sent: the gym is previewing what lands on the
            member's phone, and quick replies only exist to be tapped by the
            person receiving them. Same 4px bubble padding as the inbox, so
            the full-bleed button rows stay concentric with the corner. */}
        <div className="bg-chat-bubble-in text-foreground relative w-fit max-w-[88%] rounded-lg rounded-tl-none p-1 shadow-[var(--chat-bubble-shadow)]">
          <BubbleTail side="left" />
          <p className="px-1.5 py-0.5 text-sm break-words whitespace-pre-wrap">
            <span className="sr-only">
              Sample message. Filled-in details:{' '}
              {preset.parameterLabels.join(', ')}.{' '}
            </span>
            {/* Weight, not colour, marks the filled slots. Muting the
                literal text to make the samples pop inverted the emphasis —
                a message you are judging has to read at full contrast. */}
            {previewSegments(preset).map((segment, i) =>
              segment.kind === 'slot' ? (
                <span key={i} title={segment.label} className="font-medium">
                  {segment.value}
                </span>
              ) : (
                <span key={i}>{segment.value}</span>
              )
            )}
          </p>
          {footerText && (
            <p className="text-chat-meta px-1.5 pt-1 pb-0.5 text-[11px] leading-[1.45]">
              {footerText}
            </p>
          )}
          {buttons.length > 0 && (
            <div className="mt-1 -mr-1 -mb-1 -ml-1 overflow-hidden rounded-b-lg">
              <span className="sr-only">Reply buttons: </span>
              {buttons.map((button, i) => (
                <div
                  key={i}
                  className="border-foreground/10 text-primary-text border-t px-2 py-1.5 text-center text-sm font-medium"
                >
                  {button.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CardFooter className="items-end gap-3">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-[1.5]">
          <span className="text-foreground font-medium">Sends when: </span>
          {preset.trigger}
        </p>
        <GatedButton
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => onUse(preset)}
          canAct={canAct}
          gateReason="create message templates"
        >
          {preset.wired ? 'Use preset' : 'Use as custom draft'}
        </GatedButton>
      </CardFooter>
    </Card>
  );
}

function statusVariant(status: string): TemplateBadgeVariant {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'REJECTED':
    case 'DISABLED':
      return 'danger';
    case 'PAUSED':
      return 'orange';
    case 'IN_APPEAL':
      return 'info';
    default:
      return 'neutral';
  }
}

function qualityVariant(quality: string): TemplateBadgeVariant {
  if (quality === 'GREEN') return 'success';
  if (quality === 'YELLOW') return 'warning';
  return 'danger';
}

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
};

const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'es_MX',
  'fr',
  'fr_FR',
  'de',
  'it',
  'pt_BR',
  'pt_PT',
  'nl',
  'pl',
  'ru',
  'tr',
  'lt',
];

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
  }
}

export function TemplateManager() {
  const supabase = useMemo(() => createClient(), []);
  const { accountId, canEditSettings, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  // Non-null when the dialog is editing an existing row — switches the
  // submit handler from POST /submit to PATCH /[id] and changes the
  // dialog title + CTA. Set to the template id to pre-fill from a row.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Preset gallery — pick a ready-made gym template to pre-fill the form.
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  // Feature-backed presets are exact application contracts. Lock every
  // provider component while creating one; language remains selectable.
  const [contractLocked, setContractLocked] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Template selected for the confirm-delete dialog. The destructive
  // action goes through this two-step so a slip on the trash icon
  // doesn't take the template off Meta as well as locally.
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);
  // Header-image upload (issue #230). Uploads to the account-scoped
  // chat-media bucket and stores the public URL in header_media_url; the
  // submit route turns that into a Meta Resumable-Upload handle.
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);

  // Body variable indices — `[1, 2, 3]` for "{{1}} {{2}} {{3}}". We
  // re-run the extractor on every render to keep the sample-value rows
  // in sync with what the user typed.
  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text]
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content]
  );

  // Resize body_samples so it always has exactly bodyVarCount entries.
  // (We mutate via setForm in an effect so React owns the state.)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setForm((prev) => {
        if (prev.body_samples.length === bodyVarCount) return prev;
        const next = prev.body_samples.slice(0, bodyVarCount);
        while (next.length < bodyVarCount) next.push('');
        return { ...prev, body_samples: next };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [bodyVarCount]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      if (!accountId) {
        if (cancelled) return;
        setTemplates([]);
        setLoadError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const { data, error } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (cancelled) return;
        setTemplates(data || []);
      } catch (err) {
        if (cancelled) return;
        const message = getErrorMessage(err, 'Failed to load templates');
        console.error('Failed to fetch templates:', err);
        setLoadError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, authLoading, reloadNonce, supabase]);

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type:
        form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  // Feature presets retain the exact provider name and payload. Non-feature
  // presets are copied into an explicitly custom, separately named draft.
  function applyPreset(preset: TemplatePreset) {
    const f = preset.fields;
    setEditingId(null);
    setContractLocked(preset.wired);
    setForm({
      ...emptyForm,
      name: preset.wired ? f.name : '',
      category: f.category,
      language: 'en_US',
      header_format: f.header_format,
      header_content: f.header_content ?? '',
      header_sample: f.header_sample ?? '',
      body_text: f.body_text,
      body_samples: [...f.body_samples],
      footer_text: f.footer_text ?? '',
      buttons: f.buttons ? [...f.buttons] : [],
    });
    setPresetPickerOpen(false);
    setDialogOpen(true);
  }

  function openEdit(template: MessageTemplate) {
    setEditingId(template.id);
    setContractLocked(false);
    setForm({
      name: template.name,
      category: template.category,
      language: template.language || 'en_US',
      header_format: (template.header_type ?? 'none') as HeaderFormat,
      header_content: template.header_content ?? '',
      header_media_url: template.header_media_url ?? '',
      header_sample: template.sample_values?.header?.[0] ?? '',
      body_text: template.body_text,
      body_samples: template.sample_values?.body ?? [],
      footer_text: template.footer_text ?? '',
      buttons: template.buttons ?? [],
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingId(null);
    setContractLocked(false);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    // AUTHENTICATION is blocked by the persistent banner + disabled
    // submit button; this is a defensive second line of defense.
    if (!canEditSettings || form.category === 'Authentication') return;
    try {
      setSubmitting(true);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubmitPayload()),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ||
            `${isEdit ? 'Edit' : 'Submit'} failed (HTTP ${res.status})`
        );
      }
      setReloadNonce((nonce) => nonce + 1);
      toast.success(
        data.dry_run
          ? isEdit
            ? 'Template updated (dry-run — no Meta call)'
            : 'Template saved (dry-run — no Meta call)'
          : isEdit
            ? 'Edit submitted to Meta for review. Sync Templates after Meta decides.'
            : 'Submitted to Meta for review. Sync Templates after Meta decides.'
      );
      if (data.warning) toast.error(String(data.warning), { duration: 10000 });
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      setContractLocked(false);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(getErrorMessage(err, 'Failed to submit template'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!accountId || !canEditSettings) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      }
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
          (data.inserted || data.updated
            ? ` (${data.inserted} new, ${data.updated} updated)`
            : '')
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors
          .slice(0, 3)
          .map(
            (e: { name: string; language: string; message: string }) =>
              `${e.name} (${e.language})`
          );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(`Failed to sync: ${preview.join(', ')}${suffix}`);
      }
      if (data.truncated) {
        // Use error (not warning) so the message survives long
        // enough to read — sonner's `warning` auto-dismisses on
        // the same short timer as `success`.
        toast.error(
          'Synced the first 2000 templates only — your account has more. Sync again to continue, or contact support if this persists.',
          { duration: 10000 }
        );
      }
      if (Number(data.newly_missing) > 0) {
        toast.error(
          `${data.newly_missing} local template${data.newly_missing === 1 ? ' is' : 's are'} no longer present on Meta. They were disabled and kept for review.`,
          { duration: 10000 }
        );
      }
      setReloadNonce((nonce) => nonce + 1);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(getErrorMessage(err, 'Failed to sync templates'));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId || !canEditSettings) return;
    setDeletingId(target.id);
    try {
      // Route handler scopes the Meta delete via hsm_id (so sibling
      // language variants survive) and falls through to remove the
      // local row. Local-only rows skip the Meta call.
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(getErrorMessage(err, 'Failed to delete template'));
    } finally {
      setDeletingId(null);
    }
  }

  // The patch type unions every field across button variants. The
  // conditional rendering below ensures only fields valid for the
  // current button's `type` reach this function, so the runtime
  // assertion + per-type spread preserves discriminated-union
  // invariants without forcing every call site to thread the type
  // through generics (which TS can't infer from a partial literal).
  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
  };
  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const current = prev.buttons[index];
      if (!current) return prev;
      const next = [...prev.buttons];
      // Per-variant spread keeps the discriminant pinned. Switch
      // exhaustiveness is enforced by TypeScript.
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  function changeButtonType(index: number, type: TemplateButton['type']) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: next };
    });
  }

  function removeButton(index: number) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  }

  function addButton() {
    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
    }));
  }

  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';

  async function handleHeaderImageFile(file: File) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('Header image must be a JPEG or PNG.');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — Meta's limit is 5 MB.`
      );
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setForm((f) => ({ ...f, header_media_url: publicUrl }));
      toast.success('Image uploaded.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploadingHeader(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title="Message templates"
        description="Create WhatsApp templates, submit them to Meta, or sync ones created elsewhere."
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <GatedButton
              onClick={openCreate}
              canAct={canEditSettings}
              gateReason="create message templates"
            >
              <Plus />
              New template
            </GatedButton>
            <GatedButton
              variant="outline"
              onClick={() => setPresetPickerOpen(true)}
              canAct={canEditSettings}
              gateReason="create message templates"
            >
              <LayoutTemplate />
              Use preset
            </GatedButton>
            <GatedButton
              variant="outline"
              onClick={handleSyncFromMeta}
              disabled={syncing || loading || !accountId}
              canAct={canEditSettings}
              gateReason="sync message templates from Meta"
              title="Pull templates from your Meta WhatsApp Business Account"
            >
              <RefreshCw className={syncing ? 'animate-spin' : undefined} />
              {syncing ? 'Syncing…' : 'Sync from Meta'}
            </GatedButton>
          </div>
        }
      />

      {!canEditSettings ? (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Only admins and owners can create, sync, edit, or delete templates.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div
          className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" />
          Loading templates…
        </div>
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Templates couldn&apos;t load</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-3"
              onClick={() => setReloadNonce((nonce) => nonce + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-foreground font-medium">No templates yet</p>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Use a gym preset or create a template from scratch, then submit it
              to Meta for approval.
            </p>
            <GatedButton
              className="mt-4"
              onClick={() => setPresetPickerOpen(true)}
              canAct={canEditSettings}
              gateReason="create message templates"
            >
              <LayoutTemplate />
              Use a preset
            </GatedButton>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {templates.map((template) => {
            const statusKey = template.status || 'DRAFT';
            const status = resolveTemplateStatusDisplay(
              statusKey,
              template.provider_missing_since
            );
            return (
              <Card key={template.id}>
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <h3 className="text-foreground truncate font-medium">
                        {template.name}
                      </h3>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                        <Badge
                          variant={
                            categoryVariants[template.category] || 'neutral'
                          }
                        >
                          {template.category}
                        </Badge>
                        <Badge
                          variant={
                            template.provider_missing_since
                              ? 'danger'
                              : statusVariant(statusKey)
                          }
                        >
                          {status.label}
                        </Badge>
                        {template.language && (
                          <span className="uppercase">{template.language}</span>
                        )}
                        {template.quality_score && (
                          <Badge
                            variant={qualityVariant(template.quality_score)}
                            title="Meta quality score"
                          >
                            Quality: {template.quality_score.toLowerCase()}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {statusKey === 'APPROVED' && (
                        <GatedButton
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(template)}
                          title="Editing sends the template back to Meta for review"
                          aria-label="Edit template"
                          canAct={canEditSettings}
                          gateReason="edit message templates"
                        >
                          <Pencil />
                          Edit
                        </GatedButton>
                      )}
                      {(statusKey === 'REJECTED' || statusKey === 'PAUSED') && (
                        <GatedButton
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(template)}
                          title="Edit and resubmit this template to Meta"
                          aria-label="Edit and resubmit template"
                          canAct={canEditSettings}
                          gateReason="edit message templates"
                        >
                          <RotateCcw />
                          Resubmit
                        </GatedButton>
                      )}
                      <GatedButton
                        variant="destructive-ghost"
                        size="icon"
                        onClick={() => setTemplateToDelete(template)}
                        disabled={deletingId === template.id}
                        canAct={canEditSettings}
                        gateReason="delete message templates"
                        aria-label={
                          template.meta_template_id &&
                          !template.provider_missing_since
                            ? 'Delete template from Meta and locally'
                            : 'Delete template locally'
                        }
                        title={
                          template.meta_template_id &&
                          !template.provider_missing_since
                            ? 'Delete from Meta and UsefulDesk'
                            : 'Delete from UsefulDesk'
                        }
                      >
                        {deletingId === template.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Trash2 />
                        )}
                      </GatedButton>
                    </div>
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {template.body_text}
                  </p>
                  {template.footer_text && (
                    <p className="text-muted-foreground text-xs italic">
                      {template.footer_text}
                    </p>
                  )}
                  {template.provider_missing_since ? (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertDescription>
                        This template was not returned by Meta during the last
                        complete sync. Re-create it in Meta or delete this local
                        record.
                      </AlertDescription>
                    </Alert>
                  ) : template.rejection_reason || template.submission_error ? (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertDescription>
                        {template.rejection_reason || template.submission_error}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setContractLocked(false);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle size="lg">
              {editingId ? 'Edit template' : 'New template'}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Save your changes to send the template back to Meta for review.'
                : 'Build a WhatsApp template, then submit it to Meta for approval.'}
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={handleSubmit}>
            {contractLocked ? (
              <Alert>
                <AlertCircle />
                <AlertTitle>UsefulDesk feature contract is locked</AlertTitle>
                <AlertDescription>
                  Name, category, copy, parameter order, footer, and buttons
                  must stay exact so the matching UsefulDesk action can use this
                  template. You can choose the provider language before
                  submission.
                </AlertDescription>
              </Alert>
            ) : null}
            {form.category === 'Authentication' && (
              <Alert>
                <AlertCircle />
                <AlertTitle>
                  Authentication templates aren&apos;t supported here
                </AlertTitle>
                <AlertDescription>
                  Create them in Meta WhatsApp Manager, then use Sync from Meta.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Template name</Label>
                <Input
                  id="template-name"
                  placeholder="e.g. renewal_reminder"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={editingId !== null || contractLocked}
                  required
                  pattern="[a-z0-9_]{1,512}"
                />
                <p className="text-muted-foreground text-xs">
                  {editingId
                    ? 'The name is fixed once the template exists on Meta.'
                    : contractLocked
                      ? 'This UsefulDesk feature requires the exact template name.'
                      : 'Lowercase letters, digits, and underscores only.'}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="template-category">Category</Label>
                  <Select
                    value={form.category}
                    disabled={contractLocked}
                    onValueChange={(val) =>
                      setForm({
                        ...form,
                        category: val as MessageTemplate['category'],
                      })
                    }
                  >
                    <SelectTrigger id="template-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template-language">Language</Label>
                  <Input
                    id="template-language"
                    list="template-language-codes"
                    placeholder="en_US"
                    value={form.language}
                    onChange={(e) =>
                      setForm({ ...form, language: e.target.value })
                    }
                    disabled={editingId !== null}
                    required
                  />
                  <datalist id="template-language-codes">
                    {COMMON_LANGUAGE_CODES.map((code) => (
                      <option key={code} value={code} />
                    ))}
                  </datalist>
                  <p className="text-muted-foreground text-xs">
                    {editingId ? (
                      'Language is fixed once a template exists on Meta.'
                    ) : (
                      <>
                        Must match the exact code on Meta — <code>en_US</code>{' '}
                        and <code>en</code> are distinct.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-header-format">Header</Label>
                <Select
                  value={form.header_format}
                  disabled={contractLocked}
                  onValueChange={(val) =>
                    // Preserve header_content, header_media_url, and
                    // header_sample across format switches. The submit
                    // payload builder only reads the field that matches
                    // the active format, so an orphan value on a hidden
                    // field is harmless — and keeping it lets the user
                    // switch formats to compare without losing typing.
                    setForm({
                      ...form,
                      header_format: (val || 'none') as HeaderFormat,
                    })
                  }
                >
                  <SelectTrigger id="template-header-format" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HEADER_FORMATS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type === 'none'
                          ? 'None'
                          : type.charAt(0).toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {form.header_format === 'text' && (
                  <div className="mt-2 space-y-2">
                    <Label htmlFor="template-header-text" size="sm">
                      Header text
                    </Label>
                    <Input
                      id="template-header-text"
                      placeholder="Header text (max 60 chars, optional {{1}})"
                      value={form.header_content}
                      disabled={contractLocked}
                      onChange={(e) =>
                        setForm({ ...form, header_content: e.target.value })
                      }
                      maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                      required
                    />
                    {headerVarCount > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="template-header-sample" size="sm">
                          Sample for {`{{1}}`}
                        </Label>
                        <Input
                          id="template-header-sample"
                          placeholder="Example shown to Meta"
                          value={form.header_sample}
                          disabled={contractLocked}
                          onChange={(e) =>
                            setForm({ ...form, header_sample: e.target.value })
                          }
                          required
                        />
                      </div>
                    )}
                  </div>
                )}

                {headerNeedsMedia && (
                  <div className="mt-2 space-y-2">
                    {form.header_format === 'image' && (
                      <div className="flex items-center gap-2">
                        <input
                          ref={headerFileRef}
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleHeaderImageFile(f);
                            e.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={uploadingHeader}
                          onClick={() => headerFileRef.current?.click()}
                        >
                          {uploadingHeader ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Upload />
                          )}
                          Upload image
                        </Button>
                        <span className="text-muted-foreground text-xs">
                          JPEG or PNG, ≤5 MB
                        </span>
                      </div>
                    )}
                    <Label htmlFor="template-header-media" size="sm">
                      Public {form.header_format} URL
                    </Label>
                    <Input
                      id="template-header-media"
                      type="url"
                      placeholder="https://…"
                      value={form.header_media_url}
                      onChange={(e) =>
                        setForm({ ...form, header_media_url: e.target.value })
                      }
                      required
                    />
                    {form.header_format === 'image' &&
                      form.header_media_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={form.header_media_url}
                          alt="Template header preview"
                          className="border-border max-h-28 rounded-md border object-contain"
                        />
                      )}
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {form.header_format === 'image'
                        ? 'Upload a JPEG/PNG (≤5 MB, ≥800×418 px recommended) or paste a public HTTPS link — we upload it to Meta for review automatically.'
                        : 'Must be a publicly accessible HTTPS link. Meta fetches it once during review, so it needs to stay live for ~24 hrs.'}
                      {form.header_format === 'video' &&
                        ' Recommended: MP4 / 3GPP, ≤16 MB, ≤60 seconds.'}
                      {form.header_format === 'document' &&
                        ' Recommended: PDF, ≤100 MB.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-body">Body text</Label>
                <Textarea
                  id="template-body"
                  placeholder="Hello {{1}}, your order {{2}} is confirmed."
                  value={form.body_text}
                  disabled={contractLocked}
                  onChange={(e) =>
                    setForm({ ...form, body_text: e.target.value })
                  }
                  rows={4}
                  maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                  required
                />
                <p className="text-muted-foreground text-xs">
                  Use {`{{1}}`}, {`{{2}}`} for variables (must be contiguous
                  starting at {`{{1}}`}).
                </p>

                {bodyVarCount > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <Label size="sm">Sample values for Meta review</Label>
                    {form.body_samples.map((val, i) => {
                      const inputId = `template-body-sample-${i}`;
                      return (
                        <Input
                          key={i}
                          id={inputId}
                          aria-label={`Sample value for body variable {{${i + 1}}}`}
                          placeholder={`Sample for {{${i + 1}}}`}
                          value={val}
                          disabled={contractLocked}
                          onChange={(e) => {
                            const next = [...form.body_samples];
                            next[i] = e.target.value;
                            setForm({ ...form, body_samples: next });
                          }}
                          required
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-footer">Footer (optional)</Label>
                <Input
                  id="template-footer"
                  placeholder="Optional footer text (max 60 chars)"
                  value={form.footer_text}
                  disabled={contractLocked}
                  onChange={(e) =>
                    setForm({ ...form, footer_text: e.target.value })
                  }
                  maxLength={TEMPLATE_LIMITS.footerMaxLength}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Buttons (optional)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addButton}
                    disabled={
                      contractLocked ||
                      form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal
                    }
                  >
                    <Plus />
                    Add button
                  </Button>
                </div>
                {form.buttons.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Up to {TEMPLATE_LIMITS.maxButtonsTotal} buttons. Put quick
                    replies before link, phone, or copy-code buttons.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.buttons.map((btn, i) => (
                      <fieldset
                        key={i}
                        className="border-border bg-muted/40 space-y-2 rounded-lg border p-3"
                      >
                        <legend className="text-muted-foreground px-1 text-xs font-medium">
                          Button {i + 1}
                        </legend>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                          <Select
                            value={btn.type}
                            disabled={contractLocked}
                            onValueChange={(val) => {
                              // Same null guard as the Header Select
                              // (per PR 148): @base-ui Select fires
                              // onValueChange(null) on deselect.
                              if (!val) return;
                              changeButtonType(
                                i,
                                val as TemplateButton['type']
                              );
                            }}
                          >
                            <SelectTrigger
                              className="w-full"
                              aria-label={`Button ${i + 1} type`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="QUICK_REPLY">
                                Quick reply
                              </SelectItem>
                              <SelectItem value="URL">Link</SelectItem>
                              <SelectItem value="PHONE_NUMBER">
                                Phone
                              </SelectItem>
                              <SelectItem value="COPY_CODE">
                                Copy code
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="Button label"
                            aria-label={`Button ${i + 1} label`}
                            value={btn.text}
                            disabled={contractLocked}
                            maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                            onChange={(e) =>
                              updateButton(i, { text: e.target.value })
                            }
                            className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                            required
                          />
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="icon-sm"
                            onClick={() => removeButton(i)}
                            disabled={contractLocked}
                            aria-label="Remove template button"
                            className="col-start-2 row-start-1 sm:col-start-3"
                          >
                            <X />
                          </Button>
                        </div>
                        {btn.type === 'URL' && (
                          <div className="space-y-2">
                            <Input
                              placeholder="https://example.com/path or with {{1}} suffix"
                              aria-label={`Button ${i + 1} URL`}
                              value={btn.url}
                              disabled={contractLocked}
                              onChange={(e) =>
                                updateButton(i, { url: e.target.value })
                              }
                              required
                            />
                            {extractVariableIndices(btn.url).length > 0 && (
                              <Input
                                placeholder="Example value for {{1}} (required when URL has a variable)"
                                aria-label={`Button ${i + 1} URL sample`}
                                value={btn.example ?? ''}
                                disabled={contractLocked}
                                onChange={(e) =>
                                  updateButton(i, { example: e.target.value })
                                }
                                required
                              />
                            )}
                          </div>
                        )}
                        {btn.type === 'PHONE_NUMBER' && (
                          <PhoneInput
                            placeholder="555 123 4567"
                            aria-label={`Button ${i + 1} phone number`}
                            value={btn.phone_number}
                            disabled={contractLocked}
                            onValueChange={(value) =>
                              updateButton(i, { phone_number: value })
                            }
                            required
                          />
                        )}
                        {btn.type === 'COPY_CODE' && (
                          <Input
                            placeholder="Example code (e.g. SUMMER20)"
                            aria-label={`Button ${i + 1} example code`}
                            value={btn.example}
                            disabled={contractLocked}
                            onChange={(e) =>
                              updateButton(i, { example: e.target.value })
                            }
                            required
                          />
                        )}
                      </fieldset>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <GatedButton
                type="submit"
                disabled={submitting || form.category === 'Authentication'}
                canAct={canEditSettings}
                gateReason="submit message templates"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {editingId ? 'Saving…' : 'Submitting…'}
                  </>
                ) : editingId ? (
                  'Save and resubmit'
                ) : (
                  'Submit for approval'
                )}
              </GatedButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Preset gallery — ready-made gym templates. Selecting one drops
          its copy into the create form for the gym to customise + submit.
          The header stays pinned while the list scrolls, so the Meta-review
          caveat and the group you are inside never scroll out of reach.

          Two columns from `lg` up. Ten presets stacked single-file ran 2.85
          screens of scroll inside a 672px dialog on a 1440px desktop — half
          the width left empty to make a comparison task into a linear one.
          Paired up in a 896px dialog the same ten fit six rows, and two
          candidates can finally be read side by side. */}
      <Dialog open={presetPickerOpen} onOpenChange={setPresetPickerOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle size="lg">Use a preset</DialogTitle>
            <DialogDescription className="max-w-[80ch]">
              Pick a message to open it in the template form. You submit to Meta
              from there — approval and recipient delivery are not guaranteed,
              and Meta can reclassify a template later.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-4 min-h-0 overflow-y-auto px-4 pb-1">
            {PRESET_GROUPS.map((group, groupIndex) => {
              const presets = TEMPLATE_PRESETS.filter(
                (preset) => preset.galleryGroup === group.id
              );
              return (
                <section
                  key={group.id}
                  // The rule and the 32px above it are the whole segregation
                  // device: three groups of bounded cards need a break that
                  // reads at a squint, and a heading alone did not give one.
                  className={
                    groupIndex === 0
                      ? undefined
                      : 'border-border/70 mt-8 border-t'
                  }
                >
                  {/* Only the group title pins. The description orients you
                      on the way in and is dead weight once read, so it scrolls
                      away and the persistent bar costs one line, not three. */}
                  <div
                    className={`bg-popover sticky top-0 z-10 flex items-center gap-2 pb-2 ${
                      groupIndex === 0 ? 'pt-0' : 'pt-5'
                    }`}
                  >
                    <h3 className="text-foreground text-sm font-semibold">
                      {group.title}
                    </h3>
                    <Badge variant="neutral" size="count">
                      {presets.length}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground max-w-[70ch] pb-3 text-xs leading-[1.5]">
                    {group.description}
                  </p>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {presets.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        preset={preset}
                        canAct={canEditSettings}
                        onUse={applyPreset}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog. Surfacing the meta_template_id case
          separately so users understand a real Meta delete is happening,
          not just a local cleanup. */}
      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setTemplateToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              {templateToDelete?.meta_template_id
                ? `"${templateToDelete?.name}" will be deleted from Meta and from UsefulDesk. Active broadcasts using this template will start failing on their next send. This can't be undone.`
                : `"${templateToDelete?.name}" will be deleted from UsefulDesk. It was never submitted to Meta, so no remote cleanup is needed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingId !== null}
            >
              Cancel
            </Button>
            <GatedButton
              variant="destructive"
              onClick={confirmDelete}
              disabled={deletingId !== null}
              canAct={canEditSettings}
              gateReason="delete message templates"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </GatedButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
