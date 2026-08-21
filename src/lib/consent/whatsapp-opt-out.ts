const WHATSAPP_OPT_OUT_KEYWORDS = new Set([
  'stop',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
]);

/**
 * Exact, standalone WhatsApp opt-out commands. Do not substring-match normal
 * conversation text ("my membership ends Friday") into a legal suppression.
 */
export function isWhatsAppOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  return WHATSAPP_OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}

/**
 * Only plain text and Meta's normalized template quick-reply envelope may
 * carry a STOP-family command. Media captions and generic interactive Flow
 * choices are conversation content, not organization suppression controls.
 */
export function whatsappOptOutText(
  messageType: string,
  contentText: string | null | undefined
): string | null {
  if (messageType !== 'text' && messageType !== 'button') return null;
  return isWhatsAppOptOut(contentText) ? (contentText ?? null) : null;
}
