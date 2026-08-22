import type { TemplateButton, TemplateSampleValues } from '@/types';
import { normalizeStatus } from './template-status-normalize';

export const META_TEMPLATE_SYNC_FIELDS =
  'id,name,language,status,category,parameter_format,components,quality_score';

interface MetaButton {
  type: string;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
}

interface MetaTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: MetaButton[];
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
  };
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: string;
  components?: MetaTemplateComponent[];
  quality_score?: { score?: string } | string;
}

export interface LocalProviderTemplate {
  id: string;
  name: string;
  language: string;
  meta_template_id: string | null;
  provider_missing_since: string | null;
}

export function normalizeProviderSyncGeneration(value: unknown): number | null {
  const generation =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(generation) && generation > 0 ? generation : null;
}

export function providerSyncCasFilter(syncGeneration: number): string {
  return `provider_sync_generation.is.null,provider_sync_generation.lte.${syncGeneration}`;
}

export function findUnsafeMissingReconciliationIds(
  rows: Array<{
    id: string;
    status: string;
    provider_missing_since: string | null;
    provider_sync_generation: number | null;
  }>,
  syncGeneration: number
): string[] {
  return rows
    .filter((row) => {
      const safelyMissing =
        Boolean(row.provider_missing_since) && row.status !== 'APPROVED';
      const reconciledGeneration = row.provider_sync_generation;
      const superseded =
        reconciledGeneration !== null && reconciledGeneration > syncGeneration;
      return !safelyMissing && !superseded;
    })
    .map((row) => row.id);
}

export function findMissingProviderTemplates<T extends LocalProviderTemplate>(
  localTemplates: T[],
  metaTemplates: MetaTemplate[],
  snapshotComplete: boolean
): T[] {
  if (!snapshotComplete) return [];
  const providerIds = new Set(metaTemplates.map((template) => template.id));
  const providerKeys = new Set(
    metaTemplates.map(
      (template) => `${template.name}\u0000${template.language}`
    )
  );
  return localTemplates.filter(
    (template) =>
      template.meta_template_id !== null &&
      !template.meta_template_id.startsWith('dry-run-') &&
      !providerIds.has(template.meta_template_id) &&
      !providerKeys.has(`${template.name}\u0000${template.language}`)
  );
}

export function buildMissingProviderTemplateStateUpdate(
  updatedAt: string,
  syncGeneration: number
) {
  return {
    status: 'DISABLED' as const,
    provider_components_sync_required_at: null,
    quality_score: null,
    submission_error: null,
    rejection_reason: null,
    provider_sync_generation: syncGeneration,
    updated_at: updatedAt,
  };
}

export function buildMissingProviderTemplateUpdate(
  detectedAt: string,
  syncGeneration: number
) {
  return {
    ...buildMissingProviderTemplateStateUpdate(detectedAt, syncGeneration),
    provider_missing_since: detectedAt,
  };
}

function normalizeCategory(
  meta: string
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase();
  if (upper === 'UTILITY') return 'Utility';
  if (upper === 'AUTHENTICATION') return 'Authentication';
  return 'Marketing';
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score']
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null;
  if (!score) return null;
  const upper = score.toUpperCase();
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null;
}

function normalizeParameterFormat(
  raw: string | undefined
): 'POSITIONAL' | 'NAMED' | null {
  const upper = raw?.toUpperCase();
  return upper === 'POSITIONAL' || upper === 'NAMED' ? upper : null;
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return [];
  const out: TemplateButton[] = [];
  for (const button of metaButtons) {
    switch (button.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: button.text });
        break;
      case 'URL':
        out.push({
          type: 'URL',
          text: button.text,
          url: button.url ?? '',
          example: Array.isArray(button.example)
            ? button.example[0]
            : button.example,
        });
        break;
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: button.text,
          phone_number: button.phone_number ?? '',
        });
        break;
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: button.text,
          example: Array.isArray(button.example)
            ? (button.example[0] ?? '')
            : (button.example ?? ''),
        });
        break;
    }
  }
  return out;
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined
): TemplateSampleValues | null {
  const bodySample = body?.example?.body_text?.[0];
  const headerSample = header?.example?.header_text;
  if (!bodySample?.length && !headerSample?.length) return null;
  const values: TemplateSampleValues = {};
  if (bodySample?.length) values.body = bodySample;
  if (headerSample?.length) values.header = headerSample;
  return values;
}

export function buildSyncedTemplateRow(
  template: MetaTemplate,
  accountId: string,
  userId: string,
  syncGeneration: number,
  updatedAt = new Date().toISOString()
) {
  const body = (template.components ?? []).find(
    (component) => component.type === 'BODY'
  );
  const header = (template.components ?? []).find(
    (component) => component.type === 'HEADER'
  );
  const footer = (template.components ?? []).find(
    (component) => component.type === 'FOOTER'
  );
  const buttons = (template.components ?? []).find(
    (component) => component.type === 'BUTTONS'
  );
  const parsedButtons = parseButtons(buttons?.buttons);
  const status = normalizeStatus(template.status);
  const headerFormat = header?.format?.toUpperCase();
  const headerType =
    headerFormat === 'TEXT' ||
    headerFormat === 'IMAGE' ||
    headerFormat === 'VIDEO' ||
    headerFormat === 'DOCUMENT'
      ? headerFormat.toLowerCase()
      : null;

  return {
    account_id: accountId,
    user_id: userId,
    name: template.name,
    category: normalizeCategory(template.category),
    language: template.language,
    parameter_format: normalizeParameterFormat(template.parameter_format),
    header_type: headerType,
    header_content: header?.text ?? null,
    header_handle: header?.example?.header_handle?.[0] ?? null,
    body_text: body?.text ?? '',
    footer_text: footer?.text ?? null,
    buttons: parsedButtons.length ? parsedButtons : null,
    sample_values: extractSampleValues(body, header),
    status,
    meta_template_id: template.id,
    quality_score: normalizeQualityScore(template.quality_score),
    provider_components_sync_required_at: null,
    provider_missing_since: null,
    provider_sync_generation: syncGeneration,
    submission_error: null,
    ...(status !== 'REJECTED' && { rejection_reason: null }),
    updated_at: updatedAt,
  };
}
