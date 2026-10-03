-- All evidence and organizations in this fixture are synthetic and rolled back.
SAVEPOINT monthly_preparation_acceptance;
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
 FROM generate_series(1,6) n;
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
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offer_sets),'Automatic signup created monthly offers');
CREATE TEMP TABLE monthly_before AS SELECT to_jsonb(x) access FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001');
RESET ROLE;
CREATE FUNCTION pg_temp.monthly_prepare(p_offers JSONB DEFAULT NULL,p_evidence JSONB DEFAULT NULL,p_snapshot TEXT DEFAULT NULL,p_reviewed BOOLEAN DEFAULT TRUE)
RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.platform_admin_prepare_monthly_offers('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 coalesce(p_snapshot,public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'snapshot_token'),
 coalesce(p_offers,(SELECT offers FROM monthly_input)),coalesce(p_evidence,(SELECT evidence FROM monthly_input)),p_reviewed);
$body$;
CREATE FUNCTION pg_temp.monthly_preview() RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_monthly_offer_preview('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001');
$body$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare(p_reviewed=>FALSE)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare(p_snapshot=>'stale')$q$,'40001');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare(p_evidence=>(SELECT evidence-'capability_readiness_reference' FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare(p_evidence=>(SELECT evidence||'{"invented_acceptance":"true"}'::JSONB FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT offers||jsonb_build_array(offers->0) FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT jsonb_build_array(offers->0,offers->0) FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT jsonb_set(offers,'{0,amount_minor}','79901') FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT jsonb_set(offers,'{0,amount_minor}','"79900"') FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT jsonb_set(offers,'{0,tax_minor}','100') FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT jsonb_set(offers,'{0,merchant_id}','"acc_WrongMerchant"') FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare((SELECT jsonb_set(offers,'{0,customer_tax_note}','""') FROM monthly_input))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_prepare_monthly_offers('c1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001')->>'snapshot_token',
 (SELECT offers FROM monthly_input),(SELECT evidence FROM monthly_input),TRUE)$q$,'55000');
RESET ROLE;
SAVEPOINT ineligible_trial;
UPDATE private.organization_product_access SET suspended_at=clock_timestamp() WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'55000');
RESET ROLE;
ROLLBACK TO ineligible_trial;
SAVEPOINT non_inr;
UPDATE public.accounts SET default_currency='USD' WHERE id='c2000000-0000-4000-8000-000000000006';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'55000');
RESET ROLE;
ROLLBACK TO non_inr;
SAVEPOINT missing_buyer;
UPDATE public.invoice_profiles SET email=NULL WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'55000');
RESET ROLE;
ROLLBACK TO missing_buyer;
SAVEPOINT missing_setup;
UPDATE public.accounts SET setup_reviewed_at=NULL WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'55000');
RESET ROLE;
ROLLBACK TO missing_setup;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001',NULL)$q$,'42501');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'42501');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.monthly_preview()->'choices') c WHERE (c->>'available')::BOOLEAN),'Unprepared owner preview invented offers');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_prepare_monthly_offers(NULL,NULL,NULL,'[]','{}',TRUE)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_monthly_offer_context(NULL,NULL)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_monthly_offer_preview(NULL,NULL)$q$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_preview()$q$,'42501');
SAVEPOINT before_monthly_prepare;
SELECT pg_temp.monthly_prepare();
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM private.subscription_monthly_offers WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'All-three set missing offers');
SELECT pg_temp.assert_true((SELECT cardinality(active_account_ids)=6 AND active_account_ids=ARRAY(SELECT id FROM public.accounts WHERE organization_id=s.organization_id AND branch_status='active' ORDER BY id)
 AND owner_review_enabled AND NOT opening_enabled AND opened_at IS NULL FROM private.subscription_monthly_offer_sets s WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Exact six-branch source roster or closed opening lost');
SELECT pg_temp.assert_true((SELECT to_jsonb(x)=(SELECT access FROM monthly_before) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Preparation changed the full trial');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations WHERE organization_id='c1000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews WHERE organization_id='c1000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes WHERE organization_id='c1000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id='c1000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_orders WHERE organization_id='c1000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Preparation created owner/payment authority');
SELECT pg_temp.assert_true((SELECT bool_and(a.tier=o.tier AND a.amount_minor=o.amount_minor AND a.customer_tax_note=o.customer_tax_note AND a.customer_terms_note=o.customer_terms_note
 AND a.offer_contract_version=o.contract_version AND a.catalog_version=o.catalog_version AND a.quote_validity_seconds=1800) FROM private.subscription_monthly_offers o JOIN private.subscription_live_offer_approvals a USING(approval_id)),'Approval economics differ');
-- Even monthly Starter cannot flow through the legacy NULL owner attachment.
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_customer_preparations
 SELECT (jsonb_populate_record(NULL::private.subscription_live_customer_preparations,to_jsonb(p)||jsonb_build_object(
  'review_id',gen_random_uuid(),'offer_approval_id',(SELECT approval_id FROM private.subscription_monthly_offers WHERE tier='starter'),
  'organization_id','c1000000-0000-4000-8000-000000000001','billing_account_id','c2000000-0000-4000-8000-000000000001',
  'reviewed_at',clock_timestamp(),'opening_enabled',FALSE,'opened_at',NULL))).*
 FROM private.subscription_live_customer_preparations p LIMIT 1$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_monthly_offers SET customer_tax_note='rewrite'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_monthly_offer_sets SET opening_enabled=TRUE$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_monthly_offer_sets SET source_snapshot=repeat('a',64)$q$,'55000');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_monthly_offers$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_offer_approvals SET catalog_version=NULL WHERE offer_contract_version IS NOT NULL$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.monthly_preview()->'activeBranches')=6 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.monthly_preview()->'choices') c WHERE (c->>'available')::BOOLEAN),'Active trial exposed review or lost over-cap roster');
SELECT pg_temp.assert_true(NOT (pg_temp.monthly_preview()::TEXT ~ 'authorization_reference|merchant_id|commercial_snapshot|facts_hash|provider_acceptance|synthetic separately'),'Private facts leaked to owner');
RESET ROLE;
-- Editing actual source facts makes the old preparation unavailable; it is never rewritten.
UPDATE public.invoice_profiles SET city='Synthetic changed city' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true((public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'stale')::BOOLEAN,'Changed buyer was not stale');
SELECT pg_temp.monthly_prepare((SELECT jsonb_build_array(offers->1) FROM monthly_input));
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 AND count(*) FILTER(WHERE revoked_at IS NULL)=1 FROM private.subscription_monthly_offer_sets WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Stale set not explicitly superseded');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM private.subscription_live_offer_approvals WHERE organization_id='c1000000-0000-4000-8000-000000000001' AND revoked_at IS NOT NULL),'Stale offer approvals not revoked');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(tier='growth') FROM private.subscription_monthly_offers o JOIN private.subscription_monthly_offer_sets s USING(offer_set_id) WHERE s.revoked_at IS NULL),'Subset set invented tiers');
ROLLBACK TO before_monthly_prepare;
RESET ROLE;
-- Natural passage of time is not a source change. Preserve the exact trial row.
UPDATE private.organization_product_access SET trial_started_at=clock_timestamp()-interval '14 days',trial_ends_at=clock_timestamp()+interval '1 second'
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE monthly_before SET access=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.monthly_prepare();
SELECT pg_sleep(1.1);
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true((SELECT count(*)=3 AND bool_and((c->>'available')::BOOLEAN) FROM jsonb_array_elements(pg_temp.monthly_preview()->'choices') c),'Natural expiry did not expose all reviewed offers');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.monthly_preview()->'activeBranches')=6 AND pg_temp.monthly_preview()->>'openingEnabled'='false','Over-cap owner preview lost roster or opened payment');
SELECT pg_temp.assert_true(pg_temp.monthly_preview()->'choices'->0->'identity'->>'amountMinor'='79900'
 AND pg_temp.monthly_preview()->'choices'->1->'identity'->>'amountMinor'='149900'
 AND pg_temp.monthly_preview()->'choices'->2->'identity'->>'amountMinor'='399900','Preview lost exact totals/order');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT to_jsonb(x)=(SELECT access FROM monthly_before) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Natural expiry reset trial');
UPDATE public.invoice_profiles SET city='Synthetic later city' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.monthly_preview()->'choices') c WHERE (c->>'available')::BOOLEAN),'Stale owner preview retained offer availability');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.monthly_prepare((SELECT jsonb_build_array(offers->2) FROM monthly_input));
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true((SELECT count(*) FILTER(WHERE (c->>'available')::BOOLEAN)=1 FROM jsonb_array_elements(pg_temp.monthly_preview()->'choices') c),'Missing tiers became available');
RESET ROLE;
-- The branch subset itself is exact after explicit local synthetic archives.
UPDATE public.accounts SET branch_status='archived' WHERE organization_id='c1000000-0000-4000-8000-000000000001'
 AND id<>'c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.monthly_prepare((SELECT jsonb_build_array(offers->0) FROM monthly_input));
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_prepare()$q$,'55000');
-- Existing original preparations/financial work cannot be rebound by the new operator RPC.
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_prepare_monthly_offers('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 public.platform_admin_monthly_offer_context('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001')->>'snapshot_token',
 (SELECT offers FROM monthly_input),(SELECT evidence FROM monthly_input),TRUE)$q$,'55000');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.assert_true((SELECT cardinality(active_account_ids)=1 FROM private.subscription_monthly_offer_sets WHERE revoked_at IS NULL),'Fresh one-branch preparation retained old roster');
DO $$ DECLARE p RECORD; BEGIN
 FOR p IN SELECT oid,prosecdef,proowner,proconfig FROM pg_proc WHERE proname IN
 ('platform_admin_monthly_offer_context','platform_admin_prepare_monthly_offers','subscription_monthly_offer_preview') LOOP
 PERFORM pg_temp.assert_true(p.prosecdef AND p.proowner='postgres'::regrole AND p.proconfig=ARRAY['search_path=""']::TEXT[]
  AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
  AND NOT has_function_privilege('service_role',p.oid,'EXECUTE'),'Unsafe monthly public boundary');
 END LOOP;
END $$;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.organization_audit_log WHERE organization_id='c1000000-0000-4000-8000-000000000001'
 AND (details::TEXT ~ 'capability_readiness_reference|provider_acceptance_reference|synthetic inspected')),'Operator evidence leaked into audit');
SELECT 'PASS: reviewed monthly all-three/subset preparation, exact six-branch owner preview, natural expiry, stale supersession, private evidence and closed payment';
ROLLBACK TO monthly_preparation_acceptance;
