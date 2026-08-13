import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  findOrCreateContact: vi.fn(),
  getContactById: vi.fn(),
  resolveAuditUserId: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  noteInserts: [] as Record<string, unknown>[],
}));

vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    accountId: 'account-1',
    supabase: {
      from: (table: string) => {
        if (table !== 'contact_notes') {
          throw new Error(`Unexpected table: ${table}`);
        }
        return {
          insert: async (payload: Record<string, unknown>) => {
            mocks.noteInserts.push(payload);
            return { error: null };
          },
        };
      },
    },
  })),
}));

vi.mock('@/lib/api/v1/contacts', () => ({
  CONTACT_SELECT: '*',
  ContactError: class ContactError extends Error {
    status = 500;
  },
  findOrCreateContact: mocks.findOrCreateContact,
  getContactById: mocks.getContactById,
  resolveAuditUserId: mocks.resolveAuditUserId,
  serializeContact: vi.fn(),
  setContactTags: vi.fn(),
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));

import { POST } from './route';

function request() {
  return new Request('https://example.com/api/v1/contacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+919876543210', name: 'Asha' }),
  });
}

describe('POST /api/v1/contacts lead capture side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noteInserts.length = 0;
    mocks.resolveAuditUserId.mockResolvedValue('user-1');
    mocks.getContactById.mockResolvedValue({ id: 'contact-1' });
    mocks.runAutomationsForTrigger.mockResolvedValue(undefined);
  });

  it('records a new API enquiry and dispatches new-contact automation', async () => {
    mocks.findOrCreateContact.mockResolvedValue({
      id: 'contact-1',
      created: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.noteInserts).toEqual([
      {
        account_id: 'account-1',
        contact_id: 'contact-1',
        user_id: 'user-1',
        note_text: 'New enquiry via the public API.',
      },
    ]);
    expect(mocks.after).toHaveBeenCalledOnce();

    const callback = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await callback();
    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith({
      accountId: 'account-1',
      triggerType: 'new_contact_created',
      contactId: 'contact-1',
    });
  });

  it('records a repeat API enquiry without replaying new-contact automation', async () => {
    mocks.findOrCreateContact.mockResolvedValue({
      id: 'contact-1',
      created: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.noteInserts).toEqual([
      {
        account_id: 'account-1',
        contact_id: 'contact-1',
        user_id: 'user-1',
        note_text: 'Existing lead enquired again via the public API.',
      },
    ]);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled();
  });
});
