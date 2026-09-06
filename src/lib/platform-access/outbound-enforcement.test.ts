import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ from: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
vi.mock('@/lib/platform-access/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-access/server')>()),
  requireProductAccess: h.access,
}));

import { ProductAccessError } from './server';
import {
  engineSendText as sendAutomation,
  engineSendTemplate,
} from '@/lib/automations/meta-send';
import { engineSendText as sendFlow } from '@/lib/flows/meta-send';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { createBroadcast } from '@/lib/whatsapp/broadcast-core';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { toErrorResponse } from '@/lib/auth/account';
import { toApiErrorResponse } from '@/lib/api/v1/respond';

const db = { from: h.from } as unknown as SupabaseClient;
const args = {
  accountId: 'account-1',
  userId: 'user-1',
  contactId: 'contact-1',
  conversationId: 'conversation-1',
  text: 'Hello',
};

beforeEach(() => {
  h.from.mockReset();
  h.access.mockReset().mockRejectedValue(new ProductAccessError());
});

describe('expired organization outbound enforcement', () => {
  it('blocks manual, automation, reminder and flow sends before operational reads', async () => {
    for (const send of [
      () =>
        sendMessageToConversation(db, args.accountId, {
          conversationId: args.conversationId,
          messageType: 'text',
          contentText: args.text,
        }),
      () => sendAutomation(args),
      () =>
        engineSendTemplate({ ...args, templateName: 'gym_membership_renewal' }),
      () => sendFlow(args),
      () =>
        createBroadcast(db, args.accountId, args.userId, {
          templateName: 'offer',
          recipients: [{ to: '919876543210' }],
        }),
    ]) {
      await expect(send()).rejects.toBeInstanceOf(ProductAccessError);
    }
    expect(h.from).not.toHaveBeenCalled();
    expect(h.access).toHaveBeenCalledTimes(5);
  });

  it('keeps inbound dispatch non-throwing while suppressing automations, AI and outbound webhooks', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      runAutomationsForTrigger({
        accountId: args.accountId,
        contactId: args.contactId,
        triggerType: 'new_message_received',
        context: {},
      })
    ).resolves.toBeUndefined();
    await expect(
      dispatchInboundToAiReply({ ...args, configOwnerUserId: args.userId })
    ).resolves.toBeUndefined();
    await expect(
      dispatchWebhookEvent(db, args.accountId, 'message.received', {})
    ).resolves.toBeUndefined();
    expect(h.from).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('returns the same actionable 403 code for internal and public APIs', async () => {
    const error = new ProductAccessError();
    const internal = toErrorResponse(error);
    const api = toApiErrorResponse(error);
    expect(internal.status).toBe(403);
    expect(api.status).toBe(403);
    expect(await internal.json()).toMatchObject({
      code: 'product_access_required',
    });
    expect(await api.json()).toMatchObject({
      error: { code: 'product_access_required' },
    });
  });
});

it('blocks a cached flow sender after run retirement even when product access was restored', async () => {
  const { requireCurrentExecution, RetiredExecutionError } =
    await import('./execution-guard');
  h.access.mockResolvedValue({ allowed: true });
  const { encrypt } = await import('@/lib/whatsapp/encryption');
  const token = encrypt('test-token');
  h.from.mockImplementation((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data:
          table === 'flow_runs'
            ? null
            : { id: args.contactId, phone: '+919876543210' },
        error: null,
      }),
      single: async () => ({
        data: { phone_number_id: 'phone', access_token: token },
        error: null,
      }),
    };
    return builder;
  });
  // Retirement is checked after sender lookups as well as at the flow node.
  await expect(
    sendFlow({
      ...args,
      beforeSend: () =>
        requireCurrentExecution(db, {
          kind: 'flow',
          id: 'retired-run',
          accountId: args.accountId,
        }),
    })
  ).rejects.toBeInstanceOf(RetiredExecutionError);
  expect(h.from).toHaveBeenCalledWith('flow_runs');
});
