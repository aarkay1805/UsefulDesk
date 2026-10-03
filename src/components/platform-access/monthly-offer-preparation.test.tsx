// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: api.rpc }),
}));
import { MonthlyOfferPreparation } from './monthly-offer-preparation';
const context = {
  snapshot_token: 'source-1',
  branches: [{ account_id: 'branch-1', name: 'First branch', currency: 'INR' }],
  missing_facts: [],
  offer_set_id: null,
  stale: false,
};
beforeEach(() =>
  api.rpc.mockImplementation(async () => ({ data: context, error: null }))
);
afterEach(cleanup);
describe('Monthly offer preparation', () => {
  it('requires explicit facts review and leaves all references empty', async () => {
    render(<MonthlyOfferPreparation organizationId="gym-1" />);
    await screen.findByLabelText('Billing branch');
    expect(
      screen
        .getByRole('checkbox', {
          name: 'I checked the buyer, setup, exact totals and every review reference.',
        })
        .getAttribute('aria-checked')
    ).toBe('false');
    expect(
      (screen.getByLabelText('Operator authorization') as HTMLInputElement)
        .value
    ).toBe('');
    expect(
      screen
        .getByRole('button', { name: 'Prepare offers' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.queryByRole('button', {
        name: /open checkout|approve owner|enable payment/i,
      })
    ).toBeNull();
  });
  it('collects tier-specific tax, terms, refund and exact total review without inventing evidence', async () => {
    render(<MonthlyOfferPreparation organizationId="gym-1" />);
    await screen.findByLabelText('Billing branch');
    for (const tier of ['Starter', 'Growth', 'Ultimate']) {
      fireEvent.click(
        screen.getByRole('checkbox', { name: `Include ${tier}` })
      );
      expect(
        (screen.getByLabelText(`${tier} tax note`) as HTMLTextAreaElement).value
      ).toBe('');
      expect(
        (screen.getByLabelText(`${tier} terms`) as HTMLTextAreaElement).value
      ).toBe('');
      expect(
        (screen.getByLabelText(`${tier} refund note`) as HTMLTextAreaElement)
          .value
      ).toBe('');
      expect(
        screen
          .getByRole('checkbox', { name: `${tier} exact total reviewed` })
          .getAttribute('aria-checked')
      ).toBe('false');
    }
    expect(
      api.rpc.mock.calls.every(
        ([name]) => name === 'platform_admin_monthly_offer_context'
      )
    ).toBe(true);
  });
  it('submits only the selected reviewed offer and resets acknowledgement on edits and failure', async () => {
    api.rpc.mockImplementation(async (name: string) =>
      name === 'platform_admin_prepare_monthly_offers'
        ? {
            data: null,
            error: {
              message:
                'Preparation changed. Refresh and review the latest details.',
            },
          }
        : { data: context, error: null }
    );
    render(<MonthlyOfferPreparation organizationId="gym-1" />);
    fireEvent.click(await screen.findByLabelText('Billing branch'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'First branch' })
    );
    await waitFor(() =>
      expect(api.rpc).toHaveBeenCalledWith(
        'platform_admin_monthly_offer_context',
        { p_organization_id: 'gym-1', p_billing_account_id: 'branch-1' }
      )
    );
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Include Growth' })
    );
    for (const label of [
      'Growth offer reference',
      'Growth tax note',
      'Growth terms',
      'Growth refund note',
      'Operator authorization',
      'Buyer and billing geography review',
      'Supplier and financial year review',
      'Tax and document review',
      'Refund and support review',
      'Payment account review',
      'Payment acceptance evidence',
      'Backup and recovery evidence',
      'Plan features and branch limit review',
      'Reviewed release SHA',
      'Reviewed migration manifest SHA-256',
    ]) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: `Synthetic actual ${label}` },
      });
    }
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Growth exact total reviewed' })
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Growth unregistered-supplier invoice and receipt treatment reviewed',
      })
    );
    const ack = screen.getByRole('checkbox', {
      name: 'I checked the buyer, setup, exact totals and every review reference.',
    });
    fireEvent.click(ack);
    fireEvent.change(screen.getByLabelText('Growth terms'), {
      target: { value: 'Synthetic corrected Growth terms' },
    });
    expect(ack.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(ack);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare offers' }));
    await waitFor(() =>
      expect(api.rpc).toHaveBeenCalledWith(
        'platform_admin_prepare_monthly_offers',
        expect.objectContaining({
          p_organization_id: 'gym-1',
          p_billing_account_id: 'branch-1',
          p_expected_snapshot: 'source-1',
          p_facts_reviewed: true,
          p_offers: [
            {
              tier: 'growth',
              amount_minor: 149900,
              offer_reference: 'Synthetic actual Growth offer reference',
              customer_tax_note: 'Synthetic actual Growth tax note',
              customer_terms_note: 'Synthetic corrected Growth terms',
              customer_refund_note: 'Synthetic actual Growth refund note',
              document_treatment: 'usefulmade_unregistered_invoice_receipt_v1',
            },
          ],
          p_evidence: expect.objectContaining({
            capability_readiness_reference:
              'Synthetic actual Plan features and branch limit review',
          }),
        })
      )
    );
    expect(
      await screen.findByText(
        'Preparation changed. Refresh and review the latest details.'
      )
    ).toBeTruthy();
    expect(ack.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh facts' }));
    await waitFor(() =>
      expect(
        api.rpc.mock.calls.filter(
          ([name]) => name === 'platform_admin_monthly_offer_context'
        ).length
      ).toBe(3)
    );
  });
});
