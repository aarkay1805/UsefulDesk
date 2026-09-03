import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '../../../ui/button';
import { ScreenSafeAreaView } from '../../../ui/screen-safe-area-view';

export const QUICK_REACTION_EMOJIS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🙏',
] as const;

interface MessageActionSheetProps {
  preview: string;
  onClose(): void;
  onReact(emoji: string): void;
  onReply?(): void;
}

export function MessageActionSheet({
  preview,
  onClose,
  onReact,
  onReply,
}: MessageActionSheetProps) {
  const react = (emoji: string) => {
    onReact(emoji);
    onClose();
  };
  const reply = () => {
    onReply?.();
    onClose();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityLabel="Dismiss message actions"
          accessibilityRole="button"
          className="absolute inset-0 bg-black/45"
          onPress={onClose}
        />
        <ScreenSafeAreaView
          className="bg-surface rounded-t-2xl px-4 pt-4"
          edges={['bottom']}
          style={{ flex: 0 }}
          testID="message-action-sheet-surface"
        >
          <View accessibilityViewIsModal className="gap-4 pb-4">
            <View className="gap-1">
              <Text
                className="text-foreground text-base font-semibold"
                style={{ lineHeight: undefined }}
              >
                Message actions
              </Text>
              <Text
                className="text-muted text-sm"
                numberOfLines={2}
                style={{ lineHeight: undefined }}
              >
                {preview}
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              {QUICK_REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  accessibilityLabel={`React with ${emoji}`}
                  accessibilityRole="button"
                  className="h-12 w-12 items-center justify-center rounded-full"
                  key={emoji}
                  onPress={() => react(emoji)}
                >
                  <Text className="text-2xl" style={{ lineHeight: undefined }}>
                    {emoji}
                  </Text>
                </Pressable>
              ))}
            </View>

            {onReply ? (
              <Button
                accessibilityLabel="Reply to message"
                onPress={reply}
                size="sm"
                variant="ghost"
              >
                Reply
              </Button>
            ) : null}
          </View>
        </ScreenSafeAreaView>
      </View>
    </Modal>
  );
}
