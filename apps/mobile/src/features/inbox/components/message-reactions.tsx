import { Pressable, Text, View } from 'react-native';

import type { InboxMessageReaction } from '../inbox-types';

interface MessageReactionsProps {
  reactions: InboxMessageReaction[];
  currentUserId: string;
  onToggle?(emoji: string): void;
  pending?: boolean;
}

interface ReactionGroup {
  emoji: string;
  count: number;
  byCurrentUser: boolean;
}

function groupReactions(
  reactions: InboxMessageReaction[],
  currentUserId: string
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    const own =
      reaction.actorType === 'agent' && reaction.actorId === currentUserId;
    const current = groups.get(reaction.emoji);
    if (current) {
      current.count += 1;
      current.byCurrentUser = current.byCurrentUser || own;
    } else {
      groups.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        byCurrentUser: own,
      });
    }
  }
  return [...groups.values()];
}

export function MessageReactions({
  reactions,
  currentUserId,
  onToggle,
  pending = false,
}: MessageReactionsProps) {
  const groups = groupReactions(reactions, currentUserId);
  if (groups.length === 0) return null;

  return (
    <View className="relative z-10 mx-2 -mt-2.5 flex-row flex-wrap gap-1">
      {groups.map((group) => {
        const label = `${group.emoji} reaction, ${group.count}${
          group.byCurrentUser ? ', reacted by you' : ''
        }${pending && onToggle ? ', updating' : ''}`;
        const className =
          'border-chat-canvas bg-chat-bubble-in h-[22px] flex-row items-center gap-1 rounded-full border-2 px-1.5';
        const content = (
          <>
            <Text className="text-sm" style={{ lineHeight: undefined }}>
              {group.emoji}
            </Text>
            {group.count > 1 ? (
              <Text
                className="text-chat-meta text-xs tabular-nums"
                style={{ lineHeight: undefined }}
              >
                {group.count}
              </Text>
            ) : null}
          </>
        );

        return onToggle ? (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{
              busy: pending,
              disabled: pending,
              selected: group.byCurrentUser,
            }}
            className={className}
            disabled={pending}
            key={group.emoji}
            onPress={() => onToggle(group.emoji)}
          >
            {content}
          </Pressable>
        ) : (
          <View
            accessible
            accessibilityLabel={label}
            className={className}
            key={group.emoji}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
}
