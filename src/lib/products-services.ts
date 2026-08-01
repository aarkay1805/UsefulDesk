import type {
  CatalogItem,
  CatalogOption,
  CheckoutSelection,
  TrainerRate,
} from '@/types';
import { addDuration } from '@/lib/memberships/expiry';

/** Calendar-accurate, end-exclusive service expiry used by checkout. */
export function serviceEndDate(
  startDate: string,
  option: Pick<CatalogOption, 'duration_count' | 'duration_unit'>
): string | null {
  if (!option.duration_count || !option.duration_unit) return null;
  return addDuration(startDate, option.duration_count, option.duration_unit);
}

/** Configured sell price. Trainer-priced services deliberately have no fallback. */
export function configuredSelectionPrice(
  item: Pick<CatalogItem, 'requires_trainer'>,
  option: Pick<CatalogOption, 'standard_price'>,
  trainerId: string | null,
  rates: readonly Pick<TrainerRate, 'trainer_id' | 'price' | 'is_active'>[]
): number | null {
  if (!item.requires_trainer) {
    return option.standard_price == null ? null : Number(option.standard_price);
  }
  if (!trainerId) return null;
  const rate = rates.find(
    (candidate) => candidate.trainer_id === trainerId && candidate.is_active
  );
  return rate ? Number(rate.price) : null;
}

/** Exact minor-unit largest-remainder split, mirrored by the database trigger. */
export function proportionalAllocation(
  amount: number,
  balances: readonly number[]
): number[] {
  const amountCents = Math.round(amount * 100);
  const balanceCents = balances.map((balance) =>
    Math.max(Math.round(balance * 100), 0)
  );
  const total = balanceCents.reduce((sum, balance) => sum + balance, 0);
  if (amountCents < 0 || amountCents > total || total === 0) {
    throw new Error('Amount must fit within the available balances');
  }

  const shares = balanceCents.map((balance, index) => {
    const numerator = amountCents * balance;
    return {
      index,
      cents: Math.floor(numerator / total),
      remainder: numerator % total,
    };
  });
  let remaining =
    amountCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index
  )) {
    if (remaining === 0) break;
    share.cents += 1;
    remaining -= 1;
  }
  return shares.map((share) => share.cents / 100);
}

export function selectionTotal(
  selections: readonly CheckoutSelection[],
  prices: ReadonlyMap<string, number>
): number {
  return selections.reduce((sum, selection) => {
    const configured = prices.get(selection.option_id) ?? 0;
    const unit = selection.unit_amount ?? configured;
    return sum + unit * (selection.quantity ?? 1);
  }, 0);
}
