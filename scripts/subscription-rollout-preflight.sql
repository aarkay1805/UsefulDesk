-- Read-only baseline for the installed intake-only Production schema.
-- Run through the approved SQL connector on the explicitly selected project.
-- Output contains no credentials or customer payloads. No provider calls or
-- mutation RPCs are executed.
-- Aggregate hashes are drift checks, not backups or proof of financial settlement.
SELECT jsonb_build_object(
  'checked_at', now(),
  'project_counts', jsonb_build_object(
    'users', (SELECT count(*) FROM auth.users),
    'accounts', (SELECT count(*) FROM public.accounts),
    'organizations', (SELECT count(*) FROM public.organizations),
    'gym_payments', (SELECT count(*) FROM public.payments)),
  'live_settings', (SELECT to_jsonb(s) FROM private.subscription_live_settings s),
  'billing_settings', (SELECT to_jsonb(s) FROM private.subscription_billing_settings s),
  'opening_review_table', to_regclass('private.subscription_live_pilot_opening_reviews'),
  'live_counts', jsonb_build_object(
    'quotes', (SELECT count(*) FROM private.subscription_live_quotes),
    'orders', (SELECT count(*) FROM private.subscription_live_orders),
    'payments', (SELECT count(*) FROM private.subscription_live_payments),
    'refunds', (SELECT count(*) FROM private.subscription_live_refunds),
    'events', (SELECT count(*) FROM private.subscription_live_webhook_events),
    'grants', (SELECT count(*) FROM private.subscription_live_grants),
    'offers', (SELECT count(*) FROM private.subscription_live_offer_approvals),
    'refund_reviews', (SELECT count(*) FROM private.subscription_live_refund_reviews)),
  'access_modes', (SELECT jsonb_agg(x) FROM (
    SELECT mode, count(*) FROM private.organization_product_access GROUP BY mode
    ORDER BY mode) x),
  'fingerprints', jsonb_build_object(
    'accounts', (SELECT md5(coalesce(string_agg(row_to_json(a)::text, '|' ORDER BY id), '')) FROM public.accounts a),
    'organizations', (SELECT md5(coalesce(string_agg(row_to_json(o)::text, '|' ORDER BY id), '')) FROM public.organizations o),
    'legal_entities', (SELECT md5(coalesce(string_agg(row_to_json(l)::text, '|' ORDER BY id), '')) FROM public.legal_entities l),
    'access', (SELECT md5(coalesce(string_agg(row_to_json(p)::text, '|' ORDER BY organization_id), '')) FROM private.organization_product_access p)),
  'live_rls', (SELECT jsonb_agg(jsonb_build_object(
    'table', c.relname, 'rls', c.relrowsecurity,
    'browser_select', has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'),
    'browser_dml', has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='private' AND c.relkind='r' AND c.relname LIKE 'subscription_live_%'),
  'cron_jobs', (SELECT jsonb_agg(x) FROM (
    SELECT jobname, schedule, active FROM cron.job ORDER BY jobname) x),
  'latest_successful_workers', (SELECT jsonb_agg(x) FROM (
    SELECT DISTINCT ON (content::jsonb->>'group')
      content::jsonb->>'group' AS worker, created, status_code, timed_out,
      content::jsonb->>'failed' AS failed
    FROM net._http_response
    WHERE status_code=200 AND content::jsonb->>'group' IN ('ops', 'renewals')
    ORDER BY content::jsonb->>'group', created DESC) x),
  'recent_http_results', (SELECT jsonb_agg(x) FROM (
    SELECT created, status_code, timed_out, error_msg
    FROM net._http_response ORDER BY created DESC LIMIT 8) x)
) AS subscription_rollout_preflight;
