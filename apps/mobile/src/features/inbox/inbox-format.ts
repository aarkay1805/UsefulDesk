import { todayInTz } from '../../../../../src/lib/locale/format';
import type { LocaleFormatters } from '../../../../../src/lib/locale/format';

import type {
  ContentType,
  InboxMessage,
  ThreadDisplayItem,
} from './inbox-types';

const PLAIN_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How far back a timestamp falls, counted in the account's own calendar
 * days rather than in elapsed hours. A message sent at 11:50pm is
 * "yesterday" at 12:10am — six hours earlier it was "today" — and no
 * amount of hour arithmetic gets that right. Every chat client the gym's
 * staff already use (WhatsApp, Google Messages, iMessage) reads the
 * calendar, so this does too.
 */
export type CalendarProximity = 'today' | 'yesterday' | 'week' | 'older';

/** Exact day gap between two 'YYYY-MM-DD' days read in the same zone. */
function daysBetween(from: string, to: string): number | null {
  const a = PLAIN_DAY.exec(from);
  const b = PLAIN_DAY.exec(to);
  if (!a || !b) return null;
  // Both anchored at UTC midnight, so the subtraction can never pick up a
  // DST hour — the two days were already resolved in the account's zone.
  const fromMs = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const toMs = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function calendarProximity(
  value: string,
  timeZone: string,
  now: Date = new Date()
): CalendarProximity {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'older';
  const gap = daysBetween(todayInTz(timeZone, at), todayInTz(timeZone, now));
  if (gap === null || gap < 0) return 'older';
  if (gap === 0) return 'today';
  if (gap === 1) return 'yesterday';
  // Six days keeps every weekday name unambiguous: at seven, "Tuesday"
  // could mean either of two Tuesdays, and the label starts lying.
  return gap <= 6 ? 'week' : 'older';
}

/**
 * The timestamp on a conversation row.
 *
 * The row used to print `fmt.time` unconditionally, so a chat from three
 * weeks ago read "9:42 pm" — indistinguishable from one sent ten minutes
 * ago in a list whose whole ordering is recency. Time today, then the day
 * name, then a date: the ladder LINE, WhatsApp, Google Messages, and
 * iMessage all use.
 */
export function conversationTimestamp(
  value: string,
  fmt: LocaleFormatters,
  now: Date = new Date()
): string {
  switch (calendarProximity(value, fmt.config.timeZone, now)) {
    case 'today':
      return fmt.time(value);
    case 'yesterday':
      return 'Yesterday';
    case 'week':
      return fmt.weekday(value);
    case 'older':
      return fmt.dateShort(value);
  }
}

/**
 * The sticky date separator inside a thread. Same ladder as the row, but
 * the two recent days are named outright — a separator is read as a
 * heading, and "Today" is what a heading for today says.
 */
export function threadDateLabel(
  value: string,
  fmt: LocaleFormatters,
  now: Date = new Date()
): string {
  switch (calendarProximity(value, fmt.config.timeZone, now)) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'week':
      return fmt.weekday(value);
    case 'older':
      return fmt.date(value);
  }
}

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
