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

  it('offers one WhatsApp Chat action that resolves and opens the conversation', () => {
    const contactDetail = read(
      'src/components/contacts/contact-detail-content.tsx'
    );

    expect(contactDetail).toContain('icon={WhatsAppMark}');
    expect(contactDetail).toContain('label="Chat"');
    expect(contactDetail).toContain('resolveContactConversation(');
    expect(contactDetail).toContain('branchHref(`/inbox?c=${conversationId}`');
    expect(contactDetail).not.toContain("'template' | 'chat'");
    expect(contactDetail).not.toContain('<TemplatePicker');
  });

  it('keeps Company out of every lead-management surface', () => {
    const surfaces = [
      'src/components/contacts/contact-detail-content.tsx',
      'src/components/contacts/contact-form.tsx',
      'src/app/(dashboard)/leads/page.tsx',
      'src/components/leads/leads-board.tsx',
      'src/components/leads/import-preview-grid.tsx',
      'src/components/inbox/conversation-list.tsx',
    ];

    for (const surface of surfaces) {
      expect(read(surface), surface).not.toMatch(/\bcompany\b/i);
    }
  });
});
