import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, type TextInput as TextInputType, View } from 'react-native';

import { Button, ComposerField, IconButton } from '../../../ui';
import type { SendAttemptResult } from '../use-message-thread';

const SEND_FAILURE_MESSAGE =
  'Could not send message. Check your connection and try again.';

interface FailedAttempt {
  temporaryId: string | null;
}

export interface ConversationComposerProps {
  onSend(text: string): Promise<SendAttemptResult>;
  onRetry(temporaryId: string): Promise<SendAttemptResult>;
}

export function ConversationComposer({
  onSend,
  onRetry,
}: ConversationComposerProps) {
  const inputRef = useRef<TextInputType>(null);
  const inFlightRef = useRef(false);
  const focusAfterSettledFailureRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failedAttempt, setFailedAttempt] = useState<FailedAttempt | null>(
    null
  );
  const trimmedDraft = draft.trim();

  const requestDraftFocus = useCallback(() => {
    focusAfterSettledFailureRef.current = true;
  }, []);

  useEffect(() => {
    if (pending || !focusAfterSettledFailureRef.current) return;
    focusAfterSettledFailureRef.current = false;
    inputRef.current?.focus();
  }, [pending]);

  const resolveAttempt = useCallback(
    (result: SendAttemptResult) => {
      if (result.status === 'sent') {
        setDraft('');
        setFailedAttempt(null);
        return;
      }
      setFailedAttempt({ temporaryId: result.temporaryId });
      requestDraftFocus();
    },
    [requestDraftFocus]
  );

  const send = useCallback(async () => {
    if (inFlightRef.current || pending || !trimmedDraft) return;
    inFlightRef.current = true;
    setPending(true);
    setFailedAttempt(null);
    try {
      resolveAttempt(await onSend(trimmedDraft));
    } catch {
      setFailedAttempt({ temporaryId: null });
      requestDraftFocus();
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [onSend, pending, requestDraftFocus, resolveAttempt, trimmedDraft]);

  const retry = useCallback(async () => {
    if (
      inFlightRef.current ||
      pending ||
      failedAttempt?.temporaryId === null ||
      !failedAttempt
    ) {
      return;
    }
    inFlightRef.current = true;
    setPending(true);
    try {
      resolveAttempt(await onRetry(failedAttempt.temporaryId));
    } catch {
      setFailedAttempt({ temporaryId: failedAttempt.temporaryId });
      requestDraftFocus();
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [failedAttempt, onRetry, pending, requestDraftFocus, resolveAttempt]);

  const canRetry = failedAttempt?.temporaryId !== null && !!failedAttempt;

  return (
    <View className="border-border bg-background gap-2 border-t px-3 py-2">
      {failedAttempt ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="bg-danger-soft gap-1 rounded-xl px-3 py-2"
        >
          <Text className="text-danger-soft-foreground text-sm leading-5">
            {SEND_FAILURE_MESSAGE}
          </Text>
          {canRetry ? (
            <Button
              accessibilityLabel="Retry message"
              className="min-h-11 self-start"
              disabled={pending}
              loading={pending}
              onPress={retry}
              size="sm"
              variant="ghost"
            >
              Retry
            </Button>
          ) : null}
        </View>
      ) : null}

      <View className="flex-row items-end gap-2">
        <View className="min-w-0 flex-1">
          <ComposerField
            ref={inputRef}
            accessibilityHint="Write a message. Return adds a new line."
            isDisabled={pending}
            label="Message"
            onChangeText={setDraft}
            placeholder="Write a message"
            value={draft}
          />
        </View>
        <IconButton
          accessibilityLabel="Send message"
          isDisabled={pending || !trimmedDraft}
          isLoading={pending}
          onPress={send}
          symbol="paperplane.fill"
          testID="conversation-send"
        />
      </View>
    </View>
  );
}
