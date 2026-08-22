import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyMetaWebhookSignature: vi.fn(),
  processOwnedMetaLeadEvent: vi.fn(),
  config: {
    id: 'config-1',
    account_id: 'account-1',
  } as { id: string; account_id: string } | null,
  configError: null as Error | null,
  claim: 'claimed',
  rpc: vi.fn(),
}));

vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: mocks.verifyMetaWebhookSignature,
}));
vi.mock('@/lib/meta/lead-ingestion', () => ({
  processOwnedMetaLeadEvent: mocks.processOwnedMetaLeadEvent,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: mocks.config,
          error: mocks.configError,
        })),
      };
      return query;
    },
    rpc: mocks.rpc,
  }),
}));

import { POST } from './route';

function request(options?: { signature?: string; body?: unknown }) {
  return new Request('http://localhost/api/meta/leads/webhook', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': options?.signature ?? 'sha256=test',
    },
    body: JSON.stringify(
      options?.body ?? {
        object: 'page',
        entry: [
          {
            changes: [
              {
                field: 'leadgen',
                value: {
                  leadgen_id: 'lead-1',
                  page_id: 'page-1',
                  form_id: 'form-1',
                },
              },
            ],
          },
        ],
      }
    ),
  });
}

describe('Meta lead webhook delivery boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config = { id: 'config-1', account_id: 'account-1' };
    mocks.configError = null;
    mocks.claim = 'claimed';
    mocks.verifyMetaWebhookSignature.mockReturnValue(true);
    mocks.processOwnedMetaLeadEvent.mockResolvedValue({ status: 'processed' });
    mocks.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === 'claim_meta_lead_webhook_event_owned') {
          return { data: mocks.claim, error: null };
        }
        if (name === 'fail_meta_lead_webhook_event_owned') {
          return { data: true, error: null };
        }
        throw new Error(`Unexpected RPC ${name}: ${JSON.stringify(args)}`);
      }
    );
  });

  it('verifies HMAC before any event claim', async () => {
    mocks.verifyMetaWebhookSignature.mockReturnValueOnce(false);

    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.processOwnedMetaLeadEvent).not.toHaveBeenCalled();
  });

  it('claims with a fresh owner and invokes the shared owned ingestion service', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    const claimCall = mocks.rpc.mock.calls.find(
      ([name]) => name === 'claim_meta_lead_webhook_event_owned'
    );
    expect(claimCall).toBeDefined();
    expect(claimCall?.[1]).toMatchObject({
      p_event_id: 'meta:leadgen:lead-1',
      p_account_id: 'account-1',
      p_payload: {
        leadgen_id: 'lead-1',
        page_id: 'page-1',
        form_id: 'form-1',
      },
      p_processing_owner: expect.any(String),
      p_lease_seconds: 300,
    });
    expect(mocks.processOwnedMetaLeadEvent).toHaveBeenCalledWith({
      admin: expect.any(Object),
      event: {
        eventId: 'meta:leadgen:lead-1',
        accountId: 'account-1',
        payload: {
          leadgen_id: 'lead-1',
          page_id: 'page-1',
          form_id: 'form-1',
        },
      },
      processingOwner: claimCall?.[1].p_processing_owner,
    });
  });

  it('keeps a processed redelivery as a permanent no-op', async () => {
    mocks.claim = 'processed';

    expect((await POST(request())).status).toBe(200);
    expect(mocks.processOwnedMetaLeadEvent).not.toHaveBeenCalled();
  });

  it('does not assign an unknown Page to a fallback tenant', async () => {
    mocks.config = null;

    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.processOwnedMetaLeadEvent).not.toHaveBeenCalled();
  });

  it('fails the exact owned event when shared ingestion throws', async () => {
    mocks.processOwnedMetaLeadEvent.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    expect((await POST(request())).status).toBe(500);

    const claimCall = mocks.rpc.mock.calls.find(
      ([name]) => name === 'claim_meta_lead_webhook_event_owned'
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'fail_meta_lead_webhook_event_owned',
      {
        p_event_id: 'meta:leadgen:lead-1',
        p_account_id: 'account-1',
        p_processing_owner: claimCall?.[1].p_processing_owner,
        p_error: 'database unavailable',
      }
    );
  });
});
