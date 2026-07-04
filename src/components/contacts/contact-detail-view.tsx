'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { toast } from 'sonner';
import type { Contact, Tag, ContactNote, CustomField, Deal, MessageTemplate } from '@/types';
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
import { Button } from '@/components/ui/button';
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
  DollarSign,
  LayoutTemplate,
  Pencil,
} from 'lucide-react';

const SECTIONS = [
  { id: 'details', label: 'Details' },
  { id: 'tags', label: 'Tags' },
  { id: 'notes', label: 'Notes' },
  { id: 'deals', label: 'Deals' },
] as const;

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
  const { accountId, defaultCurrency } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Scrollspy — a single scrollable page; the nav bar highlights whichever
  // section currently sits under the fold.
  const [activeSection, setActiveSection] = useState<string>('details');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

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

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

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

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      setActiveSection('details');
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
    }
  }, [open, contactId, fetchContact, fetchTags, fetchNotes, fetchCustomFields, fetchDeals]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
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

  function scrollToSection(id: string) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  // Highlight the nav item for whichever section is under the fold.
  useEffect(() => {
    const root = scrollRef.current;
    if (!open || !contact || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { root, rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );

    SECTIONS.forEach(({ id }) => {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [open, contact]);

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
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={sendingTemplate}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {sendingTemplate ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LayoutTemplate className="size-4" />
                  )}
                  Send template
                </Button>
              </div>
            </SheetHeader>

            {/* Navigation bar — highlights the section under the fold */}
            <nav className="flex shrink-0 items-center gap-1 border-b border-border px-3">
              {SECTIONS.map((s) => {
                const active = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className={`relative px-2.5 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s.label}
                    {active && (
                      <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Single scrollable page — every section stacked */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {/* Details */}
              <section
                id="details"
                ref={(el) => {
                  sectionRefs.current.details = el;
                }}
                className="scroll-mt-2 border-b border-border/50 px-4 py-4"
              >
                <h3 className="mb-2.5 text-sm font-semibold text-foreground">Details</h3>
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
                      value={customValues[field.id]}
                      placeholder={`Add ${field.field_name}`}
                      onSave={(v) => saveCustomField(field.id, v)}
                    />
                  ))}
                </dl>
              </section>

              {/* Tags */}
              <section
                id="tags"
                ref={(el) => {
                  sectionRefs.current.tags = el;
                }}
                className="scroll-mt-2 border-b border-border/50 px-4 py-4"
              >
                <h3 className="mb-2.5 text-sm font-semibold text-foreground">Tags</h3>
                {allTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tags available. Create tags in Settings.
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
                          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all cursor-pointer disabled:opacity-60"
                          style={
                            selected
                              ? {
                                  backgroundColor: tag.color + '20',
                                  borderColor: 'transparent',
                                  color: tag.color,
                                }
                              : {
                                  backgroundColor: 'transparent',
                                  borderColor: tag.color + '40',
                                  color: tag.color,
                                }
                          }
                        >
                          {selected && <Check className="size-3.5" />}
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Notes */}
              <section
                id="notes"
                ref={(el) => {
                  sectionRefs.current.notes = el;
                }}
                className="scroll-mt-2 border-b border-border/50 px-4 py-4"
              >
                <h3 className="mb-2.5 text-sm font-semibold text-foreground">Notes</h3>
                <div className="space-y-2 mb-3">
                  <Textarea
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
              </section>

              {/* Deals */}
              <section
                id="deals"
                ref={(el) => {
                  sectionRefs.current.deals = el;
                }}
                className="scroll-mt-2 px-4 py-4"
              >
                <h3 className="mb-2.5 text-sm font-semibold text-foreground">Deals</h3>
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No deals yet</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-border bg-muted/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <DollarSign className="size-3" />
                            {formatCurrency(
                              deal.value ?? 0,
                              deal.currency || defaultCurrency,
                            )}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
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

// Zoho-style inline-editable row: label left, value right. Hovering reveals a
// pencil; clicking the value swaps it for an input with confirm/cancel. Enter
// confirms, Escape cancels. Saves only this one field via `onSave`.
function InlineField({
  label,
  value,
  placeholder,
  required,
  onSave,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  required?: boolean;
  onSave: (val: string) => Promise<boolean>;
}) {
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
    return (
      <div className="grid min-h-10 grid-cols-[100px_1fr] items-center gap-3 px-3">
        <span className="text-xs text-muted-foreground capitalize">{label}</span>
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            placeholder={placeholder}
            disabled={saving}
            className="bg-muted border-border text-foreground h-7 text-sm placeholder:text-muted-foreground"
          />
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

  const shown = value && value.trim() ? value : '—';
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
