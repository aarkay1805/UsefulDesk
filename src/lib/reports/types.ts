export type ReportRangeDays = 7 | 30 | 90;

export interface ReportMetric {
  current: number;
  previous: number;
}

export interface OwnerReport {
  period: {
    start: string;
    end: string;
    days: number;
  };
  metrics: {
    revenue: ReportMetric;
    newMembers: ReportMetric & { activeTotal: number };
    visits: ReportMetric;
    conversion: ReportMetric & {
      acquired: number;
      converted: number;
    };
  };
  attention: {
    renewalsDue: number;
    outstandingDues: number;
    outstandingAmount: number;
    inactiveMembers: number;
    churnRisk: number;
    trialFollowups: number;
    failedMandates: number;
  };
  trend: Array<{
    date: string;
    revenue: number;
    visits: number;
    newMembers: number;
    acquired: number;
    converted: number;
  }>;
  plans: Array<{
    id: string;
    name: string;
    activeMembers: number;
    newMembers: number;
    revenue: number;
    visits: number;
  }>;
  sources: Array<{
    source: string;
    label: string;
    leads: number;
    members: number;
    conversionRate: number;
  }>;
  collectionMethods: Array<{
    method: string;
    payments: number;
    amount: number;
  }>;
  collectionSources: Array<{
    source: string;
    payments: number;
    amount: number;
  }>;
}
