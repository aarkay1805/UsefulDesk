import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import {
  withLegalBusinessNameSample,
  type TemplateContract,
} from './template-contracts';
import { loadLegalBusinessName } from './legal-business-name';
import {
  REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS,
  submitRequiredTemplates,
} from './required-template-submission';
import {
  createTemplateForReview,
  loadTemplateProviderContext,
  updateTemplateForReview,
  type TemplateProviderContext,
  type TemplateSubmissionContext,
} from './template-submission-server';

type Dependencies = {
  contracts?: readonly TemplateContract[];
  loadProvider?: (
    context: Pick<TemplateSubmissionContext, 'supabase' | 'accountId'>
  ) => Promise<TemplateProviderContext>;
  create?: (
    input: TemplateSubmissionContext & {
      payload: TemplateContract['payload'];
      provider: TemplateProviderContext;
    }
  ) => Promise<unknown>;
  update?: (
    input: TemplateSubmissionContext & {
      payload: TemplateContract['payload'];
      existing: MessageTemplate;
      provider: TemplateProviderContext;
    }
  ) => Promise<unknown>;
};

export async function runRequiredTemplateSubmission(
  context: TemplateSubmissionContext,
  dependencies: Dependencies = {}
) {
  const { supabase, accountId } = context;
  const { data, error } = await (supabase as SupabaseClient)
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId);
  if (error) throw new Error(error.message);

  const loadProvider = dependencies.loadProvider ?? loadTemplateProviderContext;
  const create = dependencies.create ?? createTemplateForReview;
  const update = dependencies.update ?? updateTemplateForReview;
  let providerPromise: Promise<TemplateProviderContext> | null = null;
  let legalNamePromise: ReturnType<typeof loadLegalBusinessName> | null = null;
  const legalName = async () => {
    legalNamePromise ??= loadLegalBusinessName(
      supabase as unknown as Parameters<typeof loadLegalBusinessName>[0],
      accountId
    );
    const identity = await legalNamePromise;
    if (!identity.ok) {
      throw new Error(
        identity.code === 'legal_business_identity_missing'
          ? 'Set the legal business name in Business details before submitting templates.'
          : 'Could not load the legal business name. Try again.'
      );
    }
    return identity.name;
  };
  const provider = () => {
    providerPromise ??= loadProvider({ supabase, accountId });
    return providerPromise;
  };

  return submitRequiredTemplates({
    rows: (data ?? []) as MessageTemplate[],
    contracts: dependencies.contracts ?? REQUIRED_AUTOMATED_TEMPLATE_CONTRACTS,
    create: async (contract) =>
      create({
        ...context,
        payload: withLegalBusinessNameSample(contract, await legalName()),
        provider: await provider(),
      }),
    update: async (contract, existing) =>
      update({
        ...context,
        payload: withLegalBusinessNameSample(contract, await legalName()),
        existing,
        provider: await provider(),
      }),
  });
}
