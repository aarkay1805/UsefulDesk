-- Coordinated closed-renewal release: read-only before/after 33-relation check.
-- Excludes only additive quote renewal_release_id and scope renewal fields.
-- Separately verify every scope has renewals_enabled=false, renewal_release_id=null,
-- empty renewal releases and the hard CHECK(NOT renewals_enabled) after installation.
-- Read-only selected-gym release check through the approved connector.
-- Whole-row hashes are drift checks, not a backup or customer/provider acceptance.
SELECT clock_timestamp() checked_at,jsonb_agg(s ORDER BY relation) preservation FROM (
SELECT 'private.subscription_live_quotes' relation,count(*) row_count,md5(coalesce(string_agg((to_jsonb(x)-'renewal_release_id')::TEXT,'|' ORDER BY (to_jsonb(x)-'renewal_release_id')::TEXT),'')) fingerprint FROM private.subscription_live_quotes x
UNION ALL
SELECT 'private.subscription_live_orders' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_orders x
UNION ALL
SELECT 'private.subscription_live_payments' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_payments x
UNION ALL
SELECT 'private.subscription_live_refunds' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_refunds x
UNION ALL
SELECT 'private.subscription_live_grants' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_grants x
UNION ALL
SELECT 'private.subscription_live_offer_approvals' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_offer_approvals x
UNION ALL
SELECT 'private.subscription_live_refund_reviews' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_refund_reviews x
UNION ALL
SELECT 'private.subscription_live_pilot_opening_reviews' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_pilot_opening_reviews x
UNION ALL
SELECT 'private.subscription_live_webhook_events' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_webhook_events x
UNION ALL
SELECT 'private.subscription_live_recovery_queue' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_recovery_queue x
UNION ALL
SELECT 'private.subscription_live_recovery_exceptions' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_recovery_exceptions x
UNION ALL
SELECT 'private.subscription_live_recovery_reviews' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_recovery_reviews x
UNION ALL
SELECT 'private.subscription_live_delivery_receipts' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_delivery_receipts x
UNION ALL
SELECT 'private.subscription_live_settings' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_settings x
UNION ALL
SELECT 'private.subscription_billing_settings' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_billing_settings x
UNION ALL
SELECT 'private.organization_product_access' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.organization_product_access x
UNION ALL
SELECT 'public.organizations' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.organizations x
UNION ALL
SELECT 'public.accounts' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.accounts x
UNION ALL
SELECT 'public.legal_entities' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.legal_entities x
UNION ALL
SELECT 'public.payments' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.payments x
UNION ALL
SELECT 'public.invoices' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.invoices x
UNION ALL
SELECT 'public.memberships' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.memberships x
UNION ALL
SELECT 'public.invoice_profiles' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.invoice_profiles x
UNION ALL
SELECT 'public.membership_plans' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.membership_plans x
UNION ALL
SELECT 'public.plan_pricing_options' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.plan_pricing_options x
UNION ALL
SELECT 'public.organization_memberships' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM public.organization_memberships x
UNION ALL
SELECT 'private.subscription_live_customer_preparations' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_customer_preparations x
UNION ALL
SELECT 'private.subscription_live_customer_reviews' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_customer_reviews x
UNION ALL
SELECT 'private.subscription_live_customer_scopes' relation,count(*) row_count,md5(coalesce(string_agg((to_jsonb(x)-'renewals_enabled'-'renewal_release_id')::TEXT,'|' ORDER BY (to_jsonb(x)-'renewals_enabled'-'renewal_release_id')::TEXT),'')) fingerprint FROM private.subscription_live_customer_scopes x
UNION ALL
SELECT 'private.subscription_live_document_issues' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_live_document_issues x
UNION ALL
SELECT 'private.subscription_starter_signup_policies' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_starter_signup_policies x
UNION ALL
SELECT 'private.subscription_starter_signup_selections' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.subscription_starter_signup_selections x
UNION ALL
SELECT 'private.platform_admins' relation,count(*) row_count,md5(coalesce(string_agg(to_jsonb(x)::TEXT,'|' ORDER BY to_jsonb(x)::TEXT),'')) fingerprint FROM private.platform_admins x
) s;
