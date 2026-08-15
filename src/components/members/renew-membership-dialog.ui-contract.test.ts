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

  it('groups member context, membership details, add-ons, and payment in order', () => {
    expect(dialog).toContain('Current membership');
    expect(dialog).toContain('Membership details');
    expect(dialog).toContain('<ProductsServicesPicker');
    expect(dialog).toContain('Payment');
    expect(dialog.indexOf('Membership details')).toBeLessThan(
      dialog.indexOf('<ProductsServicesPicker')
    );
    expect(dialog.indexOf('<ProductsServicesPicker')).toBeLessThan(
      dialog.indexOf('\n                    Payment\n')
    );
  });

  it('uses shared accessible form primitives for renewal collection', () => {
    expect(dialog).toContain("from '@/components/ui/checkbox'");
    expect(dialog).toContain("from '@/components/ui/currency-input'");
    expect(dialog).toContain('<Checkbox');
    expect(dialog.match(/<CurrencyInput/g)).toHaveLength(2);
    expect(dialog).not.toMatch(/<input[\s\S]*?type=["']checkbox["']/);
    expect(dialog).toContain(
      "{isConvert ? 'Convert trial to member' : 'Renew membership'}"
    );
  });

  it('keeps products and services optional and reuses the Add Purchase catalogue', () => {
    expect(dialog).toContain('const [includeAddOns, setIncludeAddOns]');
    expect(dialog).toContain('id="rn-include-add-ons"');
    expect(dialog).toContain('checked={includeAddOns}');
    expect(dialog).toContain('Add products or services to this renewal');
    expect(dialog).toContain('presentation="catalogue"');
    expect(dialog).toContain('setSelections([])');
  });
});
