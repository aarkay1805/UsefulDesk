import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addContactTags: vi.fn(),
  resolveAuditUserId: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  decrypt: vi.fn(),
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
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/meta-api')>();
  return { ...actual, fetchLeadgenLead: mocks.fetchLeadgenLead };
});
vi.mock('@/lib/leads/meta-field-mapping', () => ({
  mapMetaLeadFields: mocks.mapMetaLeadFields,
}));

import { processOwnedMetaLeadEvent } from './lead-ingestion';

type RpcCall = { name: string; args: Record<string, unknown> };

function adminFixture(options?: {
  capture?: {
    contact_id: string;
    created_contact: boolean;
    automation_dispatched: boolean;
  };
}) {
  const rpcCalls: RpcCall[] = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  const admin = {
    from(table: string) {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        update: vi.fn((values: Record<string, unknown>) => {
          updates.push({ table, values });
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          if (table === 'meta_page_config') {
            return {
              data: {
                id: 'config-1',
                account_id: 'account-1',
                page_id: 'page-1',
                page_access_token: 'encrypted-token',
                credential_generation: 3,
              },
              error: null,
            };
          }
          if (table === 'accounts') {
            return { data: { phone_country_code: '+91' }, error: null };
          }
          return { data: null, error: null };
        }),
      };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === 'capture_meta_lead_webhook_event') {
        return {
          single: async () => ({
            data:
              options?.capture ??
              ({
                contact_id: 'contact-1',
                created_contact: true,
                automation_dispatched: false,
              } as const),
            error: null,
          }),
        };
      }
      return Promise.resolve({ data: true, error: null });
    },
  };

  return { admin, rpcCalls, updates };
}

const event = {
  eventId: 'meta:leadgen:lead-1',
  accountId: 'account-1',
  payload: {
    leadgen_id: 'lead-1',
    page_id: 'page-1',
    form_id: 'form-1',
  },
};

describe('owned Meta lead ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockReturnValue('page-token');
    mocks.fetchLeadgenLead.mockResolvedValue({
      id: 'lead-1',
      created_time: '2026-08-22T00:00:00Z',
      platform: 'fb',
      field_data: [],
    });
    mocks.resolveAuditUserId.mockResolvedValue('user-1');
    mocks.addContactTags.mockResolvedValue(undefined);
  });

  it('atomically increments and terminally completes a phone-less event once', async () => {
    const { admin, rpcCalls } = adminFixture();
    mocks.mapMetaLeadFields.mockReturnValue({
      phone: null,
      name: 'No Phone',
      email: null,
      extras: [],
    });

    await expect(
      processOwnedMetaLeadEvent({
        admin: admin as never,
        event,
        processingOwner: 'owner-1',
      })
    ).resolves.toEqual({ status: 'skipped_no_phone' });

    expect(rpcCalls).toEqual([
      {
        name: 'complete_meta_lead_without_phone_owned',
        args: {
          p_config_id: 'config-1',
          p_account_id: 'account-1',
          p_event_id: 'meta:leadgen:lead-1',
          p_processing_owner: 'owner-1',
        },
      },
    ]);
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('treats Meta test placeholder text as a phone-less lead', async () => {
    const { admin, rpcCalls } = adminFixture();
    mocks.mapMetaLeadFields.mockReturnValue({
      phone: '<test lead: dummy data>',
      name: '<test lead: dummy data>',
      email: '<test lead: dummy data>',
      extras: [],
    });

    await expect(
      processOwnedMetaLeadEvent({
        admin: admin as never,
        event,
        processingOwner: 'owner-1',
      })
    ).resolves.toEqual({ status: 'skipped_no_phone' });

    expect(rpcCalls.map((call) => call.name)).toEqual([
      'complete_meta_lead_without_phone_owned',
    ]);
    expect(mocks.resolveAuditUserId).not.toHaveBeenCalled();
  });

  it('captures one enquiry, dispatches creation once, enriches non-blockingly, and completes the owned event', async () => {
    const { admin, rpcCalls, updates } = adminFixture();
    mocks.mapMetaLeadFields.mockReturnValue({
      phone: '9876543210',
      name: 'New Lead',
      email: 'lead@example.com',
      extras: [{ label: 'Goal', value: 'Strength' }],
    });

    await expect(
      processOwnedMetaLeadEvent({
        admin: admin as never,
        event,
        processingOwner: 'owner-1',
      })
    ).resolves.toEqual({ status: 'processed', contactId: 'contact-1' });

    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledOnce();
    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith({
      accountId: 'account-1',
      triggerType: 'new_contact_created',
      contactId: 'contact-1',
    });
    expect(mocks.addContactTags).toHaveBeenCalledWith(
      admin,
      'account-1',
      'user-1',
      'contact-1',
      ['Strength']
    );
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'capture_meta_lead_webhook_event',
      'mark_meta_lead_automation_dispatched',
      'complete_meta_lead_webhook_event_owned',
    ]);
    expect(updates).toContainEqual({
      table: 'meta_page_config',
      values: { last_lead_at: expect.any(String), last_error: null },
    });
  });

  it('does not repeat creation automation when durable capture says it was dispatched', async () => {
    const { admin } = adminFixture({
      capture: {
        contact_id: 'contact-1',
        created_contact: true,
        automation_dispatched: true,
      },
    });
    mocks.mapMetaLeadFields.mockReturnValue({
      phone: '9876543210',
      name: 'Retry Lead',
      email: null,
      extras: [],
    });

    await processOwnedMetaLeadEvent({
      admin: admin as never,
      event,
      processingOwner: 'owner-2',
    });

    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('keeps goal tagging non-blocking after the durable capture', async () => {
    const { admin, rpcCalls } = adminFixture();
    mocks.mapMetaLeadFields.mockReturnValue({
      phone: '9876543210',
      name: 'Tagged Lead',
      email: null,
      extras: [{ label: 'Objective', value: 'Mobility' }],
    });
    mocks.addContactTags.mockRejectedValueOnce(new Error('tag write failed'));

    await expect(
      processOwnedMetaLeadEvent({
        admin: admin as never,
        event,
        processingOwner: 'owner-1',
      })
    ).resolves.toMatchObject({ status: 'processed' });
    expect(rpcCalls.at(-1)?.name).toBe(
      'complete_meta_lead_webhook_event_owned'
    );
  });

  it('rejects a Page config resolved into a different tenant', async () => {
    const { admin } = adminFixture();
    const originalFrom = admin.from.bind(admin);
    admin.from = ((table: string) => {
      const query = originalFrom(table);
      if (table === 'meta_page_config') {
        query.maybeSingle.mockResolvedValueOnce({
          data: null,
          error: null,
        });
      }
      return query;
    }) as typeof admin.from;

    await expect(
      processOwnedMetaLeadEvent({
        admin: admin as never,
        event,
        processingOwner: 'owner-1',
      })
    ).rejects.toThrow('Meta Page configuration is unavailable');
  });
});
