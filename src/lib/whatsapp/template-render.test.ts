import { describe, expect, it } from 'vitest';

import {
  renderTemplateBody,
  renderTemplateHeaderText,
  renderTemplateMessageText,
  resolveTemplateBodyParams,
  resolveTemplateHeaderMedia,
  templateHeaderMediaKind,
  templateHeaderMediaLabel,
} from './template-render';

describe('renderTemplateBody', () => {
  it('substitutes positional variables', () => {
    expect(
      renderTemplateBody('Hi {{1}}, your {{2}} expires on {{3}}.', [
        'Asha',
        'Gold plan',
        '30 Aug 2026',
      ])
    ).toBe('Hi Asha, your Gold plan expires on 30 Aug 2026.');
  });

  it('reuses a value wherever the same index repeats', () => {
    expect(renderTemplateBody('{{1}}, see you soon {{1}}!', ['Asha'])).toBe(
      'Asha, see you soon Asha!'
    );
  });

  it('leaves an unfilled placeholder verbatim rather than blanking it', () => {
    expect(renderTemplateBody('Hi {{1}}, pay {{2}}', ['Asha'])).toBe(
      'Hi Asha, pay {{2}}'
    );
  });

  it('returns a variable-free body unchanged', () => {
    expect(renderTemplateBody('The gym is closed on Sunday.')).toBe(
      'The gym is closed on Sunday.'
    );
  });
});

describe('resolveTemplateBodyParams', () => {
  it('prefers structured body params over the legacy positional array', () => {
    expect(
      resolveTemplateBodyParams({
        messageParams: { body: ['structured'] },
        params: ['positional'],
      })
    ).toEqual(['structured']);
  });

  it('falls back to positional params when no structured body is given', () => {
    expect(
      resolveTemplateBodyParams({
        messageParams: { headerText: 'Header' },
        params: ['positional'],
      })
    ).toEqual(['positional']);
  });

  it('ignores a malformed messageParams payload from an API caller', () => {
    expect(
      resolveTemplateBodyParams({ messageParams: 'nope', params: ['a'] })
    ).toEqual(['a']);
    expect(resolveTemplateBodyParams({})).toEqual([]);
  });

  it('coerces non-string values the way the Meta send builder does', () => {
    expect(
      resolveTemplateBodyParams({ messageParams: { body: [1200, null] } })
    ).toEqual(['1200', '']);
  });
});

describe('renderTemplateHeaderText', () => {
  it('fills a header variable from headerText', () => {
    expect(
      renderTemplateHeaderText(
        { header_type: 'text', header_content: '{{1}} renewal' },
        { messageParams: { headerText: 'Gold plan' } }
      )
    ).toBe('Gold plan renewal');
  });

  it('returns a static header unchanged', () => {
    expect(
      renderTemplateHeaderText(
        { header_type: 'text', header_content: 'Payment reminder' },
        {}
      )
    ).toBe('Payment reminder');
  });

  it('has no text to contribute for a media or absent header', () => {
    expect(
      renderTemplateHeaderText(
        { header_type: 'image', header_content: 'ignored' },
        {}
      )
    ).toBeNull();
    expect(renderTemplateHeaderText({}, {})).toBeNull();
    expect(renderTemplateHeaderText(null, {})).toBeNull();
  });
});

describe('resolveTemplateHeaderMedia', () => {
  it("uses the template's stored media URL and its kind", () => {
    expect(
      resolveTemplateHeaderMedia(
        { header_type: 'image', header_media_url: 'https://cdn/x/offer.png' },
        {}
      )
    ).toEqual({ url: 'https://cdn/x/offer.png', kind: 'image' });
  });

  it('prefers a per-send override, matching the Meta send builder', () => {
    expect(
      resolveTemplateHeaderMedia(
        { header_type: 'document', header_media_url: 'https://cdn/x/old.pdf' },
        { messageParams: { headerMediaUrl: 'https://cdn/x/new.pdf' } }
      )
    ).toEqual({ url: 'https://cdn/x/new.pdf', kind: 'document' });
  });

  it('resolves nothing for a text header or a media-id-only send', () => {
    expect(
      resolveTemplateHeaderMedia(
        { header_type: 'text', header_media_url: 'https://cdn/x/offer.png' },
        {}
      )
    ).toBeNull();
    expect(resolveTemplateHeaderMedia({ header_type: 'image' }, {})).toBeNull();
  });
});

describe('templateHeaderMediaKind', () => {
  it('classifies the extensions Meta accepts per header kind', () => {
    expect(templateHeaderMediaKind('https://cdn/x/offer.PNG')).toBe('image');
    expect(templateHeaderMediaKind('https://cdn/x/tour.mp4')).toBe('video');
    expect(templateHeaderMediaKind('https://cdn/x/invoice.pdf')).toBe(
      'document'
    );
  });

  it('ignores a query string and falls back to a link for anything else', () => {
    expect(templateHeaderMediaKind('https://cdn/x/offer.jpg?v=2')).toBe(
      'image'
    );
    expect(templateHeaderMediaKind('https://cdn/x/attachment')).toBe(
      'document'
    );
  });
});

describe('templateHeaderMediaLabel', () => {
  it('reads a human file name out of the URL', () => {
    expect(
      templateHeaderMediaLabel('https://cdn/x/August%20price%20list.pdf')
    ).toBe('August price list.pdf');
    expect(templateHeaderMediaLabel('https://cdn/')).toBe('Attachment');
  });
});

describe('renderTemplateMessageText', () => {
  it('renders the delivered body from a template row plus its params', () => {
    expect(
      renderTemplateMessageText(
        { body_text: 'Hi {{1}}, renew for {{2}}.' },
        { messageParams: { body: ['Asha', '₹2,000'] } }
      )
    ).toBe('Hi Asha, renew for ₹2,000.');
  });

  it('stacks a text header above the body the way WhatsApp delivers it', () => {
    expect(
      renderTemplateMessageText(
        {
          header_type: 'text',
          header_content: '{{1}} renewal',
          body_text: 'Hi {{1}}, renew for {{2}}.',
        },
        {
          messageParams: {
            headerText: 'Gold plan',
            body: ['Asha', '₹2,000'],
          },
        }
      )
    ).toBe('Gold plan renewal\n\nHi Asha, renew for ₹2,000.');
  });

  it('leaves a media header out of the text — it rides on media_url', () => {
    expect(
      renderTemplateMessageText(
        {
          header_type: 'image',
          header_media_url: 'https://cdn/x/offer.png',
          body_text: 'Renew today.',
        },
        {}
      )
    ).toBe('Renew today.');
  });

  it('returns null when the template row is missing or bodiless', () => {
    expect(renderTemplateMessageText(null, { params: ['Asha'] })).toBeNull();
    expect(renderTemplateMessageText({ body_text: '' }, {})).toBeNull();
  });
});
