'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  Contact,
  MemberService,
  Membership,
  MessageTemplate,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  LayoutTemplate,
  Loader2,
  Pencil,
} from 'lucide-react';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import { useLocale } from '@/hooks/use-locale';
import {
  getTemplateSendPresentation,
  membershipRenewalDefaults,
  paymentDueDefaults,
  paymentLinkDefaults,
  serviceRenewalDefaults,
} from '@/lib/whatsapp/template-send-presentation';

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
  contact?: Contact | null;
}

function renderBodyPreview(
  body: string,
  params: string[],
  parameterLabels: string[] = []
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0
      ? value
      : `[${parameterLabels[idx] ?? `Message detail ${raw}`}]`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === 'text' && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === 'URL' && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  contact,
}: TemplatePickerProps) {
  const { fmt } = useLocale();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>('');
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});
  const [resolving, setResolving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const selectionRequestRef = useRef(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      // Scope by RLS (message_templates_select → is_account_member), NOT by
      // user_id. Templates are account-owned, so filtering on the caller's
      // user_id hid templates that a teammate created — leaving them unable
      // to send approved templates in a shared account.
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch templates:', error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function resetSelection() {
    selectionRequestRef.current += 1;
    setSelected(null);
    setParams([]);
    setHeaderText('');
    setButtonParams({});
    setResolving(false);
    setEditing(false);
    setContextMessage(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  async function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    const presentation = getTemplateSendPresentation(
      template,
      slots.bodyVars.length
    );
    const initialParams = new Array(slots.bodyVars.length).fill('');
    const memberNameIndex = presentation.parameterLabels.findIndex(
      (label) => label === 'Member name'
    );
    if (memberNameIndex >= 0) {
      initialParams[memberNameIndex] = contact?.name?.trim() ?? '';
    }
    setParams(initialParams);
    setHeaderText('');
    setButtonParams({});
    setEditing(false);
    setContextMessage(null);

    if (presentation.contextKind === 'service_renewal' && contact?.id) {
      setResolving(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('member_service_details')
        .select(
          'id, item_name_snapshot, end_date, current_renewal_price, derived_status'
        )
        .eq('contact_id', contact.id)
        .in('derived_status', ['active', 'expired'])
        .order('end_date', { ascending: false });
      if (selectionRequestRef.current !== requestId) return;
      setResolving(false);

      const services = data ?? [];
      if (error || services.length !== 1) {
        setEditing(true);
        setContextMessage(
          error
            ? 'Service details could not be loaded. Review the missing details below.'
            : services.length === 0
              ? 'No renewable service was found. Add the intended service details below.'
              : 'Multiple renewable services were found. Add details for the intended service below.'
        );
        return;
      }

      const nextParams = serviceRenewalDefaults(
        services[0] as MemberService,
        contact.name,
        fmt
      );
      const hasCurrentPrice = nextParams[3].trim().length > 0;
      setParams(nextParams);
      setEditing(!hasCurrentPrice);
      setContextMessage(
        hasCurrentPrice
          ? `Ready to send using ${contact.name?.trim() || 'this contact'}’s renewable service.`
          : 'The current service renewal price is unavailable. Enter it below.'
      );
      return;
    }

    const resolvesInvoice =
      presentation.contextKind === 'payment_due' ||
      presentation.contextKind === 'payment_link';
    if (resolvesInvoice && contact?.id) {
      setResolving(true);
      const supabase = createClient();
      const [membershipResponse, invoiceResponse] = await Promise.all([
        supabase
          .from('memberships')
          .select(
            '*, contact:contacts(*), plan:membership_plans(*), pricing_option:plan_pricing_options(*)'
          )
          .eq('contact_id', contact.id)
          .maybeSingle(),
        supabase
          .from('invoice_balances')
          .select('id, collectible_balance, currency, issued_at')
          .eq('contact_id', contact.id)
          .eq('state', 'open')
          .gt('collectible_balance', 0)
          .order('issued_at', { ascending: false }),
      ]);
      if (selectionRequestRef.current !== requestId) return;

      if (membershipResponse.error || invoiceResponse.error) {
        setResolving(false);
        setEditing(true);
        setContextMessage(
          'Billing details could not be loaded. Review the missing details below.'
        );
        return;
      }

      const invoices = invoiceResponse.data ?? [];
      if (!membershipResponse.data || invoices.length !== 1) {
        setResolving(false);
        setEditing(true);
        setContextMessage(
          !membershipResponse.data
            ? 'No membership was found for this contact. Add the missing details below.'
            : invoices.length === 0
              ? 'No open invoice was found. Add the intended payment details below.'
              : 'Multiple open invoices were found. Add details for the intended invoice below.'
        );
        return;
      }

      const membership = membershipResponse.data as Membership;
      const invoice = invoices[0];
      if (presentation.contextKind === 'payment_due') {
        setResolving(false);
        setParams(paymentDueDefaults(membership, contact.name, invoice, fmt));
        setContextMessage(
          `Ready to send using ${contact.name?.trim() || 'this contact'}’s latest open invoice.`
        );
        return;
      }

      const { data: paymentLink } = await supabase
        .from('razorpay_payment_links')
        .select('short_url')
        .eq('invoice_id', invoice.id)
        .eq('status', 'created')
        .maybeSingle();
      if (selectionRequestRef.current !== requestId) return;
      setResolving(false);
      const nextParams = paymentLinkDefaults(
        membership,
        contact.name,
        invoice,
        paymentLink?.short_url,
        fmt
      );
      setParams(nextParams);
      const hasActiveLink = nextParams[3].trim().length > 0;
      setEditing(!hasActiveLink);
      setContextMessage(
        hasActiveLink
          ? `Ready to send using ${contact.name?.trim() || 'this contact'}’s active payment link.`
          : 'No active payment link was found. Create one from Business → Invoices, or enter a complete URL below.'
      );
      return;
    }

    const resolvesMembership =
      presentation.contextKind === 'membership_renewal' ||
      presentation.contextKind === 'legacy_membership_renewal';
    if (!resolvesMembership || !contact?.id) return;

    setResolving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('memberships')
      .select(
        '*, contact:contacts(*), plan:membership_plans(*), pricing_option:plan_pricing_options(*)'
      )
      .eq('contact_id', contact.id)
      .maybeSingle();
    if (selectionRequestRef.current !== requestId) return;
    setResolving(false);

    if (error || !data) {
      setEditing(true);
      setContextMessage(
        error
          ? 'Membership details could not be loaded. Review the missing details below.'
          : 'No membership was found for this contact. Add the missing details below.'
      );
      return;
    }

    const nextParams = membershipRenewalDefaults(
      data as Membership,
      contact.name,
      fmt
    );
    setParams(nextParams);
    const hasAllValues = nextParams.every((value) => value.trim().length > 0);
    setEditing(!hasAllValues);
    setContextMessage(
      hasAllValues
        ? `Ready to send using ${contact.name?.trim() || 'this contact'}’s membership details.`
        : 'Some membership details are missing. Complete them below.'
    );
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()])
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected]
  );
  const presentation = useMemo(
    () =>
      selected && slots
        ? getTemplateSendPresentation(selected, slots.bodyVars.length)
        : null,
    [selected, slots]
  );
  const canConfirm =
    !!selected &&
    !!slots &&
    !resolving &&
    slots.bodyVars.every((_, i) => (params[i] ?? '').trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? '').trim().length > 0
    );
  const contextReady = !!contextMessage && canConfirm;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="text-primary-text size-4" />
            {presentation?.title ?? 'Send template'}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? resolving
                ? 'Loading known details for this contact.'
                : 'Review the message before sending it on WhatsApp.'
              : 'Pick an approved WhatsApp template to send to this contact.'}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-primary-text size-5 animate-spin" />
              </div>
            ) : templates.length === 0 ? (
              <div className="border-border bg-background/50 rounded-md border p-6 text-center">
                <p className="text-popover-foreground text-sm">
                  No approved templates
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Approve a template in Meta WhatsApp Manager, then sync it from
                  Settings → Templates.
                </p>
              </div>
            ) : (
              templates.map((t) => {
                const templateSlots = collectVariableSlots(t);
                const itemPresentation = getTemplateSendPresentation(
                  t,
                  templateSlots.bodyVars.length
                );
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void pickTemplate(t)}
                    className="border-border hover:border-border-hover w-full rounded-lg border p-3 text-left transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {itemPresentation.title}
                          </p>
                          <Badge
                            variant={
                              t.category === 'Marketing'
                                ? 'violet'
                                : t.category === 'Utility'
                                  ? 'info'
                                  : 'neutral'
                            }
                          >
                            {t.category}
                          </Badge>
                          {itemPresentation.legacy ? (
                            <Badge variant="neutral">Legacy</Badge>
                          ) : null}
                          {t.language ? (
                            <span className="text-muted-foreground text-xs uppercase">
                              {t.language}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                          {itemPresentation.blurb ?? t.body_text}
                        </p>
                      </div>
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {contextMessage ? (
              <div className="flex items-start gap-2 text-sm">
                {contextReady ? (
                  <CheckCircle2 className="text-emerald-foreground mt-0.5 size-4 shrink-0" />
                ) : (
                  <CircleAlert className="text-amber-foreground mt-0.5 size-4 shrink-0" />
                )}
                <p>{contextMessage}</p>
              </div>
            ) : null}
            <div className="border-border rounded-lg border p-3">
              <p className="text-muted-foreground mb-1 text-xs">Preview</p>
              {resolving ? (
                <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Loading membership details…
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">
                  {renderBodyPreview(
                    selected.body_text,
                    params,
                    presentation?.parameterLabels
                  )}
                </p>
              )}
              {selected.footer_text && (
                <p className="text-muted-foreground mt-2 text-xs italic">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {!resolving &&
            slots &&
            (editing || headerText.trim().length === 0) &&
            slots.headerVarCount > 0 ? (
              <div className="space-y-1">
                <Label htmlFor="template-header-value" size="sm">
                  Header text
                </Label>
                <Input
                  id="template-header-value"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder="Value for the header variable"
                />
              </div>
            ) : null}
            {!resolving &&
              slots?.bodyVars.map((v, i) =>
                editing || !(params[i] ?? '').trim() ? (
                  <div key={v} className="space-y-1">
                    <Label htmlFor={`template-body-${v}`} size="sm">
                      {presentation?.parameterLabels[i] ??
                        `Message detail ${i + 1}`}
                    </Label>
                    <Input
                      id={`template-body-${v}`}
                      value={params[i] ?? ''}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      placeholder={`Enter ${(
                        presentation?.parameterLabels[i] ??
                        `message detail ${i + 1}`
                      ).toLowerCase()}`}
                    />
                  </div>
                ) : null
              )}
            {!resolving &&
              slots?.urlButtonSlots.map((slot) => (
                <div key={slot.index} className="space-y-1">
                  <Label htmlFor={`template-button-${slot.index}`} size="sm">
                    {`${slot.text} button URL value`}
                  </Label>
                  <Input
                    id={`template-button-${slot.index}`}
                    value={buttonParams[slot.index] ?? ''}
                    onChange={(e) =>
                      setButtonParams((prev) => ({
                        ...prev,
                        [slot.index]: e.target.value,
                      }))
                    }
                    placeholder="URL suffix value"
                  />
                  <p className="text-muted-foreground text-[10px] break-all">
                    Final URL:{' '}
                    {slot.url.replace(
                      /\{\{1\}\}/g,
                      buttonParams[slot.index] || '{{1}}'
                    )}
                  </p>
                </div>
              ))}
            {!resolving && slots && slots.bodyVars.length > 0 ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setEditing((current) => !current)}
              >
                <Pencil />
                {editing ? 'Hide resolved details' : 'Edit details'}
              </Button>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button variant="outline" onClick={resetSelection}>
                <ArrowLeft />
                Back
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                loading={resolving}
              >
                Send template
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
