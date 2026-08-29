// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FinanceInvoiceRow } from '@/lib/finance/invoices';

const testState = vi.hoisted(() => ({
  accountRole: 'admin' as 'admin' | 'viewer',
  loadFinanceInvoices: vi.fn(),
  detailPromise: Promise.resolve() as Promise<void>,
  resolveDetail: (() => undefined) as () => void,
}));
const localeState = vi.hoisted(() => ({
  fmt: {
    today: () => '2026-08-25',
    date: (value: string) => value,
    dateTime: (value: string) => value,
    money: (value: number) => `₹${value}`,
    number: (value: number) => String(value),
    phone: (value?: string | null) => value ?? '',
  },
  locale: {
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-1',
    accountRole: testState.accountRole,
  }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => localeState,
}));
vi.mock('@/lib/finance/invoices', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/finance/invoices')>();
  return {
    ...actual,
    loadFinanceInvoices: testState.loadFinanceInvoices,
  };
});
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result =
        table === 'invoice_balances'
          ? {
              data: {
                id: 'invoice-1',
                invoice_number: 'INV-1',
                seller_snapshot: null,
                customer_snapshot: null,
                total: 100,
                amount_paid: 0,
                credit_applied: 0,
                balance: 0,
                gross_amount_paid: 50,
                processed_refund_amount: 50,
                invoice_adjustment_amount: 0,
                accounting_balance: 50,
                collectible_balance: 0,
                requires_refund_review: true,
              },
              error: null,
            }
          : { data: [], error: null };
      const resolved = () => testState.detailPromise.then(() => result);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: resolved,
        single: resolved,
      };
      return builder;
    },
  }),
}));
vi.mock('@/components/finance/finance-month-actions', () => ({
  FinanceMonthActions: () => null,
}));
vi.mock('@/components/finance/finance-invoice-filters', () => ({
  FinanceInvoiceFilters: ({
    onChange,
  }: {
    onChange: (value: {
      paymentStates: string[];
      planIds: string[];
      collectionModes: string[];
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          paymentStates: ['paid'],
          planIds: [],
          collectionModes: [],
        })
      }
    >
      Apply paid filter
    </button>
  ),
}));
vi.mock('@/components/leads/leads-sort', () => ({
  LeadsSort: ({
    onChange,
  }: {
    onChange: (value: { key: string; dir: 'asc' | 'desc' }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange({ key: 'total', dir: 'asc' })}
    >
      Sort total ascending
    </button>
  ),
}));
vi.mock('@/components/finance/invoice-document-actions', () => ({
  InvoiceDocumentActions: () => null,
}));
vi.mock('@/components/finance/payment-link-actions', () => ({
  PaymentLinkActions: () => null,
}));
vi.mock('@/components/members/copy-upi-link-button', () => ({
  CopyUpiLinkButton: () => null,
  useUpiConfig: () => null,
}));
vi.mock('@/components/members/use-account-staff', () => ({
  useAccountStaff: () => ({
    staff: [],
    nameById: new Map(),
    avatarById: new Map(),
    loading: false,
  }),
}));
vi.mock('@/components/finance/record-invoice-payment-dialog', () => ({
  RecordInvoicePaymentDialog: () => null,
}));
vi.mock('@/components/finance/void-invoice-payment-dialog', () => ({
  VoidInvoicePaymentDialog: () => null,
}));

const { FinanceInvoices } = await import('./finance-invoices');

const invoice = {
  id: 'invoice-1',
  account_id: 'account-1',
  membership_id: 'membership-1',
  contact_id: 'contact-1',
  plan_id: null,
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  fee_amount: 100,
  state: 'open',
  created_at: '2026-08-01T10:00:00.000Z',
  amount_paid: 0,
  balance: 0,
  gross_amount_paid: 50,
  processed_refund_amount: 50,
  accounting_balance: 50,
  collectible_balance: 0,
  requires_refund_review: true,
  invoice_sequence: 1,
  invoice_number: 'INV-1',
  seller_snapshot: null,
  customer_snapshot: null,
  identity_snapshot_version: null,
  membership: null,
  contact: {
    id: 'contact-1',
    user_id: 'user-1',
    account_id: 'account-1',
    name: 'Asha',
    phone: '919999999999',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
  },
  lifecycle: 'current',
  paymentState: 'due',
  overdue: false,
  reference: 'INV-1',
  source: 'membership_renewal',
} as FinanceInvoiceRow;

const invoicePage = {
  rows: [invoice],
  page: 1,
  totalCount: 1,
  queueCounts: { all: 1, attention: 1, paid: 0, upcoming: 0, void: 0 },
  planOptions: [],
  summary: {
    count: 1,
    grossInvoiced: 100,
    adjustments: 0,
    invoiced: 100,
    grossCollected: 50,
    refunds: 50,
    collected: 0,
    outstanding: 0,
    overdue: 0,
  },
  snapshotToken: null,
};

const scrollIntoView = vi.fn();

function resetDetailGate() {
  testState.detailPromise = new Promise<void>((resolve) => {
    testState.resolveDetail = resolve;
  });
}

function renderInvoices() {
  return render(
    <FinanceInvoices reloadKey={0} month="2026-08" onMonthChange={vi.fn()} />
  );
}

async function finishDetailLoad() {
  await act(async () => {
    testState.resolveDetail();
    await testState.detailPromise;
  });
}

async function openRefundReviewFromList(
  actionName: 'Record payment' | 'Record'
) {
  await userEvent.click(
    await screen.findByRole('button', { name: actionName })
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Resolve refund review' })
  );
  expect(screen.getByText('Loading invoice…')).toBeTruthy();
  expect(document.getElementById('invoice-refund-review-invoice-1')).toBeNull();
}

function mobileCard(): HTMLElement {
  const reference = screen
    .getAllByText('INV-1')
    .find((element) => element.closest('[data-slot="card"]'));
  const card = reference?.closest('[data-slot="card"]');
  if (!card) throw new Error('Mobile invoice card not found');
  return card as HTMLElement;
}

function desktopRow(): HTMLElement {
  const reference = screen
    .getAllByText('INV-1')
    .find((element) => element.closest('tr'));
  const row = reference?.closest('tr');
  if (!row) throw new Error('Desktop invoice row not found');
  return row;
}

beforeEach(() => {
  testState.accountRole = 'admin';
  testState.loadFinanceInvoices.mockReset().mockResolvedValue(invoicePage);
  resetDetailGate();
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('FinanceInvoices refund-review intent', () => {
  it.each([
    ['mobile', 'Record payment'],
    ['desktop', 'Record'],
  ] as const)(
    'carries the authorized %s list CTA through loading to the existing alert',
    async (_surface, actionName) => {
      renderInvoices();
      await openRefundReviewFromList(actionName);

      await finishDetailLoad();
      const target = await waitFor(() => {
        const element = document.getElementById(
          'invoice-refund-review-invoice-1'
        );
        expect(element).toBeTruthy();
        return element!;
      });

      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    }
  );

  it.each([
    ['mobile card', mobileCard],
    ['desktop row', desktopRow],
  ] as const)(
    'does not focus refund review after a normal %s open',
    async (_surface, targetForOpen) => {
      renderInvoices();
      await screen.findByRole('button', { name: 'Record payment' });
      fireEvent.click(targetForOpen());
      expect(screen.getByText('Loading invoice…')).toBeTruthy();

      await finishDetailLoad();
      const target = await waitFor(() => {
        const element = document.getElementById(
          'invoice-refund-review-invoice-1'
        );
        expect(element).toBeTruthy();
        return element!;
      });
      expect(document.activeElement).not.toBe(target);
      expect(scrollIntoView).not.toHaveBeenCalled();
    }
  );

  it('clears a pending focus intent when detail closes before loading', async () => {
    renderInvoices();
    await openRefundReviewFromList('Record payment');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByText('Loading invoice…')).toBeNull()
    );

    fireEvent.click(mobileCard());
    expect(screen.getByText('Loading invoice…')).toBeTruthy();
    await finishDetailLoad();
    const target = await waitFor(() => {
      const element = document.getElementById(
        'invoice-refund-review-invoice-1'
      );
      expect(element).toBeTruthy();
      return element!;
    });

    expect(document.activeElement).not.toBe(target);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(['Record payment', 'Record'] as const)(
    'keeps the viewer %s action permission-blocked without a resolution CTA',
    async (actionName) => {
      testState.accountRole = 'viewer';
      renderInvoices();

      await userEvent.click(
        await screen.findByRole('button', { name: actionName })
      );
      expect(screen.getByText('Admin access required')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Resolve refund review' })
      ).toBeNull();
      expect(screen.queryByText('Loading invoice…')).toBeNull();
    }
  );
});

describe('FinanceInvoices server ledger coordination', () => {
  it('sends pagination, filters, and sort to the server loader', async () => {
    testState.loadFinanceInvoices.mockImplementation(
      (_client, query: { page: number }) =>
        Promise.resolve({ ...invoicePage, page: query.page, totalCount: 26 })
    );
    renderInvoices();
    await screen.findByText('Showing 1–25 of 26 invoices');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(
        testState.loadFinanceInvoices.mock.calls.some(
          ([, query]) => query.page === 2
        )
      ).toBe(true)
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Apply paid filter' })
    );
    await waitFor(() =>
      expect(
        testState.loadFinanceInvoices.mock.calls.some(
          ([, query]) => query.filters.paymentStates[0] === 'paid'
        )
      ).toBe(true)
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Sort total ascending' })
    );
    await waitFor(() =>
      expect(
        testState.loadFinanceInvoices.mock.calls.some(
          ([, query]) => query.sort.key === 'total' && query.sort.dir === 'asc'
        )
      ).toBe(true)
    );
  });

  it('keeps the existing error and retry contract', async () => {
    testState.loadFinanceInvoices
      .mockRejectedValueOnce(new Error('ledger unavailable'))
      .mockResolvedValueOnce(invoicePage);
    renderInvoices();

    expect(await screen.findByText('ledger unavailable')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(await screen.findAllByText('INV-1')).toHaveLength(2);
    expect(testState.loadFinanceInvoices).toHaveBeenCalledTimes(2);
  });

  it('ignores a superseded response after a newer ledger query wins', async () => {
    let resolveFirst!: (value: typeof invoicePage) => void;
    let resolveSecond!: (value: typeof invoicePage) => void;
    const first = new Promise<typeof invoicePage>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<typeof invoicePage>((resolve) => {
      resolveSecond = resolve;
    });
    testState.loadFinanceInvoices
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const onMonthChange = vi.fn();
    const view = render(
      <FinanceInvoices
        reloadKey={0}
        month="2026-08"
        onMonthChange={onMonthChange}
      />
    );
    await waitFor(() =>
      expect(testState.loadFinanceInvoices).toHaveBeenCalledTimes(1)
    );

    view.rerender(
      <FinanceInvoices
        reloadKey={1}
        month="2026-08"
        onMonthChange={onMonthChange}
      />
    );
    await waitFor(() =>
      expect(testState.loadFinanceInvoices).toHaveBeenCalledTimes(2)
    );

    const newerInvoice = {
      ...invoice,
      id: 'invoice-new',
      reference: 'INV-NEW',
    };
    await act(async () => {
      resolveSecond({ ...invoicePage, rows: [newerInvoice] });
      await second;
    });
    expect(await screen.findAllByText('INV-NEW')).toHaveLength(2);

    await act(async () => {
      resolveFirst(invoicePage);
      await first;
    });
    expect(screen.queryByText('INV-1')).toBeNull();
  });
});
