export interface RefundLineAllocationInput {
  invoiceLineId: string;
  amount: string;
}

export function normalizeRefundLineAllocations(
  value: unknown
): RefundLineAllocationInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return null;
  }
  const seen = new Set<string>();
  const normalized: RefundLineAllocationInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const invoiceLineId =
      typeof row.invoiceLineId === 'string' ? row.invoiceLineId : '';
    const amount = typeof row.amount === 'string' ? row.amount.trim() : '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        invoiceLineId
      ) ||
      !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amount) ||
      Number(amount) <= 0 ||
      seen.has(invoiceLineId)
    ) {
      return null;
    }
    seen.add(invoiceLineId);
    normalized.push({
      invoiceLineId,
      amount: (Math.round(Number(amount) * 100) / 100).toFixed(2),
    });
  }
  return normalized;
}

export function refundAllocationTotalPaise(
  allocations: RefundLineAllocationInput[]
): number {
  return allocations.reduce(
    (total, allocation) => total + Math.round(Number(allocation.amount) * 100),
    0
  );
}
