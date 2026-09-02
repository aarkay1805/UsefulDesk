import { Text, useWindowDimensions, View } from 'react-native';

import type { InboxMessage, MessageStatus } from '../inbox-types';
import { MessageContent } from './message-content';

const DELIVERY_LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
};

const DELIVERY_TICK: Record<Exclude<MessageStatus, 'failed'>, string> = {
  sending: '◷',
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
};

const THREAD_HORIZONTAL_PADDING = 12;
const BUBBLE_MAX_WIDTH_RATIO = 0.65;
const BUBBLE_HORIZONTAL_PADDING = 10;
const MAX_IMAGE_WIDTH = 240;
const IMAGE_ASPECT_RATIO = 4 / 3;

export function messageImageSizeForViewport(viewportWidth: number): {
  height: number;
  width: number;
} {
  const rowWidth = Math.max(0, viewportWidth - THREAD_HORIZONTAL_PADDING * 2);
  const contentWidth = Math.max(
    0,
    rowWidth * BUBBLE_MAX_WIDTH_RATIO - BUBBLE_HORIZONTAL_PADDING * 2
  );
  const width = Math.min(MAX_IMAGE_WIDTH, Math.floor(contentWidth));
  return { height: width / IMAGE_ASPECT_RATIO, width };
}

interface BubbleMetaProps {
  formattedTime: string;
  inline?: boolean;
  isOutbound: boolean;
  message: InboxMessage;
}

function BubbleMeta({
  formattedTime,
  inline = false,
  isOutbound,
  message,
}: BubbleMetaProps) {
  const metaTone = isOutbound ? 'text-chat-meta-out' : 'text-chat-meta';
  const deliveryStatus =
    isOutbound && message.status !== 'failed' ? message.status : null;
  const deliveryLabel = deliveryStatus ? DELIVERY_LABEL[deliveryStatus] : null;

  return (
    <Text
      accessibilityLabel={
        deliveryLabel ? `${formattedTime}, ${deliveryLabel}` : undefined
      }
      className={`${metaTone} ${
        inline ? 'text-xs' : 'self-end pt-0.5 text-xs'
      }`}
      testID="message-metadata"
    >
      {formattedTime}
      {deliveryStatus ? (
        deliveryStatus === 'read' ? (
          <>
            {' '}
            <Text className="text-chat-read text-xs">{DELIVERY_TICK.read}</Text>
          </>
        ) : (
          ` ${DELIVERY_TICK[deliveryStatus]}`
        )
      ) : null}
    </Text>
  );
}

interface MessageBubbleProps {
  message: InboxMessage;
  formattedTime: string;
  startsRun: boolean;
}

export function MessageBubble({
  message,
  formattedTime,
  startsRun,
}: MessageBubbleProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const imageSize = messageImageSizeForViewport(viewportWidth);
  const isOutbound = message.senderType !== 'customer';
  const isFailed = isOutbound && message.status === 'failed';
  const marker =
    message.contentType === 'template'
      ? 'Template'
      : message.contentType === 'interactive'
        ? 'Button reply'
        : null;
  const alignment = isOutbound ? 'items-end' : 'items-start';
  const fill = isOutbound ? 'bg-chat-bubble-out' : 'bg-chat-bubble-in';
  const tailPosition = isOutbound ? '-right-1' : '-left-1';
  const squaredCorner = isOutbound ? 'rounded-tr-none' : 'rounded-tl-none';
  const metaTone = isOutbound ? 'text-chat-meta-out' : 'text-chat-meta';
  const hasTrailingText =
    message.contentType === 'text' ||
    message.contentType === 'template' ||
    message.contentType === 'interactive';
  return (
    <View
      className={`w-full ${alignment} ${startsRun ? 'mt-3' : 'mt-0.5'}`}
      testID="message-bubble"
    >
      <View
        className={`relative max-w-[65%] rounded-lg px-2.5 py-1.5 ${fill} ${
          startsRun ? squaredCorner : ''
        }`}
      >
        {startsRun ? (
          <View
            className={`absolute top-0 size-2 rotate-45 ${tailPosition} ${fill}`}
            testID="message-bubble-tail"
          />
        ) : null}
        <View className="gap-1">
          {marker ? (
            <Text className={`${metaTone} text-xs`}>{marker}</Text>
          ) : null}
          <MessageContent
            imageSize={imageSize}
            message={message}
            trailingMeta={
              hasTrailingText ? (
                <BubbleMeta
                  formattedTime={formattedTime}
                  inline
                  isOutbound={isOutbound}
                  key={`${message.id}:${message.status}:metadata`}
                  message={message}
                />
              ) : undefined
            }
          />
          {!hasTrailingText ? (
            <BubbleMeta
              formattedTime={formattedTime}
              isOutbound={isOutbound}
              key={`${message.id}:${message.status}:metadata`}
              message={message}
            />
          ) : null}
        </View>
      </View>
      {isFailed ? (
        <View
          accessible
          accessibilityLabel="Message failed"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="mt-1 px-1"
          key={`${message.id}:failed`}
          testID="message-failed-status"
        >
          <Text className="text-danger text-xs font-medium">
            {DELIVERY_LABEL.failed}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
