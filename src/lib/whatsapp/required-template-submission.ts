import type { MessageTemplate } from '@/types';
import { REMINDER_RULES } from '@/lib/reminders/rules';
import {
  getTemplateContractById,
  type TemplateContract,
} from './template-contracts';
import { templateMatchesContract } from './template-readiness';

const EDITABLE_PROVIDER_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED']);

export const REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS: readonly TemplateContract[] =
  Array.from(
    new Set(REMINDER_RULES.flatMap((rule) => [...rule.templateContracts]))
  ).map((id) => {
    const contract = getTemplateContractById(id);
    if (!contract) throw new Error(`Unknown template contract: ${id}`);
    return contract;
  });

export type RequiredTemplatePlanItem = {
  contract: TemplateContract;
  row?: MessageTemplate;
  action: 'skip' | 'create' | 'update' | 'blocked';
  error?: string;
};

export type RequiredTemplateSubmissionResultItem = {
  contract_id: TemplateContract['id'];
  name: string;
  outcome: 'submitted' | 'already_ready_or_pending' | 'failed';
  status?: string;
  error?: string;
};

export type RequiredTemplateSubmissionSummary = {
  total: number;
  submitted: number;
  already_ready_or_pending: number;
  failed: number;
  results: RequiredTemplateSubmissionResultItem[];
};

export function planRequiredTemplateSubmissions(
  rows: readonly MessageTemplate[],
  contracts: readonly TemplateContract[] = REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS
): RequiredTemplatePlanItem[] {
  return contracts.map((contract) => {
    const expected = contract.payload;
    const row = rows.find(
      (candidate) =>
        candidate.name === expected.name &&
        (candidate.language ?? 'en_US') === expected.language
    );

    if (!row) return { contract, action: 'create' };

    const exact = templateMatchesContract(row, contract);
    if (exact && (row.status === 'APPROVED' || row.status === 'PENDING')) {
      return { contract, row, action: 'skip' };
    }

    if (!row.meta_template_id || row.status === 'DRAFT') {
      return { contract, row, action: 'create' };
    }

    if (row.status && EDITABLE_PROVIDER_STATUSES.has(row.status)) {
      return { contract, row, action: 'update' };
    }

    const error =
      row.status === 'PENDING'
        ? 'Meta is still reviewing an outdated copy. Sync and retry after that review finishes.'
        : `Meta does not allow templates in ${row.status ?? 'unknown'} status to be edited. Resolve it in WhatsApp Manager, sync, and retry.`;
    return { contract, row, action: 'blocked', error };
  });
}

export async function submitRequiredTemplates({
  rows,
  contracts = REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS,
  create,
  update,
}: {
  rows: readonly MessageTemplate[];
  contracts?: readonly TemplateContract[];
  create: (contract: TemplateContract) => Promise<unknown>;
  update: (
    contract: TemplateContract,
    row: MessageTemplate
  ) => Promise<unknown>;
}): Promise<RequiredTemplateSubmissionSummary> {
  const plan = planRequiredTemplateSubmissions(rows, contracts);
  const results: RequiredTemplateSubmissionResultItem[] = [];

  // Deliberately sequential: Meta reviews every template independently and
  // enforces create/edit rate limits. One server request must not fan out into
  // an unbounded provider burst.
  for (const item of plan) {
    const base = {
      contract_id: item.contract.id,
      name: item.contract.payload.name,
    };
    if (item.action === 'skip') {
      results.push({
        ...base,
        outcome: 'already_ready_or_pending',
        status: item.row?.status,
      });
      continue;
    }
    if (item.action === 'blocked') {
      results.push({
        ...base,
        outcome: 'failed',
        status: item.row?.status,
        error: item.error,
      });
      continue;
    }

    try {
      if (item.action === 'create') await create(item.contract);
      else await update(item.contract, item.row!);
      results.push({ ...base, outcome: 'submitted', status: 'PENDING' });
    } catch (error) {
      results.push({
        ...base,
        outcome: 'failed',
        status: item.row?.status,
        error: error instanceof Error ? error.message : 'Submission failed.',
      });
    }
  }

  return {
    total: results.length,
    submitted: results.filter((item) => item.outcome === 'submitted').length,
    already_ready_or_pending: results.filter(
      (item) => item.outcome === 'already_ready_or_pending'
    ).length,
    failed: results.filter((item) => item.outcome === 'failed').length,
    results,
  };
}
