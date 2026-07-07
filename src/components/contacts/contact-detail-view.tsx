'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactNote, CustomField, MessageTemplate } from '@/types';
import {
  customFieldInputType,
  formatCustomFieldValue,
} from '@/lib/contacts/custom-fields';
import { currencySymbol } from '@/lib/currency';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
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
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  X,
  LayoutTemplate,
  Pencil,
  StickyNote,
  MessageCircle,
} from 'lucide-react';

const SECTION_IDS = ['details', 'tags', 'notes'];

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
  const { accountId } = useAuth();

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

  // Accordion sections — all expanded by default, user can collapse.
  const [openSections, setOpenSections] = useState<string[]>(SECTION_IDS);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

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

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
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
      fetchNotes();
      fetchCustomFields();
    }
  }, [open, contactId, fetchContact, fetchConversation, fetchTags, fetchNotes, fetchCustomFields]);

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

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error('Not authenticated');
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error('Failed to add note');
    } else {
      setNewNote('');
      fetchNotes();
      toast.success('Note added');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error('Failed to delete note');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    }
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
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
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
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
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
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
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

              {/* Quick actions — HubSpot-style icon row */}
              <div className="mt-3 flex items-start gap-4">
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
                    <dl className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50">
                      <InlineField
                        label="Name"
                        value={contact.name}
                        placeholder="Add name"
                        onSave={(v) => saveField('name', v)}
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
                          className="text-primary underline underline-offset-3 hover:text-primary/80"
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
                  <AccordionContent>
                    <div className="space-y-2 mb-3">
                      <Textarea
                        ref={noteInputRef}
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Write a note..."
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] text-sm resize-none"
                      />
                      <Button
                        onClick={addNote}
                        disabled={!newNote.trim() || savingNote}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        size="sm"
                      >
                        {savingNote ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Plus className="size-3.5" />
                        )}
                        Add Note
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {loadingNotes ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : notes.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                          No notes yet.
                        </p>
                      ) : (
                        notes.map((note) => (
                          <div
                            key={note.id}
                            className="rounded-lg bg-muted/50 border border-border/50 p-3 group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap flex-1">
                                {note.note_text}
                              </p>
                              <button
                                onClick={() => deleteNote(note.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">
                              {new Date(note.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
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
}: {
  icon: typeof Phone;
  label: string;
  title?: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const circle =
    'flex size-9 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary cursor-pointer';
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
      <span className="text-[10px] leading-none text-muted-foreground">
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
  const { defaultCurrency } = useAuth();
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
      className:
        'bg-muted border-border text-foreground h-7 text-sm placeholder:text-muted-foreground',
    };
    return (
      <div className="grid min-h-10 grid-cols-[100px_1fr] items-center gap-3 px-3">
        <span className="text-xs text-muted-foreground capitalize">{label}</span>
        <div className="flex items-center gap-1">
          {type === 'currency' ? (
            <CurrencyInput
              symbol={currencySymbol(defaultCurrency)}
              {...inputProps}
            />
          ) : (
            <Input type={customFieldInputType(type)} {...inputProps} />
          )}
          <button
            type="button"
            onClick={confirm}
            disabled={saving}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10 disabled:opacity-50 cursor-pointer"
            aria-label="Save"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
            aria-label="Cancel"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  const shown =
    value && value.trim()
      ? formatCustomFieldValue(value, type, defaultCurrency)
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
