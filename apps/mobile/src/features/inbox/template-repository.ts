import { getTemplateContract } from '../../../../../src/lib/whatsapp/template-contracts';
import { evaluateTemplateReadiness } from '../../../../../src/lib/whatsapp/template-readiness';
import type { TemplateButton } from '../../../../../src/types';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import { isStrictIsoTimestamp } from './inbox-normalizers';
import type {
  ConnectionReadiness,
  NativeTemplate,
  NativeTemplateButton,
  TemplateField,
} from './inbox-types';

const READINESS_UNAVAILABLE = 'Send readiness is unavailable';
const TEMPLATE_LOAD_ERROR = 'Could not load sendable templates';
const CONNECTION_LOAD_ERROR = 'Could not load WhatsApp connection readiness';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TEMPLATE_SELECT = `
  id,
  account_id,
  name,
  language,
  category,
  body_text,
  footer_text,
  header_type,
  header_content,
  header_media_url,
  buttons,
  status,
  parameter_format,
  provider_missing_since,
  provider_components_sync_required_at
`;

export interface TemplateQuerySource {
  listTemplates(accountId: string): Promise<unknown[]>;
  findConnection(accountId: string): Promise<unknown | null>;
}

export interface TemplateRepository {
  listSendableTemplates(accountId: string): Promise<NativeTemplate[]>;
  getWhatsAppConnectionReadiness(
    accountId: string
  ): Promise<ConnectionReadiness>;
}

/**
 * Templates whose values only the system can supply. A payment link needs a
 * live Razorpay link and records send evidence against it; nobody can type
 * that on a phone, so these are sent from the invoice screens instead.
 */
const SYSTEM_FILLED_TEMPLATE_CONTRACTS = new Set(['payment_link']);

class UnsendableTemplateError extends Error {}

const invalidTemplate = (): never => {
  throw new UnsendableTemplateError(TEMPLATE_LOAD_ERROR);
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export function extractTemplateVariableIndices(text: string): number[] {
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  const indices = new Set<number>();
  for (const match of matches) {
    const index = Number(match[1]);
    if (Number.isSafeInteger(index) && index >= 1) indices.add(index);
  }
  return [...indices].sort((left, right) => left - right);
}

function hasOnlyPositionalPlaceholders(text: string): boolean {
  return [...text.matchAll(/\{\{([^}]+)\}\}/g)].every(
    (match) => /^\d+$/.test(match[1]) && Number(match[1]) >= 1
  );
}

function hasContiguousIndices(indices: number[]): boolean {
  return indices.every((index, position) => index === position + 1);
}

function parseButtons(value: unknown): NativeTemplateButton[] {
  if (value === null) return [];
  if (!Array.isArray(value)) return invalidTemplate();
  return value.map((value: unknown) => {
    const button = object(value);
    if (
      !button ||
      typeof button.type !== 'string' ||
      typeof button.text !== 'string'
    ) {
      return invalidTemplate();
    }
    switch (button.type) {
      case 'QUICK_REPLY':
        return { type: 'QUICK_REPLY', text: button.text };
      case 'URL': {
        if (typeof button.url !== 'string') return invalidTemplate();
        const variables = extractTemplateVariableIndices(button.url);
        if (
          !hasOnlyPositionalPlaceholders(button.url) ||
          variables.length > 1 ||
          (variables.length === 1 && variables[0] !== 1)
        ) {
          return invalidTemplate();
        }
        if (
          button.example !== undefined &&
          typeof button.example !== 'string'
        ) {
          return invalidTemplate();
        }
        return {
          type: 'URL',
          text: button.text,
          url: button.url,
          ...(button.example !== undefined ? { example: button.example } : {}),
        };
      }
      case 'PHONE_NUMBER':
        if (typeof button.phone_number !== 'string') return invalidTemplate();
        return {
          type: 'PHONE_NUMBER',
          text: button.text,
          phoneNumber: button.phone_number,
        };
      case 'COPY_CODE':
        if (typeof button.example !== 'string' || !button.example.trim()) {
          return invalidTemplate();
        }
        return {
          type: 'COPY_CODE',
          text: button.text,
          example: button.example,
        };
      default:
        return invalidTemplate();
    }
  });
}

function parseNativeTemplate(
  row: unknown,
  accountId: string
): NativeTemplate | null {
  const template = object(row);
  if (
    !template ||
    !isUuid(template.id) ||
    template.account_id !== accountId ||
    !isUuid(template.account_id)
  ) {
    // A row without identity, or from another branch, means the read itself
    // is wrong. That fails the whole list rather than one template.
    throw new Error(TEMPLATE_LOAD_ERROR);
  }

  if (template.category === 'Authentication') return null;

  if (
    typeof template.name !== 'string' ||
    !template.name.trim() ||
    typeof template.language !== 'string' ||
    !template.language.trim() ||
    !['Marketing', 'Utility'].includes(template.category as string) ||
    typeof template.body_text !== 'string' ||
    !template.body_text.trim() ||
    !hasOnlyPositionalPlaceholders(template.body_text) ||
    !hasContiguousIndices(extractTemplateVariableIndices(template.body_text)) ||
    template.status !== 'APPROVED' ||
    template.parameter_format !== 'POSITIONAL' ||
    template.provider_missing_since !== null ||
    template.provider_components_sync_required_at !== null ||
    !nullableString(template.header_content) ||
    !nullableString(template.footer_text) ||
    !nullableString(template.header_media_url) ||
    (template.header_type === null &&
      (template.header_content !== null || template.header_media_url !== null))
  ) {
    return invalidTemplate();
  }

  if (template.header_type !== null && template.header_type !== 'text') {
    return invalidTemplate();
  }
  if (
    SYSTEM_FILLED_TEMPLATE_CONTRACTS.has(
      getTemplateContract(template.name)?.id ?? ''
    )
  ) {
    return invalidTemplate();
  }
  if (
    template.header_type === 'text' &&
    (template.header_content === null ||
      !template.header_content.trim() ||
      !hasOnlyPositionalPlaceholders(template.header_content) ||
      (() => {
        const variables = extractTemplateVariableIndices(
          template.header_content
        );
        return (
          variables.length > 1 || (variables.length === 1 && variables[0] !== 1)
        );
      })())
  ) {
    return invalidTemplate();
  }

  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category as NativeTemplate['category'],
    bodyText: template.body_text,
    footerText: template.footer_text || null,
    headerType: template.header_type,
    headerContent: template.header_content,
    headerMediaUrl: null,
    buttons: parseButtons(template.buttons),
    status: 'APPROVED',
    parameterFormat: 'POSITIONAL',
    providerMissingSince: null,
    providerComponentsSyncRequiredAt: null,
  };
}

/** Match the same immutable approved contract that the send route enforces. */
export function templateContractReadiness(
  template: NativeTemplate
): 'ready' | 'needs_update' | 'manual_entry' {
  const contract = getTemplateContract(template.name);
  if (!contract) return 'manual_entry';

  const buttons: TemplateButton[] = template.buttons.map((button) =>
    button.type === 'PHONE_NUMBER'
      ? {
          type: 'PHONE_NUMBER',
          text: button.text,
          phone_number: button.phoneNumber,
        }
      : button
  );
  const result = evaluateTemplateReadiness(
    [
      {
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        parameter_format: template.parameterFormat,
        provider_components_sync_required_at:
          template.providerComponentsSyncRequiredAt ?? undefined,
        body_text: template.bodyText,
        footer_text: template.footerText ?? undefined,
        header_type: template.headerType ?? undefined,
        header_content: template.headerContent ?? undefined,
        buttons,
      },
    ],
    contract.id,
    template.language
  );
  return result.ready ? 'ready' : 'needs_update';
}

function parseConnection(row: unknown, accountId: string): ConnectionReadiness {
  if (row === null) {
    return {
      status: 'absent',
      ready: false,
      reason: 'WhatsApp is not connected for this branch.',
      connectedAt: null,
    };
  }
  const connection = object(row);
  if (
    !connection ||
    connection.account_id !== accountId ||
    !isUuid(connection.account_id) ||
    !['connected', 'disconnected'].includes(connection.status as string) ||
    !(
      connection.connected_at === null ||
      isStrictIsoTimestamp(connection.connected_at)
    )
  ) {
    throw new Error(CONNECTION_LOAD_ERROR);
  }
  if (connection.status === 'connected') {
    return {
      status: 'connected',
      ready: true,
      reason: null,
      connectedAt: connection.connected_at,
    };
  }
  return {
    status: 'disconnected',
    ready: false,
    reason: 'WhatsApp is disconnected for this branch.',
    connectedAt: connection.connected_at,
  };
}

export function templateFields(template: NativeTemplate): TemplateField[] {
  const fields: TemplateField[] = extractTemplateVariableIndices(
    template.bodyText
  ).map((variable) => ({
    kind: 'body',
    variable,
    label: `Message detail ${variable}`,
  }));
  if (
    template.headerType === 'text' &&
    template.headerContent &&
    extractTemplateVariableIndices(template.headerContent).includes(1)
  ) {
    fields.push({ kind: 'header', variable: 1, label: 'Title text' });
  }
  template.buttons.forEach((button, buttonIndex) => {
    if (
      (button.type === 'URL' &&
        extractTemplateVariableIndices(button.url).includes(1)) ||
      button.type === 'COPY_CODE'
    ) {
      fields.push({
        kind: 'button',
        buttonIndex,
        label: button.text,
        ...(button.type === 'COPY_CODE'
          ? { defaultValue: button.example }
          : {}),
      });
    }
  });
  return fields;
}

export function createTemplateRepository(
  source: TemplateQuerySource
): TemplateRepository {
  return {
    async listSendableTemplates(accountId) {
      let rows: unknown[];
      try {
        rows = await source.listTemplates(accountId);
      } catch {
        throw new Error(TEMPLATE_LOAD_ERROR);
      }
      if (!Array.isArray(rows)) throw new Error(TEMPLATE_LOAD_ERROR);
      // Each row fails closed on its own. One template this app cannot send —
      // a media header, a system-filled payment link, a malformed row — used
      // to throw for the whole list, which left every chat past 24 hours with
      // nothing to send at all.
      return rows
        .flatMap((row) => {
          try {
            const template = parseNativeTemplate(row, accountId);
            return template ? [template] : [];
          } catch (error) {
            if (error instanceof UnsendableTemplateError) return [];
            throw new Error(TEMPLATE_LOAD_ERROR);
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    },

    async getWhatsAppConnectionReadiness(accountId) {
      try {
        return parseConnection(
          await source.findConnection(accountId),
          accountId
        );
      } catch {
        throw new Error(CONNECTION_LOAD_ERROR);
      }
    },
  };
}

function requireSelectedBranch(accountId: string): void {
  if (selectedBranchRef.get() !== accountId) {
    throw new Error(READINESS_UNAVAILABLE);
  }
}

export const mobileTemplateQuerySource: TemplateQuerySource = {
  async listTemplates(accountId) {
    requireSelectedBranch(accountId);
    const { data, error } = await mobileSupabase
      .from('message_templates')
      .select(TEMPLATE_SELECT)
      .eq('account_id', accountId)
      .eq('status', 'APPROVED')
      .in('category', ['Utility', 'Marketing'])
      .is('provider_missing_since', null)
      .is('provider_components_sync_required_at', null)
      .order('name', { ascending: true })
      .setHeader('x-usefuldesk-account-id', accountId);
    if (error || !data) throw new Error(READINESS_UNAVAILABLE);
    return data;
  },

  async findConnection(accountId) {
    requireSelectedBranch(accountId);
    const { data, error } = await mobileSupabase
      .from('whatsapp_config')
      .select('account_id, status, connected_at')
      .eq('account_id', accountId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .maybeSingle();
    if (error) throw new Error(READINESS_UNAVAILABLE);
    return data;
  },
};

export const mobileTemplateRepository = createTemplateRepository(
  mobileTemplateQuerySource
);

export function listSendableTemplates(
  accountId: string
): Promise<NativeTemplate[]> {
  return mobileTemplateRepository.listSendableTemplates(accountId);
}

export function getWhatsAppConnectionReadiness(
  accountId: string
): Promise<ConnectionReadiness> {
  return mobileTemplateRepository.getWhatsAppConnectionReadiness(accountId);
}
