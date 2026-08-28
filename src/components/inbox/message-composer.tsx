'use client';

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  KeyboardEvent,
} from 'react';
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ResolvableAction,
  type ActionBlocker,
  type ResolvableActionOpenChangeDetails,
} from '@/components/ui/resolvable-action';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ReplyQuote } from './reply-quote';

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = 'image' | 'video' | 'document' | 'audio';

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = 'chat-media';

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void | Promise<void>;
  onSendMedia: (payload: SendMediaPayload) => void | Promise<void>;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftRef = useRef<MediaDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan('send-messages');
  const readOnly = !canSend;
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;
  const permissionBlocker: ActionBlocker | null = readOnly
    ? {
        title: 'Admin access required',
        description:
          'Only an admin or owner can send WhatsApp messages from this account.',
      }
    : null;
  const closedSessionBlocker: ActionBlocker | null = sessionExpired
    ? {
        title: 'WhatsApp session has closed',
        description:
          'Send an approved template to reopen the 24-hour WhatsApp session.',
        resolution: { label: 'Send template', onResolve: onOpenTemplates },
      }
    : null;
  const sendBlocker = permissionBlocker ?? closedSessionBlocker;
  const sendBlockerIdentity = permissionBlocker
    ? 'permission'
    : closedSessionBlocker
      ? 'session'
      : 'allowed';
  const sendDisabled = sending || (!sendBlocker && !text.trim());

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  // Staging a reply should put the caret where the reply gets typed.
  // Without this, hitting Reply on a bubble armed the quote in the composer
  // and then left the agent to click into the textarea before they could
  // type — the one action the button exists to start.
  const replyToId = replyTo?.id ?? null;
  useEffect(() => {
    if (!replyToId) return;
    textareaRef.current?.focus();
  }, [replyToId]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
    el.style.overflowY = el.scrollHeight > 96 ? 'auto' : 'hidden';
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      await onSend(trimmed, replyTo?.id);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'hidden';
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(
            "AI isn't set up yet — enable it in Settings → AI Assistant."
          );
        } else {
          toast.error(data.error ?? "Couldn't draft a reply.");
        }
        return;
      }
      const draftText = typeof data.draft === 'string' ? data.draft.trim() : '';
      if (!draftText) {
        toast.error("The assistant didn't return a reply.");
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error("Couldn't reach the AI assistant.");
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
            max / 1024 / 1024
          )} MB.`
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({
          kind,
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [removeStaged]
  );

  const handlePicked = useCallback(
    (kind: 'image' | 'video' | 'document', file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload]
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File(
        [bytes as unknown as BlobPart],
        `voice-${Date.now()}.ogg`,
        {
          type: 'audio/ogg',
        }
      );
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error('Recording is too long (over 16 MB).');
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        removeStaged(draftRef.current?.path);
        setDraft({
          kind: 'audio',
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [removeStaged]
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import('opus-recorder');
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000
      );
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error('Microphone access denied or unavailable.');
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (!recording || recordSeconds < MAX_RECORDING_SECONDS) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) stopRecording();
    })();
    return () => {
      cancelled = true;
    };
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(async () => {
    // The UI routes every activation through the same blocker popover, but
    // keep the send boundary fail-closed in case another internal path calls
    // this callback while permission or session readiness has changed.
    if (!draft || busy || sendBlocker) return;
    setBusy(true);
    try {
      await onSendMedia({
        kind: draft.kind,
        mediaUrl: draft.mediaUrl,
        path: draft.path,
        // Audio takes no caption (Meta rejects it). Everything else: the
        // trimmed caption, or undefined when blank.
        caption:
          draft.kind === 'audio'
            ? undefined
            : draft.caption.trim() || undefined,
        filename: draft.kind === 'document' ? draft.filename : undefined,
        replyToId: replyTo?.id,
      });
      // The object is now owned by the sent message — clear without GC.
      setDraft(null);
      onClearReply?.();
    } finally {
      setBusy(false);
    }
  }, [draft, busy, sendBlocker, onSendMedia, replyTo?.id, onClearReply]);

  // Discard GCs the staged object — it was uploaded but never sent.
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path);
    setDraft(null);
  }, [draft?.path, removeStaged]);

  const setCaption = useCallback((caption: string) => {
    setDraft((d) => (d ? { ...d, caption } : d));
  }, []);

  // ---- Render --------------------------------------------------------

  /**
   * The composer shell. WhatsApp's composer is not a bar bolted to the bottom
   * of the window — it is a rounded card floating on the chat canvas, and that
   * single difference is most of why its chat feels like a document you are
   * writing into rather than a form you are filling in.
   *
   * The corner is set by concentricity, not by taste: an `icon-lg` control is
   * 36px at a 10px corner, the shell pads it by 8px, so the shell's corner must
   * be 18px (`rounded-2xl`). That also makes the shell exactly 52px tall —
   * WhatsApp's own composer height — which is the sort of thing that stops
   * being a coincidence once the geometry is derived rather than eyeballed.
   * The lift is the system's Control Lift shadow.
   */
  const shellClasses =
    'bg-card rounded-2xl shadow-sm ring-1 ring-foreground/5 min-w-0 p-2';

  /**
   * Once the 24-hour window has closed, nothing the input row offers can
   * actually leave the account — free-form text, media, and a drafted reply
   * are all refused by Meta until a template reopens the session. So the row
   * is omitted rather than blocked (the surface rule: an action that no longer
   * applies is removed, not explained four times), and the amber bar becomes
   * the bottom bar, carrying the one move that still works.
   *
   * It stays mounted while an attachment is staged or the mic is live: a
   * session that closes mid-compose must not silently swallow an upload the
   * agent already made. Those two branches keep their own Send, which still
   * opens the closed-session blocker and its template resolution.
   */
  const composerOpen = !sessionExpired || draft !== null || recording;

  return (
    <div className="relative shrink-0 px-3 pt-1 pb-3 sm:px-6">
      {sessionExpired && (
        <div
          className={cn(
            'bg-card flex items-center justify-between gap-2 rounded-2xl p-2.5 shadow-sm ring-1 ring-amber-500/25',
            composerOpen && 'mb-2'
          )}
        >
          <p className="text-amber-foreground text-xs">
            The 24-hour WhatsApp® session has closed. Send an approved template
            to reopen it.
          </p>
          <ResolvableAction
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-foreground hover:text-amber-foreground shrink-0"
              >
                <LayoutTemplate className="size-3.5" />
                Templates
              </Button>
            }
            onAction={onOpenTemplates}
            blocker={permissionBlocker}
          />
        </div>
      )}

      {composerOpen && (
        <>
          {/* Hidden file inputs driven by the attach menu. */}
          <input
            ref={imageInputRef}
            type="file"
            accept={PICKER_ACCEPT.image}
            className="hidden"
            onChange={(e) => {
              handlePicked('image', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept={PICKER_ACCEPT.video}
            className="hidden"
            onChange={(e) => {
              handlePicked('video', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={documentInputRef}
            type="file"
            accept={PICKER_ACCEPT.document}
            className="hidden"
            onChange={(e) => {
              handlePicked('document', e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {draft ? (
            <MediaDraftPreview
              draft={draft}
              busy={busy}
              blocker={sendBlocker}
              blockerIdentity={sendBlockerIdentity}
              shellClasses={shellClasses}
              onCaptionChange={setCaption}
              onDiscard={discardDraft}
              onSend={sendDraft}
            />
          ) : recording ? (
            // Recording bar — takes over the shell while the mic is live.
            <div
              className={cn(
                shellClasses,
                'flex items-center gap-3 py-2 pr-1.5 pl-4'
              )}
            >
              <span className="flex size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
              <span className="text-foreground flex-1 text-sm tabular-nums">
                Recording… {formatDuration(recordSeconds)} /{' '}
                {formatDuration(MAX_RECORDING_SECONDS)}
              </span>
              <Button variant="ghost" size="sm" onClick={cancelRecording}>
                Cancel
              </Button>
              <Button
                size="icon-lg"
                onClick={stopRecording}
                aria-label="Stop and attach"
                title="Stop and attach"
              >
                <Square className="size-4" />
              </Button>
            </div>
          ) : (
            <div className={cn(shellClasses, 'flex flex-col gap-1.5')}>
              {replyTo && (
                // The quote lives INSIDE the shell, so replying grows the composer
                // upward as one object instead of stacking a second card above it.
                // It sits flush in the shell's own 8px padding, which is what keeps
                // its 10px corner concentric with the shell's 18px one.
                <ReplyQuote
                  authorLabel={replyTo.authorLabel}
                  preview={replyTo.preview}
                  onDismiss={onClearReply}
                />
              )}
              <div className="flex items-end gap-0.5">
                {/* Attach menu — photo / video / document / voice. */}
                <DropdownMenu
                  open={attachMenuOpen}
                  onOpenChange={(nextOpen, eventDetails) => {
                    if (!nextOpen) {
                      setAttachMenuOpen(false);
                    } else if (
                      !sendBlocker &&
                      eventDetails.event.type === 'keydown'
                    ) {
                      setAttachMenuOpen(true);
                    }
                  }}
                >
                  <ResolvableAction
                    trigger={
                      <DropdownMenuTrigger
                        nativeButton={false}
                        render={
                          <Button
                            nativeButton={false}
                            render={<div />}
                            variant="ghost"
                            size="icon-lg"
                            aria-label="Attach media"
                            title={sendBlocker ? undefined : 'Attach media'}
                          />
                        }
                      >
                        {busy ? (
                          <Loader2 className="size-5 animate-spin" />
                        ) : (
                          <Paperclip className="size-5" />
                        )}
                      </DropdownMenuTrigger>
                    }
                    onAction={() => setAttachMenuOpen(true)}
                    blocker={sendBlocker}
                    disabled={busy}
                  />
                  <DropdownMenuContent
                    align="start"
                    className="border-border bg-popover"
                  >
                    <DropdownMenuItem
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <ImageIcon className="mr-2 size-4" />
                      Photo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => videoInputRef.current?.click()}
                    >
                      <Video className="mr-2 size-4" />
                      Video
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => documentInputRef.current?.click()}
                    >
                      <FileText className="mr-2 size-4" />
                      Document
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void startRecording()}>
                      <Mic className="mr-2 size-4" />
                      Voice note
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    readOnly
                      ? 'Read-only — viewers can browse but not reply'
                      : sessionExpired
                        ? 'Send a template to reopen the session'
                        : 'Type a message'
                  }
                  aria-label="Message"
                  disabled={sessionExpired || readOnly}
                  rows={1}
                  // Textarea keeps its own inline title — the GatedButton
                  // wrapping pattern doesn't apply to non-button inputs.
                  // The placeholder text also surfaces the read-only state.
                  title={
                    readOnly
                      ? "Read-only — your role can't send messages"
                      : undefined
                  }
                  className={cn(
                    'text-foreground placeholder:text-muted-foreground min-w-0 flex-1 resize-none self-center overflow-y-hidden border-0 bg-transparent px-2 py-2 text-sm leading-5 outline-none',
                    (sessionExpired || readOnly) &&
                      'cursor-not-allowed opacity-60'
                  )}
                />

                <ResolvableAction
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      title={readOnly ? undefined : 'Send template'}
                      aria-label="Send template"
                    >
                      <LayoutTemplate className="size-5" />
                    </Button>
                  }
                  onAction={onOpenTemplates}
                  blocker={permissionBlocker}
                />

                <ResolvableAction
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      disabled={drafting}
                      loading={drafting}
                      title={readOnly ? undefined : 'Draft a reply with AI'}
                      aria-label="Draft a reply with AI"
                      className="hover:text-primary-text"
                    >
                      <Sparkles className="size-5" />
                    </Button>
                  }
                  onAction={() => void handleDraft()}
                  blocker={permissionBlocker}
                />

                <ResolvableAction
                  trigger={
                    <Button
                      size="icon-lg"
                      disabled={sendDisabled}
                      loading={sending}
                      aria-label="Send message"
                      className="disabled:opacity-40"
                    >
                      <Send className="size-4" />
                    </Button>
                  }
                  onAction={() => void handleSend()}
                  blocker={sendBlocker}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  draft,
  busy,
  blocker,
  blockerIdentity,
  shellClasses,
  onCaptionChange,
  onDiscard,
  onSend,
}: {
  draft: MediaDraft;
  busy: boolean;
  blocker: ActionBlocker | null;
  blockerIdentity: 'allowed' | 'permission' | 'session';
  /** The composer shell recipe, so a staged attachment sits in exactly the
   *  same floating card the message field does. */
  shellClasses: string;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void | Promise<void>;
}) {
  const sendTriggerRef = useRef<HTMLButtonElement>(null);
  const blockerOpenRef = useRef(false);
  const previousBlockerIdentityRef = useRef(blockerIdentity);

  useLayoutEffect(() => {
    if (previousBlockerIdentityRef.current === blockerIdentity) return;

    const restoreTriggerFocus = blockerOpenRef.current;
    previousBlockerIdentityRef.current = blockerIdentity;
    blockerOpenRef.current = false;
    if (restoreTriggerFocus) sendTriggerRef.current?.focus();
  }, [blockerIdentity]);

  function attemptSend() {
    if (busy || blocker) return;
    void onSend();
  }

  function trackBlockerOpen(
    open: boolean,
    eventDetails?: ResolvableActionOpenChangeDetails
  ) {
    const restoreTriggerFocus =
      blockerOpenRef.current && !open && eventDetails?.reason === 'escape-key';
    blockerOpenRef.current = open;
    if (restoreTriggerFocus) sendTriggerRef.current?.focus();
  }

  return (
    <div className={cn(shellClasses, 'flex flex-col gap-2')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === 'video' && (
            <video
              src={draft.mediaUrl}
              controls
              className="max-h-40 rounded-lg"
            />
          )}
          {draft.kind === 'audio' && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === 'document' && (
            <div className="text-foreground flex items-center gap-2 text-sm">
              <FileText className="text-muted-foreground size-5 shrink-0" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDiscard}
          aria-label="Remove attachment"
          title="Remove attachment"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex items-end gap-0.5">
        {draft.kind !== 'audio' && (
          <input
            value={draft.caption}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTriggerRef.current?.click();
              }
            }}
            placeholder="Add a caption"
            className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-sm outline-none"
          />
        )}
        <ResolvableAction
          // Popover intent belongs to one blocker identity. Remount only this
          // action when readiness changes; the staged draft and caption input
          // stay mounted while stale overlay state is discarded.
          key={blockerIdentity}
          trigger={
            <Button
              ref={sendTriggerRef}
              size="icon-lg"
              disabled={busy}
              loading={busy}
              aria-label="Send attachment"
              className={cn(
                'disabled:opacity-40',
                draft.kind === 'audio' && 'ml-auto'
              )}
            >
              <Send className="size-4" />
            </Button>
          }
          onAction={attemptSend}
          blocker={blocker}
          onOpenChange={trackBlockerOpen}
        />
      </div>
    </div>
  );
}
