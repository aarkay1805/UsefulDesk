'use client';

// ContactNotesThread — the authored-notes thread (composer + saved-note
// cards + follow-up-on-note), extracted from ContactDetailView so the
// member detail sheet can mount the exact same surface. A member IS a
// contact, so contact_notes / follow_ups apply unchanged — one thread
// component, keyed by contactId, everywhere a person's notes render.
//
// The composer itself is the shared FollowUpComposer — the same block the
// standalone Create-follow-up dialog renders, so this surface stays the
// base reference for every manual follow-up in the product.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { getErrorMessage } from '@/lib/errors';
import { canDeleteAnyNote } from '@/lib/auth/roles';
import { manualFollowUpReasonForWrite } from '@/lib/follow-ups/manual';
import { followUpDueState } from '@/lib/follow-ups/due-state';
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
import { FollowUpComposer } from '@/components/follow-ups/follow-up-composer';
import {
  DEFAULT_FOLLOW_UP_DRAFT,
  resolveDueDate,
  type FollowUpDraft,
} from '@/components/follow-ups/follow-up-fields';
import type { ContactNote, FollowUp, FollowUpReason } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MotionList, MotionListItem } from '@/components/ui/motion-list';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/ui/user-avatar';
import { CompleteFollowUpDialog } from '@/components/follow-ups/complete-follow-up-dialog';
import { FollowUpCompletionControl } from '@/components/follow-ups/follow-up-completion-control';
import { TASK_ICON } from '@/components/follow-ups/follow-up-task-summary';

/** Row actions stay hidden until the card is hovered or focused, but a touch
 *  device never hovers — there they are always on. */
const HOVER_ACTION_CLASS =
  'shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100';

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
  /** Seeds the composer's member-only Reason chip, so a note-created
   *  follow-up starts on the same reason the row action would pick.
   *  Contact/lead profiles omit it and keep the neutral sentinel. */
  followUpReason?: FollowUpReason;
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
  followUpReason,
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
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [followUps, setFollowUps] = useState<ProfileFollowUp[]>([]);
  const { noteFollowUps, items: activityItems } = useMemo(
    () => buildProfileActivity(notes, followUps),
    [notes, followUps]
  );
  const [completingFollowUp, setCompletingFollowUp] =
    useState<ProfileFollowUp | null>(null);

  // A fresh draft for this profile. Only Reason is contextual: the host
  // knows the membership, so the composer and the row-action dialog land
  // on the same chip for the same member instead of one saying "Other".
  const emptyDraft = useMemo<FollowUpDraft>(
    () => ({
      ...DEFAULT_FOLLOW_UP_DRAFT,
      reason: followUpReason ?? DEFAULT_FOLLOW_UP_DRAFT.reason,
    }),
    [followUpReason]
  );

  // Follow-up bar under the composer: task type + due date, assignee, and
  // optional reminder. Member profiles also show the member-only Reason.
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft>(
    () => emptyDraft
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
    setFollowUpDraft(emptyDraft);
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
      toast.error('Pick a due date');
      return;
    }
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authUser = session?.user;
    if (!authUser || !accountId) {
      toast.error('Your session has expired. Sign in again to save this note.');
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
      toast.error(
        getErrorMessage(
          error,
          "Couldn't add the note. Check your connection and try again."
        )
      );
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
            'Note added. Only one open follow-up at a time — complete the current one first.'
          );
        } else {
          toast.error(
            "Note added, but the follow-up wasn't created. Edit the note to try again."
          );
        }
      } else {
        toast.success('Note and follow-up added');
        setFollowUpDraft(emptyDraft);
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
    if (deletingNoteId) return;
    const hadOpenFollowUp = followUps.some(
      (task) => task.note_id === noteId && task.status === 'open'
    );
    setDeletingNoteId(noteId);
    try {
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
        toast.error(
          getErrorMessage(
            error,
            "Couldn't delete the note. Refresh and try again."
          )
        );
      } else {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        setFollowUps((current) =>
          current.map((task) =>
            task.note_id === noteId
              ? { ...task, note_id: null, status: 'cancelled' }
              : task
          )
        );
        // Deleting the note retired its open task above — say so, rather
        // than letting a follow-up the user scheduled vanish silently.
        toast.success(
          hadOpenFollowUp
            ? 'Note deleted. Its open follow-up was cancelled.'
            : 'Note deleted'
        );
        notifyFollowUpChanged();
      }
    } finally {
      setDeletingNoteId(null);
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
      toast.error('Write something before saving.');
      return false;
    }
    const due = resolveDueDate(draft, fmt.today());
    if (draft.enabled && !due) {
      toast.error('Pick a due date');
      return false;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authUser = session?.user;
    if (!authUser || !accountId) {
      toast.error(
        'Your session has expired. Sign in again to save your changes.'
      );
      return false;
    }

    const { error } = await supabase
      .from('contact_notes')
      .update({ note_text: trimmed })
      .eq('id', noteId);
    if (error) {
      toast.error(
        getErrorMessage(
          error,
          "Couldn't save the note. Check your connection and try again."
        )
      );
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
          toast.error(
            "Note saved, but the follow-up wasn't updated. Try again."
          );
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
              'Note saved. Only one open follow-up at a time — complete the current one first.'
            );
          } else {
            toast.error(
              "Note saved, but the follow-up wasn't created. Try again."
            );
          }
        }
      }
    } else if (!draft.enabled && existing && existing.status === 'open') {
      // Toggled off in the editor — retire the task. An RLS-blocked
      // update returns no error and zero rows, so the returned row (not
      // the absent error) decides whether the user is told it worked.
      const { data: cancelled } = await supabase
        .from('follow_ups')
        .update({ status: 'cancelled' })
        .eq('id', existing.id)
        .select('id')
        .maybeSingle();
      if (!cancelled) {
        toast.error(
          "Note saved, but the follow-up wasn't cancelled. Refresh and try again."
        );
      }
    }

    toast.success('Note updated');
    fetchNotes();
    notifyFollowUpChanged();
    return true;
  }

  // A disabled primary button must never be a dead end: the status slot
  // beside it always says what the composer is still waiting for.
  const hasText = Boolean(newNote.trim());
  const needsFollowUpDate =
    followUpDraft.enabled && !resolveDueDate(followUpDraft, fmt.today());
  const composerHint = needsFollowUpDate
    ? 'Pick a due date'
    : followUpDraft.enabled && !hasText
      ? 'Write a note to save this follow-up'
      : draftSaved
        ? // The draft lives in this browser's localStorage — say so, so nobody
          // expects it on their phone or on a teammate's screen.
          'Draft saved on this device'
        : null;

  return (
    <>
      {/* pb-4: 16px of air between the composer block (Add note row)
          and the saved notes below. */}
      <div className="grid grid-cols-[auto_1fr] gap-2.5 pb-4">
        <StaffAvatar
          name={profile?.full_name || 'Me'}
          src={profile?.avatar_url}
        />
        <div className="min-w-0 space-y-2">
          <FollowUpComposer
            text={newNote}
            onTextChange={setNewNote}
            onSubmit={addNote}
            draft={followUpDraft}
            onPatch={patchFollowUpDraft}
            staff={staff}
            currentUserId={user?.id ?? ''}
            showReason={Boolean(membershipId)}
            textareaRef={textareaRef}
          />
          {/* Wraps rather than clips: on a phone the status drops to its own
              line instead of truncating mid-sentence. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <Button
              onClick={addNote}
              disabled={!hasText || needsFollowUpDate}
              loading={savingNote}
              size="sm"
            >
              {followUpDraft.enabled ? 'Add note & follow-up' : 'Add note'}
            </Button>
            <div className="flex min-w-0 items-center gap-1">
              {composerHint && (
                <span role="status" className="text-muted-foreground text-xs">
                  {composerHint}
                </span>
              )}
              {(hasText || draftSaved) && (
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
          <div className="space-y-1 py-6 text-center">
            <p className="text-foreground text-sm font-medium">
              No notes or follow-ups yet
            </p>
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              Record what happened — a call, a visit, a payment promise — and
              add a follow-up so it doesn&apos;t get missed.
            </p>
          </div>
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
                    emptyDraft={emptyDraft}
                    canDeleteAny={
                      accountRole ? canDeleteAnyNote(accountRole) : false
                    }
                    onMarkDone={completeFollowUp}
                    onDelete={deleteNote}
                    deleting={deletingNoteId === item.note.id}
                    deleteBlocked={deletingNoteId !== null}
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
  // Same "<name> (Me)" order the Assign to field uses, so the card and the
  // control that set it never read differently.
  const assigneeName = followUp.assigned_to
    ? followUp.assigned_to === currentUserId
      ? `${nameById.get(followUp.assigned_to) ?? 'Me'} (Me)`
      : (nameById.get(followUp.assigned_to) ?? 'Teammate')
    : null;
  // The icon carries the task type, so the heading can keep the product's
  // one noun for the thing itself and give the row to its urgency instead.
  const TaskIcon = TASK_ICON[followUp.task_type] ?? TASK_ICON.todo;
  const due = followUpDueState(followUp.status, followUp.due_date, fmt.today());

  return (
    <div className="grid grid-cols-[auto_1fr] gap-2.5">
      <StaffAvatar name={authorName} src={authorAvatarUrl} />
      <div className="group border-border/50 bg-card min-w-0 rounded-lg border">
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
              <TaskIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="text-foreground text-sm">Follow-up</p>
                {due && <Badge variant={due.variant}>{due.label}</Badge>}
              </div>
              <p className="text-muted-foreground text-xs">
                {followUpDueLabel(
                  followUp.task_type,
                  followUp.due_date,
                  fmt.today()
                )}
              </p>
              {followUp.remind_at && followUp.status === 'open' && (
                <p className="text-muted-foreground text-xs">
                  Reminder at {fmt.time(followUp.remind_at)} on the due date
                </p>
              )}
              {noteContent && <div className="mt-2">{noteContent}</div>}
            </div>
          </div>
          <FollowUpCompletionControl
            status={followUp.status}
            onMarkDone={() => onMarkDone(followUp.id)}
          />
        </div>
        <div className="text-muted-foreground border-border/50 flex min-w-0 items-center justify-between gap-2 border-t px-3 py-2 text-xs">
          {/* The avatar names the creator; the footer carries when it was
              made and who owns it, wrapping rather than clipping. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5">
            <span
              className="shrink-0"
              title={fmt.dateTime(followUp.created_at)}
            >
              Created on {fmt.date(followUp.created_at)}
            </span>
            {assigneeName && (
              <span className="flex min-w-0 items-center gap-1">
                <span className="shrink-0">Assigned to</span>
                <span className="text-foreground truncate font-medium">
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
  emptyDraft,
  onMarkDone,
  onDelete,
  deleting,
  deleteBlocked,
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
  /** Seed for "this note has no follow-up yet" — same as the composer's. */
  emptyDraft: FollowUpDraft;
  onMarkDone: (followUpId: string) => void;
  onDelete: (noteId: string) => void;
  deleting: boolean;
  deleteBlocked: boolean;
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
  const [editDraft, setEditDraft] = useState<FollowUpDraft>(() => emptyDraft);
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
        : emptyDraft
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

  const editNeedsDate =
    editDraft.enabled && !resolveDueDate(editDraft, fmt.today());
  const bodyClickDoesSomething = isOwner || isLong;

  const createdOn = fmt.date(note.created_at);

  // Deleting a note cancels the follow-up attached to it. Say that on the
  // control itself, so the consequence is visible before the click.
  const deleteLabel =
    followUp && followUp.status === 'open'
      ? 'Delete note and cancel its follow-up'
      : 'Delete note';

  // Both card actions live in the footer strip so they are reachable by
  // keyboard and on touch — the body click stays a mouse shortcut, not the
  // only way in.
  const cardActions = (
    <span className="flex shrink-0 items-center gap-0.5">
      {isOwner && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            beginEdit();
          }}
          aria-label="Edit note"
          title="Edit note"
          className={HOVER_ACTION_CLASS}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      {(isOwner || canDeleteAny) && (
        <Button
          type="button"
          variant="destructive-ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          aria-label={deleteLabel}
          loading={deleting}
          disabled={deleteBlocked}
          title={deleteLabel}
          className={HOVER_ACTION_CLASS}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </span>
  );

  const noteContent = (
    <div>
      {/* Presentational click shortcut: the same actions exist as real
          buttons in the footer, so this div needs no role of its own. */}
      <p
        onClick={bodyClickDoesSomething ? handleBodyClick : undefined}
        className={cn(
          'text-foreground text-sm whitespace-pre-wrap',
          // No pointer cursor on a short note someone else wrote — there is
          // nothing to edit and nothing to expand.
          bodyClickDoesSomething && 'cursor-pointer',
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
          aria-expanded={expanded}
          className="text-primary-text mt-1 text-xs font-medium hover:underline"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );

  if (editing) {
    // Full composer, same as writing a new note — only the footer CTA
    // differs (Save / Cancel instead of Add note).
    return (
      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <StaffAvatar name={authorName} src={authorAvatarUrl} />
        <div className="min-w-0 space-y-2">
          <FollowUpComposer
            text={draftText}
            onTextChange={setDraftText}
            onSubmit={saveEdit}
            draft={editDraft}
            onPatch={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
            staff={staff}
            currentUserId={currentUserId}
            showReason={showReason}
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={saveEdit}
                disabled={!draftText.trim() || editNeedsDate}
                loading={savingEdit}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={savingEdit}
              >
                Cancel
              </Button>
            </div>
            {editNeedsDate && (
              <span role="status" className="text-muted-foreground text-xs">
                Pick a due date
              </span>
            )}
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
        footerAction={cardActions}
      />
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-2.5">
      <StaffAvatar name={authorName} src={authorAvatarUrl} />
      <div className="group border-border/50 bg-card min-w-0 rounded-lg border">
        <div className="p-3">{noteContent}</div>

        {/* Meta footer strip — divider above, in every layout (per mock).
            The author is the avatar's job; this strip only dates the note. */}
        <div className="text-muted-foreground border-border/50 flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
          <span className="shrink-0" title={fmt.dateTime(note.created_at)}>
            Created on {createdOn}
          </span>
          {cardActions}
        </div>
      </div>
    </div>
  );
}
