import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dialog = readFileSync(
  join(process.cwd(), 'src/components/members/renew-membership-dialog.tsx'),
  'utf8'
);

describe('RenewMembershipDialog UI contract', () => {
  it('uses the conversion flow shell with a contained responsive task path', () => {
    expect(dialog).toContain('<DialogTitle size="lg">');
    expect(dialog).toContain('max-h-[96vh]');
    expect(dialog).toContain('overflow-hidden');
    expect(dialog).toContain('sm:max-w-[min(960px,calc(100vw-2rem))]');
    expect(dialog).toContain('md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]');
    expect(dialog).toContain('overflow-y-auto');
    expect(dialog).toContain(
      '<DialogFooter className="border-border m-0 shrink-0">'
    );
  });

  it('keeps member context and delegates the task path to the shared panel', () => {
    expect(dialog).toContain('Current membership');
    expect(dialog).toContain('<MembershipCheckoutPanel');
    expect(dialog).not.toContain('Fee for this term');
    expect(dialog).not.toContain('onValueChange={setFeeAmount}');
    expect(dialog).not.toContain('presentation="catalogue"');
  });

  it('keeps the renewal shell actions and lifecycle copy', () => {
    expect(dialog).toContain(
      "{isConvert ? 'Convert trial to member' : 'Renew membership'}"
    );
    expect(dialog).toContain('Trial converted to member');
    expect(dialog).toContain('Membership renewed');
    expect(dialog).toContain('Existing invoices stay due');
  });
});
