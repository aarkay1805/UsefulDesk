import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import type { TemplateContract } from './template-contracts';
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
        payload: contract.payload,
        provider: await provider(),
      }),
    update: async (contract, existing) =>
      update({
        ...context,
        payload: contract.payload,
        existing,
        provider: await provider(),
      }),
  });
}
