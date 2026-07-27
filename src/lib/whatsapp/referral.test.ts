import { describe, expect, it } from 'vitest';

import {
  classifyReferralPlatform,
  contactSourceFromReferral,
  parseWhatsAppReferral,
  referralDisplayLabel,
  referralSourceHref,
} from './referral';

const instagramAdFixture = {
  source_url: 'https://www.instagram.com/p/UsefulDeskAd/',
  source_id: '23851234567890123',
  source_type: 'ad',
  headline: 'Join our strength programme',
  body: 'Message us to book a trial.',
  media_type: 'image',
  image_url: 'https://scontent.cdninstagram.com/example.jpg',
  ctwa_clid: 'ARExampleClickId',
};

describe('parseWhatsAppReferral', () => {
  it('preserves the documented Instagram referral fields', () => {
    const referral = parseWhatsAppReferral(instagramAdFixture);

    expect(referral).toEqual({
      source_url: 'https://www.instagram.com/p/UsefulDeskAd/',
      source_id: '23851234567890123',
      source_type: 'ad',
      headline: 'Join our strength programme',
      body: 'Message us to book a trial.',
      media_type: 'image',
      image_url: 'https://scontent.cdninstagram.com/example.jpg',
      video_url: null,
      thumbnail_url: null,
      ctwa_clid: 'ARExampleClickId',
      source_platform: 'instagram',
    });
    expect(contactSourceFromReferral(referral)).toBe('instagram');
    expect(referralDisplayLabel(referral!)).toBe('Instagram ad');
    expect(referralSourceHref(referral!)).toBe(
      'https://www.instagram.com/p/UsefulDeskAd/'
    );
  });

  it('classifies a trusted Facebook URL independently of source_type', () => {
    const referral = parseWhatsAppReferral({
      source_url: 'https://m.facebook.com/story.php?story_fbid=123',
      source_type: 'post',
      source_id: '123',
    });

    expect(referral?.source_platform).toBe('facebook');
    expect(contactSourceFromReferral(referral)).toBe('facebook');
    expect(referralDisplayLabel(referral!)).toBe('Facebook post');
  });

  it('keeps a Meta ad platform-neutral when the source URL is unavailable', () => {
    const referral = parseWhatsAppReferral({
      source_type: 'ad',
      source_id: '123',
      headline: 'A real referral with no retained URL',
    });

    expect(referral?.source_platform).toBeNull();
    expect(contactSourceFromReferral(referral)).toBeNull();
    expect(referralDisplayLabel(referral!)).toBe('Meta ad');
  });

  it('does not trust an Instagram-looking path or username on another host', () => {
    expect(
      classifyReferralPlatform('https://instagram.com.attacker.example/path')
    ).toBeNull();
    expect(
      classifyReferralPlatform(
        'https://example.com/redirect?next=instagram.com'
      )
    ).toBeNull();
    expect(
      classifyReferralPlatform('https://instagram.com@example.com/path')
    ).toBeNull();
  });

  it('drops unsafe URLs and unsupported scalar values without discarding valid context', () => {
    const referral = parseWhatsAppReferral({
      source_url: 'javascript:alert(1)',
      source_type: 'sponsored_story',
      source_id: 123,
      headline: '  Trial offer  ',
      image_url: 'http://example.com/not-https.jpg',
      unknown_future_field: { nested: true },
    });

    expect(referral).toEqual({
      source_url: null,
      source_id: null,
      source_type: null,
      headline: 'Trial offer',
      body: null,
      media_type: null,
      image_url: null,
      video_url: null,
      thumbnail_url: null,
      ctwa_clid: null,
      source_platform: null,
    });
  });

  it('returns null for absent or unusable referral payloads', () => {
    expect(parseWhatsAppReferral(undefined)).toBeNull();
    expect(parseWhatsAppReferral([])).toBeNull();
    expect(parseWhatsAppReferral({ source_type: 'unknown' })).toBeNull();
  });

  it('refuses an unsafe stored source link at render time', () => {
    expect(
      referralSourceHref({
        ...parseWhatsAppReferral(instagramAdFixture)!,
        source_url: 'javascript:alert(1)',
      })
    ).toBeNull();
  });
});
