import { describe, expect, it, vi } from 'vitest';
import type { MessageTemplate } from '@/types';
import {
  getTemplateContractById,
  type TemplateContract,
  type TemplateContractId,
} from './template-contracts';
import {
  REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS,
  planRequiredTemplateSubmissions,
  submitRequiredTemplates,
} from './required-template-submission';

function contract(id: TemplateContractId): TemplateContract {
  return getTemplateContractById(id)!;
}

function row(
  id: TemplateContractId,
  overrides: Partial<MessageTemplate> = {}
): MessageTemplate {
  const required = contract(id);
  return {
    id: `${id}-row`,
    account_id: 'account-1',
    user_id: 'user-1',
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    meta_template_id: `${id}-meta`,
    submission_error: null,
    rejection_reason: null,
    last_submitted_at: '2026-09-22T00:00:00.000Z',
    provider_components_sync_required_at: null,
    provider_missing_since: null,
    ...required.payload,
    ...overrides,
  } as MessageTemplate;
}

describe('required automated template submission', () => {
  it('derives the unique automated-message set from reminder rules', () => {
    const ids = REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    expect(ids).toContain('attendance_streak');
    expect(ids).toContain('membership_renewal');
    expect(ids).toContain('payment_link');
    expect(ids).not.toContain('invoice_document');
    expect(ids).not.toContain('festival_offer');
  });

  it('skips only exact approved or pending rows and plans safe repairs', () => {
    const contracts = [
      contract('membership_renewal'),
      contract('service_renewal'),
      contract('invoice_due'),
      contract('invoice_overdue'),
      contract('payment_link'),
    ];
    const plan = planRequiredTemplateSubmissions(
      [
        row('membership_renewal'),
        row('service_renewal', { status: 'PENDING' }),
        row('invoice_due', { body_text: 'Outdated {{1}}' }),
        row('payment_link', {
          status: 'PENDING',
          body_text: 'Outdated while Meta is reviewing it {{1}}',
        }),
      ],
      contracts
    );

    expect(plan.map(({ contract: item, action }) => [item.id, action])).toEqual(
      [
        ['membership_renewal', 'skip'],
        ['service_renewal', 'skip'],
        ['invoice_due', 'update'],
        ['invoice_overdue', 'create'],
        ['payment_link', 'blocked'],
      ]
    );
    expect(plan.at(-1)?.error).toMatch(/still reviewing/i);
  });

  it('continues after an individual failure and returns exact aggregates', async () => {
    const contracts = [
      contract('membership_renewal'),
      contract('service_renewal'),
      contract('invoice_due'),
      contract('invoice_overdue'),
    ];
    const create = vi.fn(async (item: TemplateContract) => {
      if (item.id === 'invoice_overdue') throw new Error('Meta rejected copy');
    });
    const update = vi.fn(async () => undefined);

    const result = await submitRequiredTemplates({
      rows: [
        row('membership_renewal'),
        row('service_renewal', { status: 'PENDING' }),
        row('invoice_due', { footer_text: 'Old footer' }),
      ],
      contracts,
      create,
      update,
    });

    expect(result).toMatchObject({
      total: 4,
      submitted: 1,
      already_ready_or_pending: 2,
      failed: 1,
    });
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contract_id: 'invoice_due',
          outcome: 'submitted',
        }),
        expect.objectContaining({
          contract_id: 'invoice_overdue',
          outcome: 'failed',
          error: 'Meta rejected copy',
        }),
      ])
    );
    expect(update).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it('is idempotent when a repeat run reads the pending rows created by the first run', async () => {
    const contracts = [
      contract('membership_renewal'),
      contract('service_renewal'),
    ];
    const rows: MessageTemplate[] = [];
    const create = vi.fn(async (item: TemplateContract) => {
      rows.push(row(item.id, { status: 'PENDING' }));
    });

    const first = await submitRequiredTemplates({
      rows,
      contracts,
      create,
      update: vi.fn(),
    });
    const second = await submitRequiredTemplates({
      rows,
      contracts,
      create,
      update: vi.fn(),
    });

    expect(first).toMatchObject({
      total: 2,
      submitted: 2,
      already_ready_or_pending: 0,
      failed: 0,
    });
    expect(second).toMatchObject({
      total: 2,
      submitted: 0,
      already_ready_or_pending: 2,
      failed: 0,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
