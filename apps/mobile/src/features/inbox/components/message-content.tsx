import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { Linking, Pressable, View } from 'react-native';
import { useState } from 'react';

import { messagePreview, safeMediaUrl } from '../inbox-format';
import type { ContentType, InboxMessage } from '../inbox-types';
import { Text } from '../../../ui/text';

const MEDIA_LABEL: Record<
  Extract<ContentType, 'video' | 'audio' | 'document' | 'location'>,
  string
> = {
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  location: 'Location',
};

interface MessageContentProps {
  message: InboxMessage;
  imageSize?: { height: number; width: number };
  trailingMeta?: ReactNode;
}

export function MessageContent({
  message,
  imageSize = { height: 180, width: 240 },
  trailingMeta,
}: MessageContentProps) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const safeUrl = safeMediaUrl(message.mediaUrl);
  const caption = message.contentText?.trim() || null;
  const localDocumentFilename =
    message.contentType === 'document' && message.id.startsWith('temp:')
      ? message.mediaFilename?.trim() || null
      : null;

  if (
    message.contentType === 'text' ||
    message.contentType === 'template' ||
    message.contentType === 'interactive'
  ) {
    return (
      <Text className="text-foreground text-base" testID="message-text-content">
        {caption ?? messagePreview(message)}
        {trailingMeta ? <> {trailingMeta}</> : null}
      </Text>
    );
  }

  if (message.contentType === 'image') {
    return (
      <View className="gap-2">
        {safeUrl && !imageUnavailable ? (
          <Image
            accessible
            accessibilityLabel="Photo attachment"
            contentFit="cover"
            onError={() => setImageUnavailable(true)}
            source={{ uri: safeUrl }}
            style={imageSize}
          />
        ) : (
          <Text className="text-foreground text-sm">Photo unavailable</Text>
        )}
        {caption ? (
          <Text className="text-foreground text-sm">{caption}</Text>
        ) : null}
      </View>
    );
  }

  const label = MEDIA_LABEL[message.contentType];
  if (!safeUrl) {
    return (
      <View className="gap-1">
        <Text className="text-foreground text-sm">{label} unavailable</Text>
        {caption ? (
          <Text className="text-foreground text-sm">{caption}</Text>
        ) : null}
      </View>
    );
  }

  const openMedia = async () => {
    if (opening) return;

    setOpening(true);
    setOpenFailed(false);
    try {
      await Linking.openURL(safeUrl);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  };

  return (
    <View className="gap-2">
      <Text className="text-foreground text-sm">
        {localDocumentFilename ?? label}
      </Text>
      {caption ? (
        <Text className="text-foreground text-sm">{caption}</Text>
      ) : null}
      <Pressable
        accessibilityLabel={`Open ${label.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ busy: opening, disabled: opening }}
        className="min-h-12 justify-center self-start active:opacity-70"
        disabled={opening}
        onPress={() => void openMedia()}
      >
        <Text className="text-foreground text-sm font-medium">
          Open {label.toLowerCase()}
        </Text>
      </Pressable>
      {openFailed ? (
        <Text accessibilityRole="alert" className="text-foreground text-sm">
          Unable to open {label.toLowerCase()}
        </Text>
      ) : null}
    </View>
  );
}
