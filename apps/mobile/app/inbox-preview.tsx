import { useState } from 'react';
import { Redirect, Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { accountFormatters } from '../src/core/account-formatters';
import {
  FilterMenu,
  ScreenSafeAreaView,
  SearchField,
  Text,
  type FilterMenuOption,
} from '../src/ui';
import { Notice } from '../src/ui/notice';
import { ClosedWindowBar } from '../src/features/inbox/components/closed-window-bar';
import { ConversationRow } from '../src/features/inbox/components/conversation-row';
import { MessageBubble } from '../src/features/inbox/components/message-bubble';
import {
  buildThreadItems,
  conversationTimestamp,
  threadDateLabel,
} from '../src/features/inbox/inbox-format';
import type {
  InboxConversation,
  InboxMessage,
  MessageStatus,
} from '../src/features/inbox/inbox-types';
import type { AccountSummary } from '../src/features/auth/branch-types';

// Dev-only visual harness for the inbox row timestamp, the thread date
// separators, and the drawn delivery ticks. The real screens live behind
// auth and need a live WhatsApp connection, so this renders the same
// components against fixed rows spanning today, yesterday, this week, and
// months back — the spread that proves the calendar ladder actually walks.
// Returns null outside development, so it is never reachable in a release.

const ACCOUNT = {
  id: 'preview-account',
  name: 'Iron House Gym',
  country_code: 'IN',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  date_order: 'DMY',
  time_format: '12h',
  week_start: 1,
  phone_country_code: '+91',
  measurement_system: 'metric',
  default_currency: 'INR',
} as unknown as AccountSummary;

const DAY = 86_400_000;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

function row(
  id: string,
  name: string,
  lastMessageText: string,
  lastMessageAt: string,
  unreadCount: number
): InboxConversation {
  return {
    id,
    accountId: 'preview-account',
    contactId: id,
    status: 'open',
    assignedAgentId: null,
    lastMessageText,
    lastMessageAt,
    unreadCount,
    createdAt: lastMessageAt,
    updatedAt: lastMessageAt,
    contact: { id, name, phone: '9876543210', avatarUrl: null },
    isMember: true,
  };
}

const ROWS: InboxConversation[] = [
  row(
    'r1',
    'Asha Rao',
    'Renewing today, sending the UPI now',
    ago(2 * 3600_000),
    3
  ),
  row(
    'r2',
    'Vikram Shetty',
    'Can I freeze my plan for a month?',
    ago(9 * 3600_000),
    0
  ),
  row(
    'r3',
    'Meera Iyer',
    'Thanks, see you at the 6am batch',
    ago(1.2 * DAY),
    1
  ),
  row('r4', 'Rohit Nair', 'Photo', ago(3 * DAY), 0),
  row(
    'r5',
    'Sana Qureshi',
    'Please share the quarterly price',
    ago(5 * DAY),
    12
  ),
  row('r6', 'Dev Patel', 'Membership expired last month', ago(26 * DAY), 0),
  row('r7', 'Priya Menon', 'No messages yet', ago(200 * DAY), 0),
];

function msg(
  id: string,
  senderType: InboxMessage['senderType'],
  contentText: string,
  createdAt: string,
  status: MessageStatus
): InboxMessage {
  return {
    id,
    conversationId: 'preview',
    senderType,
    senderId: null,
    contentType: 'text',
    contentText,
    mediaUrl: null,
    templateName: null,
    providerMessageId: 'wamid.PREVIEW',
    status,
    providerErrorTitle: null,
    createdAt,
    replyToMessageId: null,
    interactiveReplyId: null,
  };
}

const THREAD: InboxMessage[] = [
  msg(
    'm1',
    'customer',
    'Hi, is the quarterly plan still ₹3,999?',
    ago(9 * DAY),
    'read'
  ),
  msg(
    'm2',
    'agent',
    'Yes it is — shall I send the payment link?',
    ago(9 * DAY - 60_000),
    'read'
  ),
  msg('m3', 'customer', 'Please do', ago(4 * DAY), 'read'),
  msg(
    'm4',
    'agent',
    'Sent. Let me know once it goes through.',
    ago(4 * DAY - 60_000),
    'delivered'
  ),
  msg('m5', 'customer', 'Done, paid just now', ago(1 * DAY), 'read'),
  msg(
    'm6',
    'agent',
    'Perfect, your plan is active till 4 Dec.',
    ago(1 * DAY - 60_000),
    'sent'
  ),
  msg(
    'm7',
    'agent',
    'See you at the 6am batch tomorrow.',
    ago(2 * 3600_000),
    'read'
  ),
  msg('m8', 'agent', 'Sending now…', ago(60_000), 'sending'),
];

function Label({ children }: { children: string }) {
  return (
    <Text className="text-muted px-4 pt-6 pb-2 text-xs font-semibold uppercase">
      {children}
    </Text>
  );
}

const FILTERS: readonly FilterMenuOption<'all' | 'unread'>[] = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread', count: '16' },
];

export default function InboxPreview() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  if (!__DEV__) return <Redirect href="/" />;

  const fmt = accountFormatters(ACCOUNT);
  const items = buildThreadItems(THREAD, (value) =>
    threadDateLabel(value, fmt)
  );

  return (
    <ScreenSafeAreaView className="bg-inbox-chrome" edges={['top']}>
      <Stack.Screen options={{ headerShown: false, title: 'Inbox preview' }} />
      <ScreenSafeAreaView className="bg-inbox-panel flex-1" edges={['bottom']}>
        <ScrollView className="bg-inbox-panel flex-1">
          {/* On the chrome, as the real screen now places it. */}
          <View className="bg-inbox-chrome pb-4">
            <Label>Search and filter</Label>
            <View className="px-4">
              <SearchField
                accessibilityLabel="Search conversations"
                onValueChange={setSearch}
                placeholder="Search conversations"
                trailingAccessory={
                  <FilterMenu
                    accessibilityLabel="Conversation filter"
                    onValueChange={(next) => setFilter(next)}
                    options={FILTERS}
                    value={filter}
                  />
                }
                value={search}
              />
            </View>
          </View>

          <Label>Conversation rows</Label>
          {ROWS.map((conversation) => (
            <ConversationRow
              conversation={conversation}
              formattedPhone={fmt.phone(conversation.contact.phone)}
              formattedTime={
                conversation.lastMessageAt
                  ? conversationTimestamp(conversation.lastMessageAt, fmt)
                  : ''
              }
              key={conversation.id}
              onPress={() => {}}
            />
          ))}

          <Label>Thread separators and delivery ticks</Label>
          <View className="px-3 pb-10">
            {items.map((item) =>
              item.kind === 'date' ? (
                <View className="items-center px-3 py-3" key={item.key}>
                  <Text className="text-chat-meta text-xs font-medium">
                    {item.label}
                  </Text>
                </View>
              ) : (
                <MessageBubble
                  formattedTime={fmt.time(item.message.createdAt)}
                  key={item.key}
                  message={item.message}
                  startsRun={item.startsRun}
                />
              )
            )}
          </View>

          {/*
           * The bottom bar a closed session gets in place of the composer.
           * Unreachable in the real screen without a conversation whose last
           * inbound message is over 24 hours old, which is why it lives here.
           */}
          <Label>Closed reply window</Label>
          <ClosedWindowBar onOpenTemplates={() => {}} />

          {/*
           * The `Notice` emphasis axis, which is the choice a call site
           * actually has to get right: a fault wears the fill, a condition
           * that is merely true right now wears the hairline.
           */}
          <Label>Notice — fault vs state</Label>
          <View className="gap-2 px-3 pb-10">
            <Notice symbol="exclamationmark.triangle" title="Live updates unavailable">
              Pull to refresh while the connection recovers.
            </Notice>
            <Notice loading>Checking template send safety…</Notice>
            <Notice symbol="exclamationmark.triangle" title="Could not send" tone="danger">
              The send request did not complete.
            </Notice>
            <Notice emphasis="outline" symbol="clock" title="Reply window closed">
              WhatsApp allows only an approved template until they reply again.
            </Notice>
            <Notice emphasis="outline" symbol="exclamationmark.triangle" title="Attachment discarded" tone="danger">
              The upload was cancelled before it finished.
            </Notice>
          </View>
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenSafeAreaView>
  );
}
