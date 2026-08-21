import { describe, expect, it } from 'vitest';
import { isWhatsAppOptOut, whatsappOptOutText } from './whatsapp-opt-out';

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

describe('whatsappOptOutText', () => {
  it('accepts standalone text and normalized template-button replies', () => {
    expect(whatsappOptOutText('text', ' STOP ')).toBe(' STOP ');
    expect(whatsappOptOutText('button', 'Unsubscribe')).toBe('Unsubscribe');
  });

  it('does not treat media captions or arbitrary interactive replies as opt-outs', () => {
    expect(whatsappOptOutText('image', 'STOP')).toBeNull();
    expect(whatsappOptOutText('interactive', 'Unsubscribe')).toBeNull();
    expect(whatsappOptOutText('button', 'Renew membership')).toBeNull();
  });
});
