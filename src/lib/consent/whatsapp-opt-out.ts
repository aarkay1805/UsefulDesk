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
