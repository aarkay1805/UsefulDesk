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
const membersTableSource = readFileSync(
  join(process.cwd(), 'src/components/members/members-table.tsx'),
  'utf8'
);

const quickViewSource = membersTableSource.match(
  /function MemberAvatarQuickView\(([\s\S]*?)\n}\n\nfunction filtersForQuickMemberCount/
)?.[1];

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
    expect(quickViewSource).toBeDefined();
    expect(quickViewSource).toContain('className="size-36"');
    expect(quickViewSource).toContain('Details');
    expect(quickViewSource).toContain('<SendReminderButton');
    expect(quickViewSource).toContain('<FollowUpButton');
    expect(quickViewSource).not.toContain('fetch(');
    expect(quickViewSource).not.toContain('createClient');
    expect(membersTableSource).toContain(
      'branchHref(`/members?view=all&member=${m.id}`, accountId)'
    );
  });
});
