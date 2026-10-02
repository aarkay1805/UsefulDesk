-- Read-only release preservation check; use the approved connector on the selected project.
-- Whole-row JSONB hashes are drift checks, not backups or provider/commercial acceptance.
-- The one additive nullable customer_review_id key is excluded from existing quote evidence.
SELECT now() AS checked_at,jsonb_agg(s ORDER BY relation) AS preservation FROM (SELECT 'private.subscription_live_quotes' AS relation,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(x)-'customer_review_id')::text,'|' ORDER BY (to_jsonb(x)-'customer_review_id')::text),'')) AS fingerprint FROM private.subscription_live_quotes x
UNION ALL
SELECT 'private.subscription_live_orders' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_orders x
UNION ALL
SELECT 'private.subscription_live_payments' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_payments x
UNION ALL
SELECT 'private.subscription_live_refunds' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_refunds x
UNION ALL
SELECT 'private.subscription_live_grants' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_grants x
UNION ALL
SELECT 'private.subscription_live_offer_approvals' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_offer_approvals x
UNION ALL
SELECT 'private.subscription_live_refund_reviews' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_refund_reviews x
UNION ALL
SELECT 'private.subscription_live_pilot_opening_reviews' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_pilot_opening_reviews x
UNION ALL
SELECT 'private.subscription_live_webhook_events' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_webhook_events x
UNION ALL
SELECT 'private.subscription_live_recovery_queue' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_recovery_queue x
UNION ALL
SELECT 'private.subscription_live_recovery_exceptions' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_recovery_exceptions x
UNION ALL
SELECT 'private.subscription_live_recovery_reviews' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_recovery_reviews x
UNION ALL
SELECT 'private.subscription_live_delivery_receipts' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_delivery_receipts x
UNION ALL
SELECT 'private.subscription_live_settings' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_live_settings x
UNION ALL
SELECT 'private.subscription_billing_settings' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.subscription_billing_settings x
UNION ALL
SELECT 'private.organization_product_access' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM private.organization_product_access x
UNION ALL
SELECT 'public.organizations' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM public.organizations x
UNION ALL
SELECT 'public.accounts' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM public.accounts x
UNION ALL
SELECT 'public.legal_entities' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM public.legal_entities x
UNION ALL
SELECT 'public.payments' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM public.payments x
UNION ALL
SELECT 'public.invoices' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM public.invoices x
UNION ALL
SELECT 'public.memberships' AS relation,count(*) AS row_count,md5(coalesce(string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text),'')) AS fingerprint FROM public.memberships x) s;
