import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, type TextInput as TextInputType, View } from 'react-native';

import {
  MediaValidationError,
  type MediaKind,
} from '../../../../../../src/lib/storage/media-contract';
import { Button, ComposerField, IconButton } from '../../../ui';
import { pickConversationMedia, type PickedMediaAsset } from '../media-picker';
import {
  deleteConversationMedia,
  MediaUploadError,
  uploadConversationMedia,
  type DeleteConversationMediaInput,
  type UploadedMedia,
  type UploadConversationMediaInput,
} from '../media-upload-client';
import type { MediaSendDraft, SendAttemptResult } from '../use-message-thread';
import { ReplyQuote } from './reply-quote';

const UNCONFIRMED_SEND_MESSAGE =
  'The send request did not complete. Delivery could not be confirmed. Check the conversation before sending again.';

interface FailedAttempt {
  temporaryId: string | null;
  message: string;
  safeToRetry: boolean;
  attemptedText: string;
  replyToMessageId: string | null;
}

type AttachmentStatus =
  'uploading' | 'upload_failed' | 'uploaded' | 'sending' | 'send_failed';

interface StagedAttachment {
  asset: PickedMediaAsset;
  status: AttachmentStatus;
  progress: number;
  uploaded: UploadedMedia | null;
  caption: string;
  error: string | null;
  temporaryId: string | null;
  safeToRetry: boolean;
  replyToMessageId: string | null;
}

type UploadOperation = ReturnType<typeof uploadConversationMedia>;

export interface ConversationComposerProps {
  onSend(text: string, replyToMessageId?: string): Promise<SendAttemptResult>;
  onRetry(temporaryId: string): Promise<SendAttemptResult>;
  accountId?: string;
  onSendMedia?(draft: MediaSendDraft): Promise<SendAttemptResult>;
  onRetryMedia?(temporaryId: string): Promise<SendAttemptResult>;
  recoverUnauthorizedSession?(): Promise<void>;
  onOpenTemplates?(): void;
  onStagedChange?(retained: boolean): void;
  sessionExpired?: boolean;
  pickMedia?(kind: MediaKind): Promise<PickedMediaAsset | null>;
  uploadMedia?(input: UploadConversationMediaInput): UploadOperation;
  deleteMedia?(input: DeleteConversationMediaInput): Promise<void>;
  replyTarget?: {
    messageId: string;
    authorLabel: string;
    preview: string;
  } | null;
  onDismissReply?(): void;
  onReplySent?(replyToMessageId: string): void;
}

const attachmentLabel: Record<MediaKind, string> = {
  image: 'Photo',
  video: 'Video',
  document: 'Document',
  audio: 'Audio',
};

export function ConversationComposer({
  onSend,
  onRetry,
  accountId = '',
  onSendMedia,
  onRetryMedia,
  recoverUnauthorizedSession,
  onOpenTemplates,
  onStagedChange,
  sessionExpired = false,
  pickMedia = pickConversationMedia,
  uploadMedia,
  deleteMedia = deleteConversationMedia,
  replyTarget,
  onDismissReply,
  onReplySent,
}: ConversationComposerProps) {
  const inputRef = useRef<TextInputType>(null);
  const inFlightRef = useRef(false);
  const mediaInFlightRef = useRef(false);
  const pickerInFlightRef = useRef(false);
  const focusAfterSettledFailureRef = useRef(false);
  const mountedRef = useRef(true);
  const uploadGenerationRef = useRef(0);
  const uploadRef = useRef<UploadOperation | null>(null);
  const stagedRef = useRef<StagedAttachment | null>(null);
  const ownedPathsRef = useRef(new Set<string>());
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPending, setPickerPending] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedAttachment | null>(null);
  const [failedAttempt, setFailedAttempt] = useState<FailedAttempt | null>(
    null
  );
  stagedRef.current = staged;
  const trimmedDraft = draft.trim();
  const unchangedAmbiguousDraft =
    failedAttempt?.safeToRetry === false &&
    failedAttempt.attemptedText === trimmedDraft;

  useEffect(
    () => onStagedChange?.(pickerPending || staged !== null),
    [onStagedChange, pickerPending, staged]
  );

  useEffect(() => {
    mountedRef.current = true;
    const ownedPaths = ownedPathsRef.current;
    return () => {
      mountedRef.current = false;
      uploadGenerationRef.current += 1;
      uploadRef.current?.abort();
      const current = stagedRef.current;
      if (
        current?.uploaded &&
        !ownedPaths.has(current.uploaded.path) &&
        current.status !== 'sending' &&
        !(current.status === 'send_failed' && current.safeToRetry === false)
      ) {
        void deleteMedia({ accountId, path: current.uploaded.path });
      }
    };
  }, [accountId, deleteMedia]);

  const requestDraftFocus = useCallback(() => {
    focusAfterSettledFailureRef.current = true;
  }, []);

  useEffect(() => {
    if (pending || !focusAfterSettledFailureRef.current) return;
    focusAfterSettledFailureRef.current = false;
    inputRef.current?.focus();
  }, [pending]);

  const resolveAttempt = useCallback(
    (
      result: SendAttemptResult,
      attemptedText: string,
      replyToMessageId: string | null
    ) => {
      if (result.status === 'sent') {
        setDraft('');
        setFailedAttempt(null);
        if (replyToMessageId) onReplySent?.(replyToMessageId);
      } else {
        setFailedAttempt({ ...result, attemptedText, replyToMessageId });
        requestDraftFocus();
      }
    },
    [onReplySent, requestDraftFocus]
  );

  const send = useCallback(async () => {
    if (
      inFlightRef.current ||
      pending ||
      !trimmedDraft ||
      unchangedAmbiguousDraft
    )
      return;
    inFlightRef.current = true;
    setPending(true);
    setFailedAttempt(null);
    const replyToMessageId = replyTarget?.messageId ?? null;
    try {
      const result = replyToMessageId
        ? await onSend(trimmedDraft, replyToMessageId)
        : await onSend(trimmedDraft);
      resolveAttempt(result, trimmedDraft, replyToMessageId);
    } catch {
      setFailedAttempt({
        temporaryId: null,
        message: UNCONFIRMED_SEND_MESSAGE,
        safeToRetry: false,
        attemptedText: trimmedDraft,
        replyToMessageId,
      });
      requestDraftFocus();
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [
    onSend,
    pending,
    requestDraftFocus,
    replyTarget?.messageId,
    resolveAttempt,
    trimmedDraft,
    unchangedAmbiguousDraft,
  ]);

  const retry = useCallback(async () => {
    if (
      inFlightRef.current ||
      pending ||
      failedAttempt?.temporaryId === null ||
      failedAttempt?.safeToRetry !== true
    )
      return;
    inFlightRef.current = true;
    setPending(true);
    try {
      resolveAttempt(
        await onRetry(failedAttempt.temporaryId),
        failedAttempt.attemptedText,
        failedAttempt.replyToMessageId
      );
    } catch {
      setFailedAttempt({
        ...failedAttempt,
        message: UNCONFIRMED_SEND_MESSAGE,
        safeToRetry: false,
      });
      requestDraftFocus();
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [failedAttempt, onRetry, pending, requestDraftFocus, resolveAttempt]);

  const beginUpload = useCallback(
    (asset: PickedMediaAsset) => {
      const generation = ++uploadGenerationRef.current;
      setStaged((current) => ({
        asset,
        status: 'uploading',
        progress: 0,
        uploaded: current?.asset.uri === asset.uri ? current.uploaded : null,
        caption: current?.asset.uri === asset.uri ? current.caption : '',
        error: null,
        temporaryId: null,
        safeToRetry: false,
        replyToMessageId: null,
      }));
      const input = {
        accountId,
        asset,
        onProgress: (value: number) => {
          if (!mountedRef.current || uploadGenerationRef.current !== generation)
            return;
          setStaged((current) =>
            current?.asset.uri === asset.uri
              ? { ...current, progress: Math.max(0, Math.min(1, value)) }
              : current
          );
        },
      };
      const operation = uploadMedia
        ? uploadMedia(input)
        : uploadConversationMedia(input, { recoverUnauthorizedSession });
      uploadRef.current = operation;
      void operation.promise.then(
        (uploaded) => {
          if (!mountedRef.current || uploadGenerationRef.current !== generation)
            return;
          uploadRef.current = null;
          setStaged((current) =>
            current?.asset.uri === asset.uri
              ? {
                  ...current,
                  status: 'uploaded',
                  progress: 1,
                  uploaded,
                  error: null,
                }
              : current
          );
        },
        (error: unknown) => {
          if (!mountedRef.current || uploadGenerationRef.current !== generation)
            return;
          uploadRef.current = null;
          setStaged((current) =>
            current?.asset.uri === asset.uri
              ? {
                  ...current,
                  status: 'upload_failed',
                  error:
                    error instanceof MediaUploadError ||
                    error instanceof MediaValidationError
                      ? error.message
                      : 'Could not upload this attachment.',
                }
              : current
          );
        }
      );
    },
    [accountId, recoverUnauthorizedSession, uploadMedia]
  );

  const chooseAttachment = useCallback(
    async (kind: MediaKind) => {
      if (pickerInFlightRef.current) return;
      pickerInFlightRef.current = true;
      setPickerPending(true);
      setPickerError(null);
      setPickerOpen(false);
      try {
        const asset = await pickMedia(kind);
        if (asset && mountedRef.current) beginUpload(asset);
      } catch (error) {
        if (mountedRef.current) {
          setPickerError(
            error instanceof MediaValidationError
              ? error.message
              : 'Could not open the attachment picker.'
          );
        }
      } finally {
        pickerInFlightRef.current = false;
        if (mountedRef.current) setPickerPending(false);
      }
    },
    [beginUpload, pickMedia]
  );

  const clearAttachment = useCallback(() => {
    const current = stagedRef.current;
    if (current?.status === 'sending') return;
    uploadGenerationRef.current += 1;
    uploadRef.current?.abort();
    uploadRef.current = null;
    if (
      current?.uploaded &&
      !ownedPathsRef.current.has(current.uploaded.path) &&
      !(current.status === 'send_failed' && current.safeToRetry === false)
    ) {
      void deleteMedia({ accountId, path: current.uploaded.path });
    }
    setStaged(null);
  }, [accountId, deleteMedia]);

  const payloadFor = (
    current: StagedAttachment,
    replyToMessageId: string | null
  ): MediaSendDraft | null =>
    current.uploaded
      ? {
          mediaKind: current.asset.kind,
          mediaUrl: current.uploaded.publicUrl,
          caption:
            current.asset.kind === 'audio'
              ? undefined
              : current.caption.trim() || undefined,
          filename:
            current.asset.kind === 'document' ? current.asset.name : undefined,
          ...(replyToMessageId ? { replyToMessageId } : {}),
        }
      : null;

  const settleMediaAttempt = useCallback(
    (
      result: SendAttemptResult,
      current: StagedAttachment,
      replyToMessageId: string | null
    ) => {
      if (result.status === 'sent') {
        if (current.uploaded) ownedPathsRef.current.add(current.uploaded.path);
        setStaged(null);
        if (replyToMessageId) onReplySent?.(replyToMessageId);
        return;
      }
      setStaged((value) =>
        value
          ? {
              ...value,
              status: 'send_failed',
              error: result.message,
              temporaryId: result.temporaryId,
              safeToRetry: result.safeToRetry,
              replyToMessageId,
            }
          : value
      );
    },
    [onReplySent]
  );

  const sendAttachment = useCallback(async () => {
    const current = stagedRef.current;
    if (!current?.uploaded || mediaInFlightRef.current) return;
    if (sessionExpired) {
      onOpenTemplates?.();
      return;
    }
    const replyToMessageId = replyTarget?.messageId ?? null;
    const payload = payloadFor(current, replyToMessageId);
    if (!payload || !onSendMedia) return;
    mediaInFlightRef.current = true;
    setStaged((value) => (value ? { ...value, status: 'sending' } : value));
    try {
      settleMediaAttempt(await onSendMedia(payload), current, replyToMessageId);
    } catch {
      settleMediaAttempt(
        {
          temporaryId: '',
          status: 'failed',
          safeToRetry: false,
          message: UNCONFIRMED_SEND_MESSAGE,
        },
        current,
        replyToMessageId
      );
    } finally {
      mediaInFlightRef.current = false;
    }
  }, [
    onOpenTemplates,
    onSendMedia,
    replyTarget?.messageId,
    sessionExpired,
    settleMediaAttempt,
  ]);

  const retryAttachment = useCallback(async () => {
    const current = stagedRef.current;
    if (
      !current?.temporaryId ||
      !current.safeToRetry ||
      !onRetryMedia ||
      mediaInFlightRef.current
    )
      return;
    mediaInFlightRef.current = true;
    setStaged((value) => (value ? { ...value, status: 'sending' } : value));
    try {
      settleMediaAttempt(
        await onRetryMedia(current.temporaryId),
        current,
        current.replyToMessageId
      );
    } catch {
      settleMediaAttempt(
        {
          temporaryId: current.temporaryId,
          status: 'failed',
          safeToRetry: false,
          message: UNCONFIRMED_SEND_MESSAGE,
        },
        current,
        current.replyToMessageId
      );
    } finally {
      mediaInFlightRef.current = false;
    }
  }, [onRetryMedia, settleMediaAttempt]);

  const canRetry =
    failedAttempt?.temporaryId !== null && failedAttempt?.safeToRetry === true;

  if (staged) {
    const percentage = Math.round(staged.progress * 100);
    const ambiguous =
      staged.status === 'send_failed' && staged.safeToRetry === false;
    return (
      <View className="border-border bg-background gap-3 border-t px-3 py-3">
        {replyTarget ? (
          <ReplyQuote
            authorLabel={replyTarget.authorLabel}
            onDismiss={onDismissReply}
            preview={replyTarget.preview}
          />
        ) : null}
        {staged.asset.kind === 'image' ? (
          <Image
            accessible
            accessibilityLabel="Photo attachment preview"
            contentFit="cover"
            source={{ uri: staged.asset.uri }}
            style={{ width: '100%', height: 180, borderRadius: 14 }}
          />
        ) : (
          <View className="bg-muted gap-1 rounded-xl px-3 py-3">
            <Text
              className="text-foreground text-base font-semibold"
              style={{ lineHeight: undefined }}
            >
              {attachmentLabel[staged.asset.kind]}
            </Text>
            <Text
              className="text-muted text-sm"
              style={{ lineHeight: undefined }}
            >
              {staged.asset.name}
            </Text>
          </View>
        )}
        {staged.asset.kind !== 'audio' ? (
          <ComposerField
            isDisabled={staged.status === 'sending'}
            label="Caption"
            maxLength={1024}
            onChangeText={(caption) =>
              setStaged((current) =>
                current ? { ...current, caption } : current
              )
            }
            placeholder="Add a caption"
            value={staged.caption}
          />
        ) : null}
        {staged.status === 'uploading' ? (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percentage }}
            className="gap-2"
          >
            <Text
              className="text-foreground text-sm"
              style={{ lineHeight: undefined }}
            >
              Uploading {percentage}%
            </Text>
            <Button onPress={clearAttachment} size="sm" variant="ghost">
              Cancel attachment
            </Button>
          </View>
        ) : null}
        {staged.error ? (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="bg-danger-soft gap-2 rounded-xl px-3 py-2"
          >
            <Text
              className="text-danger-soft-foreground text-sm"
              style={{ lineHeight: undefined }}
            >
              {staged.error}
            </Text>
          </View>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {staged.status === 'upload_failed' ? (
            <Button onPress={() => beginUpload(staged.asset)} size="sm">
              Retry upload
            </Button>
          ) : null}
          {staged.status === 'send_failed' && staged.safeToRetry ? (
            <Button onPress={retryAttachment} size="sm">
              Retry attachment
            </Button>
          ) : null}
          {staged.status === 'uploaded' ? (
            <Button onPress={sendAttachment} size="sm">
              Send attachment
            </Button>
          ) : null}
          {!ambiguous &&
          staged.status !== 'uploading' &&
          staged.status !== 'sending' ? (
            <Button onPress={clearAttachment} size="sm" variant="ghost">
              {staged.uploaded ? 'Discard attachment' : 'Cancel attachment'}
            </Button>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="border-border bg-background gap-2 border-t px-3 py-2">
      {replyTarget ? (
        <ReplyQuote
          authorLabel={replyTarget.authorLabel}
          onDismiss={onDismissReply}
          preview={replyTarget.preview}
        />
      ) : null}
      {pickerError || failedAttempt ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="bg-danger-soft gap-1 rounded-xl px-3 py-2"
        >
          <Text
            className="text-danger-soft-foreground text-sm"
            style={{ lineHeight: undefined }}
          >
            {pickerError ?? failedAttempt?.message}
          </Text>
          {canRetry ? (
            <Button
              accessibilityLabel="Retry message"
              className="self-start"
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
      {pickerOpen ? (
        <View className="flex-row flex-wrap gap-2">
          {(
            [
              ['image', 'Choose photo'],
              ['video', 'Choose video'],
              ['document', 'Choose document'],
              ['audio', 'Choose audio'],
            ] as const
          ).map(([kind, label]) => (
            <Button
              accessibilityLabel={label}
              disabled={pickerPending}
              key={kind}
              onPress={() => void chooseAttachment(kind)}
              size="sm"
              variant="ghost"
            >
              {label.replace('Choose ', '')}
            </Button>
          ))}
        </View>
      ) : null}
      <View className="flex-row items-end gap-2">
        <IconButton
          accessibilityLabel="Attach media"
          isDisabled={pending || pickerPending}
          isLoading={pickerPending}
          onPress={() => setPickerOpen((value) => !value)}
          symbol="paperclip"
          testID="conversation-attach"
        />
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
          isDisabled={pending || !trimmedDraft || unchangedAmbiguousDraft}
          isLoading={pending}
          onPress={send}
          symbol="paperplane.fill"
          testID="conversation-send"
        />
      </View>
    </View>
  );
}
