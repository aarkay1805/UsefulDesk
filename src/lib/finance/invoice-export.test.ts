import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_FINANCE_INVOICE_FILTERS,
  loadFinanceInvoiceExportRows,
  type FinanceInvoiceRpcClient,
} from './invoices';

function rawRow(id: number) {
  return {
    id: `invoice-${String(id).padStart(4, '0')}`,
    account_id: 'account-1',
    membership_id: '',
    contact_id: 'contact-1',
    plan_id: null,
    period_start: '2026-08-01',
    period_end: '2026-08-01',
    fee_amount: '100.00',
    state: 'open',
    created_at: `2026-08-01T00:00:${String(id % 60).padStart(2, '0')}Z`,
    amount_paid: '0',
    credit_applied: '0',
    balance: '100',
    gross_amount_paid: '0',
    processed_refund_amount: '0',
    invoice_adjustment_amount: '0',
    accounting_balance: '100',
    collectible_balance: '100',
    requires_refund_review: false,
    invoice_sequence: id,
    invoice_number: `INV-${id}`,
    seller_snapshot: null,
    customer_snapshot: null,
    identity_snapshot_version: 1,
    membership: null,
    contact: null,
    lifecycle: 'past',
    paymentState: 'due',
    overdue: true,
    reference: `INV-${id}`,
    source: 'sale',
    lineKinds: ['service'],
    gatewayPaymentIds: [],
    gatewayRefundIds: [],
    refundDispositions: [],
  };
}

function page(
  rows: unknown[],
  page: number,
  totalCount: number,
  token: string
) {
  return {
    rows,
    page,
    totalCount,
    queueCounts: {
      all: totalCount,
      attention: totalCount,
      paid: 0,
      upcoming: 0,
      void: 0,
    },
    planOptions: [],
    summary: {
      count: totalCount,
      grossInvoiced: totalCount * 100,
      adjustments: 0,
      invoiced: totalCount * 100,
      grossCollected: 0,
      refunds: 0,
      collected: 0,
      outstanding: totalCount * 100,
      overdue: totalCount,
    },
    snapshotToken: token,
  };
}

function request(data: unknown) {
  const promise = Promise.resolve({ data, error: null });
  return {
    then: promise.then.bind(promise),
    abortSignal: () => promise,
  };
}

const query = {
  month: '2026-08',
  timeZone: 'Asia/Kolkata',
  today: '2026-08-29',
  search: '',
  queue: 'all' as const,
  filters: EMPTY_FINANCE_INVOICE_FILTERS,
  sort: { key: 'issued_on' as const, dir: 'desc' as const },
};

describe('finance invoice bounded export', () => {
  it('walks more than one server page once and terminates at the exact total', async () => {
    const allRows = Array.from({ length: 401 }, (_, index) =>
      rawRow(index + 1)
    );
    const rpc = vi.fn((_name: string, args: Record<string, unknown>) => {
      const pageIndex = Number(args.p_page);
      const rows = allRows.slice(pageIndex * 200, (pageIndex + 1) * 200);
      return request(page(rows, pageIndex, allRows.length, 'snapshot-1'));
    });
    const client = { rpc } as FinanceInvoiceRpcClient;

    const result = await loadFinanceInvoiceExportRows(client, query);

    expect(result).toHaveLength(401);
    expect(result.at(0)?.id).toBe('invoice-0001');
    expect(result.at(-1)?.id).toBe('invoice-0401');
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((call) => call[1].p_page)).toEqual([0, 1, 2]);
    for (const [, args] of rpc.mock.calls) {
      expect(args).toMatchObject({ p_mode: 'export', p_page_size: 200 });
    }
  });

  it('fails closed if rows change between export pages', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => rawRow(index + 1));
    const client = {
      rpc: (_name: string, args: Record<string, unknown>) => {
        const pageIndex = Number(args.p_page);
        return request(
          page(
            rows.slice(pageIndex * 200, (pageIndex + 1) * 200),
            pageIndex,
            rows.length,
            pageIndex === 0 ? 'snapshot-1' : 'snapshot-2'
          )
        );
      },
    } as FinanceInvoiceRpcClient;

    await expect(loadFinanceInvoiceExportRows(client, query)).rejects.toThrow(
      'Invoices changed during export'
    );
  });

  it('rejects duplicated or incomplete page results', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => rawRow(index));
    const client = {
      rpc: (_name: string, args: Record<string, unknown>) => {
        const pageIndex = Number(args.p_page);
        return request(
          page(
            pageIndex === 0 ? firstPage : [rawRow(0)],
            pageIndex,
            201,
            'snapshot-1'
          )
        );
      },
    } as FinanceInvoiceRpcClient;

    await expect(loadFinanceInvoiceExportRows(client, query)).rejects.toThrow(
      'Invoice export was incomplete'
    );
  });
});
