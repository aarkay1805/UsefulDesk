import type { MessageTemplate, TemplateButton } from '@/types';
import {
  getTemplateContractById,
  type TemplateContractId,
} from './template-contracts';
import { extractVariableIndices } from './template-validators';

export type TemplateReadinessCode =
  | 'ready'
  | 'missing'
  | 'pending'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'not_approved'
  | 'wrong_category'
  | 'wrong_parameter_format'
  | 'parameter_drift'
  | 'component_drift'
  | 'provider_sync_required';

export type TemplateReadinessRow = Partial<MessageTemplate> & {
  name?: string | null;
  language?: string | null;
  status?: string | null;
  category?: string | null;
  body_text?: string | null;
  footer_text?: string | null;
  header_type?: string | null;
  header_content?: string | null;
  buttons?: TemplateButton[] | null;
  parameter_format?: string | null;
  provider_components_sync_required_at?: string | null;
};

export type TemplateReadinessResult<T extends TemplateReadinessRow> =
  | { ready: true; code: 'ready'; row: T }
  | {
      ready: false;
      code: Exclude<TemplateReadinessCode, 'ready'>;
      message: string;
      row?: T;
    };

const STATUS_CODES: Record<string, Exclude<TemplateReadinessCode, 'ready'>> = {
  PENDING: 'pending',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
};

function failure<T extends TemplateReadinessRow>(
  code: Exclude<TemplateReadinessCode, 'ready'>,
  templateName: string,
  row?: T
): TemplateReadinessResult<T> {
  const messages: Record<Exclude<TemplateReadinessCode, 'ready'>, string> = {
    missing: `Create and submit the exact ${templateName} template, then sync after Meta review.`,
    pending: `${templateName} is still Pending Meta review.`,
    rejected: `${templateName} was Rejected by Meta. Review the provider reason before changing it.`,
    paused: `${templateName} is Paused by Meta and cannot be used.`,
    disabled: `${templateName} is Disabled by Meta and cannot be used.`,
    not_approved: `${templateName} is not Approved by Meta.`,
    wrong_category: `${templateName} does not have the category required by its UsefulDesk contract.`,
    wrong_parameter_format: `${templateName} must be synced as a POSITIONAL template.`,
    parameter_drift: `${templateName} has a different positional parameter count or order.`,
    component_drift: `${templateName} copy, header, footer, or buttons differ from the UsefulDesk contract.`,
    provider_sync_required: `${templateName} was changed by Meta. Sync Templates before sending.`,
  };
  return { ready: false, code, message: messages[code], row };
}

function sameButtons(
  actual: TemplateButton[] | null | undefined,
  expected: TemplateButton[] | undefined
): boolean {
  const actualButtons = actual ?? [];
  const expectedButtons = expected ?? [];
  if (actualButtons.length !== expectedButtons.length) return false;

  return actualButtons.every((button, index) => {
    const expectedButton = expectedButtons[index];
    if (
      !expectedButton ||
      button.type !== expectedButton.type ||
      button.text !== expectedButton.text
    ) {
      return false;
    }

    switch (button.type) {
      case 'QUICK_REPLY':
        return true;
      case 'URL':
        return (
          expectedButton.type === 'URL' &&
          button.url === expectedButton.url &&
          (button.example ?? null) === (expectedButton.example ?? null)
        );
      case 'PHONE_NUMBER':
        return (
          expectedButton.type === 'PHONE_NUMBER' &&
          button.phone_number === expectedButton.phone_number
        );
      case 'COPY_CODE':
        return (
          expectedButton.type === 'COPY_CODE' &&
          button.example === expectedButton.example
        );
    }
  });
}

export function evaluateTemplateReadiness<T extends TemplateReadinessRow>(
  rows: readonly T[] | null | undefined,
  contractId: TemplateContractId,
  language = 'en_US'
): TemplateReadinessResult<T> {
  const contract = getTemplateContractById(contractId);
  if (!contract) {
    throw new Error(`Unknown template contract: ${contractId}`);
  }
  const expected = contract.payload;
  const row = rows?.find(
    (candidate) =>
      candidate.name === expected.name &&
      (candidate.language ?? 'en_US') === language
  );
  if (!row) return failure('missing', expected.name);

  if (row.status !== 'APPROVED') {
    return failure(
      STATUS_CODES[row.status ?? ''] ?? 'not_approved',
      expected.name,
      row
    );
  }
  if (row.category !== expected.category) {
    return failure('wrong_category', expected.name, row);
  }
  if (row.parameter_format !== 'POSITIONAL') {
    return failure('wrong_parameter_format', expected.name, row);
  }
  if (row.provider_components_sync_required_at) {
    return failure('provider_sync_required', expected.name, row);
  }

  const expectedVariables = extractVariableIndices(expected.body_text);
  const actualVariables = extractVariableIndices(row.body_text ?? '');
  if (JSON.stringify(actualVariables) !== JSON.stringify(expectedVariables)) {
    return failure('parameter_drift', expected.name, row);
  }

  const headerMatches =
    (row.header_type ?? null) === (expected.header_type ?? null) &&
    (row.header_content ?? null) === (expected.header_content ?? null);
  if (
    !headerMatches ||
    row.body_text !== expected.body_text ||
    (row.footer_text ?? null) !== (expected.footer_text ?? null) ||
    !sameButtons(row.buttons, expected.buttons)
  ) {
    return failure('component_drift', expected.name, row);
  }

  return { ready: true, code: 'ready', row };
}

export class TemplateNotReadyError extends Error {
  constructor(
    readonly code: Exclude<TemplateReadinessCode, 'ready'>,
    message: string
  ) {
    super(message);
    this.name = 'TemplateNotReadyError';
  }
}

export function requireTemplateReady<T extends TemplateReadinessRow>(
  rows: readonly T[] | null | undefined,
  contractId: TemplateContractId,
  language = 'en_US'
): T {
  const result = evaluateTemplateReadiness(rows, contractId, language);
  if (!result.ready) {
    throw new TemplateNotReadyError(result.code, result.message);
  }
  return result.row;
}
