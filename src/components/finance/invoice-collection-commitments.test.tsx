// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ accountRole: 'agent', user: { id: 'author-1' } }) }));
vi.mock('@/hooks/use-locale', () => ({ useLocale: () => ({ locale: { currency: 'INR', locale: 'en-IN' }, fmt: { money: (amount: number) => `₹${amount}`, date: (date: string) => date, today: () => '2026-09-11' } }) }));
vi.mock('@/components/members/use-account-staff', () => ({ useAccountStaff: () => ({ staff: [{ user_id: 'author-1', full_name: 'Asha' }], nameById: new Map([['author-1', 'Asha']]) }) }));

import { InvoiceCollectionCommitments } from './invoice-collection-commitments';

describe('InvoiceCollectionCommitments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ commitments: [{ id: 'commitment-1', kind: 'verification_hold', state: 'open', amount: null, promised_on: null, reason: 'Receipt check', next_action: 'Call member', assigned_to: 'author-1', created_by: 'author-1', revision: 1, created_at: '2026-09-11T00:00:00.000Z' }] }), { status: 200 }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('shows the author-only resolve control and calls the revisioned resolve API', async () => {
    render(<InvoiceCollectionCommitments invoiceId="invoice-1" maxAmount={1000} />);
    const resolve = await screen.findByRole('button', { name: /resolve/i });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ commitment: { id: 'commitment-1' } }), { status: 200 }));
    fireEvent.click(resolve);
    await waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith('/api/invoices/invoice-1/commitments', expect.objectContaining({ method: 'PATCH' })));
    expect(mocks.fetch.mock.calls.at(-1)?.[1]?.body).toContain('"action":"resolve"');
  });
});
