import type { LocaleFormatters } from '../../../../../src/lib/locale/format';
import {
  getTemplateContract,
  type TemplateContractId,
} from '../../../../../src/lib/whatsapp/template-contracts';

import type { NativeTemplate, TemplateField } from './inbox-types';
import { templateFields } from './template-repository';

export type TemplateValues = Record<string, string>;

type TemplateValueSource =
  | 'contact_name'
  | 'legal_name'
  | 'membership_plan'
  | 'membership_end_date'
  | 'membership_fee';

export interface TemplateInput {
  key: string;
  field: TemplateField;
  label: string;
  /**
   * The server fills this value on every send (the legal business name of a
   * wired template), so it is never shown as something to type.
   */
  automatic: boolean;
  source: TemplateValueSource | null;
}

export interface TemplatePresentation {
  template: NativeTemplate;
  title: string;
  inputs: TemplateInput[];
  usesMembership: boolean;
  usesLegalName: boolean;
}

export interface TemplateMembershipDetails {
  planName: string | null;
  endDate: string | null;
  feeAmount: number | null;
}

export interface TemplateContext {
  contactName: string | null;
  legalName: string | null;
  membership: TemplateMembershipDetails | null;
}

export type PreviewSegment =
  | { kind: 'text'; text: string }
  | { kind: 'value'; text: string }
  | { kind: 'missing'; text: string };

/** Only these read the member's own membership, the way the website does. */
const MEMBERSHIP_CONTRACTS = new Set<TemplateContractId>([
  'membership_renewal',
  'membership_post_expiry',
  'membership_win_back',
]);

const NAME_LABELS = new Set(['Member name', 'Customer name']);
const LEGAL_NAME_LABEL = 'Legal business name';
const MEMBERSHIP_LABEL_SOURCES: Record<string, TemplateValueSource> = {
  'Plan name': 'membership_plan',
  'Membership end date': 'membership_end_date',
  'Current renewal price': 'membership_fee',
};

export function fieldKey(field: TemplateField): string {
  switch (field.kind) {
    case 'body':
      return `body:${field.variable}`;
    case 'header':
      return 'header';
    case 'button':
      return `button:${field.buttonIndex}`;
  }
}

function humanizeTemplateName(name: string): string {
  const words = name
    .replace(/^gym_/, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Message template';
}

function buttonInputLabel(
  template: NativeTemplate,
  field: Extract<TemplateField, { kind: 'button' }>
): string {
  const button = template.buttons[field.buttonIndex];
  return button?.type === 'COPY_CODE'
    ? `Code for the “${field.label}” button`
    : `Link for the “${field.label}” button`;
}

export function presentTemplate(
  template: NativeTemplate
): TemplatePresentation {
  const contract = getTemplateContract(template.name);
  const fields = templateFields(template);
  const bodyCount = fields.filter((field) => field.kind === 'body').length;
  // A contract names the values only when this approved copy still has the
  // contract's shape. An older approved version keeps plain labels rather
  // than being told the wrong thing about each blank.
  const labels =
    contract && contract.parameterLabels.length === bodyCount
      ? contract.parameterLabels
      : null;
  const usesMembership =
    labels !== null && contract ? MEMBERSHIP_CONTRACTS.has(contract.id) : false;

  const inputs = fields.map((field): TemplateInput => {
    const key = fieldKey(field);
    if (field.kind === 'header') {
      return {
        key,
        field,
        label: 'Title text',
        automatic: false,
        source: null,
      };
    }
    if (field.kind === 'button') {
      return {
        key,
        field,
        label: buttonInputLabel(template, field),
        automatic: false,
        source: null,
      };
    }
    const label = labels?.[field.variable - 1] ?? field.label;
    const isLegalName = label === LEGAL_NAME_LABEL;
    const source: TemplateValueSource | null = NAME_LABELS.has(label)
      ? 'contact_name'
      : isLegalName
        ? 'legal_name'
        : usesMembership
          ? (MEMBERSHIP_LABEL_SOURCES[label] ?? null)
          : null;
    return {
      key,
      field,
      label,
      // The send route replaces the last value of a wired template with the
      // branch's legal name, so asking for it would only invite a mismatch.
      automatic:
        isLegalName && Boolean(contract?.wired) && field.variable === bodyCount,
      source,
    };
  });

  return {
    template,
    title: contract?.title ?? humanizeTemplateName(template.name),
    inputs,
    usesMembership,
    usesLegalName: inputs.some((input) => input.source === 'legal_name'),
  };
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

/**
 * Values the app can fill before the reader types anything. The reader's own
 * edits always win: callers layer their edits over this result.
 */
export function prefillTemplateValues(
  presentation: TemplatePresentation,
  context: TemplateContext,
  fmt: Pick<LocaleFormatters, 'date' | 'money'>
): TemplateValues {
  const membership = context.membership;
  const valueFor = (source: TemplateValueSource | null): string => {
    switch (source) {
      case 'contact_name':
        return trimmed(context.contactName);
      case 'legal_name':
        return trimmed(context.legalName);
      case 'membership_plan':
        return trimmed(membership?.planName);
      case 'membership_end_date':
        return membership?.endDate ? fmt.date(membership.endDate) : '';
      case 'membership_fee':
        return membership?.feeAmount != null
          ? fmt.money(membership.feeAmount)
          : '';
      case null:
        return '';
    }
  };

  const values: TemplateValues = {};
  for (const input of presentation.inputs) {
    const value =
      input.field.kind === 'button'
        ? trimmed(input.field.defaultValue)
        : valueFor(input.source);
    if (value) values[input.key] = value;
  }
  return values;
}

export function templateSearchText(presentation: TemplatePresentation): string {
  const { template } = presentation;
  return [presentation.title, template.headerContent ?? '', template.bodyText]
    .join(' ')
    .toLowerCase();
}

export function matchesTemplateQuery(
  presentation: TemplatePresentation,
  query: string
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = templateSearchText(presentation);
  return words.every((word) => haystack.includes(word));
}

/**
 * Splits approved copy into what the customer will read. Filled blanks are
 * marked so the preview can show them; an empty blank shows its label in
 * brackets so the reader sees exactly what is still missing.
 */
export function previewSegments(
  text: string,
  prefix: 'body' | 'header',
  presentation: TemplatePresentation,
  values: TemplateValues
): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\{\{(\d+)\}\}/g)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, index) });
    }
    const key = prefix === 'header' ? 'header' : `body:${match[1]}`;
    const value = values[key]?.trim();
    const label =
      presentation.inputs.find((input) => input.key === key)?.label ??
      `Message detail ${match[1]}`;
    segments.push(
      value
        ? { kind: 'value', text: value }
        : { kind: 'missing', text: `[${label}]` }
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

export function previewText(
  text: string,
  prefix: 'body' | 'header',
  presentation: TemplatePresentation,
  values: TemplateValues
): string {
  return previewSegments(text, prefix, presentation, values)
    .map((segment) => segment.text)
    .join('');
}
