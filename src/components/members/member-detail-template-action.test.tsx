// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Membership, MessageTemplate } from '@/types';

const fetchMock = vi.hoisted(() => vi.fn());
const localeMock = vi.hoisted(() => ({
  locale: {
    locale: 'en-IN',
    timeZone: 'Asia/Kolkata',
    measurementSystem: 'metric',
    weekStart: 1,
  },
  fmt: {
    today: () => '2026-08-22',
    date: (value: string) => value,
    dateTime: (value: string) => value,
    money: (value: number) => `₹${value}`,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/members',
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    canSendMessages: true,
    accountRole: 'owner',
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => localeMock,
}));

const membership: Membership = {
  id: 'membership-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  member_number: 101,
  user_id: 'user-1',
  plan_id: null,
  start_date: '2026-08-01',
  end_date: '2026-09-01',
  status: 'active',
  fee_amount: 2000,
  fee_status: 'paid',
  is_trial: false,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  contact: {
    id: 'contact-1',
    account_id: 'account-1',
    user_id: 'user-1',
    name: 'Rajad Kashab',
    phone: '9779208861',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  },
};

const template: MessageTemplate = {
  id: 'template-1',
  account_id: 'account-1',
  user_id: 'user-1',
  name: 'custom_notice',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Your membership is confirmed.',
  status: 'APPROVED',
  parameter_format: 'POSITIONAL',
  created_at: '2026-08-22T00:00:00.000Z',
};

function resultFor(table: string) {
  if (table === 'memberships') return { data: membership, error: null };
  if (table === 'message_templates') return { data: [template], error: null };
  return { data: [], error: null };
}

function makeQuery(table: string) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    gt: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () =>
      table === 'memberships' ? resultFor(table) : { data: null, error: null },
    single: async () => ({ data: null, error: null }),
    then(
      onFulfilled: (value: ReturnType<typeof resultFor>) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(resultFor(table)).then(onFulfilled, onRejected);
    },
  };
  return query;
}

const supabase = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: 'user-1' } },
      error: null,
    })),
  },
  from: vi.fn((table: string) => makeQuery(table)),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabase,
}));

vi.mock('@/lib/memberships/check-in', () => ({
  fetchCheckInUsage: vi.fn(async () => null),
}));

vi.mock('@/components/contacts/contact-notes-thread', () => ({
  ContactNotesThread: () => null,
}));
vi.mock('./copy-upi-link-button', () => ({
  CopyUpiLinkButton: () => null,
  useUpiConfig: () => null,
}));
vi.mock('./bmi-card', () => ({ BmiCard: () => null }));
vi.mock('./churn-risk-card', () => ({ ChurnRiskCard: () => null }));
vi.mock('./member-personal-info', () => ({ MemberPersonalInfo: () => null }));
vi.mock('./member-communication', () => ({ MemberCommunication: () => null }));
vi.mock('./member-danger-zone', () => ({ MemberDangerZone: () => null }));
vi.mock('./attendance-override-dialog', () => ({
  AttendanceOverrideDialog: () => null,
}));
vi.mock('./renew-membership-dialog', () => ({
  RenewMembershipDialog: () => null,
}));
vi.mock('./change-plan-dialog', () => ({ ChangePlanDialog: () => null }));
vi.mock('./avatar-editor-dialog', () => ({ AvatarEditorDialog: () => null }));
vi.mock('./set-up-autopay-dialog', () => ({ SetUpAutoPayDialog: () => null }));
vi.mock('./product-service-sale-dialog', () => ({
  ProductServiceSaleDialog: () => null,
}));
vi.mock('./reassign-trainer-dialog', () => ({
  ReassignTrainerDialog: () => null,
}));
vi.mock('./service-customer-detail-view', () => ({
  ServiceCustomerDetailView: () => null,
}));
vi.mock('@/components/finance/invoice-detail-dialog', () => ({
  InvoiceDetailDialog: () => null,
}));
vi.mock('@/components/finance/record-invoice-payment-dialog', () => ({
  RecordInvoicePaymentDialog: () => null,
}));
vi.mock('@/components/finance/void-invoice-payment-dialog', () => ({
  VoidInvoicePaymentDialog: () => null,
}));

const { MemberDetailView } = await import('./member-detail-view');

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  });
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('member profile template action', () => {
  it('opens the approved-template picker and sends to the member contact', async () => {
    const user = userEvent.setup();
    render(
      <MemberDetailView
        membershipId="membership-1"
        open
        onOpenChange={vi.fn()}
        readiness={{
          loading: false,
          ready: true,
          reason: null,
          resolution: null,
          templateName: 'gym_membership_renewal',
          templateLanguage: 'en_US',
        }}
        onChanged={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    const action = await screen.findByRole('button', { name: 'Template' });
    expect(within(action).getByTestId('provider-mark-whatsapp')).toBeTruthy();

    await user.click(action);
    expect(
      await screen.findByText(
        'Pick an approved WhatsApp template to send to this contact.'
      )
    ).toBeTruthy();

    await user.click(
      await screen.findByRole('button', { name: /Custom notice/ })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/whatsapp/send');
    expect(JSON.parse(String(init.body))).toMatchObject({
      contact_id: 'contact-1',
      message_type: 'template',
      template_name: 'custom_notice',
      template_language: 'en_US',
    });
  });
});
