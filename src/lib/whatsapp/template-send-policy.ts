import type { TemplateConsentScope } from './template-contracts';
import { getTemplateContract } from './template-contracts';
import {
  requireTemplateReady,
  TemplateNotReadyError,
  type TemplateReadinessRow,
} from './template-readiness';

export class TemplateSendPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'TemplateSendPolicyError';
  }
}

export function resolveTemplateSendPolicy<T extends TemplateReadinessRow>(
  rows: readonly T[] | null | undefined,
  templateName: string,
  language = 'en_US'
): {
  row: T;
  consentScope: TemplateConsentScope;
  recognized: boolean;
} {
  const contract = getTemplateContract(templateName);
  if (contract) {
    try {
      const row = requireTemplateReady(rows, contract.id, language);
      return { row, consentScope: contract.consentScope, recognized: true };
    } catch (error) {
      if (error instanceof TemplateNotReadyError) {
        throw new TemplateSendPolicyError(error.code, error.message);
      }
      throw error;
    }
  }

  const row = rows?.find(
    (candidate) =>
      candidate.name === templateName &&
      (candidate.language ?? 'en_US') === language
  );
  if (!row) {
    throw new TemplateSendPolicyError(
      'template_missing',
      `Template ${templateName} is not synced locally for ${language}. Sync Templates before sending.`
    );
  }
  if (row.status !== 'APPROVED') {
    throw new TemplateSendPolicyError(
      'template_not_approved',
      `Template ${templateName} is not Approved by Meta.`
    );
  }
  if (row.category === 'Authentication') {
    throw new TemplateSendPolicyError(
      'authentication_template_unsupported',
      'Authentication templates are not supported by this send path.'
    );
  }
  if (row.category !== 'Utility' && row.category !== 'Marketing') {
    throw new TemplateSendPolicyError(
      'template_category_unknown',
      `Template ${templateName} has no supported synced provider category.`
    );
  }

  return {
    row,
    consentScope:
      row.category === 'Marketing'
        ? 'whatsapp_marketing'
        : 'whatsapp_account_updates',
    recognized: false,
  };
}
