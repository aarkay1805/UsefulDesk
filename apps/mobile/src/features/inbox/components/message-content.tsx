import { Image } from 'expo-image';
import { Linking, Pressable, Text, View } from 'react-native';
import { useState } from 'react';

import { messagePreview, safeMediaUrl } from '../inbox-format';
import type { ContentType, InboxMessage } from '../inbox-types';

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
}

export function MessageContent({ message }: MessageContentProps) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const safeUrl = safeMediaUrl(message.mediaUrl);

  if (
    message.contentType === 'text' ||
    message.contentType === 'template' ||
    message.contentType === 'interactive'
  ) {
    return (
      <Text className="text-foreground text-base leading-5">
        {messagePreview(message)}
      </Text>
    );
  }

  if (message.contentType === 'image') {
    if (!safeUrl || imageUnavailable) {
      return <Text className="text-foreground text-sm">Photo unavailable</Text>;
    }

    return (
      <Image
        accessible
        accessibilityLabel="Photo attachment"
        contentFit="cover"
        onError={() => setImageUnavailable(true)}
        source={{ uri: safeUrl }}
        style={{ height: 180, width: 240 }}
      />
    );
  }

  const label = MEDIA_LABEL[message.contentType];
  if (!safeUrl) {
    return <Text className="text-foreground text-sm">{label} unavailable</Text>;
  }

  const openMedia = async () => {
    try {
      await Linking.openURL(safeUrl);
      setOpenFailed(false);
    } catch {
      setOpenFailed(true);
    }
  };

  return (
    <View className="gap-2">
      <Text className="text-foreground text-sm">{label}</Text>
      <Pressable
        accessibilityLabel={`Open ${label.toLowerCase()}`}
        accessibilityRole="button"
        className="min-h-12 justify-center self-start active:opacity-70"
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
