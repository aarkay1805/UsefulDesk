import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  liveBillingConfig,
  liveMonthlyCheckoutEnabled,
  liveSettlementsEnabled,
} = vi.hoisted(() => ({
  liveBillingConfig: vi.fn(),
  liveMonthlyCheckoutEnabled: vi.fn(),
  liveSettlementsEnabled: vi.fn(),
}));
vi.mock('./live-provider', () => ({
  liveBillingConfig,
  liveMonthlyCheckoutEnabled,
  liveSettlementsEnabled,
}));
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import {
  MONTHLY_REVIEW_AGAIN,
  monthlyInitiationOpen,
  monthlyRoute,
  monthlyRouteJson,
  monthlyRpcError,
} from './monthly-route';

const config = {
  merchantId: 'acc_Synthetic',
  keyId: 'rzp_live_Synthetic',
  keySecret: 'synthetic-secret',
  webhookSecret: 'synthetic-hook',
  pilotOrganizationId: '99999999-9999-4999-8999-999999999999',
};
const fallback = 'Could not prepare payment. Contact support.';
const request = new Request(
  'https://desk.example/api/subscriptions/monthly-quotes',
  {
    method: 'POST',
  }
);

beforeEach(() => {
  vi.resetAllMocks();
  liveMonthlyCheckoutEnabled.mockReturnValue(true);
  liveSettlementsEnabled.mockReturnValue(true);
  liveBillingConfig.mockReturnValue(config);
});
afterEach(() => vi.restoreAllMocks());

describe('shared monthly route boundary', () => {
  it.each(['monthly', 'settlement', 'configuration'])(
    'closes %s before running handler work',
    async (closed) => {
      if (closed === 'monthly')
        liveMonthlyCheckoutEnabled.mockReturnValue(false);
      if (closed === 'settlement')
        liveSettlementsEnabled.mockReturnValue(false);
      if (closed === 'configuration')
        liveBillingConfig.mockImplementation(() => {
          throw new Error('Private setup detail');
        });
      const handler = vi.fn();
      const response = await monthlyRoute(fallback, handler)(request);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it.each([200, 202, 400, 403, 409, 429, 500])(
    'keeps handler status %s and overwrites cache policy while preserving other headers',
    async (status) => {
      const output = monthlyRouteJson({ result: 'synthetic' }, status);
      output.headers.set('Cache-Control', 'public, max-age=300');
      output.headers.set('Retry-After', '60');
      const handler = vi.fn().mockResolvedValue(output);
      const response = await monthlyRoute(fallback, handler)(request);
      expect(handler).toHaveBeenCalledWith(request, config);
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(await response.json()).toEqual({ result: 'synthetic' });
    }
  );

  it.each([
    {
      error: new ForbiddenError('Only the gym owner can choose a plan'),
      status: 403,
      message: 'Only the gym owner can choose a plan',
    },
    { error: new UnauthorizedError(), status: 401, message: 'Unauthorized' },
    {
      error: new Error('Private internal failure'),
      status: 500,
      message: fallback,
    },
  ])(
    'preserves safe classified exception status $status and copy',
    async ({ error, status, message }) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn().mockRejectedValue(error);
      const response = await monthlyRoute(fallback, handler)(request);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  );

  it.each([
    { code: '42501', status: 403, message: 'Only the gym owner can do this' },
    ...['22023', '23505', '55000', '40001'].map((code) => ({
      code,
      status: 409,
      message: MONTHLY_REVIEW_AGAIN,
    })),
    { code: 'XX000', status: 500, message: fallback },
    { code: undefined, status: 500, message: fallback },
  ])(
    'classifies SQL $code without exposing private detail',
    async ({ code, status, message }) => {
      const error = { code, message: 'Private SQL detail' };
      const response = await monthlyRoute(fallback, async () =>
        monthlyRpcError(error, fallback)
      )(request);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  );

  it('rereads initiation flags for handler containment checks', () => {
    expect(monthlyInitiationOpen()).toBe(true);
    liveMonthlyCheckoutEnabled.mockReturnValue(false);
    expect(monthlyInitiationOpen()).toBe(false);
  });
});
