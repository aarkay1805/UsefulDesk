'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { cn } from '@/lib/utils';
import type { Conversation, ConversationStatus, Tag } from '@/types';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { SearchInput } from '@/components/ui/search-input';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import { Separator } from '@/components/ui/separator';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Clicking a row's avatar: select that conversation AND reveal the
   * contact panel (which is closed by default). On the row that is
   * already active the page treats it as a toggle, so the gesture that
   * opened the panel also closes it.
   */
  onOpenProfile: (conversation: Conversation) => void;
  /**
   * Whether the contact panel is currently open. Read only to label the
   * ACTIVE row's avatar honestly — on that row the button is a disclosure
   * toggle, not a one-way "open".
   */
  contactPanelOpen?: boolean;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: 'bg-primary',
  pending: 'bg-amber-500',
  closed: 'bg-muted-foreground',
};

type InboxFilter = ConversationStatus | 'all' | 'unread' | 'member' | 'lead';

const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
  { label: 'Members', value: 'member' },
  { label: 'Leads', value: 'lead' },
  { label: 'Open', value: 'open' },
  { label: 'Pending', value: 'pending' },
  { label: 'Closed', value: 'closed' },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onOpenProfile,
  contactPanelOpen = false,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [loading, setLoading] = useState(true);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .order('last_message_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error('Failed to fetch conversations:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === 'unread') {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === 'member') {
      result = result.filter((c) => c.isMember);
    } else if (filter === 'lead') {
      result = result.filter((c) => !c.isMember);
    } else if (filter !== 'all') {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? '';
        const phone = c.contact?.phone?.toLowerCase() ?? '';
        const lastMsg = c.last_message_text?.toLowerCase() ?? '';
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search, selectedTagIds, selectedCompany]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setFilter('all');
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters =
    selectedTagIds.length > 0 || selectedCompany !== null;

  // Live count on the Unread chip. It counts the whole account, not the
  // current filter's slice — the number's job is to say how much is waiting
  // in total, which is the only reason to reach for that chip.
  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread_count > 0).length,
    [conversations]
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  return (
    // w-full on mobile so the list occupies the whole viewport when it's the
    // single pane showing; a fixed column on desktop where it shares the row
    // with the thread and (on demand) the contact panel. 352px is wide enough
    // for WhatsApp's 48px avatar plus a preview line that doesn't clip after
    // four words — the old 320px column truncated almost every preview.
    <div className="border-border bg-card flex h-full w-full min-w-0 flex-col overflow-hidden border-r lg:w-[22rem]">
      {/* Search + filters. Two rows, like WhatsApp's: the field owns the
          first, the queue chips own the second. */}
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <SearchInput
          value={search}
          onValueChange={handleSearchChange}
          placeholder="Search or start a new chat"
          aria-label="Search conversations"
          containerClassName="w-full"
        />

        <div className="flex min-w-0 items-center gap-1.5">
          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="pill"
                    size="sm"
                    aria-pressed={selectedTagIds.length > 0}
                  />
                }
              >
                Tags
                {selectedTagIds.length > 0 && (
                  <Badge size="count">{selectedTagIds.length}</Badge>
                )}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-border bg-popover max-h-64 w-56"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-popover-foreground text-sm"
                  >
                    <span className="truncate">{t.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="pill"
                    size="sm"
                    aria-pressed={Boolean(selectedCompany)}
                  />
                }
              >
                <span className="max-w-24 truncate">
                  {selectedCompany ?? 'Company'}
                </span>
                <ChevronDown className="size-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-border bg-popover max-h-64 w-56"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    'text-sm',
                    selectedCompany === null
                      ? 'text-primary-text'
                      : 'text-popover-foreground'
                  )}
                >
                  All companies
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      'text-sm',
                      selectedCompany === co
                        ? 'text-primary-text'
                        : 'text-popover-foreground'
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {(tags.length > 0 || companies.length > 0) && (
            <Separator orientation="vertical" className="h-5" />
          )}

          {/* The queue filters were a single dropdown that hid six of its
              seven options behind a click. WhatsApp puts them on the surface
              as a browsable chip strip, which is also what this product's own
              list toolbars do everywhere else. */}
          <ChipGroup<InboxFilter>
            selectionMode="single"
            value={[filter]}
            onValueChange={(values) => values[0] && setFilter(values[0])}
            aria-label="Conversation filters"
          >
            {FILTER_OPTIONS.map((opt) => (
              <Chip key={opt.value} value={opt.value} size="sm">
                {opt.label}
                {opt.value === 'unread' && unreadCount > 0 && (
                  <ChipCount count={unreadCount} />
                )}
              </Chip>
            ))}
          </ChipGroup>
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                >
                  <span className="max-w-24 truncate">
                    {tag?.name ?? 'Tag'}
                  </span>
                  <X className="size-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="size-3" />
              </button>
            )}
            <Button variant="link" size="xs" onClick={clearContactFilters}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Conversation rows.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea
        scrollbarVisibility="hover"
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-primary-text size-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <p className="text-foreground text-sm font-medium">
              {conversations.length === 0
                ? 'No conversations yet'
                : 'No conversations match'}
            </p>
            <p className="text-muted-foreground mt-1 max-w-56 text-xs">
              {conversations.length === 0
                ? 'New WhatsApp® conversations will appear here.'
                : 'Try a different search or clear the active filters.'}
            </p>
            {conversations.length > 0 && (
              <Button
                variant="link"
                size="sm"
                className="mt-2"
                onClick={clearAllFilters}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col px-2 pb-2">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                onOpenProfile={onOpenProfile}
                contactPanelOpen={contactPanelOpen}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  /** Avatar click — select this conversation AND reveal the contact panel. */
  onOpenProfile: (conversation: Conversation) => void;
  /** Panel state, used only to label the active row's avatar. */
  contactPanelOpen: boolean;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onOpenProfile,
  contactPanelOpen,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || 'Unknown';
  const unread = conversation.unread_count > 0;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const handleAvatarClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't let the row's own handler also fire — it would select the
      // conversation without opening the panel, and onOpenProfile already
      // selects it.
      e.stopPropagation();
      onOpenProfile(conversation);
    },
    [onOpenProfile, conversation]
  );

  // On the active row the avatar is a disclosure toggle (the page flips the
  // panel); on any other row it only ever opens. Label and `aria-expanded`
  // follow that, so AT never announces "collapse" for a button that expands.
  const profileOpen = isActive && contactPanelOpen;

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : '';

  return (
    // A plain clickable div, NOT a <button> and NOT role="button": the row
    // now contains real buttons (avatar, name), and ARIA forbids focusable
    // descendants inside a button — nesting them also pollutes the row's
    // accessible name with the avatar's label. Exactly the leads board
    // card's shape: the div's onClick is the pointer convenience, the NAME
    // is the real button that carries the keyboard/AT path. A non-button
    // clickable needs cursor-pointer spelled out, per the base cursor rule.
    //
    // The row is a floating rounded block inside the column's own padding,
    // not a full-bleed strip with a divider under it — WhatsApp's shape, and
    // the reason a long list reads as a stack of people rather than a table.
    <div
      onClick={handleClick}
      className={cn(
        'flex h-[72px] w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2.5 text-left transition-colors',
        isActive ? 'bg-primary-soft' : 'hover:bg-foreground/5'
      )}
    >
      {/* Avatar — opens the contact profile instead of the conversation. */}
      <button
        type="button"
        onClick={handleAvatarClick}
        aria-expanded={profileOpen}
        aria-label={
          profileOpen
            ? `Close ${displayName}'s profile`
            : `Open ${displayName}'s profile`
        }
        title={profileOpen ? 'Close profile' : 'Open profile'}
        className="focus-visible:ring-ring/50 shrink-0 rounded-full transition-opacity outline-none hover:opacity-80 focus-visible:ring-[3px]"
      >
        <UserAvatar
          name={displayName}
          src={contact?.avatar_url}
          className="size-12"
          fallbackClassName="text-base"
        />
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              className="text-foreground focus-visible:ring-ring/50 min-w-0 truncate rounded-sm text-left text-base font-medium outline-none focus-visible:ring-[3px]"
            >
              {displayName}
            </button>
            {/* Member is the state worth marking. A lead is the unmarked
                default — pinning a pill to every single row is the noise
                WhatsApp doesn't have, and the Members / Leads chips above
                already turn the distinction into a filter. */}
            {conversation.isMember && (
              <Badge variant="success" className="shrink-0">
                Member
              </Badge>
            )}
          </div>
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              // An unread row lights its timestamp, exactly as WhatsApp does —
              // a second, quieter signal that the badge is not the only thing
              // asking for attention.
              unread ? 'text-primary-text font-medium' : 'text-muted-foreground'
            )}
          >
            {timeAgo}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p
            className={cn(
              'truncate text-sm',
              unread ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {conversation.last_message_text || 'No messages yet'}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {unread && (
              <Badge
                size="count"
                aria-label={`${conversation.unread_count} unread messages`}
              >
                {conversation.unread_count}
              </Badge>
            )}
            <span
              className={cn(
                'size-2 rounded-full',
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
