import { useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import {
  AccessibilityInfo,
  Platform,
  PlatformColor,
  Pressable,
  type ColorValue,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  useWindowDimensions,
  View,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useCSSVariable } from 'uniwind';

import { useTextScale } from '../../../ui/use-text-scale';

import type {
  InboxMessage,
  InboxMessageReaction,
  MessageStatus,
} from '../inbox-types';
import {
  isAccessibilityTextScale,
  shouldInlineBubbleMetadata,
} from '../inbox-layout';
import { DeliveryTick } from './delivery-tick';
import { MessageContent } from './message-content';
import { MessageReactions } from './message-reactions';
import { ReplyQuote, type ReplyQuoteContent } from './reply-quote';
import { Text } from '../../../ui/text';

const DELIVERY_LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
};

const THREAD_HORIZONTAL_PADDING = 12;
const BUBBLE_MAX_WIDTH_RATIO = 0.8;
const ACCESSIBILITY_BUBBLE_MAX_WIDTH_RATIO = 0.88;
const BUBBLE_HORIZONTAL_PADDING = 16;
const MAX_IMAGE_WIDTH = 240;
const IMAGE_ASPECT_RATIO = 4 / 3;

export function messageImageSizeForViewport(
  viewportWidth: number,
  bubbleMaxWidthRatio = BUBBLE_MAX_WIDTH_RATIO
): {
  height: number;
  width: number;
} {
  const rowWidth = Math.max(0, viewportWidth - THREAD_HORIZONTAL_PADDING * 2);
  const contentWidth = Math.max(
    0,
    rowWidth * bubbleMaxWidthRatio - BUBBLE_HORIZONTAL_PADDING * 2
  );
  const width = Math.min(MAX_IMAGE_WIDTH, Math.floor(contentWidth));
  return { height: width / IMAGE_ASPECT_RATIO, width };
}

interface BubbleMetaProps {
  formattedTime: string;
  inline?: boolean;
  isOutbound: boolean;
  message: InboxMessage;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function BubbleMeta({
  formattedTime,
  inline = false,
  isOutbound,
  message,
  onLayout,
}: BubbleMetaProps) {
  const metaTone = isOutbound ? 'text-chat-meta-out' : 'text-chat-meta';
  const deliveryStatus =
    isOutbound && message.status !== 'failed' ? message.status : null;
  const deliveryLabel = deliveryStatus ? DELIVERY_LABEL[deliveryStatus] : null;

  return (
    <View
      accessible
      accessibilityLabel={
        deliveryLabel ? `${formattedTime}, ${deliveryLabel}` : formattedTime
      }
      className={
        inline
          ? 'flex-row items-center'
          : 'flex-row items-center self-end pt-0.5'
      }
      onLayout={onLayout}
      testID="message-metadata"
    >
      <Text className={`${metaTone} text-xs`}>{formattedTime}</Text>
      {deliveryStatus ? (
        <View className="ml-1">
          <DeliveryTick isOutbound={isOutbound} status={deliveryStatus} />
        </View>
      ) : null}
    </View>
  );
}

interface MeasuredTextContentProps extends BubbleMetaProps {
  contentWidth: number;
}

function MeasuredTextContent({
  contentWidth,
  formattedTime,
  isOutbound,
  message,
}: MeasuredTextContentProps) {
  const [lastLineWidth, setLastLineWidth] = useState<number | null>(null);
  const [metaWidth, setMetaWidth] = useState<number | null>(null);
  // Start with the trailing row so the text is measured without metadata.
  // An inline native View is one text attachment: its time and tick wrap
  // together. Reserve a small gap so rounding cannot detach it at the edge.
  const inline =
    lastLineWidth !== null &&
    metaWidth !== null &&
    lastLineWidth + metaWidth + 8 <= contentWidth;

  return (
    <>
      <MessageContent
        message={message}
        onTextLayout={
          inline
            ? undefined
            : (event: NativeSyntheticEvent<TextLayoutEventData>) => {
                const lines = event.nativeEvent.lines;
                const width = lines[lines.length - 1]?.width ?? 0;
                setLastLineWidth((current) =>
                  current === width ? current : width
                );
              }
        }
        trailingMeta={
          inline ? (
            <BubbleMeta
              formattedTime={formattedTime}
              inline
              isOutbound={isOutbound}
              message={message}
            />
          ) : undefined
        }
      />
      {!inline ? (
        <BubbleMeta
          formattedTime={formattedTime}
          isOutbound={isOutbound}
          message={message}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setMetaWidth((current) => (current === width ? current : width));
          }}
        />
      ) : null}
    </>
  );
}

interface MessageBubbleProps {
  message: InboxMessage;
  formattedTime: string;
  startsRun: boolean;
  currentUserId?: string;
  onOpenActions?(): void;
  onReply?(): void;
  onToggleReaction?(emoji: string): void;
  reactionPending?: boolean;
  reactions?: InboxMessageReaction[];
  replyQuote?: ReplyQuoteContent;
}

export function MessageBubble({
  message,
  formattedTime,
  startsRun,
  currentUserId,
  onOpenActions,
  onReply,
  onToggleReaction,
  reactionPending,
  reactions = [],
  replyQuote,
}: MessageBubbleProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const fontScale = useTextScale();
  const foreground = useCSSVariable('--color-foreground');
  const accessibilityTextScale = isAccessibilityTextScale(fontScale);
  const bubbleMaxWidthRatio = accessibilityTextScale
    ? ACCESSIBILITY_BUBBLE_MAX_WIDTH_RATIO
    : BUBBLE_MAX_WIDTH_RATIO;
  const imageSize = messageImageSizeForViewport(
    viewportWidth,
    bubbleMaxWidthRatio
  );
  const isOutbound = message.senderType !== 'customer';
  const isFailed = isOutbound && message.status === 'failed';
  const previousDeliveryRef = useRef({
    messageId: message.id,
    status: message.status,
  });
  const swipeableRef = useRef<SwipeableMethods>(null);

  useEffect(() => {
    const previousDelivery = previousDeliveryRef.current;
    previousDeliveryRef.current = {
      messageId: message.id,
      status: message.status,
    };

    if (
      Platform.OS === 'ios' &&
      isOutbound &&
      previousDelivery.messageId === message.id &&
      previousDelivery.status !== 'failed' &&
      message.status === 'failed'
    ) {
      AccessibilityInfo.announceForAccessibilityWithOptions('Message failed', {
        queue: true,
      });
    }
  }, [isOutbound, message.id, message.status]);
  const marker =
    message.contentType === 'template'
      ? 'Template'
      : message.contentType === 'interactive'
        ? 'Button reply'
        : null;
  const alignment = isOutbound ? 'items-end' : 'items-start';
  const fill = isOutbound ? 'bg-chat-bubble-out' : 'bg-chat-bubble-in';
  const metaTone = isOutbound ? 'text-chat-meta-out' : 'text-chat-meta';
  const hasTrailingText =
    message.contentType === 'text' ||
    message.contentType === 'template' ||
    message.contentType === 'interactive';
  const isMedia = ['image', 'video', 'audio', 'document'].includes(
    message.contentType
  );
  const inlineMetadata = shouldInlineBubbleMetadata(hasTrailingText, fontScale);
  const textContentWidth = Math.max(
    0,
    (viewportWidth - THREAD_HORIZONTAL_PADDING * 2) * bubbleMaxWidthRatio -
      BUBBLE_HORIZONTAL_PADDING * 2
  );
  const accessibilityActions = [
    ...(onReply ? [{ name: 'reply', label: 'Reply to message' }] : []),
    ...(onOpenActions ? [{ name: 'react', label: 'React to message' }] : []),
  ];
  return (
    <ReanimatedSwipeable
      dragOffsetFromLeftEdge={12}
      enabled={Boolean(onReply)}
      leftThreshold={44}
      onSwipeableOpen={() => {
        onReply?.();
        swipeableRef.current?.close();
      }}
      overshootLeft={false}
      ref={swipeableRef}
      renderLeftActions={
        onReply
          ? () => (
              <View
                accessibilityElementsHidden
                className="w-16 items-center justify-center"
                importantForAccessibility="no-hide-descendants"
                testID="message-swipe-reply-affordance"
              >
                <SymbolView
                  name={{
                    ios: 'arrowshape.turn.up.left.fill',
                    android: 'reply',
                  }}
                  size={22}
                  tintColor={
                    foreground !== undefined
                      ? (foreground as ColorValue)
                      : PlatformColor('label')
                  }
                  weight="semibold"
                />
              </View>
            )
          : undefined
      }
      testID="message-reply-swipeable"
    >
      <View className={`w-full ${alignment}`}>
        <Pressable
          accessibilityActions={
            accessibilityActions.length > 0 ? accessibilityActions : undefined
          }
          className={`w-full ${alignment} ${startsRun ? 'mt-3' : 'mt-0.5'}`}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'reply') onReply?.();
            if (event.nativeEvent.actionName === 'react') onOpenActions?.();
          }}
          onLongPress={onOpenActions}
          testID="message-bubble"
        >
          <View
            className={`relative ${isMedia ? 'rounded-2xl p-1' : 'rounded-3xl px-4 py-2.5'} ${fill} ${
              accessibilityTextScale ? 'max-w-[88%]' : 'max-w-[80%]'
            }`}
          >
            <View className="gap-1">
              {replyQuote ? (
                <ReplyQuote isOutbound={isOutbound} {...replyQuote} />
              ) : null}
              {marker ? (
                <Text className={`${metaTone} text-xs`}>{marker}</Text>
              ) : null}
              {inlineMetadata ? (
                <MeasuredTextContent
                  contentWidth={textContentWidth}
                  formattedTime={formattedTime}
                  isOutbound={isOutbound}
                  key={`${message.id}:${message.status}:${formattedTime}:${fontScale}:${viewportWidth}:${message.contentText}`}
                  message={message}
                />
              ) : (
                <MessageContent imageSize={imageSize} message={message} />
              )}
              {!inlineMetadata ? (
                <View className={isMedia ? 'px-2 pb-1' : undefined}>
                  <BubbleMeta
                    formattedTime={formattedTime}
                    isOutbound={isOutbound}
                    message={message}
                  />
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
        {currentUserId ? (
          <MessageReactions
            currentUserId={currentUserId}
            onToggle={onToggleReaction}
            pending={reactionPending}
            reactions={reactions}
          />
        ) : null}
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
    </ReanimatedSwipeable>
  );
}
