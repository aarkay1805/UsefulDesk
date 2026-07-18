import { describe, expect, it } from 'vitest';
import {
  aggregateOwnerReport,
  normalizeOwnerReport,
  ownerReportCsv,
  relativeChange,
  reportDateRange,
} from './reporting';

describe('owner reporting helpers', () => {
  it('builds inclusive calendar ranges across month boundaries', () => {
    expect(reportDateRange('2026-07-18', 7)).toEqual({
      start: '2026-07-12',
      end: '2026-07-18',
    });
    expect(reportDateRange('2026-03-01', 30)).toEqual({
      start: '2026-01-31',
      end: '2026-03-01',
    });
  });

  it('handles previous-period percentage baselines', () => {
    expect(relativeChange(120, 100)).toBe(20);
    expect(relativeChange(80, 100)).toBe(-20);
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange(25, 0)).toBeNull();
  });

  it('normalizes Postgres numeric strings and account source labels', () => {
    const report = normalizeOwnerReport(
      {
        period: { start: '2026-07-12', end: '2026-07-18', days: 7 },
        metrics: {
          revenue: { current: '12500.50', previous: '10000' },
          newMembers: { current: '4', previous: 2, activeTotal: '98' },
          visits: { current: 31, previous: '29' },
          conversion: {
            current: '40.0',
            previous: 25,
            acquired: '10',
            converted: '4',
          },
        },
        attention: { outstandingAmount: '3750.25' },
        trend: [{ date: '2026-07-18', revenue: '2500', visits: '9' }],
        sources: [
          {
            source: 'walk_in',
            leads: '3',
            members: '2',
            conversionRate: '40',
          },
        ],
      },
      new Map([['walk_in', 'Front desk']])
    );

    expect(report.metrics.revenue.current).toBe(12500.5);
    expect(report.metrics.newMembers.activeTotal).toBe(98);
    expect(report.attention.outstandingAmount).toBe(3750.25);
    expect(report.trend[0]).toMatchObject({ visits: 9, newMembers: 0 });
    expect(report.sources[0]).toMatchObject({
      label: 'Front desk',
      members: 2,
    });
  });

  it('escapes labels in the full CSV export', () => {
    const report = normalizeOwnerReport({
      period: { start: '2026-07-12', end: '2026-07-18', days: 7 },
      metrics: {},
      plans: [{ id: '1', name: 'Gold, annual' }],
    });
    const csv = ownerReportCsv(report);

    expect(csv).toContain('"Gold, annual"');
    expect(csv).toContain('Date,Revenue,Visits,New members');
  });

  it('aggregates the exact paginated compatibility dataset', () => {
    const report = aggregateOwnerReport(
      {
        payments: [
          {
            amount: '1000',
            method: 'upi',
            source: 'manual',
            paid_at: '2026-07-18T10:00:00Z',
            plan_id: 'plan-1',
          },
          {
            amount: 500,
            method: 'cash',
            source: 'manual',
            paid_at: '2026-07-11T10:00:00Z',
            plan_id: 'plan-1',
          },
        ],
        attendance: [
          {
            checked_in_at: '2026-07-18T08:00:00Z',
            membership_id: 'member-1',
          },
        ],
        memberships: [
          {
            id: 'member-1',
            contact_id: 'contact-1',
            plan_id: 'plan-1',
            is_trial: false,
            converted_at: null,
            created_at: '2026-07-18T07:00:00Z',
            status: 'active',
            end_date: '2026-07-20',
          },
          {
            id: 'trial-1',
            contact_id: 'contact-2',
            plan_id: null,
            is_trial: true,
            converted_at: null,
            created_at: '2026-07-15T07:00:00Z',
            status: 'active',
            end_date: '2026-07-19',
          },
        ],
        contacts: [
          {
            id: 'contact-1',
            source: 'referral',
            churn_risk: true,
            created_at: '2026-07-18T06:00:00Z',
          },
          {
            id: 'contact-2',
            source: 'walk_in',
            churn_risk: false,
            created_at: '2026-07-15T06:00:00Z',
          },
        ],
        plans: [
          {
            id: 'plan-1',
            name: 'Monthly',
            is_active: true,
            plan_type: 'recurring',
          },
        ],
        dues: [{ membership_id: 'member-1', balance: '250' }],
        activity: [
          {
            membership_id: 'member-1',
            status: 'active',
            is_trial: false,
            end_date: '2026-07-20',
            last_visit_at: '2026-07-01T08:00:00Z',
          },
        ],
        mandates: [{ membership_id: 'member-1', status: 'failed' }],
      },
      { start: '2026-07-12', end: '2026-07-18' },
      'UTC',
      new Map([['referral', 'Member referral']]),
      new Date('2026-07-18T12:00:00Z')
    );

    expect(report.metrics.revenue).toEqual({ current: 1000, previous: 500 });
    expect(report.metrics.newMembers.current).toBe(1);
    expect(report.metrics.visits.current).toBe(1);
    expect(report.metrics.conversion).toMatchObject({
      acquired: 2,
      converted: 1,
      current: 50,
    });
    expect(report.attention).toMatchObject({
      renewalsDue: 1,
      outstandingDues: 1,
      inactiveMembers: 1,
      churnRisk: 1,
      trialFollowups: 1,
      failedMandates: 1,
    });
    expect(report.plans[0]).toMatchObject({
      name: 'Monthly',
      activeMembers: 1,
      newMembers: 1,
      revenue: 1000,
      visits: 1,
    });
    expect(report.sources[0].label).toBe('Member referral');
  });
});
