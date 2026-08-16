import { describe, expect, it } from 'vitest';
import type { CatalogItem, CatalogOption, Trainer, TrainerRate } from '@/types';
import { buildImportedServiceIntent } from './member-import-services';

function option(overrides: Partial<CatalogOption> = {}): CatalogOption {
  return {
    id: 'option-1',
    account_id: 'account-1',
    item_id: 'service-1',
    duration_count: 1,
    duration_unit: 'month',
    standard_price: 4_000,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function service(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'service-1',
    account_id: 'account-1',
    kind: 'service',
    name: 'Personal training',
    description: null,
    requires_trainer: false,
    is_active: true,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    catalog_options: [option()],
    ...overrides,
  };
}

function trainer(overrides: Partial<Trainer> = {}): Trainer {
  return {
    id: 'trainer-1',
    account_id: 'account-1',
    display_name: 'Meera Singh',
    title: null,
    linked_user_id: null,
    is_active: true,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function rate(overrides: Partial<TrainerRate> = {}): TrainerRate {
  return {
    id: 'rate-1',
    account_id: 'account-1',
    trainer_id: 'trainer-1',
    option_id: 'option-1',
    price: 5_000,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const context = {
  dateOrder: 'DMY' as const,
  today: '2026-08-16',
};

describe('service-aware member import resolution', () => {
  it('matches only active services and options', () => {
    const result = buildImportedServiceIntent(
      {
        serviceName: 'Personal training',
        serviceOption: '1 month',
      },
      {
        catalogItems: [service({ is_active: false })],
        trainers: [],
        trainerRates: [],
      },
      context
    );

    expect(result.intent).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain(
      'service-unresolved'
    );
  });

  it('requires the selected trainer rate without falling back to standard price', () => {
    const result = buildImportedServiceIntent(
      {
        serviceName: 'Personal training',
        serviceOption: '1 month',
        trainerName: 'Meera Singh',
      },
      {
        catalogItems: [service({ requires_trainer: true })],
        trainers: [trainer()],
        trainerRates: [],
      },
      context
    );

    expect(result.intent).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain(
      'trainer-rate-missing'
    );
  });

  it('uses the configured price when sold price is blank', () => {
    const result = buildImportedServiceIntent(
      { serviceName: 'Personal training', serviceOption: '1 month' },
      {
        catalogItems: [service()],
        trainers: [],
        trainerRates: [],
      },
      context
    );

    expect(result.intent).toMatchObject({
      soldAmount: 4_000,
      configuredAmount: 4_000,
      startDate: '2026-08-16',
      endDate: '2026-09-16',
    });
  });

  it('preserves an explicit sold price and explicit expiry with a visible mismatch notice', () => {
    const result = buildImportedServiceIntent(
      {
        serviceName: 'Personal training',
        serviceOption: '1 month',
        startDate: '01/08/2026',
        endDate: '15/09/2026',
        soldPrice: '₹4,500',
      },
      {
        catalogItems: [service()],
        trainers: [],
        trainerRates: [],
      },
      context
    );

    expect(result.intent).toMatchObject({
      soldAmount: 4_500,
      configuredAmount: 4_000,
      startDate: '2026-08-01',
      endDate: '2026-09-15',
    });
    expect(result.notices.map((notice) => notice.code)).toContain(
      'service-expiry-override'
    );
  });

  it('blocks invalid dates and negative or malformed sold prices', () => {
    const result = buildImportedServiceIntent(
      {
        serviceName: 'Personal training',
        serviceOption: '1 month',
        startDate: '31/02/2026',
        endDate: 'nope',
        soldPrice: '-20',
      },
      {
        catalogItems: [service()],
        trainers: [],
        trainerRates: [],
      },
      context
    );

    expect(result.intent).toBeNull();
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        'service-start-invalid',
        'service-end-invalid',
        'service-price-invalid',
      ])
    );
  });

  it('creates a cancelled snapshot without refund semantics', () => {
    const result = buildImportedServiceIntent(
      {
        serviceName: 'Personal training',
        serviceOption: '1 month',
        status: 'cancelled',
      },
      {
        catalogItems: [service()],
        trainers: [],
        trainerRates: [],
      },
      context
    );

    expect(result.intent?.status).toBe('cancelled');
    expect(result.intent).not.toHaveProperty('refund');
  });

  it('ignores a trainer on a non-trainer service only with a visible notice', () => {
    const result = buildImportedServiceIntent(
      {
        serviceName: 'Personal training',
        serviceOption: '1 month',
        trainerName: 'Meera Singh',
      },
      {
        catalogItems: [service()],
        trainers: [trainer()],
        trainerRates: [rate()],
      },
      context
    );

    expect(result.intent?.trainerId).toBeNull();
    expect(result.notices.map((notice) => notice.code)).toContain(
      'trainer-ignored'
    );
  });
});
