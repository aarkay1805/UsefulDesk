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
-- MONTHLY_SHARED_SEED
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
