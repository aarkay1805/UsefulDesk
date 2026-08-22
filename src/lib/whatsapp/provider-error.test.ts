import { describe, expect, it } from 'vitest';

import { splitProviderDetail } from './provider-error';

describe('splitProviderDetail', () => {
  it('returns prose without a URL as one text segment', () => {
    expect(
      splitProviderDetail(
        'Message failed to send because of a problem with the payment method.'
      )
    ).toEqual([
      {
        kind: 'text',
        value:
          'Message failed to send because of a problem with the payment method.',
      },
    ]);
  });

  it('labels an embedded Business Manager URL by hostname and keeps the sentence', () => {
    const detail =
      'Message failed to send because your WhatsApp Business account currency is not configured. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=2067632370500278&asset_id=2136600423937923&wizard_name=CHANGE_CURRENCY to resolve this issue.';

    expect(splitProviderDetail(detail)).toEqual([
      {
        kind: 'text',
        value:
          'Message failed to send because your WhatsApp Business account currency is not configured. Visit ',
      },
      {
        kind: 'link',
        href: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=2067632370500278&asset_id=2136600423937923&wizard_name=CHANGE_CURRENCY',
        label: 'business.facebook.com',
      },
      { kind: 'text', value: ' to resolve this issue.' },
    ]);
  });

  it('leaves the sentence-ending period outside the href', () => {
    const [, link, tail] = splitProviderDetail(
      'See https://developers.facebook.com/docs/whatsapp/cloud-api/.'
    );

    expect(link).toEqual({
      kind: 'link',
      href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/',
      label: 'developers.facebook.com',
    });
    expect(tail).toEqual({ kind: 'text', value: '.' });
  });

  it('strips a www prefix from the visible label', () => {
    expect(
      splitProviderDetail('Go to https://www.example.com/help now')
    ).toEqual([
      { kind: 'text', value: 'Go to ' },
      {
        kind: 'link',
        href: 'https://www.example.com/help',
        label: 'example.com',
      },
      { kind: 'text', value: ' now' },
    ]);
  });

  it('does not linkify a non-http scheme smuggled into the prose', () => {
    const detail = 'Open javascript:alert(1) to continue';

    expect(splitProviderDetail(detail)).toEqual([
      { kind: 'text', value: detail },
    ]);
  });

  it('splits every URL in a multi-link detail', () => {
    const segments = splitProviderDetail(
      'Check https://a.example.com and https://b.example.com today'
    );

    expect(segments.filter((s) => s.kind === 'link')).toEqual([
      { kind: 'link', href: 'https://a.example.com', label: 'a.example.com' },
      { kind: 'link', href: 'https://b.example.com', label: 'b.example.com' },
    ]);
  });
});
