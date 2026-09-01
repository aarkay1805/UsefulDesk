import { Text, View } from 'react-native';

import type { InboxMessage, MessageStatus } from '../inbox-types';
import { MessageContent } from './message-content';

const DELIVERY_LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
};

const DELIVERY_TICK: Record<MessageStatus, string> = {
  sending: '◷',
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '!',
};

interface DeliveryIndicatorProps {
  status: MessageStatus;
}

export function DeliveryIndicator({ status }: DeliveryIndicatorProps) {
  const label = DELIVERY_LABEL[status];

  return (
    <Text
      accessible
      accessibilityLabel={label}
      className={
        status === 'read'
          ? 'text-chat-read text-xs'
          : 'text-chat-meta-out text-xs'
      }
    >
      {DELIVERY_TICK[status]}
    </Text>
  );
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

  return (
    <Text
      className={`${metaTone} ${
        inline ? 'text-xs' : 'self-end pt-0.5 text-xs'
      }`}
      testID="message-metadata"
    >
      {formattedTime}
      {isOutbound ? (
        <>
          {' '}
          <DeliveryIndicator status={message.status} />
        </>
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
  const isOutbound = message.senderType !== 'customer';
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
            message={message}
            trailingMeta={
              hasTrailingText ? (
                <BubbleMeta
                  formattedTime={formattedTime}
                  inline
                  isOutbound={isOutbound}
                  message={message}
                />
              ) : undefined
            }
          />
          {!hasTrailingText ? (
            <BubbleMeta
              formattedTime={formattedTime}
              isOutbound={isOutbound}
              message={message}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}
