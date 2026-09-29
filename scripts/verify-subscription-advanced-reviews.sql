\set ON_ERROR_STOP on
-- Run after the disposable subscription schema/migrations. Rolls back all data.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded: %',expected_state,statement;
EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected_state THEN RAISE; END IF; END; $$;
CREATE OR REPLACE FUNCTION pg_temp.assert_true(value BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',message; END IF;
END; $$;

SELECT pg_temp.assert_true(private.subscription_review_upgrade_minor(
  'starter','growth','2026-09-01 00:00:00+00','2026-10-01 00:00:00+00',
  '2026-09-16 00:00:00+00')=35000,'Mid-term upgrade amount');
SELECT pg_temp.assert_true(private.subscription_review_upgrade_minor(
  'starter','growth','2026-09-01 00:00:00+00',
  '2026-09-01 00:00:00.140000+00','2026-09-01 00:00:00.139999+00')=1,
  'Half-paise must round up');
SELECT pg_temp.expect_error($q$SELECT private.subscription_review_upgrade_minor(
  'starter','growth','2026-09-01 00:00:00+00','2026-10-01 00:00:00+00',
  '2026-10-01 00:00:00+00')$q$,'22023');

INSERT INTO auth.users(id,instance_id,aud,role,email,confirmed_at) VALUES
 ('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','advanced-owner@example.invalid',now());
INSERT INTO public.organizations(id,name) VALUES
 ('a2222222-2222-4222-8222-222222222221','Advanced review A'),
 ('a2222222-2222-4222-8222-222222222222','Advanced review B');
INSERT INTO public.accounts(id,name,organization_id) VALUES
 ('a3333333-3333-4333-8333-333333333331','A retained','a2222222-2222-4222-8222-222222222221'),
 ('a3333333-3333-4333-8333-333333333332','A archive','a2222222-2222-4222-8222-222222222221'),
 ('a3333333-3333-4333-8333-333333333333','B retained','a2222222-2222-4222-8222-222222222222');
INSERT INTO public.organization_memberships(organization_id,user_id,role)
 SELECT id,'a1111111-1111-4111-8111-111111111111','owner' FROM public.organizations
 WHERE id IN ('a2222222-2222-4222-8222-222222222221','a2222222-2222-4222-8222-222222222222');
INSERT INTO public.account_memberships(account_id,user_id,role)
 SELECT id,'a1111111-1111-4111-8111-111111111111','owner' FROM public.accounts
 WHERE organization_id IN ('a2222222-2222-4222-8222-222222222221','a2222222-2222-4222-8222-222222222222');
INSERT INTO private.organization_product_access(organization_id,mode,access_starts_at,access_ends_at)
 VALUES('a2222222-2222-4222-8222-222222222221','manual',now()-interval '1 day',now()+interval '29 days'),
 ('a2222222-2222-4222-8222-222222222222','manual',now()-interval '1 day',now()+interval '29 days');
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,
 billing_account_id,tier,amount_minor,state,provider_order_id,provider_payment_id)
 VALUES
 ('a4444444-4444-4444-8444-444444444441','a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333331',
 'starter',79900,'verified','order_AdvancedA','pay_AdvancedA'),
 ('a4444444-4444-4444-8444-444444444442','a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333',
 'growth',149900,'verified','order_AdvancedB','pay_AdvancedB');
INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,
 organization_id,intent_id,provider_merchant_id,provider_mode,amount_minor,currency,
 billing_timezone,verified_at) VALUES
 ('pay_AdvancedA','order_AdvancedA','a2222222-2222-4222-8222-222222222221',
  'a4444444-4444-4444-8444-444444444441','acc_AdvancedTest','test',79900,'INR','Asia/Kolkata',now()),
 ('pay_AdvancedB','order_AdvancedB','a2222222-2222-4222-8222-222222222222',
  'a4444444-4444-4444-8444-444444444442','acc_AdvancedTest','test',149900,'INR','Asia/Kolkata',now());
INSERT INTO private.organization_paid_subscription_grants(organization_id,tier,source_intent_id,
 first_provider_payment_id,period_start,paid_through_end) VALUES
 ('a2222222-2222-4222-8222-222222222221','starter','a4444444-4444-4444-8444-444444444441',
  'pay_AdvancedA',now()-interval '1 day',now()+interval '29 days'),
 ('a2222222-2222-4222-8222-222222222222','growth','a4444444-4444-4444-8444-444444444442',
  'pay_AdvancedB',now()-interval '1 day',now()+interval '29 days');
UPDATE private.subscription_billing_settings SET enabled=true,test_merchant_account_id='acc_AdvancedTest';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_advanced_reviews$q$,'42501');
SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333331','upgrade','ultimate',0,'{}',false,NULL);
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333331','upgrade','ultimate',0,'{}',false,NULL)
 ->>'state'='awaiting_policy','Exact replay changed state');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333333','upgrade','growth',0,'{}',false,NULL)$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333331','upgrade','growth',0,'{}',false,NULL)$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555552',
 'a3333333-3333-4333-8333-333333333331','addon_purchase','starter',1,'{}',false,NULL)$q$,'22023');
SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555553',
 'a3333333-3333-4333-8333-333333333333','addon_purchase','growth',1,'{}',false,NULL);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_advanced_reviews
 SET target_tier='growth' WHERE request_id='a5555555-5555-4555-8555-555555555551'$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 AND bool_and(state='awaiting_policy')
 FROM private.subscription_advanced_reviews),'Unexpected review writes');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.organization_subscription_payments),
 'Review created a payment');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.organization_paid_subscription_grants),
 'Review created a grant');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555554',
 'a3333333-3333-4333-8333-333333333331','restart','starter',0,
 ARRAY['a3333333-3333-4333-8333-333333333332']::UUID[],false,NULL)$q$,'55000');
RESET ROLE;
-- The cancelled term is ended without granting a new term or archiving a row.
UPDATE private.organization_paid_subscription_grants SET paid_through_end=now()-interval '1 hour'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
UPDATE private.organization_product_access SET access_ends_at=now()-interval '1 hour'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
INSERT INTO private.subscription_renewal_changes(request_id,organization_id,requested_by,
 source_period_start,source_period_end,source_tier,target_tier,
 archive_account_ids,active_account_ids)
 SELECT 'a6666666-6666-4666-8666-666666666661',g.organization_id,
 'a1111111-1111-4111-8111-111111111111',g.period_start,g.paid_through_end,
 g.tier,NULL,'{}',ARRAY['a3333333-3333-4333-8333-333333333331',
 'a3333333-3333-4333-8333-333333333332']::UUID[]
 FROM private.organization_paid_subscription_grants g
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
SAVEPOINT unresolved_order;
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,
 billing_account_id,tier,amount_minor,order_requested_at) VALUES
 ('a7777777-7777-4777-8777-777777777771','a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333331',
 'starter',79900,now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555554',
 'a3333333-3333-4333-8333-333333333331','restart','starter',0,
 ARRAY['a3333333-3333-4333-8333-333333333332']::UUID[],false,NULL)$q$,'55000');
RESET ROLE;
ROLLBACK TO unresolved_order;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555554',
 'a3333333-3333-4333-8333-333333333331','restart','starter',0,
 ARRAY['a3333333-3333-4333-8333-333333333332']::UUID[],true,'proposal-1')
 ->>'state'='awaiting_policy','Cancelled restart review was not held');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555554',
 'a3333333-3333-4333-8333-333333333331','restart','starter',0,
 ARRAY['a3333333-3333-4333-8333-333333333332']::UUID[],false,NULL)$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555555',
 'a3333333-3333-4333-8333-333333333331','restart','starter',0,
 ARRAY['a3333333-3333-4333-8333-333333333333']::UUID[],false,NULL)$q$,'42501');
RESET ROLE;
-- A synthetic confirmed refund gives the second permitted restart reason.
UPDATE private.organization_paid_subscription_grants
 SET refund_confirmed_at=now(),renewal_stopped_at=now()
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET access_ends_at=now()
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555556',
 'a3333333-3333-4333-8333-333333333333','restart','growth',0,'{}',false,NULL)
 ->>'state'='awaiting_policy','Refunded restart review was not held');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM private.subscription_advanced_reviews),
 'Reviews missing or duplicated');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.accounts
 WHERE id IN ('a3333333-3333-4333-8333-333333333331',
 'a3333333-3333-4333-8333-333333333332',
 'a3333333-3333-4333-8333-333333333333') AND branch_status='active'),
 'Review archived a branch');
UPDATE private.subscription_billing_settings SET enabled=false;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='a1111111-1111-4111-8111-111111111111';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555557',
 'a3333333-3333-4333-8333-333333333333','restart','growth',0,'{}',false,NULL)$q$,'55000');
RESET ROLE;
ROLLBACK;
