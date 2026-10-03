import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';

const h = vi.hoisted(() => ({
  cookies: [],
  providerGets: 0,
  externalNetwork: 0,
}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      referer:
        'http://localhost/settings?branch=f2000000-0000-4000-8000-000000000001',
    }),
  cookies: async () => ({
    getAll: () => h.cookies,
    set: (name, value) => {
      h.cookies = h.cookies.filter((c) => c.name !== name);
      h.cookies.push({ name, value });
    },
  }),
}));
const c = JSON.parse(
  readFileSync(
    '/tmp/usefuldesk-billing-release/staging-connection.json',
    'utf8'
  )
);
if (c.url !== 'https://otagotpezshybxkagtwv.supabase.co')
  throw new Error('Only selected Billing Staging is allowed');
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: c.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: c.public_key,
  SUPABASE_SERVICE_ROLE_KEY: c.secret_key,
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  USEFULDESK_SAAS_RAZORPAY_MODE: 'live',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_ID: 'rzp_live_Synthetic',
  USEFULDESK_SAAS_RAZORPAY_LIVE_KEY_SECRET: 'synthetic-key',
  USEFULDESK_SAAS_RAZORPAY_LIVE_WEBHOOK_SECRET: 'synthetic-hook',
  USEFULDESK_SAAS_RAZORPAY_LIVE_MERCHANT_ID: 'acc_TCJwBqanN9LTrK',
  USEFULDESK_SAAS_LIVE_PILOT_ORGANIZATION_ID:
    '8826d9aa-03f2-4ad7-ae91-0553052131f8',
  USEFULDESK_SAAS_LIVE_WEBHOOK_INTAKE_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_SETTLEMENTS_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_CUSTOMER_SCOPE_ENABLED: 'true',
  USEFULDESK_SAAS_LIVE_CUSTOMER_CHECKOUT_ENABLED: 'true',
});
const org = 'f1000000-0000-4000-8000-000000000001',
  branch = 'f2000000-0000-4000-8000-000000000001';
const requestId = 'fa000000-0000-4000-8000-000000000001',
  previous = 'f5000000-0000-4000-8000-000000000001';
const orderId = 'order_CloudRenewalAcceptance',
  paymentId = 'pay_CloudRenewalAcceptance';
const nativeFetch = globalThis.fetch;
const order = {
  id: orderId,
  amount: 79900,
  currency: 'INR',
  receipt: requestId,
  status: 'created',
  notes: { usefuldesk_request_id: requestId, usefuldesk_organization_id: org },
};
vi.stubGlobal('fetch', async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.startsWith(`${c.url}/`)) return nativeFetch(input, init);
  // Provider adapter answers reviewed synthetic GET fixtures without network.
  if (
    url.startsWith('https://api.razorpay.com/v1/') &&
    (!init?.method || init.method === 'GET')
  ) {
    h.providerGets++;
    if (url.endsWith(`/orders/${orderId}`)) return Response.json(order);
    if (url.endsWith(`/payments/${paymentId}`))
      return Response.json({
        id: paymentId,
        order_id: orderId,
        amount: 79900,
        currency: 'INR',
        status: 'captured',
        captured: true,
        amount_refunded: 0,
      });
    if (url.endsWith('/orders/order_CloudGymAcceptance'))
      return Response.json({
        id: 'order_CloudGymAcceptance',
        receipt: 'gym-only-synthetic',
        notes: {},
      });
  }
  h.externalNetwork++;
  throw new Error('Non-Staging network or provider mutation denied');
});
const admin = createClient(c.url, c.secret_key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let actor;
async function signIn(i) {
  h.cookies = [];
  actor = createServerClient(c.url, c.public_key, {
    cookies: {
      getAll: () => h.cookies,
      setAll: (values) => {
        for (const v of values) {
          h.cookies = h.cookies.filter((x) => x.name !== v.name);
          h.cookies.push(v);
        }
      },
    },
  });
  const userId = `e6000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const password = randomBytes(24).toString('base64url');
  const updated = await admin.auth.admin.updateUserById(userId, { password });
  expect(updated.error?.message).toBeUndefined();
  const signed = await actor.auth.signInWithPassword({
    email: `customer-scope-${i}@example.invalid`,
    password,
  });
  expect(signed.error?.message).toBeUndefined();
  expect((await actor.auth.getUser()).data.user?.id).toBe(userId);
}
async function sql(query, migration = false) {
  const folder = '/tmp/usefuldesk-billing-release';
  writeFileSync(
    `${folder}/sql-request.json`,
    JSON.stringify({ query, migration }),
    { mode: 0o600 }
  );
  const until = Date.now() + 120000;
  while (!existsSync(`${folder}/sql-response.json`)) {
    if (Date.now() > until) throw new Error('SQL bridge timeout');
    await new Promise((r) => setTimeout(r, 200));
  }
  const value = JSON.parse(readFileSync(`${folder}/sql-response.json`, 'utf8'));
  unlinkSync(`${folder}/sql-response.json`);
  if (value.error) throw new Error(value.error);
  return value;
}
const { POST: quotes } =
  await import('@/app/api/subscriptions/live-quotes/route');
const { POST: checkout } =
  await import('@/app/api/subscriptions/live-orders/route');
const { POST: webhook } =
  await import('@/app/api/subscriptions/live-webhook/route');
function quoteRequest(orgId = org, accountId = branch) {
  return new Request('http://localhost/api/subscriptions/live-quotes', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId,
      organizationId: orgId,
      accountId,
      approvalId: 'f3000000-0000-4000-8000-000000000001',
      seenAmountMinor: 79900,
      tier: 'starter',
      renewalOfRequestId: previous,
    }),
  });
}
function signedEvent(event, eventId, signature) {
  const raw = JSON.stringify(event);
  return new Request('http://localhost/api/subscriptions/live-webhook', {
    method: 'POST',
    headers: {
      'x-razorpay-signature':
        signature ??
        createHmac('sha256', 'synthetic-hook').update(raw).digest('hex'),
      'x-razorpay-event-id': eventId,
    },
    body: raw,
  });
}
beforeAll(async () => {
  expect((await admin.from('accounts').select('id').limit(1)).error).toBeNull();
});
afterAll(() => {
  vi.unstubAllGlobals();
});
it('uses real owner Auth and keeps renewal preview/quote closed before scoped fixture activation', async () => {
  await signIn(1);
  const term = await actor.rpc('subscription_live_owner_term', {
    p_organization_id: org,
  });
  expect(term.error).toBeNull();
  expect(term.data).toMatchObject({
    request_id: previous,
    expired: true,
    renewal_available: false,
  });
  expect(
    (
      await actor.rpc('subscription_live_renewal_preview', {
        p_organization_id: org,
        p_billing_account_id: branch,
        p_tier: 'starter',
      })
    ).error?.code
  ).toBe('55000');
  expect((await quotes(quoteRequest())).status).toBe(400);
  process.env.USEFULDESK_SAAS_LIVE_CUSTOMER_RENEWALS_ENABLED = 'true';
  expect((await quotes(quoteRequest())).status).toBe(409);
  expect(h.providerGets).toBe(0);
});
it('denies real branch admin, staff and outsider; private evidence cannot be exposed through PostgREST', async () => {
  for (const i of [2, 3, 4]) {
    await signIn(i);
    expect(
      (
        await actor.rpc('subscription_live_owner_term', {
          p_organization_id: org,
        })
      ).error?.code
    ).toBe('42501');
    expect((await quotes(quoteRequest())).status).toBe(403);
    const attempted = await actor
      .schema('private')
      .from('subscription_live_renewal_releases')
      .select('*');
    expect(attempted.error).not.toBeNull();
    const create = await actor.rpc('subscription_create_live_renewal_quote', {
      p_request_id: requestId,
      p_previous_request_id: previous,
      p_organization_id: org,
      p_billing_account_id: branch,
      p_actor_user_id: 'e6000000-0000-4000-8000-000000000001',
      p_approval_id: 'f3000000-0000-4000-8000-000000000001',
      p_seen_amount_minor: 79900,
      p_tier: 'starter',
      p_provider_merchant_id: 'acc_TCJwBqanN9LTrK',
    });
    expect(create.error?.code).toBe('42501');
  }
  const rows = await actor.from('accounts').select('id').eq('id', branch);
  expect(rows.error).toBeNull();
  expect(rows.data).toEqual([]);
  await signIn(1);
  expect(
    (
      await quotes(
        quoteRequest(
          '8826d9aa-03f2-4ad7-ae91-0553052131f8',
          'd4444444-4444-4444-8444-444444444444'
        )
      )
    ).status
  ).toBe(400);
  expect(
    (
      await actor.rpc('subscription_live_owner_term', {
        p_organization_id: '8826d9aa-03f2-4ad7-ae91-0553052131f8',
      })
    ).error?.code
  ).toBe('42501');
});
it('opens only synthetic Staging scopes, refuses an active term and wrong branch, then binds one expired renewal', async () => {
  await sql(
    "ALTER TABLE private.subscription_live_customer_scopes DROP CONSTRAINT subscription_customer_renewals_closed; UPDATE private.subscription_live_customer_scopes SET renewals_enabled=true,renewal_release_id='f9000000-0000-4000-8000-000000000001' WHERE organization_id='f1000000-0000-4000-8000-000000000001'; UPDATE private.subscription_live_customer_scopes SET renewals_enabled=true,renewal_release_id='f9000000-0000-4000-8000-000000000002' WHERE organization_id='f1000000-0000-4000-8000-000000000002';",
    true
  );
  await signIn(1);
  expect(
    (
      await actor.rpc('subscription_live_renewal_preview', {
        p_organization_id: 'f1000000-0000-4000-8000-000000000002',
        p_billing_account_id: 'f2000000-0000-4000-8000-000000000002',
        p_tier: 'starter',
      })
    ).error?.code
  ).toBe('55000');
  expect(
    (
      await actor.rpc('subscription_live_renewal_preview', {
        p_organization_id: org,
        p_billing_account_id: 'f2000000-0000-4000-8000-000000000002',
        p_tier: 'starter',
      })
    ).error
  ).not.toBeNull();
  const preview = await actor.rpc('subscription_live_renewal_preview', {
    p_organization_id: org,
    p_billing_account_id: branch,
    p_tier: 'starter',
  });
  expect(preview.error).toBeNull();
  expect(preview.data).toMatchObject({
    amount_minor: 79900,
    renewal_of_request_id: previous,
  });
  const r = await quotes(quoteRequest());
  expect(r.status).toBe(202);
  expect((await quotes(quoteRequest())).status).toBe(202);
  expect(
    (
      await actor.rpc('subscription_acknowledge_live_starter_reminders', {
        p_request_id: requestId,
      })
    ).error
  ).toBeNull();
  const claim = await admin.rpc('subscription_claim_live_order', {
    p_request_id: requestId,
    p_organization_id: org,
    p_actor_user_id: 'e6000000-0000-4000-8000-000000000001',
    p_provider_merchant_id: 'acc_TCJwBqanN9LTrK',
  });
  expect(claim.error).toBeNull();
  expect(claim.data.action).toBe('create');
  const repeat = await admin.rpc('subscription_claim_live_order', {
    p_request_id: requestId,
    p_organization_id: org,
    p_actor_user_id: 'e6000000-0000-4000-8000-000000000001',
    p_provider_merchant_id: 'acc_TCJwBqanN9LTrK',
  });
  expect(repeat.data.action).toBe('recovery');
  const bound = await admin.rpc('subscription_bind_live_order', {
    p_request_id: requestId,
    p_provider_order_id: orderId,
    p_provider_merchant_id: 'acc_TCJwBqanN9LTrK',
    p_pilot_organization_id: org,
  });
  expect(bound.error).toBeNull();
  delete process.env.USEFULDESK_SAAS_LIVE_CUSTOMER_RENEWALS_ENABLED;
  const blocked = await checkout(
    new Request('http://localhost/api/subscriptions/live-orders', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ organizationId: org, requestId }),
    })
  );
  expect(blocked.status).not.toBe(200);
  expect(h.providerGets).toBe(0);
});
it('routes signed raw webhook through real service RPC; replays once and separates unrelated gym events', async () => {
  const event = {
    account_id: 'acc_TCJwBqanN9LTrK',
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
    payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
  };
  expect(
    (await webhook(signedEvent(event, 'evtCloudRenewal', 'bad'))).status
  ).toBe(400);
  expect(
    (
      await webhook(
        signedEvent({ ...event, account_id: 'acc_Other' }, 'evtWrongMerchant')
      )
    ).status
  ).toBe(403);
  expect(h.providerGets).toBe(0);
  const r = await webhook(signedEvent(event, 'evtCloudRenewal'));
  expect(r.status).toBe(200);
  expect((await webhook(signedEvent(event, 'evtCloudRenewal'))).status).toBe(
    200
  );
  const term = await actor.rpc('subscription_live_owner_term', {
    p_organization_id: org,
  });
  expect(term.error).toBeNull();
  expect(term.data.request_id).toBe(requestId);
  const gym = {
    ...event,
    payload: {
      payment: {
        entity: {
          id: 'pay_CloudGymAcceptance',
          order_id: 'order_CloudGymAcceptance',
        },
      },
    },
  };
  const gr = await webhook(signedEvent(gym, 'evtCloudGym'));
  expect(gr.status).toBe(200);
  expect(await gr.json()).toMatchObject({ unrelated: true });
  await sql(
    "SELECT CASE WHEN (SELECT count(*) FROM private.subscription_live_terms WHERE request_id='fa000000-0000-4000-8000-000000000001')=1 AND (SELECT paid_through_end=period_start+interval '1 month' FROM private.subscription_live_terms WHERE request_id='fa000000-0000-4000-8000-000000000001') AND (SELECT count(*) FROM private.subscription_live_webhook_events WHERE event_id='evtCloudRenewal')=1 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_webhook_events WHERE event_id='evtCloudGym') THEN 'pass' ELSE 'fail' END AS routing_acceptance;"
  );
  expect(h.externalNetwork).toBe(0);
  console.log(
    JSON.stringify({
      realAuthRoles: 4,
      realServiceRPC: true,
      syntheticProviderGets: h.providerGets,
      externalNetworkCalls: 0,
      genuineProviderAcceptance: false,
    })
  );
});
