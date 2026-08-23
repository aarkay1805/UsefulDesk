import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('contact detail action contract', () => {
  it('keeps WhatsApp consent out of lead profiles while retaining member audit access', () => {
    const contactDetail = read(
      'src/components/contacts/contact-detail-content.tsx'
    );
    const memberSettings = read(
      'src/components/members/member-danger-zone.tsx'
    );

    expect(contactDetail).not.toContain('WhatsAppConsentControl');
    expect(contactDetail).not.toContain('WhatsApp consent');
    expect(memberSettings).toContain('WhatsAppConsentControl');
  });
});
