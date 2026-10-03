-- Synthetic local assertions only; caller wraps all source and fixtures in rollback.
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM private.subscription_monthly_catalog),'Exactly three catalog rows required');
SELECT pg_temp.assert_true((SELECT jsonb_agg(jsonb_build_array(tier,amount_minor,included_branches) ORDER BY amount_minor)
 FROM private.subscription_monthly_catalog)='[["starter",79900,1],["growth",149900,1],["ultimate",399900,5]]'::JSONB,'Catalog differs from plans.ts');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offer_sets)
 AND NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offers),'Monthly authority was seeded');
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['subscription_live_offer_approvals','subscription_live_quotes'] LOOP
  EXECUTE format('SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.%I WHERE offer_contract_version IS NOT NULL OR catalog_version IS NOT NULL),%L)',t,'Historical identity was backfilled');
 END LOOP;
 FOREACH t IN ARRAY ARRAY['subscription_live_customer_preparations','subscription_live_customer_reviews','subscription_live_quotes'] LOOP
  EXECUTE format('SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.%I WHERE monthly_offer_id IS NOT NULL),%L)',t,'Historical monthly attachment was backfilled');
 END LOOP;
END $$;
-- No operator, owner-review or opening authority exists in this foundation.
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_monthly_offer_sets WHERE owner_review_enabled OR opening_enabled OR opened_at IS NOT NULL),'Monthly opening authority seeded');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND bool_and(pg_get_expr(d.adbin,d.adrelid)='false')
 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='private.subscription_monthly_offer_sets'::regclass AND a.attname IN ('owner_review_enabled','opening_enabled')),'Monthly authority does not default closed');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_monthly_offer_sets(offer_set_id) VALUES(gen_random_uuid())$q$,'55000');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_monthly_offers(monthly_offer_id) VALUES(gen_random_uuid())$q$,'55000');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_monthly_offer_sets CASCADE$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_monthly_catalog SET amount_minor=amount_minor+1$q$,'55000');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_monthly_catalog$q$,'55000');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_monthly_catalog CASCADE$q$,'55000');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_monthly_catalog
 (contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots)
 VALUES('monthly_first_v1','future','starter',79900,'INR',1,0)$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_monthly_catalog
 (contract_version,catalog_version,tier,amount_minor,currency,included_branches,paid_extra_branch_slots)
 VALUES('monthly_first_v1','monthly_inr_2026_10_v1','ultimate',399900,'INR',1,0)$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_quotes(request_id,monthly_offer_id)
 VALUES(gen_random_uuid(),gen_random_uuid())$q$,'55000');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_offer_approvals
 SELECT (jsonb_populate_record(NULL::private.subscription_live_offer_approvals,to_jsonb(a)||jsonb_build_object('approval_id',gen_random_uuid(),'catalog_version','future'))).*
 FROM private.subscription_live_offer_approvals a WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8' LIMIT 1$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_offer_approvals
 SET offer_contract_version='monthly_first_v1',catalog_version='monthly_inr_2026_10_v1'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_quotes SET offer_contract_version='future'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_preparations SET monthly_offer_id=gen_random_uuid()$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_reviews SET monthly_offer_id=gen_random_uuid()$q$,'55000');
DO $$ DECLARE t TEXT; r TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['subscription_monthly_catalog','subscription_monthly_offer_sets','subscription_monthly_offers'] LOOP
  PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid=('private.'||t)::regclass),'Monthly table lacks RLS');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=('private.'||t)::regclass),'Monthly browser policy exists');
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.assert_true(NOT has_table_privilege(r,'private.'||t,'INSERT,UPDATE,DELETE,TRUNCATE'),'Monthly direct write granted');
   IF r<>'service_role' THEN PERFORM pg_temp.assert_true(NOT has_table_privilege(r,'private.'||t,'SELECT'),'Browser read granted'); END IF;
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname LIKE 'subscription_monthly_%' AND (NOT p.prosecdef OR p.proowner<>'postgres'::regrole
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR has_function_privilege('service_role',p.oid,'EXECUTE'))),'Unsafe monthly definer');
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_monthly_catalog SET amount_minor=1$q$,'42501');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_monthly_offer_sets CASCADE$q$,'42501');
RESET ROLE;
SELECT 'PASS: exact immutable catalog, closed authority, NULL history, private RLS/grants and definer ownership';
