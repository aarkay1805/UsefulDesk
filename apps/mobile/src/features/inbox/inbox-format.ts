import type {
  ContentType,
  InboxMessage,
  ThreadDisplayItem,
} from './inbox-types';
export const RUN_BREAK_MS = 10 * 60 * 1000;
export function startsNewRun(
  previous: Pick<InboxMessage, 'senderType' | 'createdAt'> | null,
  current: Pick<InboxMessage, 'senderType' | 'createdAt'>
): boolean {
  if (!previous || previous.senderType !== current.senderType) return true;
  return (
    new Date(current.createdAt).getTime() -
      new Date(previous.createdAt).getTime() >=
    RUN_BREAK_MS
  );
}
export function safeMediaUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
export function buildThreadItems(
  messages: InboxMessage[],
  formatDate: (value: string) => string
): ThreadDisplayItem[] {
  const items: ThreadDisplayItem[] = [];
  let previous: InboxMessage | null = null;
  let previousDate: string | null = null;
  for (const current of messages) {
    const date = formatDate(current.createdAt);
    const beginsDate = date !== previousDate;
    if (beginsDate)
      items.push({ kind: 'date', key: `date:${date}`, label: date });
    items.push({
      kind: 'message',
      key: current.id,
      message: current,
      startsRun: beginsDate || startsNewRun(previous, current),
    });
    previous = current;
    previousDate = date;
  }
  return items;
}
export function messagePreview(
  message: Pick<InboxMessage, 'contentType' | 'contentText'>
): string {
  if (message.contentText?.trim()) return message.contentText.trim();
  const labels: Record<ContentType, string> = {
    text: 'Message',
    image: 'Photo',
    document: 'Document',
    audio: 'Audio',
    video: 'Video',
    location: 'Location',
    template: 'Template message',
    interactive: 'Button reply',
  };
  return labels[message.contentType];
}
