import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FB_SDK_VERSION } from './fb-sdk';
import { META_GRAPH_VERSION } from './graph-version';
import {
  MetaGraphError,
  fetchLeadgenLead,
  getMetaUser,
  getPageLeadAccess,
  getPageLeadgenSubscription,
  listPageSubscribedApps,
  listPagesWithTokens,
  subscribePageToLeadgen,
} from '@/lib/whatsapp/meta-api';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Meta Lead Ads Graph contract', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses one Graph v26.0 constant in browser and server paths', () => {
    expect(META_GRAPH_VERSION).toBe('v26.0');
    expect(FB_SDK_VERSION).toBe(META_GRAPH_VERSION);
  });

  it('resolves the connecting Meta user with an exact bearer request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'user-1' }));

    await expect(
      getMetaUser({ userAccessToken: 'user-token' })
    ).resolves.toEqual({ id: 'user-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/me?fields=id',
      {
        headers: { Authorization: 'Bearer user-token' },
        signal: undefined,
      }
    );
  });

  it('reads exact user and app lead access fields with the Page token', async () => {
    const access = {
      app_has_leads_permission: true,
      can_access_lead: true,
      enabled_lead_access_manager: true,
      failure_reason: '',
      failure_resolution: '',
      is_page_admin: true,
      page_id: 'page-1',
      user_has_leads_permission: true,
      user_id: 'user-1',
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'page-1', has_lead_access: access })
    );

    await expect(
      getPageLeadAccess({
        pageId: 'page-1',
        userId: 'user-1',
        appId: 'app-1',
        pageAccessToken: 'page-token',
      })
    ).resolves.toEqual(access);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/page-1?fields=has_lead_access.user_id%28user-1%29.app_id%28app-1%29',
      {
        headers: { Authorization: 'Bearer page-token' },
        signal: undefined,
      }
    );
  });

  it('lists granted Pages with tasks and Page tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'page-1',
            name: 'Gym Page',
            access_token: 'page-token',
            tasks: ['ADVERTISE', 'MANAGE'],
          },
        ],
      })
    );

    await expect(
      listPagesWithTokens({ userAccessToken: 'user-token' })
    ).resolves.toEqual([
      {
        id: 'page-1',
        name: 'Gym Page',
        access_token: 'page-token',
        tasks: ['ADVERTISE', 'MANAGE'],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/me/accounts?fields=id%2Cname%2Caccess_token%2Ctasks&limit=100',
      {
        headers: { Authorization: 'Bearer user-token' },
        signal: undefined,
      }
    );
  });

  it('lists subscribed fields and diagnoses this app leadgen subscription', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'other-app', subscribed_fields: ['feed'] },
          { id: 'app-1', subscribed_fields: ['leadgen', 'feed'] },
        ],
      })
    );

    await expect(
      getPageLeadgenSubscription({
        pageId: 'page-1',
        appId: 'app-1',
        pageAccessToken: 'page-token',
      })
    ).resolves.toEqual({
      subscribed: true,
      subscribedFields: ['leadgen', 'feed'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/page-1/subscribed_apps?fields=id%2Csubscribed_fields&limit=100',
      {
        headers: { Authorization: 'Bearer page-token' },
        signal: undefined,
      }
    );
  });

  it('subscribes only the leadgen field and supports an abort signal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    const controller = new AbortController();

    await subscribePageToLeadgen({
      pageId: 'page-1',
      pageAccessToken: 'page-token',
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/page-1/subscribed_apps?subscribed_fields=leadgen',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer page-token' },
        signal: controller.signal,
      }
    );
  });

  it('fetches lead answers through the shared version and bearer contract', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'lead-1',
        created_time: '2026-08-22T00:00:00Z',
        field_data: [],
      })
    );

    await fetchLeadgenLead({ leadgenId: 'lead-1', accessToken: 'page-token' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/lead-1?fields=id,created_time,field_data,form_id,ad_id,campaign_id,platform,is_organic',
      {
        headers: { Authorization: 'Bearer page-token' },
        signal: undefined,
      }
    );
  });

  it('preserves safe Meta error fields and marks provider 5xx retryable', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            message: 'Service temporarily unavailable',
            code: 2,
            error_subcode: 99,
            error_user_msg: 'Try again later.',
          },
        },
        503
      )
    );

    const promise = listPageSubscribedApps({
      pageId: 'page-1',
      pageAccessToken: 'page-token',
    });

    await expect(promise).rejects.toMatchObject({
      name: 'MetaGraphError',
      httpStatus: 503,
      code: 2,
      subcode: 99,
      providerDetail: 'Try again later.',
      retryable: true,
    });
    await expect(promise).rejects.toBeInstanceOf(MetaGraphError);
  });

  it('marks retryable rate limits but not invalid OAuth tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Rate limited', code: 4 } }, 400)
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Invalid token', code: 190 } }, 400)
      );

    await expect(
      getMetaUser({ userAccessToken: 'rate-token' })
    ).rejects.toMatchObject({ code: 4, retryable: true });
    await expect(
      getMetaUser({ userAccessToken: 'dead-token' })
    ).rejects.toMatchObject({ code: 190, retryable: false });
  });
});
