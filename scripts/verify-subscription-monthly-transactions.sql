-- All evidence and organizations in this fixture are synthetic and rolled back.
SAVEPOINT monthly_transaction_acceptance;
-- Existing rows are never backfilled: the service resolver explicitly projects
-- their original Starter contract while exposing no monthly offer.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_resolve_live_scope('acc_TCJwBqanN9LTrK',NULL,'order_StarterOpeningSynthetic') @>
 '{"offer_contract_version":"starter_v1","catalog_version":null,"monthly_offer_id":null,"tier":"starter","included_branches":1,"paid_extra_branch_slots":0,"amount_minor":79900,"currency":"INR"}'::JSONB,
 'Original provider resolver omitted explicit Starter identity');
RESET ROLE;
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
INSERT INTO public.organizations(id,name) VALUES('c1000000-0000-4000-8000-000000000001','Synthetic monthly gym');
INSERT INTO public.legal_entities(id,organization_id,name,legal_name) VALUES
 ('c7000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Synthetic monthly brand','Synthetic monthly legal name');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.accounts(id,name,organization_id,legal_entity_id,owner_user_id,default_currency)
 SELECT ('c2000000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID,'Synthetic branch '||n,
 'c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','INR'
 FROM generate_series(1,5) n;
INSERT INTO public.invoice_profiles(account_id,business_name,legal_name,address_line1,city,state,postal_code,country,phone,email)
 SELECT id,'Synthetic monthly brand','Synthetic monthly buyer','Synthetic street','Synthetic city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid'
 FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001';
INSERT INTO public.membership_plans(account_id,name,is_active,price,duration_days)
 SELECT id,'Synthetic active plan',TRUE,1000,30 FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001';
INSERT INTO public.plan_pricing_options(account_id,plan_id,duration_count,duration_unit,price,is_active)
 SELECT account_id,id,1,'month',1000,TRUE FROM public.membership_plans WHERE account_id IN
 (SELECT id FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001');
UPDATE public.accounts SET readiness_state='ready',setup_reviewed_at=clock_timestamp(),setup_reviewed_by='e6000000-0000-4000-8000-000000000002'
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE monthly_input AS SELECT
 (SELECT evidence-ARRAY['offer_reference','customer_tax_note','customer_terms_note'] FROM signup_evidence)
 ||jsonb_build_object('capability_readiness_reference','synthetic separately reviewed enforcement') evidence,
 (SELECT jsonb_agg(jsonb_build_object('tier',tier,'amount_minor',amount_minor,'offer_reference','synthetic exact '||tier,
  'customer_tax_note','Synthetic tax '||tier,'customer_terms_note','Synthetic terms '||tier,
  'customer_refund_note','Synthetic first-payment refund '||tier,'document_treatment','usefulmade_unregistered_invoice_receipt_v1') ORDER BY amount_minor)
 FROM private.subscription_monthly_catalog) offers;
GRANT SELECT ON monthly_input TO authenticated;
INSERT INTO public.renewal_reminder_settings(account_id,days_before,service_days_before) SELECT id,ARRAY[14,7],ARRAY[14,7] FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access SET trial_started_at=now()-interval '16 days',trial_ends_at=now()-interval '2 days' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.subscription_billing_settings SET capabilities_enabled=TRUE WHERE singleton;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_prepare_monthly_offers('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'snapshot_token',
 (SELECT offers FROM monthly_input),(SELECT evidence FROM monthly_input),TRUE);
RESET ROLE;
CREATE TEMP TABLE monthly_selected AS SELECT o.* FROM private.subscription_monthly_offers o WHERE tier='growth';
GRANT SELECT ON monthly_selected TO authenticated,service_role;
CREATE TEMP TABLE monthly_alternatives AS SELECT * FROM private.subscription_monthly_offers;
GRANT SELECT ON monthly_alternatives TO authenticated;
CREATE FUNCTION pg_temp.monthly_approve() RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,TRUE) FROM monthly_selected;
$body$;
CREATE FUNCTION pg_temp.monthly_open() RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_open_reviewed_customer_scope(review_id,organization_id,'e6000000-0000-4000-8000-000000000001')
 FROM private.subscription_live_customer_preparations WHERE organization_id='c1000000-0000-4000-8000-000000000001';
$body$;
CREATE FUNCTION pg_temp.monthly_quote(p_request UUID DEFAULT 'c9000000-0000-4000-8000-000000000001') RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_create_monthly_quote(p_request,p.organization_id,p.billing_account_id,p.owner_user_id,p.review_id,p.monthly_offer_id,o.amount_minor,o.merchant_id)
 FROM private.subscription_live_customer_preparations p JOIN monthly_selected o USING(monthly_offer_id);
$body$;
-- MONTHLY_TIER_SCENARIOS
DO $$ DECLARE r RECORD; BEGIN
 FOR r IN SELECT p.oid,p.proname,p.proowner,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE '%_before_monthly') OR (n.nspname='public' AND p.proname IN
   ('platform_admin_authorize_monthly_opening','subscription_approve_monthly_review','subscription_archive_monthly_branches','subscription_create_monthly_quote')) LOOP
  PERFORM pg_temp.assert_true(r.proowner='postgres'::regrole AND r.prosecdef AND r.proconfig=ARRAY['search_path=""']::TEXT[],'Unsafe monthly transaction definer');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',r.oid,'EXECUTE'),'Anonymous monthly transaction granted');
  IF r.proname LIKE '%_before_monthly' THEN
   PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated',r.oid,'EXECUTE') AND NOT has_function_privilege('service_role',r.oid,'EXECUTE'),'Original private writer exposed');
  ELSE
   PERFORM pg_temp.assert_true(has_function_privilege('service_role',r.oid,'EXECUTE')=(r.proname='subscription_create_monthly_quote')
    AND has_function_privilege('authenticated',r.oid,'EXECUTE')=(r.proname<>'subscription_create_monthly_quote'),'Monthly transaction role grant differs');
  END IF;
 END LOOP;
END $$;
ROLLBACK TO monthly_transaction_acceptance;
