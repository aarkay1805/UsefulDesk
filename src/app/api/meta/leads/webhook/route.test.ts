import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addContactTags: vi.fn(),
  resolveAuditUserId: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  verifyMetaWebhookSignature: vi.fn(),
  fetchLeadgenLead: vi.fn(),
  mapMetaLeadFields: vi.fn(),
}));

vi.mock('@/lib/api/v1/contacts', () => ({
  addContactTags: mocks.addContactTags,
  resolveAuditUserId: mocks.resolveAuditUserId,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));
vi.mock('@/lib/leads/meta-field-mapping', () => ({
  mapMetaLeadFields: mocks.mapMetaLeadFields,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  fetchLeadgenLead: mocks.fetchLeadgenLead,
}));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: mocks.verifyMetaWebhookSignature,
}));

const notes: string[] = [];
let completionAttempts = 0;
let failFirstCompletion = true;
let retainedCapture: {
  contact_id: string;
  created_contact: boolean;
  automation_dispatched: boolean;
} | null = null;

function queryFor(table: string) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => {
      if (table === 'meta_page_config') {
        return {
          data: {
            id: 'config-1',
            account_id: 'account-1',
            page_access_token: 'encrypted',
          },
          error: null,
        };
      }
      if (table === 'accounts') {
        return { data: { phone_country_code: '+91' }, error: null };
      }
      return { data: null, error: null };
    }),
    update: vi.fn(() => {
      return query;
    }),
  };

  return query;
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => queryFor(table),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === 'claim_meta_lead_webhook_event') {
        return Promise.resolve({ data: 'claimed', error: null });
      }
      if (name === 'capture_meta_lead_webhook_event') {
        return {
          single: async () => {
            if (!retainedCapture) {
              notes.push(
                `New lead from a Meta lead ad.\n${args.p_note_details as string}`
              );
              retainedCapture = {
                contact_id: 'contact-1',
                created_contact: true,
                automation_dispatched: false,
              };
            }
            return { data: { ...retainedCapture }, error: null };
          },
        };
      }
      if (name === 'mark_meta_lead_automation_dispatched') {
        if (retainedCapture) retainedCapture.automation_dispatched = true;
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'complete_meta_lead_webhook_event') {
        completionAttempts += 1;
        if (failFirstCompletion && completionAttempts === 1) {
          return Promise.resolve({
            data: false,
            error: new Error('transient completion failure'),
          });
        }
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'fail_meta_lead_webhook_event') {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  }),
}));

import { POST } from './route';

function request() {
  return new Request('http://localhost/api/meta/leads/webhook', {
    method: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=test' },
    body: JSON.stringify({
      object: 'page',
      entry: [
        {
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lead-1',
                page_id: 'page-1',
              },
            },
          ],
        },
      ],
    }),
  });
}

describe('Meta lead webhook retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notes.length = 0;
    completionAttempts = 0;
    failFirstCompletion = true;
    retainedCapture = null;
    mocks.verifyMetaWebhookSignature.mockReturnValue(true);
    mocks.fetchLeadgenLead.mockResolvedValue({
      platform: 'fb',
      field_data: [],
    });
    mocks.mapMetaLeadFields.mockReturnValue({
      phone: '9876543210',
      name: 'Retry Lead',
      email: null,
      extras: [{ label: 'Goal', value: 'Strength' }],
    });
    mocks.resolveAuditUserId.mockResolvedValue('user-1');
    mocks.addContactTags.mockResolvedValue(undefined);
  });

  it('retains the original creation state and note across a partial retry', async () => {
    expect((await POST(request())).status).toBe(500);
    expect((await POST(request())).status).toBe(200);

    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith({
      accountId: 'account-1',
      triggerType: 'new_contact_created',
      contactId: 'contact-1',
    });
    expect(notes).toEqual(['New lead from a Meta lead ad.\nGoal: Strength']);
  });

  it('keeps goal tagging non-blocking after the durable capture', async () => {
    failFirstCompletion = false;
    mocks.addContactTags.mockRejectedValueOnce(new Error('tag write failed'));

    expect((await POST(request())).status).toBe(200);

    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledTimes(1);
    expect(notes).toEqual(['New lead from a Meta lead ad.\nGoal: Strength']);
  });
});
