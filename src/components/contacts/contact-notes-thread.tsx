'use client';

// ContactNotesThread — the authored-notes thread (composer + saved-note
// cards + follow-up-on-note), extracted from ContactDetailView so the
// member detail sheet can mount the exact same surface. A member IS a
// contact, so contact_notes / follow_ups apply unchanged — one thread
// component, keyed by contactId, everywhere a person's notes render.
//
// NoteComposerCard stays private to this profile Notes surface, while its
// follow-up fields and draft model are shared with the standalone dialog.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Calendar, Check, Loader2, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { canDeleteAnyNote } from '@/lib/auth/roles';
import { manualFollowUpReasonForWrite } from '@/lib/follow-ups/manual';
import { buildProfileActivity } from '@/lib/follow-ups/profile-activity';
import {
  duePresets,
  FOLLOW_UP_TASK_TYPES,
  followUpDueLabel,
  remindAtInTz,
  slotFromRemindAt,
} from '@/lib/leads/follow-up-dates';
import { useLocale } from '@/hooks/use-locale';
import {
  useAccountStaff,
  type StaffMember,
} from '@/components/members/use-account-staff';
import {
  DEFAULT_FOLLOW_UP_DRAFT,
  FollowUpFields,
  resolveDueDate,
  type FollowUpDraft,
} from '@/components/follow-ups/follow-up-fields';
import type { ContactNote, FollowUp, FollowUpReason } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MotionList, MotionListItem } from '@/components/ui/motion-list';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { CompleteFollowUpDialog } from '@/components/follow-ups/complete-follow-up-dialog';

/** The slice of a follow_ups row the profile activity timeline needs. */
interface ProfileFollowUp {
  id: string;
  note_id: string | null;
  status: FollowUp['status'];
  task_type: FollowUp['task_type'];
  reason: FollowUpReason;
  due_date: string;
  assigned_to: string | null;
  remind_at: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

/** Editor seed for an existing task: matching preset id or 'custom'. */
function presetIdForDate(date: string, today?: string): string {
  return (
    duePresets(today).find((preset) => preset.date === date)?.id ?? 'custom'
  );
}

interface ContactNotesThreadProps {
  contactId: string | null;
  /** Links note-created tasks to the member Follow-ups tab when hosted
   *  inside a member profile. Contact/lead profiles intentionally omit it. */
  membershipId?: string | null;
  /** Fetch trigger — the hosting sheet's `open`. */
  active: boolean;
  /** Focus target for the host's "Note" quick action. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** Fires after any follow-up-affecting write so the host can re-sync
   *  surfaces that show the contact's open task (member detail's bar). */
  onFollowUpChanged?: () => void;
}

export function ContactNotesThread({
  contactId,
  membershipId,
  active,
  textareaRef,
  onFollowUpChanged,
}: ContactNotesThreadProps) {
  const supabase = createClient();
  const { accountId, accountRole, user, profile } = useAuth();
  const { locale, fmt } = useLocale();
  const { staff, nameById, avatarById } = useAccountStaff();

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [followUps, setFollowUps] = useState<ProfileFollowUp[]>([]);
  const { noteFollowUps, items: activityItems } = useMemo(
    () => buildProfileActivity(notes, followUps),
    [notes, followUps]
  );
  const [completingFollowUp, setCompletingFollowUp] =
    useState<ProfileFollowUp | null>(null);

  // Follow-up bar under the composer: task type + due date, assignee, and
  // optional reminder. Member profiles also show the member-only Reason.
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft>(
    DEFAULT_FOLLOW_UP_DRAFT
  );
  const patchFollowUpDraft = useCallback(
    (patch: Partial<FollowUpDraft>) =>
      setFollowUpDraft((d) => ({ ...d, ...patch })),
    []
  );

  // Latest follow-up-changed callback without re-running effects.
  const followUpChangedRef = useRef(onFollowUpChanged);
  useEffect(() => {
    followUpChangedRef.current = onFollowUpChanged;
  }, [onFollowUpChanged]);
  const notifyFollowUpChanged = () => followUpChangedRef.current?.();

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
        .select(
          'id, note_id, status, task_type, reason, due_date, assigned_to, remind_at, note, created_by, created_at'
        )
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
    ]);

    if (notesRes.data) setNotes(notesRes.data);
    setFollowUps((tasksRes.data as ProfileFollowUp[] | null) ?? []);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (!active || !contactId) return;
    // IIFE per repo convention — no direct setState in the effect body.
    (async () => {
      await fetchNotes();
    })();
  }, [active, contactId, fetchNotes]);

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    const followUpDue = resolveDueDate(followUpDraft, fmt.today());
    if (followUpDraft.enabled && !followUpDue) {
      toast.error('Pick a follow-up date');
      return;
    }
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authUser = session?.user;
    if (!authUser || !accountId) {
      toast.error('Not authenticated');
      setSavingNote(false);
      return;
    }

    const { data: insertedNote, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        account_id: accountId,
        user_id: authUser.id,
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
        membership_id: membershipId ?? null,
        note_id: insertedNote?.id ?? null,
        assigned_to: followUpDraft.assignee || authUser.id,
        created_by: authUser.id,
        reason: manualFollowUpReasonForWrite(
          Boolean(membershipId),
          followUpDraft.reason
        ),
        task_type: followUpDraft.type,
        due_date: followUpDue,
        remind_at: followUpDraft.remindSlot
          ? remindAtInTz(followUpDue, followUpDraft.remindSlot, locale.timeZone)
          : null,
        note: newNote.trim().slice(0, 200),
      });
      if (taskError) {
        if (isUniqueViolation(taskError)) {
          toast.error(
            'Note added — this contact already has an open follow-up, so no new task was created'
          );
        } else {
          toast.error('Note added, but creating the follow-up task failed');
        }
      } else {
        toast.success('Note and follow-up task added');
        setFollowUpDraft(DEFAULT_FOLLOW_UP_DRAFT);
        notifyFollowUpChanged();
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

  function completeFollowUp(followUpId: string) {
    const followUp = followUps.find((task) => task.id === followUpId);
    if (followUp) setCompletingFollowUp(followUp);
  }

  function followUpCompleted(status: 'done' | 'cancelled') {
    if (!completingFollowUp) return;
    setFollowUps((current) =>
      current.map((task) =>
        task.id === completingFollowUp.id ? { ...task, status } : task
      )
    );
    setCompletingFollowUp(null);
    notifyFollowUpChanged();
  }

  async function deleteNote(noteId: string) {
    // Cancel the note's open follow-up FIRST (while note_id still
    // points here). The partial unique index allows one OPEN task per
    // contact — an orphaned open task would block every future
    // follow-up on this contact.
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
      setFollowUps((current) =>
        current.map((task) =>
          task.note_id === noteId
            ? { ...task, note_id: null, status: 'cancelled' }
            : task
        )
      );
      toast.success('Note deleted');
      notifyFollowUpChanged();
    }
  }

  // Save from a note's edit view: update the text, then reconcile the
  // follow-up task with the editor's bar (update / create / cancel).
  async function saveNoteEdit(
    noteId: string,
    text: string,
    draft: FollowUpDraft,
    existing?: ProfileFollowUp
  ): Promise<boolean> {
    if (!contactId) return false;
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Note cannot be empty');
      return false;
    }
    const due = resolveDueDate(draft, fmt.today());
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
      const remind = draft.remindSlot
        ? remindAtInTz(due, draft.remindSlot, locale.timeZone)
        : null;
      if (existing) {
        const { error: taskError } = await supabase
          .from('follow_ups')
          .update({
            task_type: draft.type,
            reason: manualFollowUpReasonForWrite(
              Boolean(membershipId),
              draft.reason
            ),
            due_date: due,
            assigned_to: draft.assignee || authUser.id,
            remind_at: remind,
            ...(membershipId ? { membership_id: membershipId } : {}),
          })
          .eq('id', existing.id);
        if (taskError) {
          toast.error('Note saved, but updating the follow-up failed');
        }
      } else {
        const { error: taskError } = await supabase.from('follow_ups').insert({
          account_id: accountId,
          contact_id: contactId,
          membership_id: membershipId ?? null,
          note_id: noteId,
          assigned_to: draft.assignee || authUser.id,
          created_by: authUser.id,
          reason: manualFollowUpReasonForWrite(
            Boolean(membershipId),
            draft.reason
          ),
          task_type: draft.type,
          due_date: due,
          remind_at: remind,
          note: trimmed.slice(0, 200),
        });
        if (taskError) {
          if (isUniqueViolation(taskError)) {
            toast.error(
              'Note saved — this contact already has an open follow-up, so no new task was created'
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
    notifyFollowUpChanged();
    return true;
  }

  return (
    <>
      {/* pb-4: 16px of air between the composer block (Create note row)
          and the saved notes below. */}
      <div className="grid grid-cols-[auto_1fr] gap-2.5 pb-4">
        <StaffAvatar
          name={profile?.full_name || 'Me'}
          src={profile?.avatar_url}
        />
        <div className="min-w-0 space-y-2">
          <NoteComposerCard
            text={newNote}
            onTextChange={setNewNote}
            draft={followUpDraft}
            onPatch={patchFollowUpDraft}
            staff={staff}
            currentUserId={user?.id ?? ''}
            showReason={Boolean(membershipId)}
            textareaRef={textareaRef}
          />
          <div className="flex items-center justify-between">
            <Button
              onClick={addNote}
              disabled={!newNote.trim() || savingNote}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              size="sm"
            >
              {savingNote && <Loader2 className="size-3.5 animate-spin" />}
              Create note
            </Button>
            <div className="flex items-center gap-2">
              {draftSaved && (
                <span className="text-muted-foreground text-xs">
                  Draft saved
                </span>
              )}
              {(newNote.trim() || draftSaved) && (
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="icon-sm"
                  onClick={discardDraft}
                  aria-label="Discard draft"
                  title="Discard draft"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {loadingNotes ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : activityItems.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No notes or follow-ups yet.
          </p>
        ) : (
          <MotionList>
            {activityItems.map((item) => (
              <MotionListItem key={item.key}>
                {item.kind === 'note' ? (
                  <NoteCard
                    note={item.note}
                    followUp={noteFollowUps[item.note.id]}
                    authorName={nameById.get(item.note.user_id) ?? 'Teammate'}
                    authorAvatarUrl={avatarById.get(item.note.user_id) ?? null}
                    currentUserId={user?.id ?? ''}
                    nameById={nameById}
                    staff={staff}
                    showReason={Boolean(membershipId)}
                    canDeleteAny={
                      accountRole ? canDeleteAnyNote(accountRole) : false
                    }
                    onMarkDone={completeFollowUp}
                    onDelete={deleteNote}
                    onSaveEdit={saveNoteEdit}
                  />
                ) : (
                  <StandaloneFollowUpCard
                    followUp={item.followUp}
                    authorName={
                      nameById.get(item.followUp.created_by) ?? 'Teammate'
                    }
                    authorAvatarUrl={
                      avatarById.get(item.followUp.created_by) ?? null
                    }
                    currentUserId={user?.id ?? ''}
                    nameById={nameById}
                    onMarkDone={completeFollowUp}
                  />
                )}
              </MotionListItem>
            ))}
          </MotionList>
        )}
      </div>

      {completingFollowUp && (
        <CompleteFollowUpDialog
          open={Boolean(completingFollowUp)}
          onOpenChange={(open) => {
            if (!open) setCompletingFollowUp(null);
          }}
          followUp={{
            id: completingFollowUp.id,
            contact_id: contactId ?? undefined,
            membership_id: membershipId ?? null,
            note: completingFollowUp.note,
          }}
          context={membershipId ? 'member' : 'lead'}
          onSaved={followUpCompleted}
        />
      )}
    </>
  );
}

/**
 * Canonical profile card for every follow-up source. The task is always the
 * primary row; optional note content sits beneath it before shared metadata.
 */
function FollowUpActivityCard({
  followUp,
  authorName,
  authorAvatarUrl,
  currentUserId,
  nameById,
  onMarkDone,
  noteContent,
  footerAction,
}: {
  followUp: ProfileFollowUp;
  authorName: string;
  authorAvatarUrl: string | null;
  currentUserId: string;
  nameById: Map<string, string>;
  onMarkDone: (followUpId: string) => void;
  noteContent?: ReactNode;
  footerAction?: ReactNode;
}) {
  const { fmt } = useLocale();
  const assigneeName = followUp.assigned_to
    ? followUp.assigned_to === currentUserId
      ? `Me (${nameById.get(followUp.assigned_to) ?? 'me'})`
      : (nameById.get(followUp.assigned_to) ?? 'Teammate')
    : null;

  return (
    <div className="grid grid-cols-[auto_1fr] gap-2.5">
      <StaffAvatar name={authorName} src={authorAvatarUrl} />
      <div className="group border-border/50 bg-card min-w-0 rounded-lg border">
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
              <Calendar className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-foreground text-sm">Follow-up</p>
              <p className="text-muted-foreground text-xs">
                {followUpDueLabel(
                  followUp.task_type,
                  followUp.due_date,
                  fmt.today()
                )}
              </p>
              {noteContent && <div className="mt-2">{noteContent}</div>}
            </div>
          </div>
          <FollowUpCompletionControl
            status={followUp.status}
            onMarkDone={() => onMarkDone(followUp.id)}
          />
        </div>
        <div className="text-muted-foreground border-border/50 flex min-w-0 items-center justify-between gap-2 border-t px-3 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-4">
            <span className="shrink-0">
              Created on {fmt.date(followUp.created_at)}
            </span>
            {assigneeName && (
              <span className="min-w-0 truncate">
                Assigned to{' '}
                <span className="text-foreground font-medium">
                  {assigneeName}
                </span>
              </span>
            )}
          </span>
          {footerAction}
        </div>
      </div>
    </div>
  );
}

/** A follow-up created from the standalone row action, with or without text. */
function StandaloneFollowUpCard({
  followUp,
  authorName,
  authorAvatarUrl,
  currentUserId,
  nameById,
  onMarkDone,
}: {
  followUp: ProfileFollowUp;
  authorName: string;
  authorAvatarUrl: string | null;
  currentUserId: string;
  nameById: Map<string, string>;
  onMarkDone: (followUpId: string) => void;
}) {
  return (
    <FollowUpActivityCard
      followUp={followUp}
      authorName={authorName}
      authorAvatarUrl={authorAvatarUrl}
      currentUserId={currentUserId}
      nameById={nameById}
      onMarkDone={onMarkDone}
      noteContent={
        followUp.note ? (
          <p className="text-foreground text-sm whitespace-pre-wrap">
            {followUp.note}
          </p>
        ) : undefined
      }
    />
  );
}

function FollowUpCompletionControl({
  status,
  onMarkDone,
}: {
  status: FollowUp['status'];
  onMarkDone: () => void;
}) {
  if (status === 'done') {
    return (
      <span
        title="Followed up"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"
      >
        <Check className="size-4" />
      </span>
    );
  }

  if (status === 'cancelled') {
    return <Badge variant="neutral">Cancelled</Badge>;
  }

  return (
    <button
      type="button"
      onClick={onMarkDone}
      aria-label="Mark as followed up"
      title="Mark as followed up"
      className="border-border text-muted-foreground hover:text-green-foreground flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-green-500"
    >
      <Check className="size-4" />
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
          className="border-border/50 size-9 border"
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
  showReason,
  textareaRef,
  autoFocus,
}: {
  text: string;
  onTextChange: (v: string) => void;
  draft: FollowUpDraft;
  onPatch: (patch: Partial<FollowUpDraft>) => void;
  staff: StaffMember[];
  currentUserId: string;
  showReason: boolean;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
}) {
  return (
    // bg-card (not bg-muted) — the switch's unchecked track is muted
    // grey and disappears on a grey card.
    <div className="border-border bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-lg border transition-colors focus-within:ring-3">
      <Textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Write a note..."
        className="text-foreground placeholder:text-muted-foreground min-h-[64px] resize-none border-0 bg-transparent text-sm focus-visible:border-transparent focus-visible:ring-0"
      />
      <FollowUpFields
        draft={draft}
        onPatch={onPatch}
        staff={staff}
        currentUserId={currentUserId}
        showReason={showReason}
      />
    </div>
  );
}

// One saved note: note-only cards lead with their text; notes attached
// to follow-ups use the canonical task-first card above. Clicking the text opens
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
  showReason,
  onMarkDone,
  onDelete,
  onSaveEdit,
}: {
  note: ContactNote;
  followUp?: ProfileFollowUp;
  authorName: string;
  authorAvatarUrl: string | null;
  currentUserId: string;
  /** Admin/owner moderation: may delete notes authored by others. */
  canDeleteAny: boolean;
  nameById: Map<string, string>;
  staff: StaffMember[];
  showReason: boolean;
  onMarkDone: (followUpId: string) => void;
  onDelete: (noteId: string) => void;
  onSaveEdit: (
    noteId: string,
    text: string,
    draft: FollowUpDraft,
    existing?: ProfileFollowUp
  ) => Promise<boolean>;
}) {
  const { locale, fmt } = useLocale();
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
    const today = fmt.today();
    setDraftText(note.note_text);
    setEditDraft(
      followUp && followUp.status !== 'cancelled'
        ? {
            enabled: true,
            reason: followUp.reason,
            type:
              FOLLOW_UP_TASK_TYPES.find((t) => t.value === followUp.task_type)
                ?.value ?? 'todo',
            dueId: presetIdForDate(followUp.due_date, today),
            customDate:
              presetIdForDate(followUp.due_date, today) === 'custom'
                ? followUp.due_date
                : '',
            assignee: followUp.assigned_to ?? '',
            remindSlot: slotFromRemindAt(followUp.remind_at, locale.timeZone),
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

  const createdOn = fmt.date(note.created_at);

  const deleteAction = (isOwner || canDeleteAny) && (
    <Button
      type="button"
      variant="destructive-ghost"
      size="icon-xs"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(note.id);
      }}
      aria-label="Delete note"
      title="Delete note"
      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Trash2 className="size-3.5" />
    </Button>
  );

  const noteContent = (
    <div
      className="cursor-pointer"
      onClick={handleBodyClick}
      role="button"
      title={isOwner ? 'Click to edit' : 'Click to expand'}
    >
      <p
        className={cn(
          'text-foreground text-sm whitespace-pre-wrap',
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
          className="text-primary-text mt-1 cursor-pointer text-xs font-medium hover:underline"
        >
          {expanded ? 'See less' : 'See more'}
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
            showReason={showReason}
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

  if (followUp) {
    return (
      <FollowUpActivityCard
        followUp={followUp}
        authorName={authorName}
        authorAvatarUrl={authorAvatarUrl}
        currentUserId={currentUserId}
        nameById={nameById}
        onMarkDone={onMarkDone}
        noteContent={noteContent}
        footerAction={deleteAction}
      />
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-2.5">
      <StaffAvatar name={authorName} src={authorAvatarUrl} />
      <div className="group border-border/50 bg-card min-w-0 rounded-lg border">
        <div className="p-3">{noteContent}</div>

        {/* Meta footer strip — divider above, in every layout (per mock) */}
        <div className="text-muted-foreground border-border/50 flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
          <span className="shrink-0">Created on {createdOn}</span>
          {deleteAction}
        </div>
      </div>
    </div>
  );
}
