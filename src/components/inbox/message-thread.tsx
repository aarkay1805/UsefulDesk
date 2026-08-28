'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import type { LocaleFormatters } from '@/lib/locale/format';
import { usePresence } from '@/hooks/use-presence';
import { PresenceDot } from '@/components/presence/presence-dot';
import { presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from '@/types';
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  MoreVertical,
  Loader2,
} from 'lucide-react';
import { format, isToday, isYesterday, differenceInHours } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MessageBubble } from './message-bubble';
import { MessageActions } from './message-actions';
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from './message-composer';
import { deleteAccountMedia } from '@/lib/storage/upload-media';
import { TemplatePicker } from './template-picker';
import { buildReplyPreview } from './reply-quote';
import {
  renderTemplateMessageText,
  resolveTemplateHeaderMedia,
} from '@/lib/whatsapp/template-render';
import { toast } from 'sonner';

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Contact-panel toggle. The page owns the open/closed state (it's the
   * one that renders the sidebar / mobile Sheet), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the ⋮ item only renders when
   * `onToggleContactPanel` is wired up.
   *
   * The header's avatar/identity block fires the SAME toggle. It used to
   * have a reveal-only handler of its own, which made the most obvious
   * affordance on the surface a one-way door: clicking the avatar again
   * did nothing, and dismissing meant finding "Hide contact panel" in the
   * ⋮ menu. One handler, one mental model.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
}

// Older separators format through the account locale (fmt passed in —
// module fn, no hook access); Today/Yesterday stay relative labels.
function formatDateSeparator(dateStr: string, fmt: LocaleFormatters): string {
  const date = new Date(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return fmt.date(date);
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = '';

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), 'yyyy-MM-dd');
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: {
  label: string;
  value: ConversationStatus;
  color: string;
}[] = [
  { label: 'Open', value: 'open', color: 'text-primary-text' },
  { label: 'Pending', value: 'pending', color: 'text-amber-foreground' },
  { label: 'Closed', value: 'closed', color: 'text-muted-foreground' },
];

/**
 * The status dot inside the header's pill trigger. Same three fills the
 * conversation row uses, so a row and its open thread never disagree about
 * what colour "pending" is.
 */
const STATUS_DOT_COLORS: Record<ConversationStatus, string> = {
  open: 'bg-primary',
  pending: 'bg-amber-500',
  closed: 'bg-muted-foreground',
};

/**
 * The chat plane. `bg-chat-canvas` is a recessed surface that is neither the
 * page background nor a card, so the conversation reads as sitting *under* the
 * list column — the tonal relationship WhatsApp uses on both light and dark.
 * `chat-surface` scopes the accent text-selection colour to this pane.
 *
 * The doodle wallpaper rides its own absolutely-positioned layer (see
 * `ChatWallpaper`) rather than a background-image here, because the tile needs
 * a different alpha per mode.
 *
 * Defined once at module scope so the empty state and the live thread can't
 * drift apart under the user's eye when they select a conversation.
 */
const CHAT_CANVAS_CLASSES = 'bg-chat-canvas chat-surface relative';

/** The repeating doodle tile, behind everything and inert to the pointer. */
function ChatWallpaper() {
  return (
    <div
      aria-hidden
      className="chat-doodle pointer-events-none absolute inset-0"
    />
  );
}

/**
 * How long two messages from the same sender can be apart and still read as
 * one turn. Inside a run bubbles stack 2px apart with a single tail on the
 * first; across runs they separate by 12px and the next one grows its own
 * tail. Those two numbers are the whole rhythm of a WhatsApp thread — a
 * uniform gap between every bubble is what makes a naive chat UI feel like a
 * list of records instead of a conversation.
 */
const RUN_BREAK_MINUTES = 5;

/**
 * How far off the bottom still counts as "reading the latest". Inside this
 * band an incoming message may move the viewport; outside it the reader has
 * deliberately scrolled back through history and the thread must hold still.
 * Roughly two bubbles' worth, so a half-scrolled last message still pins.
 */
const STICK_TO_BOTTOM_PX = 120;

function startsNewRun(
  message: Message,
  previous: Message | undefined
): boolean {
  if (!previous) return true;
  const outbound = (m: Message) =>
    m.sender_type === 'agent' || m.sender_type === 'bot';
  if (outbound(message) !== outbound(previous)) return true;
  const gapMs =
    new Date(message.created_at).getTime() -
    new Date(previous.created_at).getTime();
  return gapMs > RUN_BREAK_MINUTES * 60_000;
}

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
}: MessageThreadProps) {
  const { user } = useAuth();
  const { fmt } = useLocale();
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * True while the reader is parked at the newest message — the only state
   * in which an arriving message is allowed to move the viewport. Written
   * from the scroll handler and from the thread-change effect, never during
   * render.
   */
  const stickToBottomRef = useRef(true);
  /** Drives the jump-to-latest button. Mirrors `!stickToBottomRef.current`. */
  const [scrolledUp, setScrolledUp] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Failed to fetch profiles:', error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: '' };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === 'customer');

    if (!lastCustomerMsg)
      return { expired: true, remaining: 'No customer messages' };

    const hoursSince = differenceInHours(
      new Date(),
      new Date(lastCustomerMsg.created_at)
    );
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: 'Expired' };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h remaining`
        : `${Math.floor(hoursLeft * 60)}m remaining`;

    return { expired, remaining };
  }, [messages]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Clear the jump-to-latest affordance when the thread changes. Adjusted
  // during render through a synced-prop guard rather than in an effect —
  // `react-hooks/set-state-in-effect` is enforced, and the scroll event
  // that would otherwise correct it never fires for a thread short enough
  // to have no scrollbar, which would strand the button on an empty thread.
  const [syncedConversationId, setSyncedConversationId] =
    useState(conversationId);
  if (syncedConversationId !== conversationId) {
    setSyncedConversationId(conversationId);
    setScrolledUp(false);
  }

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('Failed to fetch messages:', error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!conversationId) {
        setReactions([]);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase
        .from('message_reactions')
        .select('*')
        .eq('conversation_id', conversationId);
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch reactions:', error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith('temp-') &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) setReplyTo(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)
      .then(({ error }) => {
        if (error) console.error('Failed to reset unread_count:', error);
      });
  }, [conversationId, hasUnread]);

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setScrolledUp(false);
    // Instant, not smooth: a smooth scroll emits intermediate scroll events
    // that read as "not at the bottom", which flips the flag and flashes
    // this very button back on mid-animation. The thread's other pins are
    // instant too, so this also stays consistent with them.
    el.scrollTop = el.scrollHeight;
  }, []);

  // Track whether the reader is at the bottom. Runs on the scroll event
  // (never in an effect), so setting state here is allowed.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    setScrolledUp((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  // Opening a different thread always lands on its newest message — a
  // scroll position carried over from the previous conversation must not
  // suppress the pin. Declared BEFORE the message effect below so it
  // resets the flag first when both fire in the same commit.
  useEffect(() => {
    stickToBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId]);

  /**
   * Keep a bottom-parked reader parked when the PANE reflows. Toggling the
   * contact panel narrows or widens the thread by 360px, which re-wraps
   * every bubble and grows `scrollHeight` while `scrollTop` stays put — on
   * a real thread that left the reader ~570px above the newest message,
   * silently, just for opening a profile. Before the guard below the next
   * message hid the damage by re-pinning; now nothing would.
   */
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [contactPanelOpen]);

  /**
   * Follow the conversation — but only while the reader is already at the
   * bottom. This used to pin unconditionally on every `messages` identity
   * change, which meant scrolling back through history was undone by the
   * next inbound message *and* by every delivery receipt (a `sent →
   * delivered → read` tick rewrites the array), so reading a thread from
   * the top was effectively impossible on a busy account.
   */
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'text',
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error('Failed to send message:', reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send message:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === 'document'
          ? payload.caption || payload.filename || 'Document'
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error('Failed to send media:', reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: 'failed' });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(
            () => {}
          );
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send media:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(
          () => {}
        );
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      await supabase
        .from('conversations')
        .update({ status })
        .eq('id', conversation.id);

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      }
    ) => {
      if (!conversation) return;

      // Same renderer the send core uses, so the optimistic bubble and
      // the persisted row read identically — header line, blank line,
      // body — instead of drifting the moment either side changes.
      const paramSource = {
        messageParams: { body: values.body, headerText: values.headerText },
      };
      const renderedText = renderTemplateMessageText(template, paramSource);
      const headerMedia = resolveTemplateHeaderMedia(template, paramSource);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: 'template',
        content_text: renderedText ?? undefined,
        media_url: headerMedia?.url,
        template_name: template.name,
        status: 'sending',
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'template',
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedText,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error('Failed to send template:', reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send template:', err);
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || 'Customer';

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg = m.sender_type === 'agent' || m.sender_type === 'bot';
      return isAgentMsg ? 'You' : contactDisplayName;
    },
    [contactDisplayName]
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor]
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn('[reactions] missing user or conversation');
        return;
      }
      if (messageId.startsWith('temp-')) {
        toast.error('Wait for the message to finish sending');
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === 'agent' &&
            r.actor_id === userId
        );
        if (emoji === '') return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: 'agent',
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch('/api/whatsapp/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'network error';
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user]
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('id', conversation.id);

      if (error) {
        console.error('Failed to update assignment:', error);
        toast.error('Failed to update assignment');
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange]
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  // Empty state — the same canvas and wallpaper as the live thread, so
  // selecting a conversation changes what's on the plane, never the plane.
  if (!conversation || !contact) {
    return (
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center px-6 text-center',
          CHAT_CANVAS_CLASSES
        )}
      >
        <ChatWallpaper />
        <div className="bg-chat-bubble-in text-chat-meta relative flex size-16 items-center justify-center rounded-full shadow-[var(--chat-bubble-shadow)]">
          <MessageSquare className="size-7" />
        </div>
        <h3 className="text-foreground relative mt-5 text-base font-medium">
          Select a conversation
        </h3>
        <p className="text-chat-meta relative mt-1 max-w-sm text-sm">
          Pick a member or lead on the left to read the thread and reply on
          WhatsApp.
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? 'Assigned')
    : 'Assign';

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn('flex min-w-0 flex-1 flex-col', CHAT_CANVAS_CLASSES)}>
      <ChatWallpaper />

      {/* Header — a 64px card bar over the canvas, matching WhatsApp's:
          avatar, name, one supporting line, then actions. Everything that
          isn't Status or Assign lives behind the ⋮ menu so the bar stays as
          quiet as the one every user already knows. */}
      <div className="border-border bg-card relative flex h-16 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Back-to-list — mobile only; on lg+ the list is always beside us. */}
          {onBack && (
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onBack}
              aria-label="Back to conversations"
              className="lg:hidden"
            >
              <ArrowLeft className="size-5" />
            </Button>
          )}
          {/* Avatar + identity are one target, the way WhatsApp opens contact
              info: the whole block toggles the profile panel rather than only
              a small circle. `aria-expanded` is what makes it read as a
              disclosure to AT — and it is the honest description, because a
              second click closes the panel again. */}
          <button
            type="button"
            onClick={onToggleContactPanel}
            aria-expanded={contactPanelOpen ?? false}
            aria-label={
              contactPanelOpen
                ? `Close ${displayName}'s profile`
                : `Open ${displayName}'s profile`
            }
            title={contactPanelOpen ? 'Close profile' : 'Open profile'}
            className="hover:bg-foreground/5 focus-visible:ring-ring/50 -mx-1.5 flex min-w-0 items-center gap-3 rounded-lg px-1.5 py-1 text-left transition-colors outline-none focus-visible:ring-[3px]"
          >
            <UserAvatar
              name={displayName}
              src={contact.avatar_url}
              size="lg"
              className="shrink-0"
            />
            <div className="min-w-0">
              <div className="text-foreground truncate text-base font-medium">
                {displayName}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {contact.phone}
              </div>
            </div>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Status — daily CRM work, so it stays on the bar rather than in
              the overflow. Pill trigger: the canonical menu-opening
              counterpart to a Chip. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" />}
              aria-label={`Conversation status. ${currentStatus?.label ?? 'Status'}`}
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  STATUS_DOT_COLORS[conversation.status]
                )}
              />
              <span className="hidden sm:inline">
                {currentStatus?.label ?? 'Status'}
              </span>
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn('text-sm', opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" />}
              aria-label={`Assign conversation. ${assignLabel}`}
              title={assignLabel}
            >
              <UserPlus className="size-3" />
              <span className="hidden max-w-24 truncate sm:inline">
                {assignLabel}
              </span>
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground text-sm"
                >
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        'text-sm',
                        isSelected
                          ? 'text-primary-text'
                          : 'text-popover-foreground'
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
                        )}
                        className="mr-2"
                      />
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? ' (me)' : ''}
                      </span>
                      {isSelected && <Check className="ml-2 size-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-muted-foreground text-sm"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Overflow — the session window, a manual resync, and the contact
              panel toggle. All three are occasional; none of them earns a
              permanent slot next to the member's name. The 24-hour session
              still announces itself where it actually bites, in the composer,
              so demoting the countdown here hides a number, not a state. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-lg" />}
              aria-label="More conversation actions"
              title="More"
            >
              <MoreVertical className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover w-56"
            >
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-muted-foreground text-xs">
                  WhatsApp® session
                </span>
                <Badge variant={sessionInfo.expired ? 'danger' : 'success'}>
                  <Clock />
                  {sessionInfo.remaining}
                </Badge>
              </div>
              <DropdownMenuSeparator className="bg-border" />
              {onToggleContactPanel && (
                <DropdownMenuItem
                  onClick={onToggleContactPanel}
                  className="hidden text-sm lg:flex"
                >
                  {contactPanelOpen ? (
                    <PanelRightClose className="mr-2 size-4" />
                  ) : (
                    <PanelRightOpen className="mr-2 size-4" />
                  )}
                  {contactPanelOpen
                    ? 'Hide contact panel'
                    : 'Show contact panel'}
                </DropdownMenuItem>
              )}
              {onRefresh && (
                <DropdownMenuItem
                  onClick={handleRefreshClick}
                  disabled={isRefreshing}
                  className="text-sm"
                >
                  <RefreshCw
                    className={cn(
                      'mr-2 size-4',
                      isRefreshing && 'animate-spin'
                    )}
                  />
                  {isRefreshing ? 'Refreshing…' : 'Refresh conversation'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages. The generous side gutters are WhatsApp's — bubbles capped
          at 65% of the pane never reach the pane edge, which is what keeps a
          wide desktop thread readable instead of stretched.

          The wrapper exists so the jump-to-latest button can anchor to the
          BOTTOM OF THE PANE. Absolutely positioning it inside the scroller
          would make it scroll away with the content. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="chat-scroll relative flex-1 overflow-x-hidden overflow-y-auto px-4 py-3 sm:px-8 lg:px-12"
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="text-primary-text size-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
              <p className="text-foreground text-sm font-medium">
                No messages yet
              </p>
              <p className="text-chat-meta text-xs">
                Send a template to start the conversation.
              </p>
            </div>
          ) : (
            <div>
              {messageGroups.map((group) => (
                <div key={group.date}>
                  {/* Date separator — sticky, like WhatsApp's, so the day you
                    are reading stays named while you scroll back through it. */}
                  <div className="sticky top-0 z-10 flex justify-center py-2">
                    <span className="bg-chat-bubble-in text-chat-meta rounded-md px-3 py-1 text-[11px] font-medium shadow-[var(--chat-bubble-shadow)]">
                      {formatDateSeparator(group.date, fmt)}
                    </span>
                  </div>
                  {group.messages.map((msg, index) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    const opensRun = startsNewRun(
                      msg,
                      group.messages[index - 1]
                    );
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === 'agent' && r.actor_id === user?.id
                      );
                      const next = own?.emoji === emoji ? '' : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <div
                        key={msg.id}
                        className={cn(opensRun ? 'mt-3' : 'mt-0.5')}
                      >
                        <MessageActions
                          message={msg}
                          onReply={
                            sessionInfo.expired
                              ? undefined
                              : () => handleStartReply(msg)
                          }
                          onReact={(emoji) => {
                            if (emoji) void postReaction(msg.id, emoji);
                          }}
                        >
                          <MessageBubble
                            message={msg}
                            reply={reply}
                            reactions={msgReactions}
                            currentUserId={user?.id}
                            onToggleReaction={handlePillToggle}
                            startsRun={opensRun}
                          />
                        </MessageActions>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Jump to latest. The thread no longer yanks a reader who has
            scrolled back into history down to the newest message, so it owes
            them a one-click way down — and a visible marker that there IS
            something below. The unmodified Button master at a named icon
            size, per the surface's "our components stay our components"
            rule — no circle, no call-site geometry. */}
        {scrolledUp && messages.length > 0 && (
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={scrollToLatest}
            aria-label="Jump to latest message"
            title="Jump to latest"
            className="ring-border absolute right-4 bottom-3 z-20 shadow-md ring-1 sm:right-8 lg:right-12"
          >
            <ChevronDown className="size-5" />
          </Button>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
        contact={contact}
      />
    </div>
  );
}
