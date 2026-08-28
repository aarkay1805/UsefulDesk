'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { Message, MessageReaction, MessageReferral } from '@/types';
import {
  AlertTriangle,
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  ExternalLink,
  Megaphone,
} from 'lucide-react';
import { useLocale } from '@/hooks/use-locale';
import { ReplyQuote } from './reply-quote';
import { MessageReactions } from './message-reactions';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SourceIcon } from '@/components/leads/source-icon';
import {
  referralDisplayLabel,
  referralSourceHref,
} from '@/lib/whatsapp/referral';
import { splitProviderDetail } from '@/lib/whatsapp/provider-error';
import { getTemplateSendPresentation } from '@/lib/whatsapp/template-send-presentation';
import {
  templateHeaderMediaKind,
  templateHeaderMediaLabel,
} from '@/lib/whatsapp/template-render';

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * True when this bubble opens a run — the first message of a same-sender
   * group, or one far enough after the last to read as a new turn. Only a
   * run-opening bubble draws a tail; the rest stack tightly beneath it, which
   * is what turns a column of bubbles into a conversation with a rhythm.
   * Defaults to true so a lone bubble (tests, previews) still looks finished.
   */
  startsRun?: boolean;
}

// Status ticks sit on the outbound bubble, which is now an accent TINT rather
// than a solid accent fill, so they resolve against the same derived
// --chat-meta-out the timestamp uses and stay ≥4.5:1 on every accent in both
// modes. Read is the one state that changes hue: WhatsApp's blue double-tick
// is the single most-recognised delivery signal in messaging, and a fixed
// domain status is exactly what the semantic sky token exists for — it must
// NOT follow the account accent, or "read" and "brand" become the same colour.
// Every state still carries an aria-label so the meaning never rides on
// colour alone (WCAG 1.4.1).
function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <Clock aria-label="Sending" className="size-3.5 opacity-70" />;
    case 'sent':
      return <Check aria-label="Sent" className="size-3.5" />;
    case 'delivered':
      return <CheckCheck aria-label="Delivered" className="size-3.5" />;
    case 'read':
      return (
        <CheckCheck
          aria-label="Read"
          className="text-sky-foreground size-3.5"
        />
      );
    case 'failed':
      return (
        <XCircle
          aria-label="Failed to send"
          className="text-destructive size-3.5"
        />
      );
    default:
      return null;
  }
}

/**
 * The bubble tail — the single most recognisable shape in a chat client, and
 * the reason a stack of rounded rectangles reads as "messages" rather than
 * "cards". It hangs off the TOP outer corner of the first bubble in a run
 * (WhatsApp's placement; the tail marks where a run starts, not where it
 * ends), so the matching corner drops its radius and the wedge continues the
 * fill across the gap. Drawn rather than faked with a CSS triangle: a
 * hard-edged triangle beside a 10px-radius bubble reads as a glitch.
 *
 * Exported because the template preset gallery draws the same tail on its
 * sample bubbles: the shape is the whole reason those previews read as
 * messages, and two copies of the path would drift.
 */
export function BubbleTail({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 12"
      width={8}
      height={12}
      className={cn(
        'absolute top-0 h-3 w-2',
        side === 'right'
          ? 'text-chat-bubble-out -right-2'
          : 'text-chat-bubble-in -left-2'
      )}
    >
      <path
        fill="currentColor"
        d={
          side === 'right'
            ? 'M0 0h6.6C7.4 0 8 .6 8 1.4 8 6.9 4.6 11.1 0 12Z'
            : 'M8 0H1.4C.6 0 0 .6 0 1.4 0 6.9 3.4 11.1 8 12Z'
        }
      />
    </svg>
  );
}

/**
 * Timestamp + delivery state, rendered twice on purpose.
 *
 * WhatsApp tucks the metadata into the tail of the message's LAST line rather
 * than giving it a row of its own — which is why a two-word reply there is one
 * line tall and the same reply in a naive implementation is two. Reproducing
 * that needs the meta both reserved in the text flow (so the last line wraps
 * short of it) and painted at the bubble's bottom-right corner. Rendering the
 * identical node twice — once invisible inline, once absolutely positioned —
 * makes the reservation exactly as wide as the thing it reserves for, with no
 * measurement and no magic number to drift.
 */
function BubbleMeta({
  time,
  status,
  showStatus,
}: {
  time: string;
  status: Message['status'];
  showStatus: boolean;
}) {
  return (
    <>
      <span className="tabular-nums">{time}</span>
      {showStatus && <StatusIcon status={status} />}
    </>
  );
}

/**
 * Retained Meta diagnostics for a failed outbound send.
 *
 * The note is subordinate to the bubble it annotates, so it hangs off the
 * bubble's right edge while its own prose reads left-aligned — the previous
 * `text-right` block gave five lines of explanation a ragged left edge and
 * let Meta's Business Manager URL overflow the width cap. Hierarchy runs
 * status, then cause and recovery, then diagnostics: the Meta code and error
 * title stay retained without leading the note.
 */
function DeliveryFailureNote({ message }: { message: Message }) {
  const code = message.provider_error_code;
  const title = message.provider_error_title;
  const detail = message.provider_error_detail;

  if (!code && !title && !detail) return null;

  // Meta often repeats `title` verbatim as `error_data.details`. Show the
  // sentence once, and keep the footnote only for a title that adds something.
  const body = detail || title;
  const footnote = detail && title && title !== detail ? title : null;

  return (
    <Alert
      variant="destructive"
      className="mt-1.5 w-auto max-w-[min(100%,23rem)] px-2.5 py-2 text-xs"
    >
      <AlertTriangle className="size-3.5" />
      <AlertTitle>Failed to send</AlertTitle>
      {body && (
        <AlertDescription className="text-xs break-words">
          {splitProviderDetail(body).map((segment, index) =>
            segment.kind === 'text' ? (
              <Fragment key={index}>{segment.value}</Fragment>
            ) : (
              <a
                key={index}
                href={segment.href}
                target="_blank"
                rel="noopener noreferrer"
                title={segment.href}
                // inline-flex welds the glyph to the hostname — at phone
                // width the two wrapped onto separate lines. The whole
                // anchor moves to the next line instead, and a hostname
                // too long for the note ellipsises rather than overflows.
                className="inline-flex max-w-full items-baseline gap-0.5 font-medium"
              >
                <span className="truncate">{segment.label}</span>
                <ExternalLink
                  aria-hidden="true"
                  className="size-3 shrink-0 self-center"
                />
              </a>
            )
          )}
        </AlertDescription>
      )}
      {(code || footnote) && (
        <p
          className={cn(
            // Neutral tone plus the rule below carry the demotion; a 1px
            // type step would only add a value off the ramp for nothing.
            'text-muted-foreground col-start-2',
            // The rule separates diagnostics from the explanation above it;
            // with no explanation there is nothing to divide.
            body && 'border-border mt-1.5 border-t pt-1.5'
          )}
        >
          {code && <span className="tabular-nums">Meta {code}</span>}
          {code && footnote && ' \u00b7 '}
          {footnote}
        </p>
      )}
    </Alert>
  );
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="bg-foreground/5 text-chat-meta flex items-center gap-2 rounded-sm px-3 py-2 text-xs">
      <ImageOff className="h-4 w-4 shrink-0" />
      <span>{label} unavailable</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith('/api/whatsapp/media/')) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load media');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await loadImage();
    })();
    return () => {
      cancelled = true;
      if (src?.startsWith('blob:')) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="bg-foreground/5 flex h-40 w-60 items-center justify-center rounded-sm">
        <ImageOff className="text-chat-meta h-8 w-8" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-foreground/5 flex h-40 w-60 items-center justify-center rounded-sm">
        <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <Image
      src={src ?? ''}
      alt={alt}
      width={240}
      height={256}
      unoptimized
      className="h-auto max-h-64 w-auto max-w-60 rounded-sm object-cover"
      onError={() => setError(true)}
    />
  );
}

function ReferralContext({ referral }: { referral: MessageReferral }) {
  const label = referralDisplayLabel(referral);
  const href = referralSourceHref(referral);
  const sourceKey = referral.source_platform;

  return (
    <div className="border-border/50 mb-1.5 max-w-60 space-y-1.5 border-b px-1.5 pt-0.5 pb-2">
      <Badge variant="neutral">
        {sourceKey ? (
          <SourceIcon source={sourceKey} label={label} />
        ) : (
          <Megaphone className="size-3" aria-hidden />
        )}
        {label}
      </Badge>
      {referral.headline && (
        <p className="text-xs font-medium">{referral.headline}</p>
      )}
      {referral.body && (
        <p className="text-chat-meta line-clamp-2 text-xs">{referral.body}</p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-text inline-flex items-center gap-1 text-xs hover:underline"
        >
          View source
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </div>
  );
}

/**
 * Small caps label that tags where a bubble came from — an approved
 * template send, or a quick-reply button the customer tapped.
 *
 * Deliberately unfilled. A translucent chip under the label lightens the
 * local background, and even now that the outbound bubble is a tint rather
 * than a solid accent fill, a second translucent layer on top of it has no
 * headroom left. Straight on the bubble both bubbles carry `--chat-meta`,
 * which is derived from the fill it sits on and therefore clears AA on every
 * accent in both modes. Size and caps carry the demotion, not colour.
 */
function BubbleMarker({
  icon: Icon,
  label,
  onOutbound,
}: {
  icon: typeof LayoutTemplate;
  label: string;
  onOutbound: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 pt-0.5 text-[11px] font-medium tracking-wide uppercase',
        onOutbound ? 'text-chat-meta-out' : 'text-chat-meta'
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/**
 * The image, video, or document a template's header delivered.
 *
 * The row keeps only the URL (`content_type` stays `template`), so the
 * kind is re-derived from it. The document case is a plain underlined
 * link rather than the filled row the document content-type uses: a
 * translucent box inside the outbound bubble drops its own label below
 * AA, the same trap the Template tag fell into.
 */
function TemplateHeaderMedia({ url }: { url: string }) {
  switch (templateHeaderMediaKind(url)) {
    case 'image':
      return <MediaImage url={url} alt="Template header image" />;
    case 'video':
      return (
        <video src={url} controls className="max-h-64 max-w-60 rounded-sm" />
      );
    case 'document':
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground mx-1.5 inline-flex max-w-60 items-center gap-2 text-sm underline underline-offset-2"
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{templateHeaderMediaLabel(url)}</span>
        </a>
      );
  }
}

/**
 * Restores the bubble's reading inset on text rows. The bubble itself pads by
 * only 4px so nested blocks stay concentric with its corner, so anything that
 * is plain type carries the remaining 6px / 2px itself.
 */
const BUBBLE_TEXT_INSET = 'px-1.5 py-0.5';

/**
 * A run of message text with the bubble metadata tucked into its last line.
 *
 * `meta` is rendered twice: once invisible and inline, so the final line wraps
 * short of it, and once positioned over the space that reservation opened up.
 * Anything that is not a bare paragraph (media, documents, locations) opts out
 * by passing `meta` as a following row instead — WhatsApp does the same, since
 * there is no text line for the timestamp to ride on.
 */
function TextWithMeta({
  text,
  meta,
  metaClassName,
}: {
  text: string;
  meta: React.ReactNode;
  metaClassName: string;
}) {
  return (
    <div className="relative">
      <p
        className={cn(
          'text-sm break-words whitespace-pre-wrap',
          BUBBLE_TEXT_INSET
        )}
      >
        {text}
        <span
          aria-hidden
          className={cn(
            'invisible ml-2 inline-flex items-center gap-1 align-baseline text-[11px] select-none',
            metaClassName
          )}
        >
          {meta}
        </span>
      </p>
      {/* Pinned to the text's own edge, not the wrapper's, so it lands exactly
          where the invisible spacer above reserved room for it. */}
      <span
        className={cn(
          'absolute right-1.5 bottom-0.5 flex items-center gap-1 text-[11px] leading-none',
          metaClassName
        )}
      >
        {meta}
      </span>
    </div>
  );
}

function MessageContent({
  message,
  onOutbound = false,
  meta,
  metaClassName,
}: {
  message: Message;
  /** True inside an outbound bubble — markers resolve against its tint. */
  onOutbound?: boolean;
  /** Timestamp + delivery state. See TextWithMeta for the two-render trick. */
  meta: React.ReactNode;
  metaClassName: string;
}) {
  // Everything that ends in a paragraph tucks the meta into that paragraph's
  // last line; everything else hands it back for a trailing row.
  const trailingMeta = (
    <span
      className={cn(
        'mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none',
        BUBBLE_TEXT_INSET,
        metaClassName
      )}
    >
      {meta}
    </span>
  );

  switch (message.content_type) {
    case 'text':
      return (
        <TextWithMeta
          text={message.content_text ?? ''}
          meta={meta}
          metaClassName={metaClassName}
        />
      );

    case 'image':
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text ? (
            <div className="mt-1">
              <TextWithMeta
                text={message.content_text}
                meta={meta}
                metaClassName={metaClassName}
              />
            </div>
          ) : (
            trailingMeta
          )}
        </div>
      );

    case 'video':
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-sm"
            />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text ? (
            <div className="mt-1">
              <TextWithMeta
                text={message.content_text}
                meta={meta}
                metaClassName={metaClassName}
              />
            </div>
          ) : (
            trailingMeta
          )}
        </div>
      );

    case 'audio':
      return (
        <div>
          {message.media_url ? (
            <audio
              src={message.media_url}
              controls
              className="mx-1.5 max-w-60"
            />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
          {trailingMeta}
        </div>
      );

    case 'document':
      if (!message.media_url) {
        return (
          <div>
            <MediaUnavailable label={message.content_text || 'Document'} />
            {trailingMeta}
          </div>
        );
      }
      return (
        <div>
          <a
            href={message.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-foreground/5 hover:bg-foreground/10 flex items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors"
          >
            <FileText className="text-chat-meta h-5 w-5 shrink-0" />
            <span className="truncate">
              {message.content_text || 'Document'}
            </span>
          </a>
          {trailingMeta}
        </div>
      );

    case 'template': {
      // The delivered body is persisted by every send path now (see
      // `renderTemplateMessageText`) — the bubble shows what the member
      // actually received, tagged as a template rather than replaced by
      // the tag. Rows written before that landed carry no text at all,
      // so they fall back to the template's own title; the bubble still
      // says which message went out.
      const fallbackTitle = message.template_name
        ? getTemplateSendPresentation({ name: message.template_name }, 0).title
        : null;
      const body = message.content_text || fallbackTitle;
      return (
        <div
          className={cn(
            'flex flex-col',
            message.media_url ? 'gap-1' : 'gap-0.5'
          )}
        >
          <BubbleMarker
            icon={LayoutTemplate}
            label="Template"
            onOutbound={onOutbound}
          />
          {message.media_url && <TemplateHeaderMedia url={message.media_url} />}
          {body ? (
            <TextWithMeta
              text={body}
              meta={meta}
              metaClassName={metaClassName}
            />
          ) : (
            trailingMeta
          )}
        </div>
      );
    }

    case 'location':
      return (
        <div>
          <div
            className={cn('flex items-center gap-2 text-sm', BUBBLE_TEXT_INSET)}
          >
            <MapPin className="text-chat-meta h-4 w-4 shrink-0" />
            <span>{message.content_text || 'Location shared'}</span>
          </div>
          {trailingMeta}
        </div>
      );

    case 'interactive': {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <BubbleMarker
            icon={CornerDownLeft}
            label="Button reply"
            onOutbound={onOutbound}
          />
          <TextWithMeta
            text={message.content_text || '[Interactive reply]'}
            meta={meta}
            metaClassName={metaClassName}
          />
        </div>
      );
    }

    default:
      return (
        <TextWithMeta
          text={message.content_text || '[Unsupported message type]'}
          meta={meta}
          metaClassName={metaClassName}
        />
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  startsRun = true,
}: MessageBubbleProps) {
  const { fmt } = useLocale();
  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';
  const time = fmt.time(new Date(message.created_at));
  const metaClassName = isAgent ? 'text-chat-meta-out' : 'text-chat-meta';

  const meta = (
    <BubbleMeta time={time} status={message.status} showStatus={isAgent} />
  );

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div className={cn('flex flex-col', isAgent ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          // Concentricity: the bubble pads by 4px, so a nested block (quote,
          // media, document row) sits 4px inside a 10px corner and is drawn at
          // `rounded-sm` — 6 + 4 = 10. Reading inset is restored by
          // BUBBLE_TEXT_INSET on the text rows rather than by the bubble, which
          // would otherwise push every nested block 10px in and break the pair.
          'text-foreground relative w-fit max-w-full rounded-lg p-1 shadow-[var(--chat-bubble-shadow)]',
          isAgent ? 'bg-chat-bubble-out' : 'bg-chat-bubble-in',
          // The tail replaces the corner it hangs off, so that corner squares
          // up and the wedge reads as one continuous shape with the bubble.
          startsRun && (isAgent ? 'rounded-tr-none' : 'rounded-tl-none')
        )}
      >
        {startsRun && <BubbleTail side={isAgent ? 'right' : 'left'} />}
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onOutbound={isAgent}
          />
        )}
        {message.referral && <ReferralContext referral={message.referral} />}
        <MessageContent
          message={message}
          onOutbound={isAgent}
          meta={meta}
          metaClassName={metaClassName}
        />
      </div>
      {isAgent && message.status === 'failed' && (
        <DeliveryFailureNote message={message} />
      )}
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
