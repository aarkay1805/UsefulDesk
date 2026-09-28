\set ON_ERROR_STOP on
-- Disposable schema only. Synthetic verified inputs test SQL, not Razorpay.
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
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at) VALUES
 ('f1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','renewal-owner@example.invalid',now());
INSERT INTO public.organizations(id,name) VALUES ('f2222222-2222-4222-8222-222222222222','Synthetic renewal gym');
INSERT INTO public.accounts(id,name,organization_id) VALUES
 ('f3333333-3333-4333-8333-333333333331','Retained branch','f2222222-2222-4222-8222-222222222222'),
 ('f3333333-3333-4333-8333-333333333332','Owner archive choice','f2222222-2222-4222-8222-222222222222');
INSERT INTO public.organization_memberships(organization_id,user_id,role)
 VALUES('f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','owner');
INSERT INTO public.account_memberships(account_id,user_id,role)
 SELECT id,'f1111111-1111-4111-8111-111111111111','owner' FROM public.accounts
 WHERE organization_id='f2222222-2222-4222-8222-222222222222';
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,billing_account_id,
 tier,amount_minor,state,provider_order_id,provider_payment_id,requested_at,verified_at) VALUES
 ('f7777777-7777-4777-8777-777777777777','f2222222-2222-4222-8222-222222222222',
 'f1111111-1111-4111-8111-111111111111','f3333333-3333-4333-8333-333333333331',
 'ultimate',399900,'verified','order_RenewalInitial','pay_RenewalInitial',now()-interval '30 days',now()-interval '30 days');
INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,organization_id,intent_id,
 provider_merchant_id,provider_mode,amount_minor,currency,billing_timezone,verified_at) VALUES
 ('pay_RenewalInitial','order_RenewalInitial','f2222222-2222-4222-8222-222222222222','f7777777-7777-4777-8777-777777777777',
 'acc_RenewalTest','test',399900,'INR','Asia/Kolkata',now()-interval '30 days');
INSERT INTO private.organization_paid_subscription_grants(organization_id,tier,source_intent_id,first_provider_payment_id,
 period_start,paid_through_end) VALUES ('f2222222-2222-4222-8222-222222222222','ultimate','f7777777-7777-4777-8777-777777777777',
 'pay_RenewalInitial',now()-interval '30 days',now()+interval '1 hour');
INSERT INTO private.organization_product_access(organization_id,mode,access_starts_at,access_ends_at)
 VALUES('f2222222-2222-4222-8222-222222222222','manual',now()-interval '30 days',now()+interval '1 hour');
UPDATE private.subscription_billing_settings SET enabled=true,test_merchant_account_id='acc_RenewalTest';
UPDATE private.product_access_settings SET enforcement_enabled=true;
SAVEPOINT base_fixture;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_renewal_intent('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888','f3333333-3333-4333-8333-333333333331')$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_schedule_test_renewal_change('f2222222-2222-4222-8222-222222222222','f6666666-6666-4666-8666-666666666666','starter','{}')$q$,'22023');
SELECT public.subscription_schedule_test_renewal_change('f2222222-2222-4222-8222-222222222222','f6666666-6666-4666-8666-666666666666','starter',ARRAY['f3333333-3333-4333-8333-333333333332']::UUID[]);
SELECT public.subscription_schedule_test_renewal_change('f2222222-2222-4222-8222-222222222222','f6666666-6666-4666-8666-666666666666','starter',ARRAY['f3333333-3333-4333-8333-333333333332']::UUID[]);
SELECT pg_temp.expect_error($q$SELECT public.subscription_schedule_test_renewal_change('f2222222-2222-4222-8222-222222222222','f6666666-6666-4666-8666-666666666666',NULL,'{}')$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_renewal_changes$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_test_renewal_failure('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Failed','acc_RenewalTest',79900,'INR')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.accounts WHERE organization_id='f2222222-2222-4222-8222-222222222222' AND branch_status='active'),'Scheduling archived a branch');
-- Advance only the synthetic paid boundary, leaving real time/provider untouched.
UPDATE private.organization_paid_subscription_grants SET paid_through_end=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET access_ends_at=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE private.subscription_renewal_changes SET source_period_end=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_create_test_renewal_intent('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888','f3333333-3333-4333-8333-333333333331');
SELECT pg_temp.assert_true(public.subscription_create_test_renewal_intent('f2222222-2222-4222-8222-222222222222','f9999999-9999-4999-8999-999999999999','f3333333-3333-4333-8333-333333333331')->>'request_id'='f8888888-8888-4888-8888-888888888888','Browser loss did not recover canonical renewal');
RESET ROLE;
SAVEPOINT pending_renewal;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_test_renewal_order('f8888888-8888-4888-8888-888888888888','f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','acc_Wrong')$q$,'55000');
SELECT pg_temp.assert_true(public.subscription_claim_test_renewal_order('f8888888-8888-4888-8888-888888888888','f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','acc_RenewalTest')->>'action'='create','Missing first order claim');
SELECT pg_temp.assert_true(public.subscription_claim_test_renewal_order('f8888888-8888-4888-8888-888888888888','f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','acc_RenewalTest')->>'action'='recovery','Ambiguous order creates another');
SELECT public.subscription_bind_test_order('f8888888-8888-4888-8888-888888888888','order_Renewal','acc_RenewalTest');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_test_renewal_failure('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Failed','acc_RenewalTest',399900,'INR')$q$,'22023');
SELECT public.subscription_record_test_renewal_failure('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Failed','acc_RenewalTest',79900,'INR');
SELECT public.subscription_record_test_renewal_failure('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_FailedAgain','acc_RenewalTest',79900,'INR');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access_ends_at=now()+interval '71 hours' AND version=2 FROM private.organization_product_access WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Grace moved on retry');
SELECT pg_temp.assert_true((SELECT tier='ultimate' AND paid_through_end=now()-interval '1 hour' FROM private.organization_paid_subscription_grants WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Failure changed paid tier or paid-through');
SELECT pg_temp.assert_true(private.organization_has_product_access('f2222222-2222-4222-8222-222222222222'),'Grace did not use shared product access');
SAVEPOINT grace;
-- An intervening platform version change makes an old callback stale.
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_renewal_payment('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Renewal','acc_RenewalTest',79900,'INR',now())$q$,'55000');
ROLLBACK TO grace;
UPDATE public.accounts SET branch_status='archived' WHERE id='f3333333-3333-4333-8333-333333333331';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_renewal_payment('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Renewal','acc_RenewalTest',79900,'INR',now())$q$,'22023');
ROLLBACK TO grace;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_commit_test_renewal_payment('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Renewal','acc_RenewalTest',79900,'INR',now());
SELECT public.subscription_commit_test_renewal_payment('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Renewal','acc_RenewalTest',79900,'INR',now()+interval '10 days');
SELECT public.subscription_record_test_renewal_failure('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_DelayedFailure','acc_RenewalTest',79900,'INR');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_renewal_payment('f8888888-8888-4888-8888-888888888888','order_Renewal','pay_Another','acc_RenewalTest',79900,'INR',now())$q$,'23505');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT tier='starter' AND period_start=now() AND paid_through_end=(now()-interval '1 hour')+interval '1 month' FROM private.organization_paid_subscription_grants WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Renewal tier/term is wrong');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND count(*) FILTER(WHERE branch_status='active')=1 FROM public.accounts WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Downgrade did not preserve branch history');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.organization_subscription_payments WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Duplicate renewal ledger');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.product_access_audit WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Duplicate renewal/grace audit');
ROLLBACK TO base_fixture;
-- Cancellation keeps the paid end, has no grace and refuses renewal orders.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_schedule_test_renewal_change('f2222222-2222-4222-8222-222222222222','f6666666-6666-4666-8666-666666666666',NULL,'{}');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access_ends_at=now()+interval '1 hour' AND version=1 FROM private.organization_product_access WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Cancellation ended paid access early');
UPDATE private.organization_paid_subscription_grants SET paid_through_end=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET access_ends_at=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE private.subscription_renewal_changes SET source_period_end=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_renewal_intent('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888','f3333333-3333-4333-8333-333333333331')$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true(NOT private.organization_has_product_access('f2222222-2222-4222-8222-222222222222'),'Cancellation granted grace');
ROLLBACK TO base_fixture;
UPDATE private.subscription_billing_settings SET enabled=false;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_schedule_test_renewal_change('f2222222-2222-4222-8222-222222222222','f6666666-6666-4666-8666-666666666666',NULL,'{}')$q$,'55000');
RESET ROLE;
ROLLBACK TO base_fixture;
-- A late failure after the fixed grace must not reopen access.
UPDATE private.organization_paid_subscription_grants SET paid_through_end=now()-interval '4 days' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET access_ends_at=now()-interval '4 days' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_create_test_renewal_intent('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888','f3333333-3333-4333-8333-333333333331');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_test_renewal_order('f8888888-8888-4888-8888-888888888888','f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','acc_RenewalTest');
SELECT public.subscription_bind_test_order('f8888888-8888-4888-8888-888888888888','order_LateRenewal','acc_RenewalTest');
SELECT public.subscription_record_test_renewal_failure('f8888888-8888-4888-8888-888888888888','order_LateRenewal','pay_LateFailed','acc_RenewalTest',399900,'INR');
RESET ROLE;
SELECT pg_temp.assert_true(NOT private.organization_has_product_access('f2222222-2222-4222-8222-222222222222'),'Late failure reopened expired access');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_commit_test_renewal_payment('f8888888-8888-4888-8888-888888888888','order_LateRenewal','pay_LateRenewal','acc_RenewalTest',399900,'INR',now());
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access_starts_at=now() FROM private.organization_product_access WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Late renewal backdated access over the gap');
ROLLBACK TO base_fixture;
-- Refund reservations freeze the actual first payment date and saved zone.
UPDATE private.organization_subscription_intents SET requested_at=now()-interval '8 days' WHERE request_id='f7777777-7777-4777-8777-777777777777';
UPDATE private.organization_subscription_payments SET verified_at=now()-interval '7 days',billing_timezone='Pacific/Kiritimati' WHERE provider_payment_id='pay_RenewalInitial';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_reserve_test_first_refund('f2222222-2222-4222-8222-222222222222','f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111','acc_RenewalTest','pay_RenewalInitial',now()-interval '7 days',now())$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_reserve_test_first_refund('f2222222-2222-4222-8222-222222222222','f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111','acc_RenewalTest','pay_Wrong',now()-interval '7 days',now())$q$,'22023');

SELECT public.subscription_receive_test_refund_request('f2222222-2222-4222-8222-222222222222','f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111','acc_RenewalTest',now());
SELECT pg_temp.expect_error($q$SELECT public.subscription_reserve_test_first_refund('f2222222-2222-4222-8222-222222222222','f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111','acc_RenewalTest','pay_RenewalInitial',now()-interval '8 days',now())$q$,'22023');
SELECT public.subscription_reserve_test_first_refund('f2222222-2222-4222-8222-222222222222','f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111','acc_RenewalTest','pay_RenewalInitial',now()-interval '7 days',now());
RESET ROLE;
UPDATE public.accounts SET timezone='America/Los_Angeles' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_reserve_test_first_refund('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888','f1111111-1111-4111-8111-111111111111','acc_RenewalTest','pay_RenewalInitial',now()-interval '7 days',now()+interval '10 days')->>'request_id'='f9999999-9999-4999-8999-999999999999','Refund retry created another claim');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(billing_timezone)='Pacific/Kiritimati' AND min(amount_minor)=399900 FROM private.subscription_first_refund_claims WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Refund claim changed frozen payment facts');
SELECT pg_temp.assert_true((SELECT version=1 AND access_ends_at=now()+interval '1 hour' FROM private.organization_product_access WHERE organization_id='f2222222-2222-4222-8222-222222222222'),'Refund request changed access');
SELECT 'PASS: Test renewal, fixed grace, downgrade archives, cancellation, stale callbacks, replay, gates and first-refund reservation' AS result;
ROLLBACK;
