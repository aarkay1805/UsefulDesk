import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  after: vi.fn(),
  addContactTags: vi.fn(),
  resolveAuditUserId: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  captureError: null as { message: string } | null,
  captureRpc: vi.fn(),
}));

vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>();
  return { ...actual, after: h.after };
});

vi.mock('@/lib/api/v1/contacts', () => ({
  ContactError: class ContactError extends Error {
    status = 500;
  },
  addContactTags: h.addContactTags,
  resolveAuditUserId: h.resolveAuditUserId,
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { leadCapture: {} },
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/security/client-ip', () => ({
  getClientIp: () => '203.0.113.10',
}));

vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
}));

function makeAdmin() {
  return {
    rpc(name: string, params: Record<string, unknown>) {
      h.captureRpc(name, params);
      return {
        single: vi.fn(async () => ({
          data: h.captureError
            ? null
            : { contact_id: 'contact-1', created_contact: true },
          error: h.captureError,
        })),
      };
    },
    from(table: string) {
      if (table === 'lead_capture_forms') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: {
              id: 'form-1',
              account_id: 'account-1',
              consent_text: 'I agree to WhatsApp follow-up.',
              accounts: { phone_country_code: '91' },
            },
            error: null,
          })),
        };
        return builder;
      }

      if (table === 'lead_field_options') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          order: vi.fn(async () => ({ data: [], error: null })),
        };
        return builder;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => makeAdmin(),
}));

import { POST } from './route';

function request(overrides: Record<string, unknown> = {}) {
  return new Request('https://desk.example/api/lead-forms/form-token/submit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'UsefulDesk regression test',
    },
    body: JSON.stringify({
      name: 'Asha',
      phone: '9876543210',
      email: 'asha@example.com',
      goal: '',
      source: '',
      consent: true,
      website: '',
      turnstile_token: 'verified',
      ...overrides,
    }),
  });
}

describe('POST /api/lead-forms/[token]/submit atomic capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.captureError = null;
    h.resolveAuditUserId.mockResolvedValue('user-1');
    h.addContactTags.mockResolvedValue(undefined);
    h.runAutomationsForTrigger.mockResolvedValue(undefined);
  });

  it('does not acknowledge or automate a contact without consent evidence', async () => {
    h.captureError = { message: 'submission insert failed' };

    const response = await POST(request(), {
      params: Promise.resolve({ token: 'form-token' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'server_error',
    });
    expect(h.after).not.toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('commits the contact, note, submission, and consent through one RPC', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ token: 'form-token' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(h.captureRpc).toHaveBeenCalledWith(
      'capture_public_lead_form_submission',
      expect.objectContaining({
        p_account_id: 'account-1',
        p_form_id: 'form-1',
        p_audit_user_id: 'user-1',
        p_phone: '919876543210',
        p_name: 'Asha',
        p_email: 'asha@example.com',
        p_consent_text: 'I agree to WhatsApp follow-up.',
        p_ip: '203.0.113.10',
        p_user_agent: 'UsefulDesk regression test',
      })
    );
    expect(h.after).toHaveBeenCalledOnce();

    const callback = h.after.mock.calls[0]?.[0] as () => Promise<void>;
    await callback();
    expect(h.runAutomationsForTrigger).toHaveBeenCalledWith({
      accountId: 'account-1',
      triggerType: 'new_contact_created',
      contactId: 'contact-1',
    });
  });

  it('does not suppress new-contact automation when goal enrichment fails', async () => {
    h.addContactTags.mockRejectedValue(new Error('tag write failed'));

    const response = await POST(request({ goal: 'general_fitness' }), {
      params: Promise.resolve({ token: 'form-token' }),
    });

    expect(response.status).toBe(200);
    expect(h.addContactTags).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'user-1',
      'contact-1',
      ['General fitness']
    );
    expect(h.after).toHaveBeenCalledOnce();
  });
});
