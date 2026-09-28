\set ON_ERROR_STOP on
-- Run ONLY against a disposable database with the subscription draft installed.
-- Everything, including synthetic users and the temporary gate change, rolls back.
-- This exercises SQL, not Razorpay verification or the full application's RLS.
BEGIN;
CREATE FUNCTION pg_temp.expect_error(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %, but statement succeeded: %',expected_state,statement;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>expected_state THEN RAISE; END IF;
END;
$$;
CREATE FUNCTION pg_temp.assert_true(value BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',message; END IF;
END;
$$;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at) VALUES
 ('91111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','subscription-owner@example.invalid',now()),
 ('96666666-6666-4666-8666-666666666666','00000000-0000-0000-0000-000000000000','authenticated','authenticated','subscription-other@example.invalid',now());
INSERT INTO public.organizations(id,name) VALUES
 ('92222222-2222-4222-8222-222222222222','Subscription acceptance gym'),
 ('94444444-4444-4444-8444-444444444444','Subscription isolation gym');
INSERT INTO public.accounts(id,name,organization_id,branch_status)
 SELECT ('93333333-3333-4333-8333-33333333333'||n)::UUID,'Branch '||n,
   '92222222-2222-4222-8222-222222222222'::UUID,
   (CASE WHEN n=6 THEN 'archived' ELSE 'active' END)::public.branch_status_enum
 FROM generate_series(1,6) n;
INSERT INTO public.accounts(id,name,organization_id) VALUES
 ('95555555-5555-4555-8555-555555555555','Isolated branch','94444444-4444-4444-8444-444444444444');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','owner'),
 ('94444444-4444-4444-8444-444444444444','96666666-6666-4666-8666-666666666666','owner');
INSERT INTO public.account_memberships(account_id,user_id,role)
 SELECT id,'91111111-1111-4111-8111-111111111111'::UUID,'owner'::public.account_role_enum
 FROM public.accounts WHERE organization_id='92222222-2222-4222-8222-222222222222';
INSERT INTO private.organization_product_access(organization_id,mode,trial_started_at,trial_ends_at) VALUES
 ('92222222-2222-4222-8222-222222222222','trial',now()-interval '15 days',now()-interval '1 day'),
 ('94444444-4444-4444-8444-444444444444','trial',now()-interval '15 days',now()-interval '1 day');
UPDATE private.product_access_settings SET enforcement_enabled=true WHERE singleton;
UPDATE private.subscription_billing_settings SET enabled=true,test_merchant_account_id='acc_AcceptanceTest' WHERE singleton;
-- A live trial also refuses a sixth active branch through the trigger.
SELECT pg_temp.expect_error($q$INSERT INTO public.accounts(name,organization_id) VALUES('Sixth trial branch','92222222-2222-4222-8222-222222222222')$q$,'22023');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT * FROM private.organization_subscription_payments$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_conversion_branches('94444444-4444-4444-8444-444444444444')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_branches_for_conversion('92222222-2222-4222-8222-222222222222',ARRAY['95555555-5555-4555-8555-555555555555']::UUID[])$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.restore_branch('93333333-3333-4333-8333-333333333336')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_monthly_intent('92222222-2222-4222-8222-222222222222','97777777-7777-4777-8777-777777777777','starter','93333333-3333-4333-8333-333333333331')$q$,'22023');
SELECT public.subscription_archive_branches_for_conversion('92222222-2222-4222-8222-222222222222',ARRAY[
 '93333333-3333-4333-8333-333333333332','93333333-3333-4333-8333-333333333333',
 '93333333-3333-4333-8333-333333333334','93333333-3333-4333-8333-333333333335']::UUID[]);
SELECT public.subscription_create_monthly_intent('92222222-2222-4222-8222-222222222222','97777777-7777-4777-8777-777777777777','starter','93333333-3333-4333-8333-333333333331');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_test_order('97777777-7777-4777-8777-777777777777','92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','acc_AcceptanceTest')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_test_order('97777777-7777-4777-8777-777777777777','94444444-4444-4444-8444-444444444444','96666666-6666-4666-8666-666666666666','acc_AcceptanceTest')$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_test_order('97777777-7777-4777-8777-777777777777','92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','acc_WrongMerchant')$q$,'55000');
SELECT pg_temp.assert_true(public.subscription_claim_test_order('97777777-7777-4777-8777-777777777777','92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','acc_AcceptanceTest')->>'action'='create','First claim must create');
SELECT pg_temp.assert_true(public.subscription_claim_test_order('97777777-7777-4777-8777-777777777777','92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','acc_AcceptanceTest')->>'action'='recovery','Uncertain claim must recover');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_create_monthly_intent('92222222-2222-4222-8222-222222222222','98888888-8888-4888-8888-888888888888','starter','93333333-3333-4333-8333-333333333331')->>'request_id'='97777777-7777-4777-8777-777777777777','Browser loss must resume the canonical request');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_monthly_intent('92222222-2222-4222-8222-222222222222','98888888-8888-4888-8888-888888888888','growth','93333333-3333-4333-8333-333333333331')$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.organization_subscription_intents WHERE organization_id='92222222-2222-4222-8222-222222222222'),'Browser restart created another intent');
SELECT pg_temp.assert_true((SELECT mode='trial' FROM private.organization_product_access WHERE organization_id='92222222-2222-4222-8222-222222222222'),'Pending order granted access');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_bind_test_order('97777777-7777-4777-8777-777777777777','order_Acceptance123','acc_AcceptanceTest');
SELECT public.subscription_bind_test_order('97777777-7777-4777-8777-777777777777','order_Acceptance123','acc_AcceptanceTest');
SELECT pg_temp.expect_error($q$SELECT public.subscription_bind_test_order('97777777-7777-4777-8777-777777777777','order_Different','acc_AcceptanceTest')$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Acceptance123','pay_Acceptance123','acc_AcceptanceTest',1,'INR',now())$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Different','pay_Acceptance123','acc_AcceptanceTest',79900,'INR',now())$q$,'22023');
SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Acceptance123','pay_Acceptance123','acc_AcceptanceTest',79900,'INR',now());
SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Acceptance123','pay_Acceptance123','acc_AcceptanceTest',79900,'INR',now()+interval '10 days');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Acceptance123','pay_Acceptance123','acc_AcceptanceTest',NULL,'INR',now())$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Acceptance123','pay_Acceptance123','acc_AcceptanceTest',79900,NULL,now())$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_initial_payment('97777777-7777-4777-8777-777777777777','order_Acceptance123','pay_Different','acc_AcceptanceTest',79900,'INR',now())$q$,'23505');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.organization_subscription_payments WHERE organization_id='92222222-2222-4222-8222-222222222222'),'Duplicate payment ledger');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.product_access_audit WHERE organization_id='92222222-2222-4222-8222-222222222222'),'Duplicate access audit');
SELECT pg_temp.assert_true((SELECT period_start=now() AND paid_through_end=now()+interval '1 month' FROM private.organization_paid_subscription_grants WHERE organization_id='92222222-2222-4222-8222-222222222222'),'Delayed replay extended the term');
SELECT pg_temp.assert_true((SELECT mode='trial' AND version=1 FROM private.organization_product_access WHERE organization_id='94444444-4444-4444-8444-444444444444'),'Unrelated organization changed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.restore_branch('93333333-3333-4333-8333-333333333332')$q$,'22023');
RESET ROLE;
-- Even a direct insertion cannot bypass capacity. Archiving frees one slot.
SELECT pg_temp.expect_error($q$INSERT INTO public.accounts(name,organization_id) VALUES('No slot','92222222-2222-4222-8222-222222222222')$q$,'22023');
UPDATE public.accounts SET branch_status='archived' WHERE id='93333333-3333-4333-8333-333333333331';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.restore_branch('93333333-3333-4333-8333-333333333332');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=6 AND count(*) FILTER(WHERE branch_status='active')=1 FROM public.accounts WHERE organization_id='92222222-2222-4222-8222-222222222222'),'Archive/restore changed history or exceeded capacity');
UPDATE private.subscription_billing_settings SET enabled=false WHERE singleton;
-- Subscription rollout off must not remove the already-shipped access boundary.
UPDATE private.organization_product_access SET access_starts_at=now()-interval '2 hours',
 access_ends_at=now()-interval '1 hour' WHERE organization_id='92222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_monthly_intent('92222222-2222-4222-8222-222222222222','98888888-8888-4888-8888-888888888888','starter','93333333-3333-4333-8333-333333333332')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.restore_branch('93333333-3333-4333-8333-333333333336')$q$,'42501');
RESET ROLE;
SELECT 'PASS: disposable SQL conversion, replay, isolation, recovery and capacity' AS result;
ROLLBACK;
