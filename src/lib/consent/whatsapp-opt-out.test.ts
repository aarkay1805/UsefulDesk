import { describe, expect, it } from 'vitest';
import { isWhatsAppOptOut } from './whatsapp-opt-out';

describe('isWhatsAppOptOut', () => {
  it.each(['STOP', ' stop ', 'Unsubscribe', 'CANCEL', 'end', 'Quit'])(
    'accepts the standalone command %s',
    (text) => {
      expect(isWhatsAppOptOut(text)).toBe(true);
    }
  );

  it.each([
    '',
    'please stop messaging',
    'my membership ends Friday',
    'restart',
    null,
    undefined,
  ])('does not substring-match normal conversation text', (text) => {
    expect(isWhatsAppOptOut(text)).toBe(false);
  });
});
