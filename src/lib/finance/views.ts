export type FinanceView = 'overview' | 'collections';
export type FinanceCollectionView = 'due' | 'recent';

export function parseFinanceView(value: unknown): FinanceView {
  return value === 'collections' ? 'collections' : 'overview';
}

export function parseFinanceCollectionView(
  value: unknown
): FinanceCollectionView {
  return value === 'recent' ? 'recent' : 'due';
}

export function financeHref(
  view: FinanceView,
  collectionView: FinanceCollectionView = 'due'
): string {
  return view === 'collections'
    ? `/finance?view=collections&table=${collectionView}`
    : '/finance?view=overview';
}
