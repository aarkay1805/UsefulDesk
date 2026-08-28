import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(
  join(process.cwd(), 'src/hooks/use-table-prefs.ts'),
  'utf8'
);
const leadsPage = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/leads/page.tsx'),
  'utf8'
);

describe('table preference hydration readiness', () => {
  it('identifies readiness by the exact account/user/view cache scope', () => {
    expect(hook).toContain('const [readyScope, setReadyScope]');
    expect(hook).toContain('setReadyScope(cacheKey)');
    expect(hook).toContain('cacheKey !== null && readyScope === cacheKey');
    expect(hook.indexOf('setReadyScope(cacheKey)')).toBeGreaterThan(
      hook.indexOf('.maybeSingle()')
    );
  });

  it('gates the first lead listing read on preferences and custom metadata', () => {
    expect(leadsPage).toContain(
      'const [prefs, setPrefs, prefsReady] = useTablePrefs<TablePrefs>('
    );
    expect(leadsPage).toContain(
      'if (!listingInput || !prefsReady || !customFieldsReady) return;'
    );
    expect(leadsPage).toContain('customFieldsScope === accountId');
  });

  it('derives page zero during render instead of fetching then resetting in an effect', () => {
    expect(leadsPage).toContain(
      'const requestPage = pageForLeadListingScope(pageScope, listingScope, page);'
    );
    expect(leadsPage).toContain('if (pageScope !== listingScope) {');
    expect(leadsPage).toContain("page: mode === 'board' ? 0 : requestPage");
    expect(leadsPage).not.toMatch(
      /useEffect\(\(\) => \{\s*setPage\(0\);\s*\}, \[search, filters/
    );
  });

  it('hides rows hydrated for a superseded account/filter/page request key', () => {
    expect(leadsPage).toContain('const [listingDataKey, setListingDataKey]');
    expect(leadsPage).toContain(
      'setListingDataKey(leadListingRequestKey(listingInput))'
    );
    expect(leadsPage).toContain('listingDataKey === activeListingKey');
    expect(leadsPage).toContain('!listingDataReady || loading');
  });

  it('cancels database work on a real unmount without breaking strict replay sharing', () => {
    expect(leadsPage).toContain('const run = ++listingEffectRun.current;');
    expect(leadsPage).toContain('queueMicrotask(() => {');
    expect(leadsPage).toContain('listingEffectRun.current === run');
    expect(leadsPage).toContain('listingCoordinatorRef.current?.abort()');
  });

  it('keeps unrelated staff and tag metadata out of listing dependencies', () => {
    const listingBlock = leadsPage.slice(
      leadsPage.indexOf('const fetchListing = useCallback'),
      leadsPage.indexOf('/** Refresh whichever views hold data')
    );
    const dependencyBlock = listingBlock.slice(
      listingBlock.lastIndexOf('}, [')
    );
    expect(dependencyBlock).not.toContain('staff');
    expect(dependencyBlock).not.toContain('nameById');
    expect(dependencyBlock).not.toContain('tagsMap');
    expect(dependencyBlock).not.toMatch(/\bcustomFields,/);
  });
});
