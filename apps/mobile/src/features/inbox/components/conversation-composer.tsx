import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type TextInput as TextInputType, View } from 'react-native';

import {
  MediaValidationError,
  type MediaKind,
} from '../../../../../../src/lib/storage/media-contract';
import { Button, ComposerField, IconButton, Notice } from '../../../ui';
import { Glyph, type GlyphName } from '../../../ui/glyph';
import { Text } from '../../../ui/text';
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
import { AudioAttachment, VideoAttachment } from './media-playback';
import { attachmentSize } from '../media-display';
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
  sendEnabled?: boolean;
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

/**
 * The attach menu, as rows rather than a grid of tiles: a leading glyph then
 * its name, which is what iOS chat apps do and what survives an accessibility
 * text scale, where an icon stacked over a label turns each tile into a column.
 * `label` stays the spoken name so the row still reads as an action.
 */
const ATTACHMENT_OPTIONS: readonly {
  kind: MediaKind;
  label: string;
  name: string;
  symbol: GlyphName;
}[] = [
  {
    kind: 'image',
    label: 'Choose photo',
    name: attachmentLabel.image,
    symbol: 'photo',
  },
  {
    kind: 'video',
    label: 'Choose video',
    name: attachmentLabel.video,
    symbol: 'video',
  },
  {
    kind: 'document',
    label: 'Choose document',
    name: attachmentLabel.document,
    symbol: 'doc',
  },
  {
    kind: 'audio',
    label: 'Choose audio',
    name: attachmentLabel.audio,
    symbol: 'waveform',
  },
];

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
  sendEnabled = true,
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
  /**
   * Send appears once there is something to send, the way every current chat
   * app does it, rather than sitting there greyed out over an empty field. It
   * stays through `pending` so the control the reader pressed keeps its
   * spinner, and stays for an ambiguous draft — that text is real, it is the
   * resend that is locked, so the control is disabled rather than absent.
   */
  const showSend = Boolean(trimmedDraft) || pending;

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
      !sendEnabled ||
      sessionExpired ||
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
    sendEnabled,
    sessionExpired,
    pending,
    requestDraftFocus,
    replyTarget?.messageId,
    resolveAttempt,
    trimmedDraft,
    unchangedAmbiguousDraft,
  ]);

  const retry = useCallback(async () => {
    if (
      !sendEnabled ||
      sessionExpired ||
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
  }, [
    failedAttempt,
    onRetry,
    pending,
    requestDraftFocus,
    resolveAttempt,
    sendEnabled,
    sessionExpired,
  ]);

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
    if (!sendEnabled) return;
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
    sendEnabled,
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
    if (sessionExpired) {
      onOpenTemplates?.();
      return;
    }
    if (!sendEnabled) return;
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
  }, [
    onRetryMedia,
    settleMediaAttempt,
    sessionExpired,
    sendEnabled,
    onOpenTemplates,
  ]);

  const canRetry =
    failedAttempt?.temporaryId !== null && failedAttempt?.safeToRetry === true;

  if (staged) {
    const percentage = Math.round(staged.progress * 100);
    const ambiguous =
      staged.status === 'send_failed' && staged.safeToRetry === false;
    return (
      <View className="border-border bg-inbox-panel gap-3 border-t px-3 py-3">
        {replyTarget ? (
          <ReplyQuote
            authorLabel={replyTarget.authorLabel}
            onDismiss={onDismissReply}
            preview={replyTarget.preview}
          />
        ) : null}
        <View className="flex-row items-center gap-3">
          <Glyph
            name={
              ATTACHMENT_OPTIONS.find(({ kind }) => kind === staged.asset.kind)!
                .symbol
            }
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text
              accessibilityLabel={staged.asset.name}
              className="text-foreground text-base font-semibold"
              numberOfLines={2}
            >
              {staged.asset.name}
            </Text>
            <Text className="text-muted text-sm">
              {attachmentLabel[staged.asset.kind]} ·{' '}
              {attachmentSize(staged.asset.size)}
            </Text>
          </View>
          {!ambiguous && staged.status !== 'sending' ? (
            <IconButton
              accessibilityLabel={
                staged.uploaded ? 'Discard attachment' : 'Cancel attachment'
              }
              onPress={clearAttachment}
              symbol="xmark"
              variant="ghost"
            />
          ) : null}
        </View>
        {staged.asset.kind === 'image' ? (
          <Image
            accessible
            accessibilityLabel="Photo attachment preview"
            contentFit="contain"
            source={{ uri: staged.asset.uri }}
            style={{ width: '100%', height: 180, borderRadius: 14 }}
          />
        ) : null}
        {staged.asset.kind === 'video' ? (
          <VideoAttachment
            key={staged.asset.uri}
            uri={staged.asset.uri}
            width="100%"
          />
        ) : null}
        {staged.asset.kind === 'audio' ? (
          <AudioAttachment key={staged.asset.uri} uri={staged.asset.uri} />
        ) : null}
        <View className="flex-row items-end justify-end gap-2">
          {staged.asset.kind !== 'audio' ? (
            <View className="min-w-0 flex-1">
              <ComposerField
                appearance="chat"
                hideLabel
                accessibilityHint="Optional caption. Return adds a new line."
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
            </View>
          ) : null}
          {staged.status === 'uploaded' || staged.status === 'sending' ? (
            <IconButton
              accessibilityLabel="Send attachment"
              isDisabled={!sendEnabled && !sessionExpired}
              isLoading={staged.status === 'sending'}
              onPress={sendAttachment}
              shape="circle"
              symbol="send"
              tone="on-accent"
            />
          ) : null}
        </View>
        {staged.status === 'uploading' ? (
          <View
            accessible
            accessibilityLabel="Uploading attachment"
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percentage }}
            className="gap-2"
          >
            <Text className="text-foreground text-sm">
              Uploading {percentage}%
            </Text>
          </View>
        ) : null}
        {staged.error ? (
          <Notice symbol="exclamationmark.triangle" tone="danger">
            {staged.error}
          </Notice>
        ) : null}
        {staged.status === 'upload_failed' ||
        (staged.status === 'send_failed' && staged.safeToRetry) ? (
          <View className="flex-row flex-wrap gap-2">
            {staged.status === 'upload_failed' ? (
              <Button onPress={() => beginUpload(staged.asset)} size="sm">
                Retry upload
              </Button>
            ) : null}
            {staged.status === 'send_failed' && staged.safeToRetry ? (
              <Button
                disabled={!sendEnabled && !sessionExpired}
                onPress={retryAttachment}
                size="sm"
              >
                Retry attachment
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="bg-inbox-panel gap-2 px-3 py-2">
      {replyTarget ? (
        <ReplyQuote
          authorLabel={replyTarget.authorLabel}
          onDismiss={onDismissReply}
          preview={replyTarget.preview}
        />
      ) : null}
      {pickerError || failedAttempt ? (
        <Notice
          action={
            canRetry ? (
              <Button
                accessibilityLabel="Retry message"
                className="self-start"
                disabled={pending || !sendEnabled || sessionExpired}
                loading={pending}
                onPress={retry}
                size="sm"
                variant="ghost"
              >
                Retry
              </Button>
            ) : null
          }
          symbol="exclamationmark.triangle"
          tone="danger"
        >
          {pickerError ?? failedAttempt?.message}
        </Notice>
      ) : null}
      {pickerOpen ? (
        <View className="bg-inbox-chrome overflow-hidden rounded-2xl py-1">
          {ATTACHMENT_OPTIONS.map(({ kind, label, name, symbol }) => (
            <Button
              accessibilityLabel={label}
              className="justify-start gap-3 rounded-none px-4"
              disabled={pickerPending}
              key={kind}
              onPress={() => void chooseAttachment(kind)}
              size="sm"
              symbol={symbol}
              variant="ghost"
            >
              {name}
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
          variant="ghost"
        />
        <View className="min-w-0 flex-1">
          <ComposerField
            ref={inputRef}
            accessibilityHint="Write a message. Return adds a new line."
            appearance="chat"
            hideLabel
            isDisabled={pending}
            label="Message"
            onChangeText={setDraft}
            placeholder="Write a message"
            value={draft}
          />
        </View>
        {showSend ? (
          <IconButton
            accessibilityLabel="Send message"
            isDisabled={
              pending ||
              !sendEnabled ||
              sessionExpired ||
              unchangedAmbiguousDraft
            }
            isLoading={pending}
            onPress={send}
            shape="circle"
            symbol="send"
            testID="conversation-send"
            tone="on-accent"
          />
        ) : null}
      </View>
    </View>
  );
}
