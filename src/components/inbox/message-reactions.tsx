'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { MessageReaction } from '@/types';

interface MessageReactionsProps {
  reactions: MessageReaction[];
  currentUserId: string | undefined;
  /** Toggle the agent's reaction. If the agent already has this emoji →
   *  caller should send empty to remove; otherwise swap/add. */
  onToggle: (emoji: string) => void;
}

interface ReactionGroup {
  emoji: string;
  count: number;
  byCurrentUser: boolean;
}

function groupReactions(
  reactions: MessageReaction[],
  currentUserId: string | undefined
): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const existing = map.get(r.emoji);
    const isMine =
      r.actor_type === 'agent' &&
      !!currentUserId &&
      r.actor_id === currentUserId;
    if (existing) {
      existing.count += 1;
      existing.byCurrentUser = existing.byCurrentUser || isMine;
    } else {
      map.set(r.emoji, { emoji: r.emoji, count: 1, byCurrentUser: isMine });
    }
  }
  return [...map.values()];
}

export function MessageReactions({
  reactions,
  currentUserId,
  onToggle,
}: MessageReactionsProps) {
  const groups = useMemo(
    () => groupReactions(reactions, currentUserId),
    [reactions, currentUserId]
  );

  if (groups.length === 0) return null;

  return (
    // Reaction pills overlap the bubble they belong to rather than sitting in
    // a row beneath it — the overlap is what makes them read as attached to
    // that message instead of as a new message. The canvas-coloured ring cuts
    // them out of the bubble fill so the seam stays crisp on either surface.
    <div className="relative z-10 -mt-2.5 mr-2 ml-2 flex flex-wrap gap-1">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => onToggle(g.emoji)}
          aria-pressed={g.byCurrentUser}
          className={cn(
            'inline-flex h-[22px] items-center gap-1 rounded-full border-2 px-1.5 text-[11px] leading-none shadow-[var(--chat-bubble-shadow)] transition-colors',
            // The fill MUST be opaque, and it is the neutral bubble surface for
            // everyone. This pill straddles the bubble's bottom edge, so a
            // translucent fill (it shipped briefly on `--primary-soft`, a
            // 12%-alpha accent) lets the bubble read through its top half and
            // the canvas through its bottom — the wash the emoji sat in.
            'bg-chat-bubble-in text-chat-meta',
            // Cut-out ring against the canvas at rest; on hover the edge
            // strengthens and the fill holds still, per the Edge-Strengthening
            // Rule — a hover that moved the fill would reintroduce exactly the
            // translucency this pill just got rid of.
            'border-chat-canvas hover:border-border-hover'
          )}
        >
          <span className="text-sm leading-none">{g.emoji}</span>
          {g.count > 1 && <span className="tabular-nums">{g.count}</span>}
        </button>
      ))}
    </div>
  );
}
