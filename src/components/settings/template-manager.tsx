'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Upload,
  MoreHorizontal,
  Send,
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
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { BubbleTail } from '@/components/inbox/message-bubble';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GatedButton } from '@/components/ui/gated-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ApprovalSteps } from './automated-message-setup';
import { SettingsPanelHead, SettingsSectionHead } from './settings-panel-head';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
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
  validateTemplatePayload,
} from '@/lib/whatsapp/template-validators';
import {
  TEMPLATE_PRESETS,
  presetWithLegalBusinessName,
  type TemplatePreset,
} from '@/lib/whatsapp/template-presets';
import { loadLegalBusinessName } from '@/lib/whatsapp/legal-business-name';
import {
  getTemplateContract,
  getTemplateContractById,
  type TemplateContractId,
} from '@/lib/whatsapp/template-contracts';
import {
  evaluateTemplateReadiness,
  type TemplateReadinessCode,
} from '@/lib/whatsapp/template-readiness';
import { REMINDER_RULES } from '@/lib/reminders/rules';
import { browserBranchId } from '@/lib/auth/branch-context';
import { getErrorMessage } from '@/lib/errors';
import { invalidateApprovedMessageTemplates } from '@/components/inbox/use-approved-message-templates';
import type { RequiredTemplateSubmissionSummary } from '@/lib/whatsapp/required-template-submission';

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
    description: 'Messages used by UsefulDesk features.',
  },
  {
    id: 'account_update',
    title: 'Account updates',
    description: 'Messages about a member’s account or payment.',
  },
  {
    id: 'marketing',
    title: 'Marketing',
    description: 'Offers you can send to members.',
  },
];

type GalleryFilter = 'all' | 'approved' | 'pending' | 'not_approved';

// These provider-approved names predate the current feature contracts. Keep
// them available for manual use and review without repeating their newer
// use cases in the main gallery.
const OLDER_TEMPLATE_NAMES = new Set([
  'gym_renewal_reminder',
  'gym_payment_due',
]);

function matchesGalleryFilter(
  template: MessageTemplate | undefined,
  filter: GalleryFilter
): boolean {
  if (filter === 'all') return true;
  const status = template?.provider_missing_since
    ? 'NOT_ON_META'
    : (template?.status ?? 'NOT_SUBMITTED');
  if (filter === 'approved') return status === 'APPROVED';
  if (filter === 'pending')
    return status === 'PENDING' || status === 'IN_APPEAL';
  return (
    status !== 'APPROVED' && status !== 'PENDING' && status !== 'IN_APPEAL'
  );
}

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

function previewSegments(
  bodyText: string,
  samples: string[],
  labels: string[]
): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  const pattern = /\{\{(\d+)\}\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(bodyText)) !== null) {
    if (match.index > cursor) {
      segments.push({
        kind: 'text',
        value: bodyText.slice(cursor, match.index),
      });
    }
    const slot = Number(match[1]) - 1;
    const label = labels[slot] ?? `Detail ${match[1]}`;
    segments.push({
      kind: 'slot',
      value: samples[slot]?.trim() || label,
      label,
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < bodyText.length) {
    segments.push({
      kind: 'text',
      value: bodyText.slice(cursor),
    });
  }
  return segments;
}

function TemplateMessagePreview({
  preset,
  template,
  placement = 'card',
}: {
  preset?: TemplatePreset;
  template?: MessageTemplate;
  placement?: 'card' | 'dialog';
}) {
  const buttons = template
    ? (template.buttons ?? [])
    : (preset?.fields.buttons ?? []);
  const footerText = template
    ? template.footer_text
    : preset?.fields.footer_text;
  const bodyText = template
    ? template.body_text
    : (preset?.fields.body_text ?? '');
  const samples = template
    ? (template.sample_values?.body ?? [])
    : (preset?.fields.body_samples ?? []);
  const labels = preset?.parameterLabels ?? [];
  const legalNameIndex = labels.indexOf('Legal business name');
  const previewSamples = [...samples];
  if (legalNameIndex >= 0) {
    previewSamples[legalNameIndex] =
      preset?.fields.body_samples[legalNameIndex] ?? '';
  }
  const identityUnavailable =
    legalNameIndex >= 0 && !previewSamples[legalNameIndex]?.trim();

  return (
    <div
      data-slot="template-message-preview"
      className={
        placement === 'dialog'
          ? 'bg-chat-canvas relative flex flex-col items-start overflow-hidden rounded-xl px-3 py-4'
          : 'bg-chat-canvas relative flex flex-1 flex-col items-start overflow-hidden px-3 py-3'
      }
    >
      <div
        aria-hidden
        className="chat-doodle pointer-events-none absolute inset-0"
      />
      <div
        className={`bg-chat-bubble-in text-foreground relative w-fit rounded-lg rounded-tl-none p-1 shadow-[var(--chat-bubble-shadow)] ${placement === 'dialog' ? 'max-w-[92%]' : 'max-w-[88%]'}`}
      >
        <BubbleTail side="left" />
        {template?.header_type && (
          <p className="text-chat-meta px-1.5 pt-0.5 text-xs font-medium">
            {template.header_type === 'text'
              ? template.header_content || 'Text header'
              : `${template.header_type} header`}
          </p>
        )}
        <p className="px-1.5 py-0.5 text-sm break-words whitespace-pre-wrap">
          {identityUnavailable ? (
            'Preview unavailable until the legal business name can be loaded.'
          ) : (
            <>
              <span className="sr-only">
                Sample message. Filled-in details:{' '}
                {labels.length ? labels.join(', ') : 'Template variables'}.{' '}
              </span>
              {previewSegments(bodyText, previewSamples, labels).map(
                (segment, i) =>
                  segment.kind === 'slot' ? (
                    <span key={i} title={segment.label} className="font-medium">
                      {segment.value}
                    </span>
                  ) : (
                    <span key={i}>{segment.value}</span>
                  )
              )}
            </>
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
  );
}

const categoryVariants: Record<string, TemplateBadgeVariant> = {
  Marketing: 'violet',
  Utility: 'info',
  Authentication: 'warning',
};

/**
 * One message in the combined gallery.
 *
 * The sample is drawn as a WhatsApp bubble on the inbox's own chat
 * canvas — same fill and meta tokens, same tail geometry, same doodle
 * wallpaper. Linked templates use their stored provider copy, while a
 * missing template uses the preset copy. The legal-name example always shows
 * the selected branch's current identity, even if Meta stores an older sample.
 *
 * Card, not a rule-separated block: at two columns a shared hairline no
 * longer says which preset owns which message, so each one needs its own
 * bounded surface. The chat band takes the slack (`flex-1`) so the footer
 * strips of two side-by-side cards land on the same line whatever their
 * messages measure.
 */
function TemplateGalleryCard({
  preset,
  template,
  canAct,
  onUse,
  onEdit,
  onSync,
  onDelete,
  syncing,
  deleting,
}: {
  preset?: TemplatePreset;
  template?: MessageTemplate;
  canAct: boolean;
  onUse: (preset: TemplatePreset) => void;
  onEdit: (template: MessageTemplate) => void;
  onSync: () => void;
  onDelete: (template: MessageTemplate) => void;
  syncing: boolean;
  deleting: boolean;
}) {
  const statusKey = template?.status || 'DRAFT';
  const status = template
    ? resolveTemplateStatusDisplay(statusKey, template.provider_missing_since)
    : null;
  const action = template?.provider_missing_since
    ? 'Check status'
    : statusKey === 'APPROVED'
      ? 'Edit'
      : statusKey === 'PENDING' ||
          statusKey === 'IN_APPEAL' ||
          statusKey === 'DISABLED' ||
          statusKey === 'PENDING_DELETION'
        ? 'Check status'
        : statusKey === 'REJECTED' || statusKey === 'PAUSED'
          ? 'Resubmit'
          : 'Submit draft';

  return (
    <Card data-slot={preset ? 'preset' : 'template'} size="sm">
      <CardHeader className="min-h-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="text-foreground text-sm font-medium">
            {preset?.title ?? template?.name}
          </h4>
          <Badge
            variant={
              categoryVariants[template?.category ?? preset?.category ?? ''] ||
              'neutral'
            }
          >
            {template?.category ?? preset?.category}
          </Badge>
          {status ? (
            <Badge
              variant={
                template?.provider_missing_since
                  ? 'danger'
                  : statusVariant(statusKey)
              }
            >
              {status.label}
            </Badge>
          ) : (
            <Badge variant="neutral">Ready-made</Badge>
          )}
          {template?.quality_score && (
            <Badge
              variant={qualityVariant(template.quality_score)}
              title="Meta quality score"
            >
              Quality: {template.quality_score.toLowerCase()}
            </Badge>
          )}
        </div>
        {template && (
          <p className="text-muted-foreground text-xs">
            {preset ? `${template.name} · ` : ''}
            {template.language || 'en_US'}
          </p>
        )}
      </CardHeader>

      {/* A direct child of Card, not CardContent: the band wants the card's
          full width the way a card's leading image does, and the message is
          the thing being chosen, so it gets its own plane. The card then
          reads as three zones — what it is, what it says, when and how to
          take it. Matching the header's `px-3` puts the bubble body on the
          title's left edge and leaves the tail to hang into the gutter the
          way it does in the thread. */}
      <TemplateMessagePreview preset={preset} template={template} />

      {template &&
        (template.provider_missing_since ||
          template.rejection_reason ||
          template.submission_error) && (
          <CardContent className="text-destructive text-xs">
            {template.provider_missing_since
              ? 'WhatsApp did not show this message in the last check.'
              : template.rejection_reason || template.submission_error}
          </CardContent>
        )}

      <CardFooter className="items-end gap-3">
        {preset && (
          <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-[1.5]">
            <span className="text-foreground font-medium">Used when: </span>
            {preset.trigger}
          </p>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {template ? (
            <>
              <GatedButton
                size="sm"
                variant="outline"
                onClick={() =>
                  action === 'Check status' ? onSync() : onEdit(template)
                }
                disabled={syncing}
                loading={action === 'Check status' && syncing}
                canAct={canAct}
                gateReason={
                  action === 'Check status'
                    ? 'sync message templates from Meta'
                    : 'edit message templates'
                }
              >
                {action}
              </GatedButton>
              <GatedButton
                variant="destructive-ghost"
                size="icon-sm"
                onClick={() => onDelete(template)}
                loading={deleting}
                canAct={canAct}
                gateReason="delete message templates"
                aria-label={`Delete ${template.name}`}
                title={
                  template.meta_template_id && !template.provider_missing_since
                    ? 'Delete from Meta and UsefulDesk'
                    : 'Delete from UsefulDesk'
                }
              >
                <Trash2 />
              </GatedButton>
            </>
          ) : preset ? (
            <GatedButton
              size="sm"
              variant="outline"
              onClick={() => onUse(preset)}
              canAct={canAct}
              gateReason="create message templates"
            >
              {preset.wired ? 'Use this message' : 'Use as draft'}
            </GatedButton>
          ) : null}
        </div>
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
] as const;

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

function formFromPreset(preset: TemplatePreset): TemplateFormData {
  const f = preset.fields;
  return {
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
  };
}

function formFromTemplate(template: MessageTemplate): TemplateFormData {
  return {
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
  };
}

type SetupAction = 'submit' | 'resubmit' | 'sync' | 'review' | 'return';

interface SetupStateCopy {
  action: SetupAction;
  title: string;
  description: string;
  destructive?: boolean;
}

function resolveSetupStateCopy(
  template: MessageTemplate | null,
  readinessCode: TemplateReadinessCode
): SetupStateCopy {
  const status = template?.status ?? 'DRAFT';

  if (!template || status === 'DRAFT') {
    return {
      action: 'submit',
      title: 'Needs WhatsApp review',
      description:
        'Send this message to WhatsApp for approval. It will not turn on by itself — you choose when to start sending.',
    };
  }

  if (status === 'REJECTED') {
    return {
      action: 'resubmit',
      title: 'WhatsApp did not approve it',
      description: 'See why in Details. Then send it for review again.',
      destructive: true,
    };
  }

  if (status === 'PAUSED') {
    return {
      action: 'resubmit',
      title: 'WhatsApp paused this message',
      description: 'Send it for review again.',
    };
  }

  if (status === 'PENDING' || status === 'IN_APPEAL') {
    return {
      action: 'sync',
      title:
        status === 'PENDING'
          ? 'Waiting for WhatsApp review'
          : 'WhatsApp is reviewing it again',
      description:
        'WhatsApp usually reviews a message within minutes, sometimes up to 24 hours. Check its status after WhatsApp reviews it.',
    };
  }

  if (template.provider_missing_since) {
    return {
      action: 'review',
      title: 'Message not found on WhatsApp',
      description:
        'WhatsApp did not show it in the last check. Open Templates to fix it.',
      destructive: true,
    };
  }

  if (status === 'APPROVED' && readinessCode === 'ready') {
    return {
      action: 'return',
      title: 'Approved for WhatsApp',
      description: 'This message is ready. Go back to Messages.',
    };
  }

  if (
    status === 'APPROVED' &&
    ['component_drift', 'parameter_drift', 'wrong_parameter_format'].includes(
      readinessCode
    )
  ) {
    return {
      action: 'resubmit',
      title: 'Message needs updating',
      description:
        'This feature needs different text. Update it and send it for review again.',
    };
  }

  if (status === 'APPROVED' && readinessCode === 'wrong_category') {
    return {
      action: 'review',
      title: 'Message category needs replacing',
      description:
        'This message has the wrong type. Open Templates to replace it.',
      destructive: true,
    };
  }

  if (status === 'APPROVED' && readinessCode === 'provider_sync_required') {
    return {
      action: 'sync',
      title: 'Check WhatsApp status',
      description: 'WhatsApp changed this message. Check its status and text.',
    };
  }

  if (status === 'DISABLED') {
    return {
      action: 'sync',
      title: 'WhatsApp disabled this message',
      description: 'Check it in WhatsApp Manager. Then check its status here.',
      destructive: true,
    };
  }

  return {
    action: 'sync',
    title: 'Check WhatsApp status',
    description: 'Check its status before you continue.',
  };
}

export function TemplateManager({
  setupContractId,
  onSetupClose,
}: {
  setupContractId?: TemplateContractId;
  onSetupClose?: (submitted: boolean) => void;
} = {}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, canEditSettings, loading: authLoading } = useAuth();
  const focusedContractId = setupContractId ?? searchParams.get('contract');
  const focusedContract = focusedContractId
    ? getTemplateContractById(focusedContractId as TemplateContractId)
    : null;
  const focusedRule = REMINDER_RULES.find(
    (rule) => rule.id === searchParams.get('rule')
  );
  const safeReturnTo =
    focusedRule &&
    focusedContract &&
    (focusedRule.templateContracts as readonly TemplateContractId[]).includes(
      focusedContract.id
    )
      ? (() => {
          const params = new URLSearchParams({
            tab: 'reminders',
            rule: focusedRule.id,
          });
          const branchId = browserBranchId();
          if (branchId) params.set('branch', branchId);
          return `/settings?${params.toString()}`;
        })()
      : null;
  const focusedTemplatesUrl = focusedContract
    ? (() => {
        const params = new URLSearchParams({
          tab: 'templates',
          contract: focusedContract.id,
        });
        if (
          focusedRule &&
          (
            focusedRule.templateContracts as readonly TemplateContractId[]
          ).includes(focusedContract.id)
        ) {
          params.set('rule', focusedRule.id);
        }
        const branchId = browserBranchId();
        if (branchId) params.set('branch', branchId);
        return `/settings?${params.toString()}`;
      })()
    : null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('all');
  const [legalIdentity, setLegalIdentity] = useState<{
    accountId: string;
    name: string | null;
  } | null>(null);
  const legalBusinessName =
    legalIdentity?.accountId === accountId ? legalIdentity.name : null;
  useEffect(() => {
    if (authLoading || !accountId) return;
    let cancelled = false;
    void (async () => {
      const identity = await loadLegalBusinessName(
        supabase as unknown as Parameters<typeof loadLegalBusinessName>[0],
        accountId
      );
      if (!cancelled) {
        setLegalIdentity({
          accountId,
          name: identity.ok ? identity.name : null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, authLoading, supabase, reloadNonce]);
  const presets = useMemo(
    () =>
      TEMPLATE_PRESETS.map((preset) =>
        presetWithLegalBusinessName(preset, legalBusinessName)
      ),
    [legalBusinessName]
  );
  const gallery = useMemo(() => {
    const linkedIds = new Set<string>();
    const presetCards = presets.map((preset) => {
      const template = preset.wired
        ? templates.find(
            (item) =>
              item.name === preset.fields.name &&
              (item.language || 'en_US') === 'en_US' &&
              !linkedIds.has(item.id)
          )
        : undefined;
      if (template) linkedIds.add(template.id);
      return { preset, template };
    });
    const otherCards = templates
      .filter((template) => !linkedIds.has(template.id))
      .map((template) => ({ preset: undefined, template }));
    return [...presetCards, ...otherCards];
  }, [presets, templates]);
  const galleryCounts = {
    all: gallery.length,
    approved: gallery.filter((item) =>
      matchesGalleryFilter(item.template, 'approved')
    ).length,
    pending: gallery.filter((item) =>
      matchesGalleryFilter(item.template, 'pending')
    ).length,
    not_approved: gallery.filter((item) =>
      matchesGalleryFilter(item.template, 'not_approved')
    ).length,
  };
  const unmatchedTemplates = gallery.filter(
    (item) => !item.preset && matchesGalleryFilter(item.template, galleryFilter)
  );
  const otherTemplates = unmatchedTemplates.filter(
    (item) => !item.template || !OLDER_TEMPLATE_NAMES.has(item.template.name)
  );
  const olderTemplates = unmatchedTemplates.filter(
    (item) => item.template && OLDER_TEMPLATE_NAMES.has(item.template.name)
  );
  const focusedPreset = focusedContract
    ? (presets.find((preset) => preset.id === focusedContract.id) ?? null)
    : null;
  const focusedTemplate = focusedContract
    ? (templates.find(
        (template) => template.name === focusedContract.payload.name
      ) ?? null)
    : null;
  const [dialogOpen, setDialogOpen] = useState(Boolean(setupContractId));
  const [submitting, setSubmitting] = useState(false);
  const [submittingRequired, setSubmittingRequired] = useState(false);
  const submittingRequiredRef = useRef(false);
  const [requiredSubmissionSummary, setRequiredSubmissionSummary] =
    useState<RequiredTemplateSubmissionSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  // Non-null when the dialog is editing an existing row — switches the
  // submit handler from POST /submit to PATCH /[id] and changes the
  // dialog title + CTA. Set to the template id to pre-fill from a row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const setupTemplate = setupContractId
    ? templates.find(
        (template) =>
          template.name === focusedContract?.payload.name &&
          template.language === 'en_US'
      )
    : null;
  const setupReadiness = setupContractId
    ? evaluateTemplateReadiness(templates, setupContractId)
    : null;
  const setupState = setupContractId
    ? resolveSetupStateCopy(
        setupTemplate ?? null,
        setupReadiness?.code ?? 'missing'
      )
    : null;
  const setupMaySubmit =
    setupState?.action === 'submit' || setupState?.action === 'resubmit';
  // Feature-backed presets are exact application contracts. Lock every
  // provider component while creating one, including its language.
  const [contractLocked, setContractLocked] = useState(false);
  const lockedPreset = contractLocked
    ? (presets.find(
        (preset) => preset.wired && preset.fields.name === form.name
      ) ?? null)
    : null;
  const lockedContractLanguage = lockedPreset
    ? getTemplateContractById(lockedPreset.id)?.payload.language
    : null;
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
  const formLegalSampleIndex =
    getTemplateContract(form.name)?.parameterLabels.indexOf(
      'Legal business name'
    ) ?? -1;
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
        if (setupContractId) {
          const contract = getTemplateContractById(setupContractId);
          const preset = TEMPLATE_PRESETS.find(
            (item) => item.id === setupContractId
          );
          if (!contract || !preset)
            throw new Error('The required template preset is unavailable.');
          const existing = data?.find(
            (item) =>
              item.name === contract.payload.name && item.language === 'en_US'
          );
          setEditingId(
            (existing?.status ?? 'DRAFT') === 'DRAFT'
              ? null
              : (existing?.id ?? null)
          );
          setContractLocked(true);
          const exactForm = formFromPreset(preset);
          setForm({
            ...exactForm,
            header_media_url: existing?.header_media_url ?? '',
          });
        }
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
  }, [accountId, authLoading, reloadNonce, setupContractId, supabase]);

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    const bodySamples = form.body_samples.map((v) => v.trim());
    const builtInContract = getTemplateContract(form.name);
    if (builtInContract) {
      const index = builtInContract.parameterLabels.indexOf(
        'Legal business name'
      );
      if (index >= 0 && index < bodySamples.length) {
        bodySamples[index] = legalBusinessName?.trim() ?? '';
      }
    }
    if (bodySamples.some(Boolean)) {
      sample_values.body = bodySamples;
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: lockedContractLanguage ?? (form.language.trim() || 'en_US'),
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
    setEditingId(null);
    setContractLocked(preset.wired);
    setForm(
      formFromPreset(presetWithLegalBusinessName(preset, legalBusinessName))
    );
    setDialogOpen(true);
  }

  function openEdit(template: MessageTemplate) {
    // DRAFT rows have no Meta identity. The create endpoint upserts them by
    // account/name/language; PATCH only accepts submitted provider templates.
    setEditingId((template.status ?? 'DRAFT') === 'DRAFT' ? null : template.id);
    setContractLocked(false);
    const nextForm = formFromTemplate(template);
    const contract = getTemplateContract(template.name);
    const index =
      contract?.parameterLabels.indexOf('Legal business name') ?? -1;
    if (index >= 0 && index < nextForm.body_samples.length) {
      nextForm.body_samples = [...nextForm.body_samples];
      nextForm.body_samples[index] = legalBusinessName ?? '';
    }
    setForm(nextForm);
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
    if (
      !canEditSettings ||
      form.category === 'Authentication' ||
      (setupContractId &&
        (loading || loadError || !accountId || !setupMaySubmit))
    )
      return;
    const builtInContract = getTemplateContract(form.name);
    const legalSampleIndex = builtInContract?.parameterLabels.indexOf(
      'Legal business name'
    );
    if (
      legalSampleIndex !== undefined &&
      legalSampleIndex >= 0 &&
      legalSampleIndex < form.body_samples.length &&
      !legalBusinessName
    ) {
      toast.error('Set the legal business name in Business details first.');
      return;
    }
    try {
      setSubmitting(true);
      const payload = buildSubmitPayload();
      validateTemplatePayload(payload);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ||
            `${isEdit ? 'Edit' : 'Submit'} failed (HTTP ${res.status})`
        );
      }
      setReloadNonce((nonce) => nonce + 1);
      if (accountId) invalidateApprovedMessageTemplates(accountId);
      toast.success(
        setupContractId
          ? data.dry_run
            ? 'Message saved for testing. No WhatsApp approval request was sent.'
            : 'Sent for WhatsApp review. This does not turn the message on.'
          : data.dry_run
            ? isEdit
              ? 'Message updated for testing. Nothing was sent to WhatsApp.'
              : 'Message saved for testing. Nothing was sent to WhatsApp.'
            : isEdit
              ? 'Changes sent for WhatsApp review. Check the status later.'
              : 'Sent for WhatsApp review. Check the status later.'
      );
      if (data.warning) toast.error(String(data.warning), { duration: 10000 });
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      setContractLocked(false);
      onSetupClose?.(true);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(
        getErrorMessage(
          err,
          setupContractId
            ? 'Could not send for WhatsApp review'
            : 'Could not send message for review'
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function syncTemplatesFromMeta(announceSuccess: boolean) {
    const res = await fetch('/api/whatsapp/templates/sync', {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
    }
    if (announceSuccess) {
      toast.success(
        `Checked ${data.total} message${data.total === 1 ? '' : 's'} on WhatsApp` +
          (data.inserted || data.updated
            ? ` (${data.inserted} new, ${data.updated} updated)`
            : '')
      );
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const preview = data.errors
        .slice(0, 3)
        .map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`
        );
      const suffix =
        data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
      toast.error(`Could not check: ${preview.join(', ')}${suffix}`);
    }
    if (data.truncated) {
      toast.error(
        'Only the first 2,000 messages were checked. Check again to load more. If this keeps happening, contact support.',
        { duration: 10000 }
      );
    }
    if (Number(data.newly_missing) > 0) {
      toast.error(
        `${data.newly_missing} message${data.newly_missing === 1 ? ' is' : 's are'} missing from WhatsApp. We turned them off and kept them for review.`,
        { duration: 10000 }
      );
    }
    setReloadNonce((nonce) => nonce + 1);
    if (accountId) invalidateApprovedMessageTemplates(accountId);
  }

  async function handleSyncFromMeta() {
    if (!accountId || !canEditSettings) return;
    setSyncing(true);
    try {
      await syncTemplatesFromMeta(true);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(getErrorMessage(err, 'Could not check WhatsApp messages'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubmitRequiredTemplates() {
    if (!accountId || !canEditSettings || submittingRequiredRef.current) {
      return;
    }
    submittingRequiredRef.current = true;
    setSubmittingRequired(true);
    setRequiredSubmissionSummary(null);
    try {
      const response = await fetch('/api/whatsapp/templates/submit-required', {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data?.error || `Submission failed (HTTP ${response.status})`
        );
      }
      const summary = data as RequiredTemplateSubmissionSummary;
      setRequiredSubmissionSummary(summary);
      if (summary.failed > 0) {
        toast.error(
          `Sent ${summary.submitted} for review. ${summary.failed} need help.`,
          { duration: 10000 }
        );
      } else if (summary.submitted > 0) {
        toast.success(
          `Sent ${summary.submitted} message${summary.submitted === 1 ? '' : 's'} for WhatsApp review.`
        );
      } else {
        toast.success('All needed messages are ready or waiting for review.');
      }

      try {
        await syncTemplatesFromMeta(false);
      } catch (syncError) {
        console.error('Post-submission template sync error:', syncError);
        toast.error(
          getErrorMessage(
            syncError,
            'We could not check the latest WhatsApp status'
          ),
          { duration: 10000 }
        );
        setReloadNonce((nonce) => nonce + 1);
      }
    } catch (error) {
      console.error('Required template submission error:', error);
      toast.error(
        getErrorMessage(error, 'Could not send needed messages for review')
      );
    } finally {
      submittingRequiredRef.current = false;
      setSubmittingRequired(false);
    }
  }

  function openFocusedTemplates() {
    if (!focusedTemplatesUrl) return;
    setDialogOpen(false);
    onSetupClose?.(false);
    router.replace(focusedTemplatesUrl);
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
      if (accountId) invalidateApprovedMessageTemplates(accountId);
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

  const editorDialog = (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) {
          setEditingId(null);
          setContractLocked(false);
          setForm(emptyForm);
          onSetupClose?.(false);
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle size="lg">
            {setupContractId
              ? 'Set up message'
              : editingId
                ? 'Edit template'
                : 'New template'}
          </DialogTitle>
          <DialogDescription>
            {setupContractId
              ? `Check the message and its WhatsApp status.`
              : editingId
                ? 'Save changes and send this message for WhatsApp review.'
                : 'Create a message for WhatsApp to review.'}
          </DialogDescription>
        </DialogHeader>

        {setupContractId && (loading || loadError || !accountId) ? (
          <div className="space-y-4">
            {loadError || (!loading && !accountId) ? (
              <Alert variant="destructive">
                <AlertTitle>Template couldn’t load</AlertTitle>
                <AlertDescription>
                  {loadError || 'Select a branch to set up this template.'}
                </AlertDescription>
              </Alert>
            ) : (
              <p role="status" className="text-muted-foreground text-sm">
                Loading message…
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onSetupClose?.(false)}>
                Cancel
              </Button>
              {loadError ? (
                <Button onClick={() => setReloadNonce((value) => value + 1)}>
                  Try again
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : setupContractId && focusedPreset && setupState ? (
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <TemplateMessagePreview preset={focusedPreset} placement="dialog" />

            <div className="space-y-1">
              <div className="text-sm font-medium">What it does</div>
              <div className="text-muted-foreground text-sm">
                {focusedPreset.blurb}
              </div>
            </div>

            <ApprovalSteps
              current={
                setupState.action === 'return'
                  ? 3
                  : setupTemplate?.status === 'PENDING' ||
                      setupTemplate?.status === 'IN_APPEAL'
                    ? 2
                    : 1
              }
            />

            <Alert variant={setupState.destructive ? 'destructive' : 'default'}>
              <AlertCircle />
              <AlertTitle>{setupState.title}</AlertTitle>
              <AlertDescription>{setupState.description}</AlertDescription>
            </Alert>

            {headerNeedsMedia && setupMaySubmit ? (
              <div className="space-y-2">
                <Label htmlFor="locked-template-header-media">
                  {form.header_format === 'document'
                    ? 'PDF link for review'
                    : `${form.header_format} link for review`}
                </Label>
                {form.header_format === 'image' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={headerFileRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleHeaderImageFile(file);
                        event.target.value = '';
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={uploadingHeader}
                      onClick={() => headerFileRef.current?.click()}
                    >
                      <Upload />
                      Upload image
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      JPEG or PNG, up to 5 MB
                    </span>
                  </div>
                ) : null}
                <Input
                  id="locked-template-header-media"
                  type="url"
                  placeholder="https://…"
                  value={form.header_media_url}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      header_media_url: event.target.value,
                    })
                  }
                  required
                />
                <div className="text-muted-foreground text-xs leading-relaxed">
                  Use a public HTTPS link. WhatsApp uses it only for review.
                </div>
              </div>
            ) : null}

            <Accordion>
              <AccordionItem value="technical-details">
                <AccordionTrigger>Details</AccordionTrigger>
                <AccordionContent>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <dt className="text-muted-foreground text-xs">
                        Template name
                      </dt>
                      <dd>
                        <code className="break-all">{form.name}</code>
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground text-xs">
                        Category
                      </dt>
                      <dd>{form.category}</dd>
                    </div>
                    {setupTemplate &&
                    setupTemplate.category !== form.category ? (
                      <div className="space-y-1">
                        <dt className="text-muted-foreground text-xs">
                          WhatsApp category
                        </dt>
                        <dd>{setupTemplate.category}</dd>
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <dt className="text-muted-foreground text-xs">Header</dt>
                      <dd>
                        {form.header_format === 'none'
                          ? 'No header'
                          : form.header_format.charAt(0).toUpperCase() +
                            form.header_format.slice(1)}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-muted-foreground text-xs">
                        Language
                      </dt>
                      <dd>{form.language}</dd>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <dt className="text-muted-foreground text-xs">
                        WhatsApp status
                      </dt>
                      <dd>
                        {setupTemplate
                          ? resolveTemplateStatusDisplay(
                              setupTemplate.status ?? 'DRAFT',
                              setupTemplate.provider_missing_since
                            ).label
                          : 'Not submitted'}
                      </dd>
                    </div>
                    {setupTemplate?.rejection_reason ||
                    setupTemplate?.submission_error ? (
                      <div className="space-y-1 sm:col-span-2">
                        <dt className="text-muted-foreground text-xs">
                          Review details
                        </dt>
                        <dd>
                          {setupTemplate.rejection_reason ||
                            setupTemplate.submission_error}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <DialogFooter className="sticky -bottom-4 z-10">
              {setupState.action === 'return' ? (
                <Button type="button" onClick={() => onSetupClose?.(false)}>
                  Return to Messages
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onSetupClose?.(false)}
                  >
                    Cancel
                  </Button>
                  {setupState.action === 'review' ? (
                    <GatedButton
                      type="button"
                      canAct={canEditSettings}
                      gateReason="review this message in Templates"
                      onClick={openFocusedTemplates}
                    >
                      Open Templates
                    </GatedButton>
                  ) : setupState.action === 'sync' ? (
                    <GatedButton
                      type="button"
                      loading={syncing}
                      canAct={canEditSettings}
                      gateReason="sync the WhatsApp approval status"
                      onClick={handleSyncFromMeta}
                    >
                      Check status
                    </GatedButton>
                  ) : (
                    <GatedButton
                      type="submit"
                      loading={submitting}
                      canAct={canEditSettings}
                      gateReason="submit this message for WhatsApp approval"
                    >
                      {setupState.action === 'resubmit'
                        ? setupTemplate?.status === 'APPROVED'
                          ? 'Update and send for review'
                          : 'Send for review again'
                        : 'Send for review'}
                    </GatedButton>
                  )}
                </>
              )}
            </DialogFooter>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={handleSubmit}>
            {contractLocked && lockedPreset ? (
              <div className="space-y-5">
                {headerNeedsMedia ? (
                  <div className="space-y-2">
                    <Label htmlFor="locked-template-header-media">
                      {form.header_format === 'document'
                        ? 'PDF link for review'
                        : `${form.header_format} link for review`}
                    </Label>
                    {form.header_format === 'image' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={headerFileRef}
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void handleHeaderImageFile(file);
                            event.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={uploadingHeader}
                          onClick={() => headerFileRef.current?.click()}
                        >
                          <Upload />
                          Upload image
                        </Button>
                        <span className="text-muted-foreground text-xs">
                          JPEG or PNG, up to 5 MB
                        </span>
                      </div>
                    ) : null}
                    <Input
                      id="locked-template-header-media"
                      type="url"
                      placeholder="https://…"
                      value={form.header_media_url}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          header_media_url: event.target.value,
                        })
                      }
                      required
                    />
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Use a public HTTPS link. WhatsApp uses it only for review.
                    </p>
                  </div>
                ) : null}

                <TemplateMessagePreview
                  preset={lockedPreset}
                  placement="dialog"
                />

                <dl className="grid gap-3 border-t pt-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <dt className="text-muted-foreground text-xs">
                      Template name
                    </dt>
                    <dd>
                      <code className="break-all">{form.name}</code>
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-muted-foreground text-xs">
                      Message type
                    </dt>
                    <dd>{form.category}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-muted-foreground text-xs">Header</dt>
                    <dd>
                      {form.header_format === 'none'
                        ? 'No header'
                        : form.header_format.charAt(0).toUpperCase() +
                          form.header_format.slice(1)}
                    </dd>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <dt className="text-muted-foreground text-xs">
                      What it does
                    </dt>
                    <dd>{lockedPreset.blurb}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
            {!contractLocked && form.category === 'Authentication' && (
              <Alert>
                <AlertCircle />
                <AlertTitle>
                  Sign-in messages must be made in WhatsApp Manager
                </AlertTitle>
                <AlertDescription>
                  Create them in WhatsApp Manager, then update this list from
                  WhatsApp.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-4" hidden={contractLocked}>
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
                    ? 'You cannot change the name after you save it.'
                    : contractLocked
                      ? 'This feature needs this exact name.'
                      : 'Use small letters, numbers, and underscores only.'}
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
                    disabled={editingId !== null || contractLocked}
                    required
                  />
                  <datalist id="template-language-codes">
                    {COMMON_LANGUAGE_CODES.map((code) => (
                      <option key={code} value={code} />
                    ))}
                  </datalist>
                  <p className="text-muted-foreground text-xs">
                    {editingId ? (
                      'You cannot change the language after you save it.'
                    ) : (
                      <>
                        Use the language code shown in WhatsApp. For example,{' '}
                        <code>en_US</code> and <code>en</code> mean different
                        things.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-header-format">Top of message</Label>
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
                      Text at top
                    </Label>
                    <Input
                      id="template-header-text"
                      placeholder="Up to 60 characters"
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
                          placeholder="Example for review"
                          value={form.header_sample}
                          disabled={contractLocked}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              header_sample: e.target.value,
                            })
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
                          JPEG or PNG, up to 5 MB
                        </span>
                      </div>
                    )}
                    <Label htmlFor="template-header-media" size="sm">
                      Link to public {form.header_format}
                    </Label>
                    <Input
                      id="template-header-media"
                      type="url"
                      placeholder="https://…"
                      value={form.header_media_url}
                      onChange={(e) =>
                        setForm({ ...form, header_media_url: e.target.value })
                      }
                      disabled={contractLocked}
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
                        ? 'Upload a JPEG or PNG, or use a public HTTPS link. WhatsApp needs it for review.'
                        : 'Use a public HTTPS link. Keep the file there for 24 hours so WhatsApp can review it.'}
                      {form.header_format === 'video' &&
                        ' Use MP4 or 3GPP, up to 16 MB and 60 seconds.'}
                      {form.header_format === 'document' &&
                        ' Use a PDF, up to 100 MB.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-body">Message text</Label>
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
                  Use {`{{1}}`}, {`{{2}}`} where UsefulDesk should fill in
                  details. Keep the numbers in order. Add words before and after
                  them so WhatsApp can approve the message.
                </p>

                {bodyVarCount > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <Label size="sm">Examples for WhatsApp review</Label>
                    {formLegalSampleIndex >= 0 && (
                      <p className="text-muted-foreground text-xs">
                        The legal business name comes from Business details.
                      </p>
                    )}
                    {form.body_samples.map((val, i) => {
                      const inputId = `template-body-sample-${i}`;
                      return (
                        <Input
                          key={i}
                          id={inputId}
                          aria-label={`Sample value for body variable {{${i + 1}}}`}
                          placeholder={`Sample for {{${i + 1}}}`}
                          value={
                            i === formLegalSampleIndex
                              ? (legalBusinessName ?? '')
                              : val
                          }
                          disabled={
                            contractLocked || i === formLegalSampleIndex
                          }
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
                <Label htmlFor="template-footer">
                  Text at bottom (optional)
                </Label>
                <Input
                  id="template-footer"
                  placeholder="Footer text (up to 60 characters)"
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
                    Add up to {TEMPLATE_LIMITS.maxButtonsTotal} buttons. Put
                    reply buttons before links or phone buttons.
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
                              placeholder="https://example.com/page"
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
                                placeholder="Example for {{1}}"
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
                            placeholder="Example code, like SUMMER20"
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

            <DialogFooter className="sticky -bottom-4 z-10">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {contractLocked ? (
                  <p className="text-muted-foreground text-xs leading-relaxed sm:max-w-xs">
                    WhatsApp must approve this message before automated messages
                    can use it.
                  </p>
                ) : (
                  <span />
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      onSetupClose?.(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <GatedButton
                    type="submit"
                    loading={submitting}
                    disabled={form.category === 'Authentication'}
                    canAct={canEditSettings}
                    gateReason="submit message templates"
                  >
                    {editingId ? 'Save and send for review' : 'Send for review'}
                  </GatedButton>
                </div>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );

  if (setupContractId) return editorDialog;

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title="Message templates"
        description="Choose WhatsApp messages and check if they are ready to use."
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="More template actions"
                    loading={submittingRequired || syncing}
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-56">
                <DropdownMenuItem
                  onClick={handleSubmitRequiredTemplates}
                  disabled={
                    !canEditSettings || loading || syncing || !accountId
                  }
                  title={
                    !canEditSettings
                      ? "Read-only — your role can't submit required message templates"
                      : undefined
                  }
                >
                  <Send />
                  Send needed messages for review
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSyncFromMeta}
                  disabled={
                    !canEditSettings ||
                    submittingRequired ||
                    loading ||
                    !accountId
                  }
                  title={
                    !canEditSettings
                      ? "Read-only — your role can't sync message templates from Meta"
                      : 'Get templates from your WhatsApp account'
                  }
                >
                  <RefreshCw />
                  Update from WhatsApp
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {requiredSubmissionSummary ? (
        <Alert
          variant={
            requiredSubmissionSummary.failed > 0 ? 'destructive' : 'default'
          }
        >
          <AlertTitle>
            {requiredSubmissionSummary.failed > 0
              ? 'Some messages need help'
              : 'Messages sent for review'}
          </AlertTitle>
          <AlertDescription>
            <p>
              Sent {requiredSubmissionSummary.submitted} · Ready or waiting{' '}
              {requiredSubmissionSummary.already_ready_or_pending} · Failed{' '}
              {requiredSubmissionSummary.failed} · Total{' '}
              {requiredSubmissionSummary.total}
            </p>
            {requiredSubmissionSummary.failed > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {requiredSubmissionSummary.results
                  .filter((result) => result.outcome === 'failed')
                  .map((result) => (
                    <li key={result.contract_id}>
                      {result.name} — {result.error ?? 'Submission failed.'}
                    </li>
                  ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {focusedContract ? (
        <Alert>
          <AlertTitle>{focusedContract.title}</AlertTitle>
          <AlertDescription>
            <p>
              To use this feature, choose the message named{' '}
              <span className="font-medium">
                {focusedContract.payload.name}
              </span>
              . Use the ready-made message or update your list from WhatsApp.
            </p>
            {safeReturnTo ? (
              <Button
                variant="link"
                size="sm"
                className="px-0"
                onClick={() => router.replace(safeReturnTo)}
              >
                Return to Messages
              </Button>
            ) : null}
            {focusedPreset ? (
              <GatedButton
                variant="outline"
                size="sm"
                className="mt-2"
                canAct={canEditSettings}
                gateReason={
                  focusedTemplate
                    ? 'edit this message template'
                    : 'create this message template'
                }
                onClick={() => {
                  if (focusedTemplate) openEdit(focusedTemplate);
                  else applyPreset(focusedPreset);
                }}
              >
                {focusedTemplate
                  ? `Open ${focusedContract.payload.name}`
                  : `Set up ${focusedContract.title}`}
              </GatedButton>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!canEditSettings ? (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Ask an admin or owner to change message templates.
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
      ) : (
        <div className="space-y-8">
          <ChipGroup<GalleryFilter>
            selectionMode="single"
            value={[galleryFilter]}
            onValueChange={(values) => values[0] && setGalleryFilter(values[0])}
            aria-label="Filter message templates by approval status"
          >
            {(
              [
                ['all', 'All'],
                ['approved', 'Approved'],
                ['pending', 'Pending'],
                ['not_approved', 'Not approved'],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} value={value}>
                {label} <ChipCount count={galleryCounts[value]} />
              </Chip>
            ))}
          </ChipGroup>

          {galleryCounts[galleryFilter] === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                No messages with this status.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              {PRESET_GROUPS.map((group) => {
                const cards = gallery.filter(
                  (item) =>
                    item.preset?.galleryGroup === group.id &&
                    matchesGalleryFilter(item.template, galleryFilter)
                );
                if (cards.length === 0) return null;
                const headingId = `template-group-${group.id}`;
                return (
                  <section
                    key={group.id}
                    className="space-y-3"
                    aria-labelledby={headingId}
                  >
                    <SettingsSectionHead
                      id={headingId}
                      title={group.title}
                      description={group.description}
                    />
                    <div className="grid gap-3 xl:grid-cols-2">
                      {cards.map(({ preset, template }) => (
                        <TemplateGalleryCard
                          key={preset?.id ?? template?.id}
                          preset={preset}
                          template={template}
                          canAct={canEditSettings}
                          onUse={applyPreset}
                          onEdit={openEdit}
                          onSync={handleSyncFromMeta}
                          onDelete={setTemplateToDelete}
                          syncing={syncing}
                          deleting={deletingId === template?.id}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {otherTemplates.length > 0 && (
                <section
                  className="space-y-3"
                  aria-labelledby="other-template-heading"
                >
                  <SettingsSectionHead
                    id="other-template-heading"
                    title="Other templates"
                    description="Messages you added and versions in other languages."
                  />
                  <div className="grid gap-3 xl:grid-cols-2">
                    {otherTemplates.map(({ template }) => (
                      <TemplateGalleryCard
                        key={template?.id}
                        template={template}
                        canAct={canEditSettings}
                        onUse={applyPreset}
                        onEdit={openEdit}
                        onSync={handleSyncFromMeta}
                        onDelete={setTemplateToDelete}
                        syncing={syncing}
                        deleting={deletingId === template?.id}
                      />
                    ))}
                  </div>
                </section>
              )}
              {olderTemplates.length > 0 && (
                <section aria-label="Older templates">
                  <Accordion>
                    <AccordionItem value="older-templates">
                      <AccordionTrigger>
                        Older templates ({olderTemplates.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          <p className="text-muted-foreground text-sm">
                            These older messages are no longer used by
                            UsefulDesk.
                          </p>
                          <div className="grid gap-3 xl:grid-cols-2">
                            {olderTemplates.map(({ template }) => (
                              <TemplateGalleryCard
                                key={template?.id}
                                template={template}
                                canAct={canEditSettings}
                                onUse={applyPreset}
                                onEdit={openEdit}
                                onSync={handleSyncFromMeta}
                                onDelete={setTemplateToDelete}
                                syncing={syncing}
                                deleting={deletingId === template?.id}
                              />
                            ))}
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {editorDialog}

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
              {templateToDelete?.meta_template_id &&
              !templateToDelete.provider_missing_since
                ? `"${templateToDelete?.name}" will be removed from WhatsApp and UsefulDesk. Broadcasts that use it will stop sending. You cannot undo this.`
                : `"${templateToDelete?.name}" will be removed from UsefulDesk. This does not change WhatsApp.`}
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
