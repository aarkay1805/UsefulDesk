import { describe, expect, it, vi } from 'vitest';
import type { MessageTemplate } from '@/types';
import { getTemplateContractById } from './template-contracts';
import { runRequiredTemplateSubmission } from './required-template-submission-server';

const membership = getTemplateContractById('membership_renewal')!;
const service = getTemplateContractById('service_renewal')!;

function row(
  contract = membership,
  overrides: Partial<MessageTemplate> = {}
): MessageTemplate {
  return {
    id: `${contract.id}-row`,
    account_id: 'account-1',
    user_id: 'user-1',
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    meta_template_id: `${contract.id}-meta`,
    submission_error: null,
    rejection_reason: null,
    last_submitted_at: '2026-09-22T00:00:00.000Z',
    provider_components_sync_required_at: null,
    provider_missing_since: null,
    ...contract.payload,
    ...overrides,
  } as MessageTemplate;
}

function dbWithRows(rows: MessageTemplate[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const eq = vi.fn(() => result);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq };
}

describe('runRequiredTemplateSubmission', () => {
  it('uses a fresh account-scoped read and does not load credentials for a no-op', async () => {
    const supabase = dbWithRows([
      row(membership),
      row(service, { status: 'PENDING' }),
    ]);
    const loadProvider = vi.fn();

    const result = await runRequiredTemplateSubmission(
      { supabase: supabase as never, accountId: 'account-1', userId: 'user-1' },
      {
        contracts: [membership, service],
        loadProvider,
        create: vi.fn(),
        update: vi.fn(),
      }
    );

    expect(result).toMatchObject({
      total: 2,
      submitted: 0,
      already_ready_or_pending: 2,
      failed: 0,
    });
    expect(supabase.from).toHaveBeenCalledWith('message_templates');
    expect(supabase.eq).toHaveBeenCalledWith('account_id', 'account-1');
    expect(loadProvider).not.toHaveBeenCalled();
  });

  it('loads one account WABA context for a mixed sequential run', async () => {
    const supabase = dbWithRows([row(membership, { body_text: 'Old {{1}}' })]);
    const provider = { wabaId: 'waba-1', accessToken: 'token-1' };
    const loadProvider = vi.fn().mockResolvedValue(provider);
    const create = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);

    const result = await runRequiredTemplateSubmission(
      { supabase: supabase as never, accountId: 'account-1', userId: 'user-1' },
      {
        contracts: [membership, service],
        loadProvider,
        create,
        update,
      }
    );

    expect(result).toMatchObject({ total: 2, submitted: 2, failed: 0 });
    expect(loadProvider).toHaveBeenCalledOnce();
    expect(loadProvider).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1' })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        payload: membership.payload,
        provider,
      })
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        payload: service.payload,
        provider,
      })
    );
  });

  it('fails before submission when the account-scoped catalog cannot be read', async () => {
    const result = Promise.resolve({
      data: null,
      error: { message: 'catalog unavailable' },
    });
    const eq = vi.fn(() => result);
    const select = vi.fn(() => ({ eq }));
    const supabase = { from: vi.fn(() => ({ select })) };

    await expect(
      runRequiredTemplateSubmission(
        {
          supabase: supabase as never,
          accountId: 'account-1',
          userId: 'user-1',
        },
        {
          contracts: [membership],
          loadProvider: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        }
      )
    ).rejects.toThrow('catalog unavailable');
  });
});
