import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../../../ui/button';
import { IconButton } from '../../../ui/icon-button';
import { Notice } from '../../../ui/notice';
import { AudioAttachment, VideoAttachment } from './media-playback';
import { documentType } from '../media-display';
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
          <View style={imageSize}>
            <Image
              accessible
              accessibilityLabel="Photo attachment"
              contentFit="cover"
              onError={() => setImageUnavailable(true)}
              source={{ uri: safeUrl }}
              style={{ ...imageSize, borderRadius: 14 }}
            />
            <View className="absolute right-2 bottom-2">
              <IconButton
                accessibilityLabel="View photo"
                onPress={() =>
                  router.push({
                    pathname: '/(app)/photo',
                    params: { url: safeUrl },
                  })
                }
                symbol="arrow.up.left.and.arrow.down.right"
                variant="secondary"
              />
            </View>
          </View>
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

  if (message.contentType === 'video' || message.contentType === 'audio') {
    return (
      <View className="gap-2" style={{ width: imageSize.width }}>
        {message.contentType === 'video' ? (
          <VideoAttachment key={safeUrl} uri={safeUrl} {...imageSize} />
        ) : (
          <AudioAttachment key={safeUrl} uri={safeUrl} />
        )}
        {caption ? (
          <Text className="text-foreground px-2 text-base">{caption}</Text>
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
      <Text
        className="text-foreground px-2 pt-2 text-base font-medium"
        numberOfLines={2}
      >
        {localDocumentFilename ??
          (message.contentType === 'document' ? documentType(safeUrl) : label)}
      </Text>
      {caption ? (
        <Text className="text-foreground text-sm">{caption}</Text>
      ) : null}
      <Button
        accessibilityLabel={`Open ${label.toLowerCase()}`}
        loading={opening}
        onPress={() => void openMedia()}
        size="sm"
        symbol={message.contentType === 'document' ? 'doc' : undefined}
        variant="ghost"
      >
        Open {label.toLowerCase()}
      </Button>
      {openFailed ? (
        <Notice tone="danger">Unable to open {label.toLowerCase()}</Notice>
      ) : null}
    </View>
  );
}
