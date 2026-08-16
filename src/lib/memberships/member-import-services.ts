import { optionEndDate, durationLabel } from '@/lib/memberships/pricing';
import type { DateOrder } from '@/lib/leads/import-coerce';
import type {
  CatalogItem,
  CatalogOption,
  MemberServiceStatus,
  Trainer,
  TrainerRate,
} from '@/types';
import { parseImportDate, parseMoney } from './import-commit';

export interface MemberImportServiceFacts {
  catalogItems: CatalogItem[];
  trainers: Trainer[];
  trainerRates: TrainerRate[];
}

export interface MemberImportServiceInput {
  serviceName: string;
  serviceOption?: string;
  trainerName?: string;
  startDate?: string;
  fallbackStartDate?: string;
  endDate?: string;
  soldPrice?: string;
  status?: string;
  resolution?: {
    itemId?: string | null;
    optionId?: string | null;
    trainerId?: string | null;
  };
}

export type MemberImportServiceIssueCode =
  | 'service-unresolved'
  | 'service-option-unresolved'
  | 'trainer-unresolved'
  | 'trainer-required'
  | 'trainer-rate-missing'
  | 'service-start-invalid'
  | 'service-end-invalid'
  | 'service-date-range-invalid'
  | 'service-price-invalid'
  | 'service-price-unavailable';

export type MemberImportServiceNoticeCode =
  'service-expiry-override' | 'trainer-ignored';

export interface MemberImportServiceIssue {
  code: MemberImportServiceIssueCode;
  message: string;
}

export interface MemberImportServiceNotice {
  code: MemberImportServiceNoticeCode;
  message: string;
}

export interface ImportedServiceIntent {
  itemId: string;
  itemName: string;
  optionId: string;
  optionLabel: string;
  trainerId: string | null;
  trainerName: string | null;
  startDate: string;
  endDate: string;
  soldAmount: number;
  configuredAmount: number | null;
  status: MemberServiceStatus;
  requiresTrainer: boolean;
  explicitPrice: boolean;
  explicitEndDate: boolean;
}

export interface ImportedServiceResolutionResult {
  intent: ImportedServiceIntent | null;
  errors: MemberImportServiceIssue[];
  notices: MemberImportServiceNotice[];
}

function normalized(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function activeServiceMatches(
  input: MemberImportServiceInput,
  items: CatalogItem[]
): CatalogItem[] {
  const active = items.filter(
    (item) => item.kind === 'service' && item.is_active
  );
  if (input.resolution?.itemId) {
    return active.filter((item) => item.id === input.resolution?.itemId);
  }
  const wanted = normalized(input.serviceName);
  return active.filter((item) => normalized(item.name) === wanted);
}

function optionLabel(option: CatalogOption): string | null {
  if (option.duration_count === null || option.duration_unit === null) {
    return null;
  }
  return durationLabel(option.duration_count, option.duration_unit);
}

function activeOptionMatches(
  input: MemberImportServiceInput,
  item: CatalogItem
): CatalogOption[] {
  const active = (item.catalog_options ?? [])
    .filter(
      (option) =>
        option.is_active &&
        option.item_id === item.id &&
        option.duration_count !== null &&
        option.duration_unit !== null
    )
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
    );
  if (input.resolution?.optionId) {
    return active.filter((option) => option.id === input.resolution?.optionId);
  }
  const wanted = normalized(input.serviceOption);
  if (!wanted) return active.length === 1 ? active : [];
  return active.filter((option) => normalized(optionLabel(option)) === wanted);
}

function activeTrainerMatches(
  input: MemberImportServiceInput,
  trainers: Trainer[]
): Trainer[] {
  const active = trainers.filter((trainer) => trainer.is_active);
  if (input.resolution?.trainerId) {
    return active.filter(
      (trainer) => trainer.id === input.resolution?.trainerId
    );
  }
  const wanted = normalized(input.trainerName);
  if (!wanted) return [];
  return active.filter(
    (trainer) => normalized(trainer.display_name) === wanted
  );
}

function serviceStatus(
  sourceStatus: string | undefined,
  startDate: string,
  endDate: string,
  today: string
): MemberServiceStatus {
  if (normalized(sourceStatus) === 'cancelled') return 'cancelled';
  if (startDate > today) return 'upcoming';
  if (endDate < today) return 'expired';
  return 'active';
}

export function buildImportedServiceIntent(
  input: MemberImportServiceInput,
  facts: MemberImportServiceFacts,
  context: { dateOrder: DateOrder; today: string }
): ImportedServiceResolutionResult {
  const errors: MemberImportServiceIssue[] = [];
  const notices: MemberImportServiceNotice[] = [];
  const itemMatches = activeServiceMatches(input, facts.catalogItems);
  if (itemMatches.length !== 1) {
    errors.push({
      code: 'service-unresolved',
      message: 'Choose one active service for this source value.',
    });
    return { intent: null, errors, notices };
  }
  const item = itemMatches[0];
  const optionMatches = activeOptionMatches(input, item);
  if (optionMatches.length !== 1) {
    errors.push({
      code: 'service-option-unresolved',
      message: 'Choose one active duration option for this service.',
    });
    return { intent: null, errors, notices };
  }
  const option = optionMatches[0];

  let selectedTrainer: Trainer | null = null;
  let configuredAmount: number | null =
    option.standard_price === null ? null : Number(option.standard_price);
  if (item.requires_trainer) {
    const trainerMatches = activeTrainerMatches(input, facts.trainers);
    if (!normalized(input.trainerName) && !input.resolution?.trainerId) {
      errors.push({
        code: 'trainer-required',
        message: 'Choose an active trainer for this service.',
      });
    } else if (trainerMatches.length !== 1) {
      errors.push({
        code: 'trainer-unresolved',
        message: 'Choose one active trainer for this source value.',
      });
    } else {
      selectedTrainer = trainerMatches[0];
      const rates = facts.trainerRates.filter(
        (rate) =>
          rate.is_active &&
          rate.trainer_id === selectedTrainer?.id &&
          rate.option_id === option.id
      );
      if (rates.length !== 1) {
        errors.push({
          code: 'trainer-rate-missing',
          message:
            'The selected trainer needs one active rate for this service option.',
        });
      } else {
        configuredAmount = Number(rates[0].price);
      }
    }
  } else if (normalized(input.trainerName) || input.resolution?.trainerId) {
    notices.push({
      code: 'trainer-ignored',
      message:
        'This service does not use a trainer, so the trainer is ignored.',
    });
  }

  const rawStart = input.startDate?.trim() || input.fallbackStartDate?.trim();
  const startDate = rawStart
    ? parseImportDate(rawStart, context.dateOrder)
    : context.today;
  if (rawStart && !startDate) {
    errors.push({
      code: 'service-start-invalid',
      message: 'Enter a valid service start date.',
    });
  }

  const explicitEnd = input.endDate?.trim()
    ? parseImportDate(input.endDate, context.dateOrder)
    : null;
  if (input.endDate?.trim() && !explicitEnd) {
    errors.push({
      code: 'service-end-invalid',
      message: 'Enter a valid service expiry date.',
    });
  }
  const calculatedEnd =
    startDate && option.duration_count !== null && option.duration_unit !== null
      ? optionEndDate(startDate, {
          duration_count: option.duration_count,
          duration_unit: option.duration_unit,
        })
      : null;
  const endDate = explicitEnd ?? calculatedEnd;
  if (startDate && endDate && endDate <= startDate) {
    errors.push({
      code: 'service-date-range-invalid',
      message: 'Service expiry must be after its start date.',
    });
  }
  if (explicitEnd && calculatedEnd && explicitEnd !== calculatedEnd) {
    notices.push({
      code: 'service-expiry-override',
      message: `Source expiry ${explicitEnd} overrides calculated expiry ${calculatedEnd}.`,
    });
  }

  const explicitPrice = Boolean(input.soldPrice?.trim());
  const soldAmount = explicitPrice
    ? parseMoney(input.soldPrice ?? '')
    : configuredAmount;
  if (explicitPrice && (soldAmount === null || soldAmount < 0)) {
    errors.push({
      code: 'service-price-invalid',
      message: 'Enter a valid non-negative sold price.',
    });
  } else if (soldAmount === null || soldAmount < 0) {
    errors.push({
      code: 'service-price-unavailable',
      message: 'Configure an active price for this service option.',
    });
  }

  if (errors.length > 0 || !startDate || !endDate || soldAmount === null) {
    return { intent: null, errors, notices };
  }
  return {
    intent: {
      itemId: item.id,
      itemName: item.name,
      optionId: option.id,
      optionLabel: optionLabel(option) ?? '',
      trainerId: selectedTrainer?.id ?? null,
      trainerName: selectedTrainer?.display_name ?? null,
      startDate,
      endDate,
      soldAmount,
      configuredAmount,
      status: serviceStatus(input.status, startDate, endDate, context.today),
      requiresTrainer: item.requires_trainer,
      explicitPrice,
      explicitEndDate: Boolean(explicitEnd),
    },
    errors,
    notices,
  };
}
