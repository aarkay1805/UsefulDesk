import { describe, expect, it, vi } from 'vitest';
import type { MembershipPlan } from '@/types';
import { buildMemberImportCandidates } from './member-import-candidates';
import {
  commitMemberImportGroups,
  type MemberImportTransactionCheckpoint,
} from './member-import-transaction';

const option = {
  id: 'gold-month',
  account_id: 'account-1',
  plan_id: 'plan-gold',
  duration_count: 1,
  duration_unit: 'month',
  price: 1_200,
  setup_fee: 0,
  is_active: true,
  sort_order: 0,
  created_at: '',
  updated_at: '',
};
const plans = [
  {
    id: 'plan-gold',
    account_id: 'account-1',
    name: 'Gold',
    is_active: true,
    pricing_options: [option],
  },
] as unknown as MembershipPlan[];
const catalogItems = [
  {
    id: 'service-pt',
    account_id: 'account-1',
    kind: 'service' as const,
    name: 'Personal training',
    description: null,
    requires_trainer: false,
    is_active: true,
    created_by: 'user-1',
    created_at: '',
    updated_at: '',
    catalog_options: [
      {
        id: 'pt-month',
        account_id: 'account-1',
        item_id: 'service-pt',
        duration_count: 1,
        duration_unit: 'month' as const,
        standard_price: 4_000,
        is_active: true,
        sort_order: 0,
        created_at: '',
        updated_at: '',
      },
    ],
  },
];

function candidates() {
  return buildMemberImportCandidates(
    [
      {
        sourceKey: 'sheet:2',
        sourceRow: 2,
        legacyMemberId: 'M-1',
        originalValues: {
          phone: '+15550000022',
          name: 'Asha',
          planName: 'Gold',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          startDate: '01/08/2026',
          fee: '5200',
          amountPaid: '2000',
          balance: '3200',
          paymentMethod: 'upi',
          tagNames: [],
          customValues: [],
        },
      },
      {
        sourceKey: 'sheet:3',
        sourceRow: 3,
        legacyMemberId: 'M-1',
        originalValues: {
          phone: '+15550000022',
          name: 'Asha',
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceStart: '01/10/2026',
          fee: '4000',
          amountPaid: '',
          balance: '4000',
          tagNames: [],
          customValues: [],
        },
      },
    ],
    {
      plans,
      catalogItems,
      trainers: [],
      trainerRates: [],
      dateOrder: 'DMY',
      today: '2026-08-16',
    }
  );
}

describe('member import group transaction client', () => {
  it('sends one stable atomic payload per customer group', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contact_id: 'contact-1',
        membership_id: 'membership-1',
        rows: [
          { source_key: 'sheet:2', status: 'imported' },
          { source_key: 'sheet:3', status: 'imported' },
        ],
      },
      error: null,
    });

    const result = await commitMemberImportGroups(candidates(), {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc,
      paidAt: (date) => `${date}T12:00:00.000Z`,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('perform_member_import_group', {
      p_payload: expect.objectContaining({
        account_id: 'account-1',
        idempotency_key: expect.any(String),
        contact: expect.objectContaining({
          phone: '+15550000022',
          name: 'Asha',
        }),
        rows: [
          expect.objectContaining({
            source_key: 'sheet:2',
            total: 5200,
            amount_paid: 2000,
            balance: 3200,
            membership: expect.objectContaining({ fee_amount: 1200 }),
            service: expect.objectContaining({
              item_id: 'service-pt',
              sold_amount: 4000,
            }),
          }),
          expect.objectContaining({
            source_key: 'sheet:3',
            membership: null,
            service: expect.objectContaining({ start_date: '2026-10-01' }),
          }),
        ],
      }),
    });
    expect(result.groups).toEqual([
      expect.objectContaining({ status: 'imported', contactId: 'contact-1' }),
    ]);
  });

  it('continues after one customer group fails', async () => {
    const rows = candidates();
    const second = {
      ...rows[1],
      sourceKey: 'sheet:4',
      sourceRow: 4,
      customerGroupKey: 'phone:15550000044:legacy:m-4',
      customerIdempotencyKey: '5a017f96-5708-438e-b854-0ab1ff80fd5b',
      purchaseIdempotencyKey: 'cf1fbc17-7113-4af9-9bd3-49142646521b',
      draftValues: { ...rows[1].draftValues, phone: '+15550000044' },
      originalValues: { ...rows[1].originalValues, phone: '+15550000044' },
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'changed' },
      })
      .mockResolvedValueOnce({
        data: {
          contact_id: 'contact-2',
          membership_id: null,
          rows: [{ source_key: 'sheet:4', status: 'imported' }],
        },
        error: null,
      });

    const result = await commitMemberImportGroups([rows[0], second], {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc,
      paidAt: (date) => date,
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result.groups.map((group) => group.status)).toEqual([
      'failed',
      'imported',
    ]);
  });

  it('omits unmapped null profile fields when updating an existing contact', async () => {
    const [candidate] = candidates();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contact_id: 'contact-1',
        membership_id: 'membership-1',
        rows: [],
      },
      error: null,
    });

    await commitMemberImportGroups(
      [
        {
          ...candidate,
          existingMatch: {
            contactId: 'contact-1',
            isMember: false,
            profileConflict: true,
          },
          resolutions: {
            ...candidate.resolutions,
            existingContact: 'use_csv',
          },
        },
      ],
      {
        accountId: 'account-1',
        importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
        rpc,
        paidAt: (date) => date,
      }
    );

    const payload = rpc.mock.calls[0][1].p_payload;
    expect(payload.contact).toMatchObject({
      id: 'contact-1',
      name: 'Asha',
      use_csv: true,
    });
    expect(payload.contact).not.toHaveProperty('email');
    expect(payload.contact).not.toHaveProperty('address_line1');
  });

  it('sends a reviewed cancellation-debt decision with its row facts', async () => {
    const [candidate] = candidates();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contact_id: 'contact-1',
        rows: [{ source_key: candidate.sourceKey, status: 'imported' }],
      },
      error: null,
    });
    await commitMemberImportGroups(
      [
        {
          ...candidate,
          resolutions: {
            ...candidate.resolutions,
            cancelledDebt: { decision: 'write_off', fingerprint: 'facts-1' },
          },
        },
      ],
      {
        accountId: 'account-1',
        importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
        rpc,
        paidAt: (date) => date,
      }
    );
    expect(rpc.mock.calls[0][1].p_payload.rows[0]).toMatchObject({
      cancellation_debt: { decision: 'write_off', fingerprint: 'facts-1' },
    });
  });

  it('checkpoints the exact payload before dispatch and retries an unknown result unchanged', async () => {
    const journal: MemberImportTransactionCheckpoint[] = [];
    const checkpoint = vi.fn(async (entry) => {
      const previous = journal.findIndex(
        (item) => item.customerGroupKey === entry.customerGroupKey
      );
      if (previous >= 0) journal[previous] = entry;
      else journal.push(entry);
      return true;
    });
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection lost after send'))
      .mockResolvedValueOnce({
        data: {
          contact_id: 'contact-1',
          membership_id: 'membership-1',
          rows: [
            { source_key: 'sheet:2', status: 'imported' },
            { source_key: 'sheet:3', status: 'imported' },
          ],
        },
        error: null,
      });
    const options = {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc,
      paidAt: (date: string) => date,
      checkpoint,
    };

    const first = await commitMemberImportGroups(candidates(), options);
    expect(first.groups[0]).toMatchObject({ status: 'uncertain' });
    expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]
    );
    const attemptedPayload = journal[0].payload;

    const second = await commitMemberImportGroups(candidates(), {
      ...options,
      checkpoints: journal,
    });
    expect(second.groups[0]).toMatchObject({ status: 'imported' });
    expect(rpc.mock.calls[1][1].p_payload).toBe(attemptedPayload);
  });

  it('does not dispatch when checkpoint persistence fails', async () => {
    const rpc = vi.fn();
    await expect(
      commitMemberImportGroups(candidates(), {
        accountId: 'account-1',
        importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
        rpc,
        paidAt: (date) => date,
        checkpoint: async () => false,
      })
    ).rejects.toThrow('Could not save this import checkpoint');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['08006', '40003'])(
    'keeps SQLSTATE %s as uncertain',
    async (code) => {
      const result = await commitMemberImportGroups(candidates(), {
        accountId: 'account-1',
        importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code, message: 'completion may be unknown' },
        }),
        paidAt: (date) => date,
      });

      expect(result.groups[0]).toMatchObject({ status: 'uncertain' });
    }
  );

  it('treats duplicate or incomplete RPC rows as uncertain', async () => {
    const result = await commitMemberImportGroups(candidates(), {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc: vi.fn().mockResolvedValue({
        data: {
          contact_id: 'contact-1',
          rows: [
            { source_key: 'sheet:2', status: 'imported' },
            { source_key: 'sheet:2', status: 'imported' },
          ],
        },
        error: null,
      }),
      paidAt: (date) => date,
    });

    expect(result.groups[0]).toMatchObject({ status: 'uncertain' });
  });

  it('reserves every exact payload before the first RPC', async () => {
    const rows = candidates();
    const second = {
      ...rows[1],
      sourceKey: 'sheet:4',
      sourceRow: 4,
      customerGroupKey: 'phone:15550000044:legacy:m-4',
      customerIdempotencyKey: '5a017f96-5708-438e-b854-0ab1ff80fd5b',
      purchaseIdempotencyKey: 'cf1fbc17-7113-4af9-9bd3-49142646521b',
      draftValues: { ...rows[1].draftValues, phone: '+15550000044' },
      originalValues: { ...rows[1].originalValues, phone: '+15550000044' },
    };
    const prepare = vi.fn(async () => true);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contact_id: 'contact-1',
        rows: [{ source_key: 'sheet:2', status: 'imported' }],
      },
      error: null,
    });

    await commitMemberImportGroups([rows[0], second], {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc,
      paidAt: (date) => date,
      prepare,
    });

    expect(prepare).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ customerGroupKey: rows[0].customerGroupKey }),
        expect.objectContaining({ customerGroupKey: second.customerGroupKey }),
      ])
    );
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]
    );
  });

  it('allows a definite rollback to be reviewed and retried with a fresh payload', async () => {
    const journal: MemberImportTransactionCheckpoint[] = [];
    const checkpoint = vi.fn(async (entry) => {
      const index = journal.findIndex(
        (item) => item.customerGroupKey === entry.customerGroupKey
      );
      if (index >= 0) journal[index] = entry;
      else journal.push(entry);
      return true;
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'race' },
      })
      .mockResolvedValueOnce({
        data: {
          contact_id: 'contact-1',
          rows: [
            { source_key: 'sheet:2', status: 'imported' },
            { source_key: 'sheet:3', status: 'imported' },
          ],
        },
        error: null,
      });
    const first = await commitMemberImportGroups(candidates(), {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc,
      paidAt: (date) => date,
      checkpoint,
    });
    expect(first.groups[0].status).toBe('failed');
    const original = journal[0].payload;
    const corrected = candidates().map((candidate) => ({
      ...candidate,
      built: {
        ...candidate.built,
        contact: { ...candidate.built.contact, name: 'Corrected Asha' },
      },
    }));

    const second = await commitMemberImportGroups(corrected, {
      accountId: 'account-1',
      importJobId: '2de1e325-29bc-4b7d-9449-d0e3350db601',
      rpc,
      paidAt: (date) => date,
      checkpoints: [], // Reviewer reset only the definite rollback checkpoint.
      checkpoint,
    });
    expect(second.groups[0].status).toBe('imported');
    expect(rpc.mock.calls[1][1].p_payload).not.toBe(original);
    expect(rpc.mock.calls[1][1].p_payload.contact.name).toBe('Corrected Asha');
  });
});
