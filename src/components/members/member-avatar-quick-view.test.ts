import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const previewCardSource = readFileSync(
  join(process.cwd(), 'src/components/ui/preview-card.tsx'),
  'utf8'
);
const memberIdentitySource = readFileSync(
  join(process.cwd(), 'src/components/members/member-identity.tsx'),
  'utf8'
);
const quickViewSource = readFileSync(
  join(
    process.cwd(),
    'src/components/members/member-avatar-quick-view.tsx'
  ),
  'utf8'
);
const memberViewSources = [
  ['renewals', 'renewal-action-lists.tsx'],
  ['followups', 'follow-up-lists.tsx'],
  ['trials', 'trial-action-lists.tsx'],
  ['payments', 'payments-table.tsx'],
  ['retention', 'inactive-action-lists.tsx'],
  ['all', 'members-table.tsx'],
  ['attendance', 'attendance-view.tsx'],
] as const;

describe('member avatar quick view', () => {
  it('opens quickly and leaves enough time to move into the card', () => {
    expect(previewCardSource).toContain('delay = 80');
    expect(previewCardSource).toContain('closeDelay = 150');
  });

  it('anchors the preview only to the canonical member avatar', () => {
    expect(memberIdentitySource).toContain('<PreviewCardTrigger');
    expect(memberIdentitySource).toContain(
      'aria-label={`Quick view for ${display}`}'
    );
    expect(memberIdentitySource).toContain(
      '<UserAvatar name={display} src={src} size={size} />'
    );
  });

  it('uses loaded row data for the large photo and direct actions', () => {
    expect(quickViewSource).toContain('className="size-36"');
    expect(quickViewSource).toContain('Details');
    expect(quickViewSource).toContain('<SendReminderButton');
    expect(quickViewSource).toContain('<FollowUpButton');
    expect(quickViewSource).not.toContain('fetch(');
    expect(quickViewSource).not.toContain('createClient');
  });

  it.each(memberViewSources)(
    'is wired into the %s members view',
    (view, file) => {
      const source = readFileSync(
        join(process.cwd(), 'src/components/members', file),
        'utf8'
      );
      expect(source).toContain('buildMemberAvatarPreview({');
      expect(source).toMatch(new RegExp(`view: ["']${view}["']`));
    }
  );

  it('loads at-risk avatars with the list instead of on hover', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/components/members/inactive-action-lists.tsx'
      ),
      'utf8'
    );
    expect(source).toContain(".select('id, avatar_url')");
    expect(source).toContain('contact_avatar_url');
  });
});
