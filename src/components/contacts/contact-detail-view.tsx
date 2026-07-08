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
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { canDeleteAnyNote } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import {
  duePresets,
  FOLLOW_UP_TASK_TYPES,
  followUpDueLabel,
  remindAtIST,
  REMINDER_SLOTS,
  slotFromRemindAt,
  type FollowUpTaskType,
} from '@/lib/leads/follow-up-dates';
import { istToday } from '@/lib/memberships/expiry';
import {
  useAccountStaff,
  type StaffMember,
} from '@/components/members/use-account-staff';
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
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEditActions } from '@/components/ui/inline-edit-actions';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  Phone,
  Mail,
  Building2,
  ChevronDown,
  Copy,
  Check,
  Loader2,
  Timer,
  Trash2,
  LayoutTemplate,
  Pencil,
  StickyNote,
  MessageCircle,
  UserPlus,
  Calendar,
} from 'lucide-react';

const SECTION_IDS = ['details', 'tags', 'notes'];

/** The slice of a follow_ups row a note card needs for its strip. */
interface NoteFollowUp {
  id: string;
  status: string;
  task_type: string;
  due_date: string;
  assigned_to: string | null;
  remind_at: string | null;
}

/** Editor state for the composer's follow-up bar. */
interface FollowUpDraft {
  enabled: boolean;
  type: FollowUpTaskType;
  /** duePresets() id, or 'custom'. */
  dueId: string;
  customDate: string;
  /** '' = current user. */
  assignee: string;
  /** '' = no reminder; otherwise an IST slot like '08:00'. */
  remindSlot: string;
}

const DEFAULT_FOLLOW_UP_DRAFT: FollowUpDraft = {
  enabled: false,
  type: 'todo',
  dueId: '3d',
  customDate: '',
  assignee: '',
  remindSlot: '',
};

/** The concrete IST due date a draft resolves to (undefined = invalid). */
function resolveDueDate(draft: FollowUpDraft): string | undefined {
  return draft.dueId === 'custom'
    ? draft.customDate || undefined
    : duePresets().find((p) => p.id === draft.dueId)?.date;
}

/** Editor seed for an existing task: matching preset id or 'custom'. */
function presetIdForDate(date: string): string {
  return duePresets().find((p) => p.date === date)?.id ?? 'custom';
}

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
  const { accountId, accountRole, user, profile } = useAuth();
  const { staff, nameById, avatarById } = useAccountStaff();

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
  // Follow-up task attached to each note (via follow_ups.note_id),
  // keyed by note id — drives the card's "Follow up" strip.
  const [noteFollowUps, setNoteFollowUps] = useState<
    Record<string, NoteFollowUp>
  >({});

  // Follow-up bar under the composer (HubSpot-style): task type + due
  // chips plus assignee and an optional reminder time on the due date.
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft>(
    DEFAULT_FOLLOW_UP_DRAFT
  );
  const patchFollowUpDraft = useCallback(
    (patch: Partial<FollowUpDraft>) =>
      setFollowUpDraft((d) => ({ ...d, ...patch })),
    []
  );
  // Unsent note text survives closing the sheet: debounce-saved to
  // localStorage per contact, restored on open, cleared on send/trash.
  const [draftSaved, setDraftSaved] = useState(false);

  const draftKey = contactId ? `wacrm:note-draft:${contactId}` : null;

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    (async () => {
      const stored = window.localStorage.getItem(draftKey) ?? '';
      if (cancelled) return;
      setNewNote(stored);
      setDraftSaved(Boolean(stored));
    })();
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    const id = window.setTimeout(() => {
      if (newNote.trim()) {
        window.localStorage.setItem(draftKey, newNote);
        setDraftSaved(true);
      } else {
        window.localStorage.removeItem(draftKey);
        setDraftSaved(false);
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [draftKey, newNote]);

  function discardDraft() {
    if (draftKey) window.localStorage.removeItem(draftKey);
    setNewNote('');
    setDraftSaved(false);
    setFollowUpDraft(DEFAULT_FOLLOW_UP_DRAFT);
  }

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

    const [notesRes, tasksRes] = await Promise.all([
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      supabase
        .from('follow_ups')
        .select('id, note_id, status, task_type, due_date, assigned_to, remind_at')
        .eq('contact_id', contactId)
        .not('note_id', 'is', null),
    ]);

    if (notesRes.data) setNotes(notesRes.data);
    const map: Record<string, NoteFollowUp> = {};
    for (const t of (tasksRes.data ?? []) as (NoteFollowUp & {
      note_id: string;
    })[]) {
      map[t.note_id] = t;
    }
    setNoteFollowUps(map);
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
    const followUpDue = resolveDueDate(followUpDraft);
    if (followUpDraft.enabled && !followUpDue) {
      toast.error('Pick a follow-up date');
      return;
    }
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

    const { data: insertedNote, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        account_id: accountId,
        user_id: user.id,
        note_text: newNote.trim(),
      })
      .select('id')
      .single();

    if (error) {
      toast.error('Failed to add note');
      setSavingNote(false);
      return;
    }

    // The optional follow-up task rides along with the note. The DB
    // allows one OPEN task per contact — hitting that isn't a failure
    // of the note, so report it distinctly.
    if (followUpDraft.enabled && followUpDue) {
      const { error: taskError } = await supabase.from('follow_ups').insert({
        account_id: accountId,
        contact_id: contactId,
        note_id: insertedNote?.id ?? null,
        assigned_to: followUpDraft.assignee || user.id,
        created_by: user.id,
        reason: 'other',
        task_type: followUpDraft.type,
        due_date: followUpDue,
        remind_at: followUpDraft.remindSlot
          ? remindAtIST(followUpDue, followUpDraft.remindSlot)
          : null,
        note: newNote.trim().slice(0, 200),
      });
      if (taskError) {
        if (isUniqueViolation(taskError)) {
          toast.error(
            'Note added — this lead already has an open follow-up, so no new task was created'
          );
        } else {
          toast.error('Note added, but creating the follow-up task failed');
        }
      } else {
        toast.success('Note and follow-up task added');
        setFollowUpDraft(DEFAULT_FOLLOW_UP_DRAFT);
      }
    } else {
      toast.success('Note added');
    }

    setNewNote('');
    if (draftKey) window.localStorage.removeItem(draftKey);
    setDraftSaved(false);
    fetchNotes();
    setSavingNote(false);
  }

  async function markFollowUpDone(noteId: string, followUpId: string) {
    const { error } = await supabase
      .from('follow_ups')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', followUpId);
    if (error) {
      toast.error('Failed to mark as followed up');
      return;
    }
    setNoteFollowUps((prev) => ({
      ...prev,
      [noteId]: { ...prev[noteId], status: 'done' },
    }));
    toast.success('Marked as followed up');
  }

  async function deleteNote(noteId: string) {
    // Cancel the note's open follow-up FIRST (while note_id still
    // points here). The partial unique index allows one OPEN task per
    // contact — an orphaned open task would block every future
    // follow-up on this lead.
    await supabase
      .from('follow_ups')
      .update({ status: 'cancelled' })
      .eq('note_id', noteId)
      .eq('status', 'open');

    // .select() makes an RLS-blocked delete detectable: it returns no
    // error, just zero rows — without it we'd toast success while the
    // note survives (only its own author or an admin may delete).
    const { data: deleted, error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId)
      .select('id');

    if (error || !deleted?.length) {
      toast.error('Failed to delete note');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setNoteFollowUps((prev) => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
      toast.success('Note deleted');
    }
  }

  // Save from a note's edit view: update the text, then reconcile the
  // follow-up task with the editor's bar (update / create / cancel).
  async function saveNoteEdit(
    noteId: string,
    text: string,
    draft: FollowUpDraft,
    existing?: NoteFollowUp
  ): Promise<boolean> {
    if (!contactId) return false;
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Note cannot be empty');
      return false;
    }
    const due = resolveDueDate(draft);
    if (draft.enabled && !due) {
      toast.error('Pick a follow-up date');
      return false;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authUser = session?.user;
    if (!authUser || !accountId) {
      toast.error('Not authenticated');
      return false;
    }

    const { error } = await supabase
      .from('contact_notes')
      .update({ note_text: trimmed })
      .eq('id', noteId);
    if (error) {
      toast.error('Failed to update note');
      return false;
    }

    if (draft.enabled && due) {
      const remind = draft.remindSlot ? remindAtIST(due, draft.remindSlot) : null;
      if (existing) {
        const { error: taskError } = await supabase
          .from('follow_ups')
          .update({
            task_type: draft.type,
            due_date: due,
            assigned_to: draft.assignee || authUser.id,
            remind_at: remind,
          })
          .eq('id', existing.id);
        if (taskError) {
          toast.error('Note saved, but updating the follow-up failed');
        }
      } else {
        const { error: taskError } = await supabase.from('follow_ups').insert({
          account_id: accountId,
          contact_id: contactId,
          note_id: noteId,
          assigned_to: draft.assignee || authUser.id,
          created_by: authUser.id,
          reason: 'other',
          task_type: draft.type,
          due_date: due,
          remind_at: remind,
          note: trimmed.slice(0, 200),
        });
        if (taskError) {
          if (isUniqueViolation(taskError)) {
            toast.error(
              'Note saved — this lead already has an open follow-up, so no new task was created'
            );
          } else {
            toast.error('Note saved, but creating the follow-up failed');
          }
        }
      }
    } else if (!draft.enabled && existing && existing.status === 'open') {
      // Toggled off in the editor — retire the task.
      await supabase
        .from('follow_ups')
        .update({ status: 'cancelled' })
        .eq('id', existing.id);
    }

    toast.success('Note updated');
    fetchNotes();
    return true;
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
                    {/* pb-4: 16px of air between the composer block
                        (Create note row) and the saved notes below. */}
                    <div className="grid grid-cols-[auto_1fr] gap-2.5 pb-4">
                      <StaffAvatar
                        name={profile?.full_name || 'Me'}
                        src={profile?.avatar_url}
                      />
                      <div className="space-y-2 min-w-0">
                      <NoteComposerCard
                        text={newNote}
                        onTextChange={setNewNote}
                        draft={followUpDraft}
                        onPatch={patchFollowUpDraft}
                        staff={staff}
                        currentUserId={user?.id ?? ''}
                        textareaRef={noteInputRef}
                      />
                      <div className="flex items-center justify-between">
                        <Button
                          onClick={addNote}
                          disabled={!newNote.trim() || savingNote}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground"
                          size="sm"
                        >
                          {savingNote && (
                            <Loader2 className="size-3.5 animate-spin" />
                          )}
                          Create note
                        </Button>
                        <div className="flex items-center gap-2">
                          {draftSaved && (
                            <span className="text-xs text-muted-foreground">
                              Draft saved
                            </span>
                          )}
                          {(newNote.trim() || draftSaved) && (
                            <button
                              type="button"
                              onClick={discardDraft}
                              aria-label="Discard draft"
                              title="Discard draft"
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive cursor-pointer"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      </div>
                    </div>

                    <div className="space-y-4">
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
                          <NoteCard
                            key={note.id}
                            note={note}
                            followUp={noteFollowUps[note.id]}
                            authorName={
                              nameById.get(note.user_id) ?? 'Teammate'
                            }
                            authorAvatarUrl={
                              avatarById.get(note.user_id) ?? null
                            }
                            currentUserId={user?.id ?? ''}
                            nameById={nameById}
                            staff={staff}
                            canDeleteAny={
                              accountRole ? canDeleteAnyNote(accountRole) : false
                            }
                            onMarkDone={markFollowUpDone}
                            onDelete={deleteNote}
                            onSaveEdit={saveNoteEdit}
                          />
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
              symbol={currencySymbol(defaultCurrency)}
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

// Note author's avatar (and the composer's current user) — photo when
// uploaded, initial fallback otherwise; hover reveals the full name.
function StaffAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={name}
            className="inline-flex cursor-default self-start"
          />
        }
      >
        <UserAvatar
          className="size-9 border border-border/50"
          name={name}
          src={src}
        />
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

// The composer card — borderless textarea + attached follow-up bar in
// one bordered container. Shared by "write a note" and a saved note's
// edit view (which swaps the footer CTA for Save/Cancel).
function NoteComposerCard({
  text,
  onTextChange,
  draft,
  onPatch,
  staff,
  currentUserId,
  textareaRef,
  autoFocus,
}: {
  text: string;
  onTextChange: (v: string) => void;
  draft: FollowUpDraft;
  onPatch: (patch: Partial<FollowUpDraft>) => void;
  staff: StaffMember[];
  currentUserId: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
}) {
  return (
    // bg-card (not bg-muted) — the switch's unchecked track is muted
    // grey and disappears on a grey card.
    <div className="rounded-lg border border-border bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 transition-colors">
      <Textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Write a note..."
        className="border-0 bg-transparent text-foreground placeholder:text-muted-foreground min-h-[64px] text-sm resize-none focus-visible:ring-0 focus-visible:border-transparent"
      />
      <FollowUpRow
        draft={draft}
        onPatch={onPatch}
        staff={staff}
        currentUserId={currentUserId}
      />
    </div>
  );
}

// Follow-up bar attached under the note textarea — three states (per
// the mocks): switch off = just the label row; on = task chips ("[Call ▾]
// [In 3 days (Friday) ▾]") plus an "Assign to … / reminder" strip under
// its own divider. Reminder defaults to none ("Set reminder").
function FollowUpRow({
  draft,
  onPatch,
  staff,
  currentUserId,
}: {
  draft: FollowUpDraft;
  onPatch: (patch: Partial<FollowUpDraft>) => void;
  staff: StaffMember[];
  currentUserId: string;
}) {
  const presets = duePresets();
  // Chip shows the preset label verbatim ("In 3 days (Friday)",
  // "Tomorrow") — no connecting "in" between the two chips.
  const dueLabel =
    draft.dueId === 'custom'
      ? draft.customDate || 'Custom date'
      : presets.find((p) => p.id === draft.dueId)?.label ?? presets[3].label;
  const effectiveAssignee = draft.assignee || currentUserId;
  const assigneeMember = staff.find((s) => s.user_id === effectiveAssignee);
  const assigneeLabel = assigneeMember
    ? `${assigneeMember.full_name}${effectiveAssignee === currentUserId ? ' (Me)' : ''}`
    : 'Me';
  const remindLabel =
    REMINDER_SLOTS.find((s) => s.value === draft.remindSlot)?.label ??
    'Set reminder';

  // Sizing/spacing per the Figma spec (node 38:793): a 12/8 padded bar
  // with NO flex gap — each row self-pads (label row py-1, chips row
  // py-2, so 12px between them and 16px under the chips). Chips are
  // 14px text in 8/4 padded pills with 4px inner gaps; the footer line
  // is 12px text, regular weight, 4px inner gaps and 16px between the
  // two groups.
  const chip =
    'inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground hover:bg-muted';
  const textTrigger =
    'inline-flex cursor-pointer items-center gap-1 py-1 text-xs text-foreground hover:text-primary-text';
  const item = 'text-popover-foreground focus:bg-muted focus:text-foreground';

  return (
    <div className="border-t border-border">
      <div className="flex flex-col px-3 py-2">
        <div className="flex items-center justify-between gap-2 py-1">
          <span className="text-sm text-foreground">Add a follow up task</span>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(v) => onPatch({ enabled: v === true })}
            aria-label="Add a follow up task"
          />
        </div>

        {/* What + when */}
        {draft.enabled && (
          <div className="flex flex-wrap items-center gap-2 py-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={chip} />}>
                {FOLLOW_UP_TASK_TYPES.find((t) => t.value === draft.type)?.label}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover border-border min-w-28">
                {FOLLOW_UP_TASK_TYPES.map((t) => (
                  <DropdownMenuItem
                    key={t.value}
                    onClick={() => onPatch({ type: t.value })}
                    className={item}
                  >
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={chip} />}>
                {dueLabel}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover border-border min-w-52">
                {presets.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => onPatch({ dueId: p.id })}
                    className={item}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => onPatch({ dueId: 'custom' })}
                  className={item}
                >
                  Custom date
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {draft.dueId === 'custom' && (
              <input
                type="date"
                value={draft.customDate}
                min={istToday()}
                onChange={(e) => onPatch({ customDate: e.target.value })}
                className="h-7 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-primary"
                aria-label="Follow-up date"
              />
            )}
          </div>
        )}
      </div>

      {/* Who + reminder — its own strip under a full-width divider (per mock) */}
      {draft.enabled && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-3 py-2">
            <span className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Assign to</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" className={textTrigger} />}>
                  {assigneeLabel}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-popover border-border min-w-44">
                  {staff.map((s) => (
                    <DropdownMenuItem
                      key={s.user_id}
                      onClick={() => onPatch({ assignee: s.user_id })}
                      className={item}
                    >
                      {s.user_id === currentUserId
                        ? `${s.full_name} (Me)`
                        : s.full_name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={textTrigger} />}>
                <Timer className="size-4 text-muted-foreground" />
                {remindLabel}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover border-border min-w-36 max-h-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => onPatch({ remindSlot: '' })} className={item}>
                  No reminder
                </DropdownMenuItem>
                {REMINDER_SLOTS.map((s) => (
                  <DropdownMenuItem
                    key={s.value}
                    onClick={() => onPatch({ remindSlot: s.value })}
                    className={item}
                  >
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
      )}
    </div>
  );
}

// One saved note: author avatar + card with the text (clamped to 3
// lines behind "See more"), a "Follow up" strip when the note spawned
// a task, and the assignee/created meta row. Clicking the card opens
// the FULL composer edit view for the note's creator (textarea +
// follow-up bar, Save/Cancel footer); for anyone else it just
// expands/collapses the text.
function NoteCard({
  note,
  followUp,
  authorName,
  authorAvatarUrl,
  currentUserId,
  canDeleteAny,
  nameById,
  staff,
  onMarkDone,
  onDelete,
  onSaveEdit,
}: {
  note: ContactNote;
  followUp?: NoteFollowUp;
  authorName: string;
  authorAvatarUrl: string | null;
  currentUserId: string;
  /** Admin/owner moderation: may delete notes authored by others. */
  canDeleteAny: boolean;
  nameById: Map<string, string>;
  staff: StaffMember[];
  onMarkDone: (noteId: string, followUpId: string) => void;
  onDelete: (noteId: string) => void;
  onSaveEdit: (
    noteId: string,
    text: string,
    draft: FollowUpDraft,
    existing?: NoteFollowUp
  ) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOwner = note.user_id === currentUserId;
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [editDraft, setEditDraft] = useState<FollowUpDraft>(
    DEFAULT_FOLLOW_UP_DRAFT
  );
  const [savingEdit, setSavingEdit] = useState(false);
  // Clamp heuristic — cheap and stable (no layout measurement):
  // long text or 4+ lines gets the 3-line clamp + "See more".
  const isLong =
    note.note_text.length > 180 || note.note_text.split('\n').length > 3;

  function beginEdit() {
    setDraftText(note.note_text);
    setEditDraft(
      followUp && followUp.status !== 'cancelled'
        ? {
            enabled: true,
            type:
              FOLLOW_UP_TASK_TYPES.find((t) => t.value === followUp.task_type)
                ?.value ?? 'todo',
            dueId: presetIdForDate(followUp.due_date),
            customDate:
              presetIdForDate(followUp.due_date) === 'custom'
                ? followUp.due_date
                : '',
            assignee: followUp.assigned_to ?? '',
            remindSlot: slotFromRemindAt(followUp.remind_at),
          }
        : DEFAULT_FOLLOW_UP_DRAFT
    );
    setEditing(true);
  }

  function handleBodyClick() {
    if (editing) return;
    if (isOwner) beginEdit();
    else setExpanded((v) => !v);
  }

  async function saveEdit() {
    setSavingEdit(true);
    const ok = await onSaveEdit(note.id, draftText, editDraft, followUp);
    setSavingEdit(false);
    if (ok) setEditing(false);
  }

  const assigneeName = followUp?.assigned_to
    ? followUp.assigned_to === currentUserId
      ? `Me (${nameById.get(followUp.assigned_to) ?? 'me'})`
      : nameById.get(followUp.assigned_to) ?? 'Teammate'
    : null;

  const createdOn = new Date(note.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Meta footer — always the card's own bottom strip (under a divider),
  // "Created on" first, then the assignee when the note spawned a task.
  const metaRow = (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-4">
        <span className="shrink-0">Created on {createdOn}</span>
        {assigneeName && (
          <span className="min-w-0 truncate">
            Assigned to{' '}
            <span className="font-medium text-foreground">{assigneeName}</span>
          </span>
        )}
      </span>
      {(isOwner || canDeleteAny) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          aria-label="Delete note"
          title="Delete note"
          className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );

  if (editing) {
    // Full composer, same as writing a new note — only the footer CTA
    // differs (Save / Cancel instead of Create note).
    return (
      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <StaffAvatar name={authorName} src={authorAvatarUrl} />
        <div className="min-w-0 space-y-2">
          <NoteComposerCard
            text={draftText}
            onTextChange={setDraftText}
            draft={editDraft}
            onPatch={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
            staff={staff}
            currentUserId={currentUserId}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={saveEdit}
              disabled={!draftText.trim() || savingEdit}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {savingEdit && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={savingEdit}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-2.5">
      <StaffAvatar name={authorName} src={authorAvatarUrl} />
      <div className="group min-w-0 rounded-lg border border-border/50 bg-card">
        <div
          className="cursor-pointer p-3"
          onClick={handleBodyClick}
          role="button"
          title={isOwner ? 'Click to edit' : 'Click to expand'}
        >
          <p
            className={cn(
              'text-sm text-foreground whitespace-pre-wrap',
              isLong && !expanded && 'line-clamp-3'
            )}
          >
            {note.note_text}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="mt-1 cursor-pointer text-xs font-medium text-primary-text hover:underline"
            >
              {expanded ? 'See less' : 'See more'}
            </button>
          )}
        </div>

        {followUp && (
          <div className="border-t border-border/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                {/* Leading calendar avatar — flags the strip as a task,
                    mirroring the author avatar's size/gap so the two
                    rows read as a set. */}
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Calendar className="size-4" />
                </span>
                {/* 2px title→due gap per the Figma spec. Spans, not <p> —
                    the accordion content styles descendant <p>s with mb-4,
                    which would defeat the gap. */}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-foreground">Follow up</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {followUpDueLabel(followUp.task_type, followUp.due_date)}
                  </span>
                </div>
              </div>
              {followUp.status === 'done' ? (
                <span
                  title="Followed up"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"
                >
                  <Check className="size-4" />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onMarkDone(note.id, followUp.id)}
                  aria-label="Mark as followed up"
                  title="Mark as followed up"
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-green-500 hover:text-green-700 dark:hover:text-green-400"
                >
                  <Check className="size-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Meta footer strip — divider above, in every layout (per mock) */}
        <div className="border-t border-border/50 px-3 py-2">{metaRow}</div>
      </div>
    </div>
  );
}
