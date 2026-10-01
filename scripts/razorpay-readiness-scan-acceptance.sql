-- Run only against a disposable full-schema database with an account fixture.
-- No provider calls; all fixtures and function replacements roll back.
BEGIN;
\ir ../supabase/migrations/20261001154214_razorpay_readiness_scan_freshness.sql
\ir ../supabase/migrations/20261001154214_razorpay_readiness_scan_freshness.sql
DO $$
DECLARE
  v_account UUID := (SELECT id FROM public.accounts ORDER BY id LIMIT 1);
  v_owner UUID := '00000000-0000-4000-8000-000000000001';
  v_other UUID := '00000000-0000-4000-8000-000000000002';
  v_claimed INTEGER;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'Disposable account fixture required'; END IF;
  IF EXISTS(SELECT 1 FROM public.account_payment_credentials) THEN
    RAISE EXCEPTION 'Acceptance requires an empty credential table'; END IF;
  INSERT INTO public.account_payment_credentials
    (account_id,gateway,authentication_mode,provider_mode,secret_storage_version,
     connection_status,merchant_status,canonical_webhook_ingress,
     oauth_access_expires_at,oauth_refresh_expires_at,activation_verified_at,
     last_oauth_refresh_scan_at,oauth_refresh_scan_due_at)
  VALUES(v_account,'razorpay','oauth','test',1,'ready','unknown','application',
    now()+interval '60 days',now()+interval '120 days',now()-interval '25 hours',
    now()-interval '20 hours',now()+interval '4 hours');
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>1 THEN RAISE EXCEPTION 'Stale readiness must override future token due time'; END IF;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_other,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Live lease must exclude a second owner'; END IF;
  IF NOT public.finish_razorpay_oauth_refresh_scan(v_account,v_owner,'synthetic failure') THEN
    RAISE EXCEPTION 'Exact owner must finish'; END IF;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Post-expiry failed scan must retain six-hour backoff'; END IF;
  UPDATE public.account_payment_credentials SET activation_verified_at=now(),last_oauth_refresh_scan_at=now(),
    oauth_refresh_scan_due_at=now()+interval '24 hours' WHERE account_id=v_account;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Fresh readiness must not add a scan'; END IF;
  UPDATE public.account_payment_credentials SET merchant_status='activated',activation_verified_at=now()-interval '25 hours',
    last_oauth_refresh_scan_at=now()-interval '20 hours' WHERE account_id=v_account;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Activated merchants keep ordinary cadence'; END IF;
  UPDATE public.account_payment_credentials SET merchant_status='unknown' WHERE account_id=v_account;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('live',v_owner,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Wrong provider mode must not claim'; END IF;
  UPDATE public.account_payment_credentials SET connection_status='reconnect_required' WHERE account_id=v_account;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Disconnected connections must not claim'; END IF;
  UPDATE public.account_payment_credentials SET connection_status='ready',activation_verified_at=NULL,
    last_oauth_refresh_scan_at=NULL WHERE account_id=v_account;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>1 THEN RAISE EXCEPTION 'Never-verified readiness must become due'; END IF;
  PERFORM public.finish_razorpay_oauth_refresh_scan(v_account,v_owner,'synthetic failure');
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>0 THEN RAISE EXCEPTION 'Never-verified failed scan must retain backoff'; END IF;
  UPDATE public.account_payment_credentials SET oauth_refresh_scan_due_at=now()-interval '1 second' WHERE account_id=v_account;
  SELECT count(*) INTO v_claimed FROM public.claim_razorpay_oauth_refresh_scan_batch('test',v_owner,1,300);
  IF v_claimed<>1 THEN RAISE EXCEPTION 'Ordinary due scan must still claim'; END IF;
  IF has_function_privilege('anon','public.claim_razorpay_oauth_refresh_scan_batch(text,uuid,integer,integer)','execute')
    OR has_function_privilege('authenticated','public.claim_razorpay_oauth_refresh_scan_batch(text,uuid,integer,integer)','execute')
    OR NOT has_function_privilege('service_role','public.claim_razorpay_oauth_refresh_scan_batch(text,uuid,integer,integer)','execute')
    OR (SELECT prosecdef FROM pg_proc WHERE oid='public.claim_razorpay_oauth_refresh_scan_batch(text,uuid,integer,integer)'::regprocedure)
  THEN RAISE EXCEPTION 'Service-only invoker boundary changed'; END IF;
  RAISE NOTICE 'Readiness acceptance passed: due, lease, backoff, mode, status, fresh, activated, null and grants; migration replay passed';
END;
$$;
ROLLBACK;
