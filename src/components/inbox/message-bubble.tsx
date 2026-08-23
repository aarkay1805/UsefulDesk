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
}

// Status ticks render INSIDE the outbound bg-primary bubble, so their
// colour must contrast with the accent fill — which varies per theme
// (white-text violet/cobalt/rose vs dark-text emerald/amber). Deriving
// from primary-foreground is the only recipe that works on all five;
// fixed grey/blue/red ticks fell below 3:1 on several accents. "Read"
// is full-strength vs the dimmed pending tier, and every state carries
// an aria-label so the meaning never rides on colour alone (WCAG 1.4.1).
function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return (
        <Clock
          aria-label="Sending"
          className="text-primary-foreground/70 h-3 w-3"
        />
      );
    case 'sent':
      return (
        <Check
          aria-label="Sent"
          className="text-primary-foreground/70 h-3 w-3"
        />
      );
    case 'delivered':
      return (
        <CheckCheck
          aria-label="Delivered"
          className="text-primary-foreground/70 h-3 w-3"
        />
      );
    case 'read':
      return (
        <CheckCheck
          aria-label="Read"
          className="text-primary-foreground h-3 w-3"
        />
      );
    case 'failed':
      return (
        <XCircle
          aria-label="Failed to send"
          className="text-primary-foreground h-3 w-3"
        />
      );
    default:
      return null;
  }
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
    <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
      <ImageOff className="text-muted-foreground h-4 w-4 shrink-0" />
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
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
        <ImageOff className="text-muted-foreground h-8 w-8" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-muted flex h-40 w-60 items-center justify-center rounded-lg">
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
      className="h-auto max-h-64 w-auto max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function ReferralContext({ referral }: { referral: MessageReferral }) {
  const label = referralDisplayLabel(referral);
  const href = referralSourceHref(referral);
  const sourceKey = referral.source_platform;

  return (
    <div className="border-border/50 mb-2 max-w-60 space-y-1.5 border-b pb-2">
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
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {referral.body}
        </p>
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
 * Deliberately unfilled. A translucent chip under the label lightens
 * the local background, and on the outbound bubble that dropped the
 * label to 3.7:1 (cobalt) and 3.9:1 (rose) — below AA for 10px text.
 * Straight on the bubble fill the same label measures 4.6–8.0:1 on
 * every accent, in both modes. Size and caps carry the demotion
 * instead of colour, so the tag never has to be dimmed to read as one.
 */
function BubbleMarker({
  icon: Icon,
  label,
  onPrimary,
}: {
  icon: typeof LayoutTemplate;
  label: string;
  onPrimary: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase',
        onPrimary ? 'text-primary-foreground' : 'text-muted-foreground'
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
function TemplateHeaderMedia({
  url,
  onPrimary,
}: {
  url: string;
  onPrimary: boolean;
}) {
  switch (templateHeaderMediaKind(url)) {
    case 'image':
      return <MediaImage url={url} alt="Template header image" />;
    case 'video':
      return (
        <video src={url} controls className="max-h-64 max-w-60 rounded-lg" />
      );
    case 'document':
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex max-w-60 items-center gap-2 text-sm underline underline-offset-2',
            onPrimary ? 'text-primary-foreground' : 'text-foreground'
          )}
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{templateHeaderMediaLabel(url)}</span>
        </a>
      );
  }
}

function MessageContent({
  message,
  onPrimary = false,
}: {
  message: Message;
  /** True inside an outbound (primary-filled) bubble — markers must read
   *  against the accent fill rather than the neutral page foreground. */
  onPrimary?: boolean;
}) {
  switch (message.content_type) {
    case 'text':
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content_text}
        </p>
      );

    case 'image':
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              {message.content_text}
            </p>
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
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case 'audio':
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case 'document':
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || 'Document'} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-muted/50 hover:bg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
        >
          <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
          <span className="truncate">{message.content_text || 'Document'}</span>
        </a>
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
            onPrimary={onPrimary}
          />
          {message.media_url && (
            <TemplateHeaderMedia
              url={message.media_url}
              onPrimary={onPrimary}
            />
          )}
          {message.content_text ? (
            <p className="text-sm break-words whitespace-pre-wrap">
              {message.content_text}
            </p>
          ) : (
            fallbackTitle && (
              <p
                className={cn(
                  'text-sm break-words',
                  onPrimary
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {fallbackTitle}
              </p>
            )
          )}
        </div>
      );
    }

    case 'location':
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
          <span>{message.content_text || 'Location shared'}</span>
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
            onPrimary={onPrimary}
          />
          <p className="text-sm break-words whitespace-pre-wrap">
            {message.content_text || '[Interactive reply]'}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content_text || '[Unsupported message type]'}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const { fmt } = useLocale();
  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';
  const time = fmt.time(new Date(message.created_at));

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div className={cn('flex flex-col', isAgent ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'relative rounded-2xl px-3 py-2',
          isAgent
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted text-foreground rounded-bl-md'
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        {message.referral && <ReferralContext referral={message.referral} />}
        <MessageContent message={message} onPrimary={isAgent} />
        <div
          className={cn(
            'mt-1 flex items-center gap-1',
            isAgent ? 'justify-end' : 'justify-start'
          )}
        >
          <span
            className={cn(
              'text-[10px]',
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
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
