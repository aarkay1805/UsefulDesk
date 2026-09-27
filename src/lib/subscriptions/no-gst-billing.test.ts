import { describe, expect, it } from 'vitest';
import { prepareBaseTierUpgrade } from './billing-transitions';
import {
  draftNoGstBaseUpgradeAmount,
  draftNoGstMonthlySaasAmount,
} from './no-gst-billing';

describe('unregistered Usefulmade no-GST billing drafts', () => {
  it('uses listed software amounts for each approved monthly package and adds zero GST', () => {
    expect(draftNoGstMonthlySaasAmount('starter', 1)).toEqual({
      merchantTaxMode: 'unregistered_no_gst',
      listedSoftwareMinor: 79900,
      gstMinor: 0,
      draftTotalMinor: 79900,
    });
    expect(draftNoGstMonthlySaasAmount('growth', 2)).toMatchObject({
      listedSoftwareMinor: 199800,
      gstMinor: 0,
      draftTotalMinor: 199800,
    });
    expect(draftNoGstMonthlySaasAmount('ultimate', 6)).toMatchObject({
      listedSoftwareMinor: 449800,
      gstMinor: 0,
      draftTotalMinor: 449800,
    });
  });

  it('keeps the prorated upgrade difference free of GST without changing its entitlement state', () => {
    const pending = prepareBaseTierUpgrade({
      requestId: 'upgrade-1',
      organizationId: 'org-1',
      fromTier: 'starter',
      toTier: 'growth',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-02-01T00:00:00.000Z',
      requestedAt: '2026-01-16T12:00:00.000Z',
    });
    expect(draftNoGstBaseUpgradeAmount(pending)).toEqual({
      merchantTaxMode: 'unregistered_no_gst',
      listedSoftwareMinor: 35000,
      gstMinor: 0,
      draftTotalMinor: 35000,
    });
    expect(pending.state).toBe('pending');
  });

  it('rejects branch counts that the selected tier cannot cover', () => {
    expect(() => draftNoGstMonthlySaasAmount('starter', 2)).toThrow(
      'cannot cover'
    );
    expect(() => draftNoGstMonthlySaasAmount('growth', 3)).toThrow(
      'cannot cover'
    );
    expect(() => draftNoGstMonthlySaasAmount('starter', 0)).toThrow(
      'positive integer'
    );
  });
});
