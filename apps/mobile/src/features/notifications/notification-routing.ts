export interface PushDestination {
  version: 1;
  accountId: string;
  conversationId: string;
  messageId: string;
  deliveryId: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = [
  'accountId',
  'conversationId',
  'deliveryId',
  'messageId',
  'version',
];

export function parsePushDestination(data: unknown): PushDestination | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }
  const row = data as Record<string, unknown>;
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(KEYS)) {
    return null;
  }
  if (
    row.version !== 1 ||
    typeof row.accountId !== 'string' ||
    typeof row.conversationId !== 'string' ||
    typeof row.messageId !== 'string' ||
    typeof row.deliveryId !== 'string' ||
    !UUID.test(row.accountId) ||
    !UUID.test(row.conversationId) ||
    !UUID.test(row.messageId) ||
    !UUID.test(row.deliveryId)
  ) {
    return null;
  }
  return {
    version: 1,
    accountId: row.accountId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    deliveryId: row.deliveryId,
  };
}

export function destinationFromNotificationResponse(
  response: unknown
): PushDestination | null {
  if (typeof response !== 'object' || response === null) return null;
  const notification = (response as Record<string, unknown>).notification;
  if (typeof notification !== 'object' || notification === null) return null;
  const request = (notification as Record<string, unknown>).request;
  if (typeof request !== 'object' || request === null) return null;
  const content = (request as Record<string, unknown>).content;
  if (typeof content !== 'object' || content === null) return null;
  return parsePushDestination((content as Record<string, unknown>).data);
}
