import { View } from 'react-native';

import { IconButton } from '../../../ui/icon-button';
import { Text } from '../../../ui/text';

export type ReplyQuoteContent =
  | { authorLabel: string; preview: string; unavailable?: never }
  | { unavailable: true; authorLabel?: never; preview?: never };

interface ReplyQuoteProps {
  authorLabel?: string;
  isOutbound?: boolean;
  onDismiss?(): void;
  preview?: string;
  unavailable?: boolean;
}

export function ReplyQuote({
  authorLabel,
  isOutbound = false,
  onDismiss,
  preview,
  unavailable = false,
}: ReplyQuoteProps) {
  const metaTone = isOutbound ? 'text-chat-meta-out' : 'text-chat-meta';

  return (
    <View
      className="bg-chat-canvas border-l-primary min-w-0 flex-row items-center gap-2 rounded-md border-l-4 px-2 py-1.5"
      testID="reply-quote"
    >
      <View className="min-w-0 flex-1 gap-0.5">
        {unavailable ? (
          <Text className={`${metaTone} text-sm`}>
            Original message unavailable
          </Text>
        ) : (
          <>
            <Text
              className={`${metaTone} text-xs font-semibold`}
              numberOfLines={1}
            >
              {authorLabel}
            </Text>
            <Text className="text-foreground text-sm" numberOfLines={2}>
              {preview}
            </Text>
          </>
        )}
      </View>
      {onDismiss ? (
        <IconButton
          accessibilityLabel="Dismiss reply"
          onPress={onDismiss}
          symbol="xmark"
          variant="ghost"
        />
      ) : null}
    </View>
  );
}
