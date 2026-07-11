'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { toast } from 'sonner';
import type { Contact, Tag, CustomField, MessageTemplate } from '@/types';
import {
  customFieldInputType,
  formatCustomFieldValue,
} from '@/lib/contacts/custom-fields';
import { currencySymbol } from '@/lib/currency';
import {
  canReassignLeadsDirectly,
  canRequestLeadTransfer,
} from '@/lib/auth/roles';
import {
  requestLeadAssignment,
  requestLeadTransfer,
} from '@/lib/leads/transfers';
import { TransferRequestDialog } from '@/components/leads/transfer-request-dialog';
import { ContactNotesThread } from './contact-notes-thread';
import { useAccountStaff } from '@/components/members/use-account-staff';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import { MemberForm } from '@/components/members/member-form';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEditActions } from '@/components/ui/inline-edit-actions';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Badge } from '@/components/ui/badge';
import { SourceIcon } from '@/components/leads/source-icon';
import { useLeadFieldOptions } from '@/hooks/use-lead-field-options';
import { autoReceivedLabel } from '@/lib/leads/attributes';
import {
  columnToStatus,
  leadColumnKey,
  type LeadColumnKey,
} from '@/lib/leads/status';
import {
  Phone,
  Mail,
  Building2,
  ChevronDown,
  Copy,
  Check,
  Loader2,
  LayoutTemplate,
  Pencil,
  StickyNote,
  MessageCircle,
  UserPlus,
} from 'lucide-react';

const SECTION_IDS = ['details', 'tags', 'notes'];

// The notes thread (composer, note cards, follow-up-on-note) now lives in
// contact-notes-thread.tsx so the member detail sheet mounts the same
// surface. Re-export the composer building blocks so existing import
// sites (BulkAddNoteDialog etc.) keep working.
export {
  NoteComposerCard,
  DEFAULT_FOLLOW_UP_DRAFT,
  resolveDueDate,
  type FollowUpDraft,
} from './contact-notes-thread';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const supabase = createClient();
  const router = useRouter();
  const { accountRole, user } = useAuth();
  const { fmt } = useLocale();
  const { staff, nameById, avatarById } = useAccountStaff();
  // Account option lists (status/source/gender) — drive the Details
  // section's dropdown editors, kept in sync with the leads table which
  // reads the same lists.
  const fieldOptions = useLeadFieldOptions();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Existing WhatsApp thread for this contact — powers the Chat quick action.
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Convert-to-member — opens the member form seeded with this contact.
  const [convertOpen, setConvertOpen] = useState(false);

  // Agent peer-handoff (migration 050): a chosen transfer target awaiting
  // the confirm dialog. Admins reassign instantly and never open this.
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  // Accordion sections — all expanded by default, user can collapse.
  const [openSections, setOpenSections] = useState<string[]>(SECTION_IDS);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Custom fields — folded into the Details section (values keyed by field id).
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) setContact(data);
    setLoading(false);
  }, [contactId, supabase]);

  const fetchConversation = useCallback(async () => {
    if (!contactId) return;
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    setConversationId(data?.id ?? null);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      setOpenSections(SECTION_IDS);
      fetchContact();
      fetchConversation();
      fetchTags();
      fetchCustomFields();
    }
  }, [open, contactId, fetchContact, fetchConversation, fetchTags, fetchCustomFields]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  // Quick action: make sure the Notes section is open, then focus the composer.
  function startNote() {
    setOpenSections((prev) =>
      prev.includes('notes') ? prev : [...prev, 'notes'],
    );
    // Wait a tick so the accordion panel is mounted/expanded before focusing.
    setTimeout(() => {
      noteInputRef.current?.focus();
      noteInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // Quick action: jump to this contact's WhatsApp thread in the inbox.
  function openChat() {
    if (!conversationId) return;
    onOpenChange(false);
    router.push(`/inbox?c=${conversationId}`);
  }

  // Save one core contact column inline (Zoho-style per-field edit).
  // Returns whether the write succeeded so the row can exit edit mode.
  async function saveField(
    column: 'name' | 'phone' | 'email' | 'company',
    val: string,
  ): Promise<boolean> {
    if (!contactId) return false;
    const next = val.trim() || null;
    const { error } = await supabase
      .from('contacts')
      .update({ [column]: next, updated_at: new Date().toISOString() })
      .eq('id', contactId);
    if (error) {
      toast.error('Failed to update');
      return false;
    }
    setContact((c) => (c ? { ...c, [column]: next } : c));
    onUpdated();
    return true;
  }

  // Write any single contacts column (used by the Details dropdown editors
  // for status / source / gender / assignee). `next` is already the DB
  // value (null clears; lead_status is a LeadStatus|null; assigned_to a
  // uuid|null), so no trimming here.
  async function saveContactColumn(
    column: 'lead_status' | 'source' | 'gender' | 'assigned_to',
    next: string | null,
  ): Promise<boolean> {
    if (!contactId) return false;
    const { error } = await supabase
      .from('contacts')
      .update({ [column]: next, updated_at: new Date().toISOString() })
      .eq('id', contactId);
    if (error) {
      toast.error('Failed to update');
      return false;
    }
    setContact((c) => (c ? { ...c, [column]: next } : c));
    onUpdated();
    return true;
  }

  // Ownership transfer of the "Received by" owner (contacts.user_id,
  // migration 050). Admins move it instantly; an agent handing off a lead
  // they own opens the accept-gated dialog (returns false so the inline
  // field reverts — ownership hasn't moved yet). Only reachable for
  // human-received leads (the Received-by row is static for auto origins).
  const canReassignDirect = accountRole
    ? canReassignLeadsDirectly(accountRole)
    : false;
  const canTransfer = accountRole ? canRequestLeadTransfer(accountRole) : false;

  async function transferOwner(next: string | null): Promise<boolean> {
    if (!contact || !next) return false;
    if (next === contact.user_id) return true;

    if (canReassignDirect) {
      try {
        await requestLeadTransfer(supabase, contact.id, next);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to transfer');
        return false;
      }
      setContact((c) => (c ? { ...c, user_id: next } : c));
      onUpdated();
      toast.success('Ownership transferred');
      return true;
    }

    if (!canTransfer || contact.user_id !== user?.id) {
      toast.error('Only the current owner or an admin can transfer this lead.');
      return false;
    }
    setTransferTarget(next);
    return false; // dialog owns the request; field reverts to current owner
  }

  // Assignment change (contacts.assigned_to, migration 052). Owner/admin →
  // instant; any other agent → request the owner must approve (returns false
  // so the inline field reverts — assignment hasn't changed yet).
  async function saveAssignment(next: string | null): Promise<boolean> {
    if (!contact) return false;
    if (next === (contact.assigned_to ?? null)) return true;
    let outcome: 'approved' | 'pending';
    try {
      outcome = await requestLeadAssignment(supabase, contact.id, next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
      return false;
    }
    if (outcome === 'approved') {
      setContact((c) =>
        c
          ? {
              ...c,
              assigned_to: next,
              pending_invitation_id: null,
              pending_assignee_name: null,
            }
          : c
      );
      onUpdated();
      return true;
    }
    toast.success('Sent to the lead owner for approval');
    return false;
  }

  async function submitTransferRequest(note: string) {
    if (!contact || !transferTarget) return;
    setTransferSubmitting(true);
    try {
      await requestLeadTransfer(
        supabase,
        contact.id,
        transferTarget,
        note || undefined
      );
      toast.success('Transfer request sent — waiting for them to accept.');
      setTransferTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send request');
    } finally {
      setTransferSubmitting(false);
    }
  }

  // Save one custom field value inline — delete + re-insert for that field
  // only, so no unique constraint on the value table is assumed.
  async function saveCustomField(
    fieldId: string,
    val: string,
  ): Promise<boolean> {
    if (!contactId) return false;
    const trimmed = val.trim();

    const del = await supabase
      .from('contact_custom_values')
      .delete()
      .eq('contact_id', contactId)
      .eq('custom_field_id', fieldId);
    if (del.error) {
      toast.error('Failed to update');
      return false;
    }

    if (trimmed) {
      const { error } = await supabase.from('contact_custom_values').insert({
        contact_id: contactId,
        custom_field_id: fieldId,
        value: trimmed,
      });
      if (error) {
        toast.error('Failed to update');
        return false;
      }
    }

    setCustomValues((prev) => ({ ...prev, [fieldId]: trimmed }));
    onUpdated();
    return true;
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    if (isSelected) {
      const { error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId);
      if (!error) {
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        onUpdated();
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (!error) {
        setContactTagIds((prev) => [...prev, tagId]);
        onUpdated();
      }
    }
    setSavingTags(false);
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues,
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(`Failed to send template: ${reason}`);
        return;
      }

      toast.success(`Template "${template.name}" sent`);
      // The send may have just created the thread — refresh the Chat action.
      fetchConversation();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(`Failed to send template: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The sheet master caps side=right at sm:max-w-sm (384px) via a
        // data-variant, which beats a plain sm:max-w-*. Match the
        // variant to actually widen: 500px fits the follow-up row on
        // one line.
        className="bg-popover border-border text-popover-foreground data-[side=right]:sm:max-w-[500px] w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-muted border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary-text text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-popover-foreground truncate">
                    {contact.name || 'Unknown'}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground text-xs mt-0.5">
                    Contact details
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <button
                      onClick={copyPhone}
                      className="flex items-center gap-1 hover:text-primary-text transition-colors cursor-pointer"
                    >
                      <Phone className="size-3" />
                      {contact.phone}
                      {copiedPhone ? (
                        <Check className="size-3 text-primary" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick actions — a primary "Convert" action leads the row
                  (filled circle), then the HubSpot-style icon actions. */}
              <div className="mt-3 flex items-start gap-6">
                <QuickAction
                  icon={UserPlus}
                  label="Convert"
                  title="Convert to member"
                  primary
                  onClick={() => setConvertOpen(true)}
                />
                <QuickAction
                  icon={LayoutTemplate}
                  label="Template"
                  title="Send a WhatsApp template"
                  loading={sendingTemplate}
                  onClick={() => setTemplatePickerOpen(true)}
                />
                <QuickAction
                  icon={MessageCircle}
                  label="Chat"
                  title={
                    conversationId
                      ? 'Open conversation in inbox'
                      : 'No conversation yet — send a template to start one'
                  }
                  disabled={!conversationId}
                  onClick={openChat}
                />
                <QuickAction
                  icon={Phone}
                  label="Call"
                  title={`Call ${contact.phone}`}
                  href={`tel:${contact.phone}`}
                />
                <QuickAction
                  icon={StickyNote}
                  label="Note"
                  title="Add a note"
                  onClick={startNote}
                />
                <QuickAction
                  icon={Mail}
                  label="Email"
                  title={
                    contact.email ? `Email ${contact.email}` : 'No email on file'
                  }
                  disabled={!contact.email}
                  href={contact.email ? `mailto:${contact.email}` : undefined}
                />
              </div>
            </SheetHeader>

            {/* Single scrollable page — every section an accordion, open by default */}
            <div className="flex-1 overflow-y-auto">
              <Accordion
                multiple
                value={openSections}
                onValueChange={(v) => setOpenSections(v as string[])}
                className="px-4"
              >
                {/* Details */}
                <AccordionItem value="details" className="border-b border-border/50">
                  <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                    Details
                  </AccordionTrigger>
                  <AccordionContent>
                    {/* Mirrors the leads table's columns, in the same
                        order, so the two stay in sync — including custom
                        fields (added once in Settings, they surface in both
                        the table and here from the shared custom_fields
                        fetch). Received By + Created are read-only. */}
                    <dl className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50">
                      <InlineField
                        label="Name"
                        value={contact.name}
                        placeholder="Add name"
                        onSave={(v) => saveField('name', v)}
                      />
                      <InlineSelectField
                        label="Status"
                        value={leadColumnKey(contact.lead_status)}
                        variant="pill"
                        options={fieldOptions.statuses.map((s) => ({
                          value: s.key,
                          label: s.label,
                          color: s.color,
                        }))}
                        display={
                          <Badge color={fieldOptions.statusFor(contact.lead_status).color}>
                            {fieldOptions.statusFor(contact.lead_status).label}
                          </Badge>
                        }
                        onSave={(v) =>
                          saveContactColumn(
                            'lead_status',
                            columnToStatus(v as LeadColumnKey),
                          )
                        }
                      />
                      <InlineField
                        label="Phone"
                        value={contact.phone}
                        placeholder="Add phone"
                        required
                        onSave={(v) => saveField('phone', v)}
                      />
                      <InlineField
                        label="Email"
                        type="email"
                        value={contact.email}
                        placeholder="Add email"
                        onSave={(v) => saveField('email', v)}
                      />
                      <InlineField
                        label="Company"
                        value={contact.company}
                        placeholder="Add company"
                        onSave={(v) => saveField('company', v)}
                      />
                      <InlineSelectField
                        label="Source"
                        value={contact.source ?? ''}
                        variant="plain"
                        options={fieldOptions.sources.map((o) => ({
                          value: o.key,
                          label: o.label,
                          icon: <SourceIcon source={o.key} label={o.label} />,
                        }))}
                        display={
                          contact.source ? (
                            <SourceIcon
                              source={contact.source}
                              label={fieldOptions.sourceLabel(contact.source)}
                            />
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )
                        }
                        onSave={(v) => saveContactColumn('source', v || null)}
                      />
                      <InlineSelectField
                        label="Gender"
                        value={contact.gender ?? ''}
                        variant="plain"
                        options={fieldOptions.genders.map((o) => ({
                          value: o.key,
                          label: o.label,
                        }))}
                        display={
                          contact.gender ? (
                            <span>{fieldOptions.genderLabel(contact.gender)}</span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )
                        }
                        onSave={(v) => saveContactColumn('gender', v || null)}
                      />
                      <InlineSelectField
                        label="Assigned to"
                        value={contact.assigned_to ?? ''}
                        variant="plain"
                        options={[
                          { value: '', label: 'Unassigned' },
                          ...staff.map((s) => ({
                            value: s.user_id,
                            label: s.full_name,
                            icon: (
                              <UserAvatar
                                name={s.full_name}
                                src={s.avatar_url}
                                className="size-5 shrink-0"
                                fallbackClassName="text-[10px]"
                              />
                            ),
                          })),
                        ]}
                        display={
                          contact.assigned_to ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                              <UserAvatar
                                name={nameById.get(contact.assigned_to) ?? 'Teammate'}
                                src={avatarById.get(contact.assigned_to) ?? null}
                                className="size-5 shrink-0"
                                fallbackClassName="text-[10px]"
                              />
                              <span className="truncate">
                                {nameById.get(contact.assigned_to) ?? 'Teammate'}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">Unassigned</span>
                          )
                        }
                        onSave={(v) => saveAssignment(v || null)}
                      />
                      {(() => {
                        // "Received by" = the human owner (contacts.user_id).
                        // Auto origins are locked; human leads get an owner
                        // picker that transfers ownership (migration 050).
                        const auto = autoReceivedLabel(contact.received_via);
                        if (auto) {
                          return (
                            <StaticField label="Received by">
                              <Badge variant="neutral">{auto}</Badge>
                            </StaticField>
                          );
                        }
                        const name = nameById.get(contact.user_id) ?? 'Teammate';
                        const ownerChip = (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <UserAvatar
                              name={name}
                              src={avatarById.get(contact.user_id) ?? null}
                              className="size-5 shrink-0"
                              fallbackClassName="text-[10px]"
                            />
                            <span className="truncate">{name}</span>
                          </span>
                        );
                        const canInitiate =
                          canReassignDirect ||
                          (canTransfer && contact.user_id === user?.id);
                        if (!canInitiate) {
                          return (
                            <StaticField label="Received by">
                              {ownerChip}
                            </StaticField>
                          );
                        }
                        return (
                          <InlineSelectField
                            label="Received by"
                            value={contact.user_id ?? ''}
                            variant="plain"
                            options={staff.map((s) => ({
                              value: s.user_id,
                              label: s.full_name,
                              icon: (
                                <UserAvatar
                                  name={s.full_name}
                                  src={s.avatar_url}
                                  className="size-5 shrink-0"
                                  fallbackClassName="text-[10px]"
                                />
                              ),
                            }))}
                            display={ownerChip}
                            onSave={(v) => transferOwner(v || null)}
                          />
                        );
                      })()}
                      {contact.created_by && (
                        <StaticField label="Created by">
                          {(() => {
                            const name =
                              nameById.get(contact.created_by) ?? 'Teammate';
                            return (
                              <span className="flex min-w-0 items-center gap-1.5">
                                <UserAvatar
                                  name={name}
                                  src={
                                    avatarById.get(contact.created_by) ?? null
                                  }
                                  className="size-5 shrink-0"
                                  fallbackClassName="text-[10px]"
                                />
                                <span className="truncate">{name}</span>
                              </span>
                            );
                          })()}
                        </StaticField>
                      )}
                      {customFields.map((field) => (
                        <InlineField
                          key={field.id}
                          label={field.field_name}
                          type={field.field_type}
                          value={customValues[field.id]}
                          placeholder={`Add ${field.field_name}`}
                          onSave={(v) => saveCustomField(field.id, v)}
                        />
                      ))}
                      <StaticField label="Created">
                        <span className="text-foreground">
                          {fmt.date(contact.created_at)}
                        </span>
                      </StaticField>
                    </dl>
                  </AccordionContent>
                </AccordionItem>

                {/* Tags */}
                <AccordionItem value="tags" className="border-b border-border/50">
                  <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                    Tags
                  </AccordionTrigger>
                  <AccordionContent>
                    {allTags.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No tags available.{' '}
                        <Link
                          href="/settings?tab=fields"
                          onClick={() => onOpenChange(false)}
                          className="text-primary-text underline underline-offset-3 hover:text-primary-text/80"
                        >
                          Create tags in Settings
                        </Link>
                        .
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => {
                          const selected = contactTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleTag(tag.id)}
                              disabled={savingTags}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all cursor-pointer disabled:opacity-60 ${
                                selected
                                  ? 'border-transparent bg-muted text-foreground'
                                  : 'border-border bg-transparent text-muted-foreground hover:bg-muted/50'
                              }`}
                            >
                              {selected && <Check className="size-3.5" />}
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Notes */}
                <AccordionItem value="notes" className="border-b-0">
                  <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                    Notes
                  </AccordionTrigger>
                  {/* The panel is overflow-hidden (open/close animation),
                      which would clip the composer's 3px focus ring —
                      px/pt give the ring room. */}
                  <AccordionContent className="px-1 pt-1">
                    <ContactNotesThread
                      contactId={contactId}
                      active={open}
                      textareaRef={noteInputRef}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <TemplatePicker
      open={templatePickerOpen}
      onOpenChange={setTemplatePickerOpen}
      onSelect={handleSendTemplate}
    />
    {contact && (
      <MemberForm
        open={convertOpen}
        onOpenChange={setConvertOpen}
        seedContact={{
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
        }}
        onSaved={() => {
          setConvertOpen(false);
          onUpdated();
        }}
      />
    )}
    {contact && (
      <TransferRequestDialog
        key={transferTarget ?? 'none'}
        open={transferTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null);
        }}
        targetName={
          transferTarget ? nameById.get(transferTarget) ?? 'Teammate' : ''
        }
        targetAvatarUrl={transferTarget ? avatarById.get(transferTarget) : null}
        leadName={contact.name?.trim() || contact.phone}
        submitting={transferSubmitting}
        onConfirm={submitTransferRequest}
      />
    )}
    </>
  );
}

// HubSpot-style quick action: circular icon button with a tiny label under it.
// Renders an anchor when `href` is given (tel:/mailto:), a button otherwise.
function QuickAction({
  icon: Icon,
  label,
  title,
  onClick,
  href,
  disabled,
  loading,
  primary,
}: {
  icon: typeof Phone;
  label: string;
  title?: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Filled primary circle + white icon — the emphasised action. */
  primary?: boolean;
}) {
  const circle = primary
    ? 'flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer'
    : 'flex size-9 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary cursor-pointer';
  const inner = loading ? (
    <Loader2 className="size-4 animate-spin" />
  ) : (
    <Icon className="size-4" />
  );

  return (
    <div
      className={`flex w-11 flex-col items-center gap-1 ${
        disabled ? 'opacity-40' : ''
      }`}
      title={title}
    >
      {href && !disabled ? (
        <a href={href} className={circle} aria-label={label}>
          {inner}
        </a>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || loading}
          className={`${circle} disabled:pointer-events-none`}
          aria-label={label}
        >
          {inner}
        </button>
      )}
      <span className="text-xs leading-none text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// Zoho-style inline-editable row: label left, value right. Hovering reveals a
// pencil; clicking the value swaps it for an input with confirm/cancel. Enter
// confirms, Escape cancels. Saves only this one field via `onSave`.
function InlineField({
  label,
  value,
  placeholder,
  required,
  type,
  onSave,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  required?: boolean;
  /** Custom field data type (see CUSTOM_FIELD_TYPES); drives input + display. */
  type?: string;
  onSave: (val: string) => Promise<boolean>;
}) {
  const { locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function begin() {
    setDraft(value ?? '');
    setEditing(true);
  }

  async function confirm() {
    if (required && !draft.trim()) {
      toast.error(`${label} is required`);
      return;
    }
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (editing) {
    // Shared between the plain input and the currency-adorned one so
    // the two branches can't drift.
    const inputProps = {
      autoFocus: true,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDraft(e.target.value),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirm();
        } else if (e.key === 'Escape') {
          setEditing(false);
        }
      },
      placeholder,
      disabled: saving,
      // pr-16 clears the floating confirm/dismiss pair: the pair sits
      // right-2.5 (10px) plus two size-6 buttons and a gap (50px), and
      // unlike the table cells there's no outer cell padding absorbing
      // part of that — 60px to clear, plus 4px of breathing room so the
      // date picker's calendar icon doesn't touch the ✓ button.
      // bg-card (not bg-muted) marks the active editor with a solid
      // fill, matching the leads table's edit state.
      className:
        'bg-card border-border text-foreground h-7 pr-16 text-sm placeholder:text-muted-foreground',
    };
    return (
      <div className="grid min-h-10 grid-cols-[100px_1fr] items-center gap-3 px-3">
        <span className="text-xs text-muted-foreground capitalize">{label}</span>
        {/* Same in-field editing chrome as the leads table cells: the
            input fills the row and the actions float inside its right
            edge (InlineEditActions). */}
        <div className="relative min-w-0">
          {type === 'currency' ? (
            <CurrencyInput
              symbol={currencySymbol(locale.currency)}
              {...inputProps}
            />
          ) : (
            <Input type={customFieldInputType(type)} {...inputProps} />
          )}
          <InlineEditActions
            saving={saving}
            onConfirm={confirm}
            onDismiss={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  const shown =
    value && value.trim()
      ? formatCustomFieldValue(value, type, locale.currency, locale.locale)
      : '—';
  return (
    <button
      type="button"
      onClick={begin}
      className="group grid min-h-10 w-full grid-cols-[100px_1fr] items-center gap-3 px-3 text-left transition-colors hover:bg-muted/40 cursor-pointer"
    >
      <span className="text-xs text-muted-foreground capitalize leading-5">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate text-sm leading-5 ${
            shown === '—' ? 'text-muted-foreground/60' : 'text-foreground'
          }`}
        >
          {shown}
        </span>
        <Pencil className="ml-auto size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </button>
  );
}

// Read-only Details row — same two-column layout as InlineField but no
// editor (Received By, Created).
function StaticField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[100px_1fr] items-center gap-3 px-3">
      <span className="text-xs text-muted-foreground capitalize leading-5">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        {children}
      </span>
    </div>
  );
}

interface SelectFieldOption {
  value: string;
  label: string;
  /** Pill colour for `variant: 'pill'` (status). */
  color?: string;
  /** Leading glyph for `variant: 'plain'` (source logo, teammate avatar). */
  icon?: React.ReactNode;
}

// Dropdown-editable Details row (status / source / gender / assignee),
// mirroring the leads table's inline cell editors: coloured pills for
// status, icon + label otherwise. The whole row is the trigger; picking an
// option commits immediately.
function InlineSelectField({
  label,
  value,
  options,
  variant,
  display,
  onSave,
}: {
  label: string;
  /** Current option value ('' allowed, e.g. unassigned). */
  value: string;
  options: SelectFieldOption[];
  variant: 'pill' | 'plain';
  /** Read-mode rendering of the current value. */
  display: React.ReactNode;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pick(next: string) {
    if (next === value) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setOpen(false);
  }

  return (
    <div className="grid min-h-10 grid-cols-[100px_1fr] items-center gap-3 px-3">
      <span className="text-xs text-muted-foreground capitalize leading-5">
        {label}
      </span>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={saving}
              className="group -mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40 disabled:opacity-60"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            {display}
          </span>
          {saving ? (
            <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <ChevronDown className="ml-auto size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[popup-open]:opacity-100" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-popover border-border min-w-52">
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value || 'unassigned'}
              onClick={() => pick(o.value)}
              className="justify-between gap-3 text-popover-foreground focus:bg-muted focus:text-foreground"
            >
              {variant === 'pill' ? (
                <Badge color={o.color ?? '#64748b'}>{o.label}</Badge>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                </span>
              )}
              {o.value === value && (
                <Check className="size-3.5 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

