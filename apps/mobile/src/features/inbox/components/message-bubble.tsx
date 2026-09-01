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

  return (
    <View className={`w-full ${alignment} ${startsRun ? 'mt-3' : 'mt-0.5'}`}>
      <View
        className={`relative max-w-[65%] rounded-lg px-2.5 py-1.5 ${fill} ${
          startsRun ? squaredCorner : ''
        }`}
      >
        {startsRun ? (
          <View
            className={`absolute top-0 size-2 rotate-45 ${tailPosition} ${fill}`}
          />
        ) : null}
        <View className="gap-1">
          {marker ? (
            <Text className={`${metaTone} text-xs`}>{marker}</Text>
          ) : null}
          <MessageContent message={message} />
          <View className="flex-row items-center gap-1 self-end pt-0.5">
            <Text className={`${metaTone} text-xs`}>{formattedTime}</Text>
            {isOutbound ? <DeliveryIndicator status={message.status} /> : null}
          </View>
        </View>
      </View>
    </View>
  );
}
