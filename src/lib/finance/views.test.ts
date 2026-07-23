import { describe, expect, it } from 'vitest';

import {
  financeHref,
  parseFinanceCollectionView,
  parseFinanceView,
} from './views';

describe('finance views', () => {
  it('accepts known views and falls back to the overview', () => {
    expect(parseFinanceView('collections')).toBe('collections');
    expect(parseFinanceView('overview')).toBe('overview');
    expect(parseFinanceView('expenses')).toBe('overview');
    expect(parseFinanceView(undefined)).toBe('overview');
  });

  it('accepts known collection views and falls back to dues', () => {
    expect(parseFinanceCollectionView('recent')).toBe('recent');
    expect(parseFinanceCollectionView('due')).toBe('due');
    expect(parseFinanceCollectionView('failed')).toBe('due');
    expect(parseFinanceCollectionView(null)).toBe('due');
  });

  it('builds stable deep links', () => {
    expect(financeHref('overview')).toBe('/finance?view=overview');
    expect(financeHref('collections')).toBe(
      '/finance?view=collections&table=due'
    );
    expect(financeHref('collections', 'recent')).toBe(
      '/finance?view=collections&table=recent'
    );
  });
});
