\set ON_ERROR_STOP on
-- Run inside a transaction after the advanced-review draft on a disposable
-- full repository schema. The caller must BEGIN and ROLLBACK in one psql session.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(value BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',message; END IF;
END; $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded: %',expected_state,statement;
EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected_state THEN RAISE; END IF; END; $$;

INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
VALUES('a1111111-1111-4111-8111-111111111111',
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'advanced-full-owner@example.invalid',now(),'{"full_name":"Synthetic advanced owner"}'::jsonb);
INSERT INTO public.organizations(id,name) VALUES
 ('a2222222-2222-4222-8222-222222222221','Advanced full A'),
 ('a2222222-2222-4222-8222-222222222222','Advanced full B');
INSERT INTO public.legal_entities(id,organization_id,name) VALUES
 ('a3333333-3333-4333-8333-333333333321','a2222222-2222-4222-8222-222222222221','Synthetic A'),
 ('a3333333-3333-4333-8333-333333333322','a2222222-2222-4222-8222-222222222222','Synthetic B');
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id) VALUES
 ('a3333333-3333-4333-8333-333333333331','A retained','a2222222-2222-4222-8222-222222222221',
  'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333321'),
 ('a3333333-3333-4333-8333-333333333332','A archive','a2222222-2222-4222-8222-222222222221',
  'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333321'),
 ('a3333333-3333-4333-8333-333333333333','B retained','a2222222-2222-4222-8222-222222222222',
  'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333322');
INSERT INTO public.organization_memberships(organization_id,user_id,role)
 SELECT id,'a1111111-1111-4111-8111-111111111111','owner' FROM public.organizations
 WHERE id IN ('a2222222-2222-4222-8222-222222222221',
              'a2222222-2222-4222-8222-222222222222');
INSERT INTO public.account_memberships(account_id,user_id,role)
 SELECT id,'a1111111-1111-4111-8111-111111111111','owner' FROM public.accounts
 WHERE organization_id IN ('a2222222-2222-4222-8222-222222222221',
                           'a2222222-2222-4222-8222-222222222222');
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,
 billing_account_id,tier,amount_minor,state,provider_order_id,provider_payment_id) VALUES
 ('a4444444-4444-4444-8444-444444444441','a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333331',
 'starter',79900,'verified','order_AdvancedFullA','pay_AdvancedFullA'),
 ('a4444444-4444-4444-8444-444444444442','a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333',
 'growth',149900,'verified','order_AdvancedFullB','pay_AdvancedFullB');
INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,
 organization_id,intent_id,provider_merchant_id,provider_mode,amount_minor,currency,
 billing_timezone,verified_at) VALUES
 ('pay_AdvancedFullA','order_AdvancedFullA','a2222222-2222-4222-8222-222222222221',
 'a4444444-4444-4444-8444-444444444441','acc_AdvancedFull','test',79900,'INR','Asia/Kolkata',now()),
 ('pay_AdvancedFullB','order_AdvancedFullB','a2222222-2222-4222-8222-222222222222',
 'a4444444-4444-4444-8444-444444444442','acc_AdvancedFull','test',149900,'INR','Asia/Kolkata',now());
INSERT INTO private.organization_paid_subscription_grants(organization_id,tier,source_intent_id,
 first_provider_payment_id,period_start,paid_through_end) VALUES
 ('a2222222-2222-4222-8222-222222222221','starter','a4444444-4444-4444-8444-444444444441',
 'pay_AdvancedFullA',now()-interval '1 day',now()+interval '29 days'),
 ('a2222222-2222-4222-8222-222222222222','growth','a4444444-4444-4444-8444-444444444442',
 'pay_AdvancedFullB',now()-interval '1 day',now()+interval '29 days');
INSERT INTO private.organization_product_access(organization_id,mode,access_starts_at,access_ends_at)
 VALUES('a2222222-2222-4222-8222-222222222221','manual',now()-interval '1 day',now()+interval '29 days'),
 ('a2222222-2222-4222-8222-222222222222','manual',now()-interval '1 day',now()+interval '29 days')
 ON CONFLICT(organization_id) DO UPDATE SET mode='manual',
 access_starts_at=excluded.access_starts_at,access_ends_at=excluded.access_ends_at;
UPDATE private.subscription_billing_settings SET enabled=true,test_merchant_account_id='acc_AdvancedFull';

-- A provider-processed first refund must not erase a later paid obligation.
SAVEPOINT later_renewal_refund_case;
INSERT INTO private.organization_subscription_intents(request_id,organization_id,
 requested_by,billing_account_id,tier,amount_minor,kind,state,source_period_start,
 source_period_end,source_tier,expected_access_version,provider_order_id,provider_payment_id)
 SELECT 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',g.organization_id,
 'a1111111-1111-4111-8111-111111111111',
 'a3333333-3333-4333-8333-333333333331','starter',79900,'renewal','verified',
 g.period_start,g.paid_through_end,g.tier,a.version,
 'order_LaterRenewal','pay_LaterRenewal'
 FROM private.organization_paid_subscription_grants g
 JOIN private.organization_product_access a USING(organization_id)
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222221';
INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,
 organization_id,intent_id,provider_merchant_id,provider_mode,amount_minor,currency,
 billing_timezone,verified_at)
 VALUES('pay_LaterRenewal','order_LaterRenewal',
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','acc_AdvancedFull','test',
 79900,'INR','Asia/Kolkata',now());
INSERT INTO private.subscription_first_refund_requests(organization_id,request_id,
 requested_by,requested_at) VALUES('a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
 'a1111111-1111-4111-8111-111111111111',now());
INSERT INTO private.subscription_first_refund_claims(organization_id,request_id,
 requested_by,provider_payment_id,provider_merchant_id,amount_minor,currency,
 billing_timezone,paid_at,requested_at) VALUES(
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
 'a1111111-1111-4111-8111-111111111111','pay_AdvancedFullA',
 'acc_AdvancedFull',79900,'INR','Asia/Kolkata',now(),now());
INSERT INTO private.subscription_refund_executions(organization_id,request_id,
 provider_refund_id,provider_status) VALUES(
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','rfnd_LaterRenewal','processed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_full_refund(
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','acc_AdvancedFull',
 'pay_AdvancedFullA','rfnd_LaterRenewal',79900,'INR')
 ->>'review_reason'='later_paid_obligation',
 'Processed first refund erased a later renewal');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT current_term_refunded_at IS NULL
 FROM private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222221'),
 'Later renewal access ended after first refund');
ROLLBACK TO later_renewal_refund_case;

SAVEPOINT later_upgrade_refund_case;
INSERT INTO private.organization_subscription_intents(request_id,organization_id,
 requested_by,billing_account_id,tier,amount_minor,kind,state,source_period_start,
 source_period_end,source_tier,expected_access_version,provider_order_id,provider_payment_id)
 SELECT 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',g.organization_id,
 'a1111111-1111-4111-8111-111111111111',
 'a3333333-3333-4333-8333-333333333331','growth',25000,'upgrade','verified',
 g.period_start,g.paid_through_end,g.tier,a.version,
 'order_LaterUpgrade','pay_LaterUpgrade'
 FROM private.organization_paid_subscription_grants g
 JOIN private.organization_product_access a USING(organization_id)
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222221';
INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,
 organization_id,intent_id,provider_merchant_id,provider_mode,amount_minor,currency,
 billing_timezone,verified_at)
 VALUES('pay_LaterUpgrade','order_LaterUpgrade',
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','acc_AdvancedFull','test',
 25000,'INR','Asia/Kolkata',now());
UPDATE private.organization_paid_subscription_grants SET tier='growth'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
INSERT INTO private.subscription_first_refund_requests(organization_id,request_id,
 requested_by,requested_at) VALUES('a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
 'a1111111-1111-4111-8111-111111111111',now());
INSERT INTO private.subscription_first_refund_claims(organization_id,request_id,
 requested_by,provider_payment_id,provider_merchant_id,amount_minor,currency,
 billing_timezone,paid_at,requested_at) VALUES(
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
 'a1111111-1111-4111-8111-111111111111','pay_AdvancedFullA',
 'acc_AdvancedFull',79900,'INR','Asia/Kolkata',now(),now());
INSERT INTO private.subscription_refund_executions(organization_id,request_id,
 provider_refund_id,provider_status) VALUES(
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','rfnd_LaterUpgrade','processed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_full_refund(
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','acc_AdvancedFull',
 'pay_AdvancedFullA','rfnd_LaterUpgrade',79900,'INR')
 ->>'review_reason'='later_paid_obligation',
 'Processed first refund erased a paid upgrade');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT tier='growth' AND current_term_refunded_at IS NULL
 FROM private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222221'),
 'Paid upgrade access ended after first refund');
ROLLBACK TO later_upgrade_refund_case;

SAVEPOINT later_addon_refund_case;
INSERT INTO private.organization_subscription_intents(request_id,organization_id,
 requested_by,billing_account_id,tier,amount_minor,kind,state,source_period_start,
 source_period_end,source_tier,expected_access_version,provider_order_id,provider_payment_id)
 SELECT 'accccccc-cccc-4ccc-8ccc-ccccccccccc1',g.organization_id,
 'a1111111-1111-4111-8111-111111111111',
 'a3333333-3333-4333-8333-333333333333','growth',49900,'addon_purchase','verified',
 g.period_start,g.paid_through_end,g.tier,a.version,
 'order_LaterAddon','pay_LaterAddon'
 FROM private.organization_paid_subscription_grants g
 JOIN private.organization_product_access a USING(organization_id)
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222222';
INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,
 organization_id,intent_id,provider_merchant_id,provider_mode,amount_minor,currency,
 billing_timezone,verified_at)
 VALUES('pay_LaterAddon','order_LaterAddon',
 'a2222222-2222-4222-8222-222222222222',
 'accccccc-cccc-4ccc-8ccc-ccccccccccc1','acc_AdvancedFull','test',
 49900,'INR','Asia/Kolkata',now());
INSERT INTO private.subscription_paid_branch_slots(organization_id,generation,
 source_intent_id,source_payment_id,active_from,paid_through_end)
 SELECT g.organization_id,g.term_generation,
 'accccccc-cccc-4ccc-8ccc-ccccccccccc1','pay_LaterAddon',
 g.period_start,g.paid_through_end FROM private.organization_paid_subscription_grants g
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222222';
INSERT INTO private.subscription_first_refund_requests(organization_id,request_id,
 requested_by,requested_at) VALUES('a2222222-2222-4222-8222-222222222222',
 'accccccc-cccc-4ccc-8ccc-ccccccccccc2',
 'a1111111-1111-4111-8111-111111111111',now());
INSERT INTO private.subscription_first_refund_claims(organization_id,request_id,
 requested_by,provider_payment_id,provider_merchant_id,amount_minor,currency,
 billing_timezone,paid_at,requested_at) VALUES(
 'a2222222-2222-4222-8222-222222222222',
 'accccccc-cccc-4ccc-8ccc-ccccccccccc2',
 'a1111111-1111-4111-8111-111111111111','pay_AdvancedFullB',
 'acc_AdvancedFull',149900,'INR','Asia/Kolkata',now(),now());
INSERT INTO private.subscription_refund_executions(organization_id,request_id,
 provider_refund_id,provider_status) VALUES(
 'a2222222-2222-4222-8222-222222222222',
 'accccccc-cccc-4ccc-8ccc-ccccccccccc2','rfnd_LaterAddon','processed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_full_refund(
 'accccccc-cccc-4ccc-8ccc-ccccccccccc2','acc_AdvancedFull',
 'pay_AdvancedFullB','rfnd_LaterAddon',149900,'INR')
 ->>'review_reason'='later_paid_obligation',
 'Processed first refund erased a paid add-on');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1
 FROM private.subscription_paid_branch_slots
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'
   AND cancelled_at IS NULL), 'Paid add-on slot changed after first refund');
ROLLBACK TO later_addon_refund_case;

SAVEPOINT captured_after_refund_case;
UPDATE private.organization_paid_subscription_grants SET
 period_start=now()-interval '1 month',paid_through_end=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
UPDATE private.organization_product_access SET
 access_starts_at=now()-interval '1 month',access_ends_at=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_create_test_renewal_intent(
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
 'a3333333-3333-4333-8333-333333333331');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_test_renewal_order(
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
 'a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull');
SELECT public.subscription_bind_test_order('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
 'order_AfterRefund','acc_AdvancedFull');
RESET ROLE;
UPDATE private.organization_paid_subscription_grants SET
 refund_confirmed_at=now(),renewal_stopped_at=now()
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
UPDATE private.organization_product_access SET access_ends_at=now(),version=version+1
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_renewal_payment(
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5','order_AfterRefund',
 'pay_AfterRefund','acc_AdvancedFull',79900,'INR',now())
 ->>'status'='review_required','Captured renewal after refund was not held');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT state='review_required' AND
 provider_payment_id='pay_AfterRefund' FROM private.organization_subscription_intents
 WHERE request_id='abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5'),
 'Late capture evidence did not persist after refund');
ROLLBACK TO captured_after_refund_case;
SAVEPOINT unresolved_refund_renewal_case;
UPDATE private.organization_paid_subscription_grants SET
 period_start=now()-interval '1 month',paid_through_end=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
UPDATE private.organization_product_access SET
 access_starts_at=now()-interval '1 month',access_ends_at=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
INSERT INTO private.subscription_first_refund_requests(organization_id,request_id,
 requested_by,requested_at) VALUES('a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',
 'a1111111-1111-4111-8111-111111111111',now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_renewal_intent(
 'a2222222-2222-4222-8222-222222222221',
 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
 'a3333333-3333-4333-8333-333333333331')$q$,'55000');
RESET ROLE;
ROLLBACK TO unresolved_refund_renewal_case;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_advanced_reviews$q$,'42501');
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333331','upgrade','ultimate',0,'{}',false,NULL)
 ->>'state'='awaiting_policy','Upgrade review missing');
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222221','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333331','upgrade','ultimate',0,'{}',false,NULL)
 ->>'request_id'='a5555555-5555-4555-8555-555555555551','Replay changed request');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555551',
 'a3333333-3333-4333-8333-333333333333','upgrade','ultimate',0,'{}',false,NULL)$q$,'23505');
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555552',
 'a3333333-3333-4333-8333-333333333333','addon_purchase','growth',1,'{}',false,NULL)
 ->>'state'='awaiting_policy','Add-on review missing');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.subscription_advanced_reviews
 WHERE organization_id IN ('a2222222-2222-4222-8222-222222222221','a2222222-2222-4222-8222-222222222222')),
 'Review was duplicated');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.organization_subscription_payments
 WHERE organization_id IN ('a2222222-2222-4222-8222-222222222221',
                           'a2222222-2222-4222-8222-222222222222')),
 'Review wrote payment');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.accounts
 WHERE branch_status='active' AND id IN (
 'a3333333-3333-4333-8333-333333333331',
 'a3333333-3333-4333-8333-333333333332',
 'a3333333-3333-4333-8333-333333333333')),'Review changed roster');
SAVEPOINT advanced_quote_case;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_quote(
 'a5555555-5555-4555-8555-555555555551')$q$,'55000');
RESET ROLE;
UPDATE private.subscription_billing_settings SET
 advanced_commercial_approved=true,
 advanced_policy_version='synthetic-advanced-v1',
 advanced_quote_lifetime_seconds=900,
 advanced_tax_policy='unregistered_no_gst_confirmed',
 advanced_addon_proration_policy='actual_remaining_term',
 advanced_addon_renewal_policy='with_base_term',
 advanced_addon_cancellation_policy='at_renewal_exact_roster',
 advanced_restart_policy='fresh_month_at_verification',
 advanced_payments_enabled=true;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_quote(
 'a5555555-5555-4555-8555-555555555551')->>'kind'='upgrade',
 'Upgrade quote missing');
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_quote(
 'a5555555-5555-4555-8555-555555555551')->>'request_id'=
 'a5555555-5555-4555-8555-555555555551','Quote replay changed identity');
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_quote(
 'a5555555-5555-4555-8555-555555555552')->>'kind'='addon_purchase',
 'Add-on quote missing');
RESET ROLE;
SAVEPOINT stale_quote;
UPDATE private.organization_product_access SET version=version+1
 WHERE organization_id='a2222222-2222-4222-8222-222222222221';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_test_advanced_order(
 'a5555555-5555-4555-8555-555555555551',
 'a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')$q$,'55000');
RESET ROLE;
ROLLBACK TO stale_quote;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_test_advanced_order(
 'a5555555-5555-4555-8555-555555555551',
 'a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')->>'action'='create',
 'First order was not claimed');
SELECT pg_temp.assert_true(public.subscription_claim_test_advanced_order(
 'a5555555-5555-4555-8555-555555555551',
 'a2222222-2222-4222-8222-222222222221',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')->>'action'='recovery',
 'Ambiguous order would be reposted');
SELECT public.subscription_bind_test_order(
 'a5555555-5555-4555-8555-555555555551','order_AdvancedUpgrade','acc_AdvancedFull');
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555551','order_AdvancedUpgrade',
 'pay_AdvancedUpgrade','acc_AdvancedFull',
 (SELECT amount_minor FROM private.organization_subscription_intents
  WHERE request_id='a5555555-5555-4555-8555-555555555551'),'INR',now())
 ->>'status'='verified','Captured upgrade did not commit');
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555551','order_AdvancedUpgrade',
 'pay_AdvancedUpgrade','acc_AdvancedFull',
 (SELECT amount_minor FROM private.organization_subscription_intents
  WHERE request_id='a5555555-5555-4555-8555-555555555551'),'INR',now())
 ->>'status'='verified','Upgrade replay did not return original');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555551','order_AdvancedUpgrade',
 'pay_AdvancedDifferent','acc_AdvancedFull',
 (SELECT amount_minor FROM private.organization_subscription_intents
  WHERE request_id='a5555555-5555-4555-8555-555555555551'),'INR',now())$q$,'23505');
SELECT pg_temp.assert_true((SELECT tier='ultimate' FROM
 private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222221'),
 'Upgrade tier did not change');
SELECT pg_temp.assert_true(public.subscription_claim_test_advanced_order(
 'a5555555-5555-4555-8555-555555555552',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')->>'action'='create',
 'Add-on order was not claimed');
SELECT public.subscription_bind_test_order(
 'a5555555-5555-4555-8555-555555555552','order_AdvancedAddon','acc_AdvancedFull');
RESET ROLE;
SAVEPOINT stale_captured_addon;
UPDATE private.organization_product_access SET version=version+1
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555552','order_AdvancedAddon',
 'pay_AdvancedStale','acc_AdvancedFull',
 (SELECT amount_minor FROM private.organization_subscription_intents
  WHERE request_id='a5555555-5555-4555-8555-555555555552'),'INR',now())
 ->>'status'='review_required','Stale captured add-on was not held');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM private.subscription_paid_branch_slots
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Stale capture added capacity');
RESET ROLE;
ROLLBACK TO stale_captured_addon;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555552','order_AdvancedAddon',
 'pay_AdvancedAddon','acc_AdvancedFull',
 (SELECT amount_minor FROM private.organization_subscription_intents
  WHERE request_id='a5555555-5555-4555-8555-555555555552'),'INR',now())
 ->>'status'='verified','Captured add-on did not commit');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_paid_branch_slots
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Verified add-on slot missing');
SELECT pg_temp.expect_error($q$UPDATE private.organization_paid_subscription_grants
 SET paid_through_end=paid_through_end+interval '1 month'
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'$q$,'55000');
ROLLBACK TO advanced_quote_case;
SAVEPOINT starter_hook_case;
UPDATE private.subscription_billing_settings SET
 standard_reminder_policy_approved=true,
 standard_reminder_policy_version='synthetic-v1',
 standard_reminder_days_before=ARRAY[7,3,1],
 standard_reminder_hour_local=9,
 capabilities_enabled=true;
INSERT INTO public.renewal_reminder_settings(account_id,days_before,service_days_before)
 VALUES('a3333333-3333-4333-8333-333333333333',ARRAY[14,7],ARRAY[14,7])
 ON CONFLICT(account_id) DO UPDATE SET days_before=excluded.days_before,
 service_days_before=excluded.service_days_before;
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,
 billing_account_id,tier,amount_minor,kind,source_period_start,source_period_end,
 source_tier,expected_access_version)
 SELECT 'a7777777-7777-4777-8777-777777777771',g.organization_id,
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333',
 'starter',79900,'renewal',g.period_start,g.paid_through_end,g.tier,a.version
 FROM private.organization_paid_subscription_grants g
 JOIN private.organization_product_access a USING(organization_id)
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222222';
SELECT pg_temp.expect_error($q$UPDATE private.organization_subscription_intents
 SET order_requested_at=now() WHERE request_id='a7777777-7777-4777-8777-777777777771'$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_acknowledge_starter_reminders(
 'a7777777-7777-4777-8777-777777777771')->>'policy_version'='synthetic-v1',
 'Owner reminder acknowledgment missing');
RESET ROLE;
UPDATE private.organization_subscription_intents SET order_requested_at=now(),
 provider_order_id='order_AdvancedStarter'
 WHERE request_id='a7777777-7777-4777-8777-777777777771';
UPDATE private.organization_paid_subscription_grants SET tier='starter'
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true((SELECT days_before=ARRAY[7,3,1] AND
 service_days_before=ARRAY[7,3,1] FROM public.renewal_reminder_settings
 WHERE account_id='a3333333-3333-4333-8333-333333333333'),
 'Starter grant did not normalize reminders');
ROLLBACK TO starter_hook_case;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.subscription_generation_history
 WHERE organization_id IN ('a2222222-2222-4222-8222-222222222221',
                           'a2222222-2222-4222-8222-222222222222')
 AND generation=1 AND closed_at IS NULL),'First generations not recorded');
SELECT pg_temp.expect_error($q$UPDATE private.organization_paid_subscription_grants
 SET term_generation=2 WHERE organization_id='a2222222-2222-4222-8222-222222222222'$q$,'55000');
UPDATE private.organization_paid_subscription_grants
 SET refund_confirmed_at=now(),renewal_stopped_at=now()
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true((SELECT current_term_refunded_at=refund_confirmed_at
  AND term_generation=1 FROM private.organization_paid_subscription_grants
  WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Current refund marker missing');
SELECT pg_temp.assert_true((SELECT close_reason='first_payment_refund' AND closed_at IS NOT NULL
  FROM private.subscription_generation_history
  WHERE organization_id='a2222222-2222-4222-8222-222222222222' AND generation=1),
 'Refund history missing');
SELECT pg_temp.expect_error($q$UPDATE private.organization_paid_subscription_grants
 SET refund_confirmed_at=NULL WHERE organization_id='a2222222-2222-4222-8222-222222222222'$q$,'55000');
UPDATE private.organization_product_access SET access_ends_at=(
 SELECT current_term_refunded_at FROM private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222222')
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
SAVEPOINT unresolved_refund;
INSERT INTO private.subscription_first_refund_requests(organization_id,request_id,
 requested_by,requested_at) VALUES(
 'a2222222-2222-4222-8222-222222222222',
 'a8888888-8888-4888-8888-888888888881',
 'a1111111-1111-4111-8111-111111111111',now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555553',
 'a3333333-3333-4333-8333-333333333333','restart','growth',0,'{}',false,NULL)$q$,'55000');
RESET ROLE;
ROLLBACK TO unresolved_refund;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555553',
 'a3333333-3333-4333-8333-333333333333','restart','growth',0,'{}',false,NULL)
 ->>'state'='awaiting_policy','Refund restart review missing');
RESET ROLE;
-- Synthetic provider evidence reaches the same service-only restart commit.
-- It tests SQL atomicity, not a genuine Razorpay capture.
UPDATE private.subscription_billing_settings SET
 advanced_commercial_approved=true,
 advanced_policy_version='synthetic-advanced-v1',
 advanced_quote_lifetime_seconds=900,
 advanced_tax_policy='unregistered_no_gst_confirmed',
 advanced_addon_proration_policy='actual_remaining_term',
 advanced_addon_renewal_policy='with_base_term',
 advanced_addon_cancellation_policy='at_renewal_exact_roster',
 advanced_restart_policy='fresh_month_at_verification',
 advanced_payments_enabled=true;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_quote(
 'a5555555-5555-4555-8555-555555555553')->>'kind'='restart',
 'Refund restart quote missing');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_test_advanced_order(
 'a5555555-5555-4555-8555-555555555553',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')->>'action'='create',
 'Restart order not claimed');
SELECT public.subscription_bind_test_order('a5555555-5555-4555-8555-555555555553',
 'order_AdvancedRestart','acc_AdvancedFull');
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555553','order_AdvancedRestart',
 'pay_AdvancedRestart','acc_AdvancedFull',149900,'INR',now())
 ->>'status'='verified','Captured restart did not commit');
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'a5555555-5555-4555-8555-555555555553','order_AdvancedRestart',
 'pay_AdvancedRestart','acc_AdvancedFull',149900,'INR',now())
 ->>'status'='verified','Restart replay changed result');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT term_generation=2 AND current_term_refunded_at IS NULL
 AND refund_confirmed_at IS NOT NULL
 AND first_provider_payment_id='pay_AdvancedFullB'
 FROM private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Restart generation erased first-refund history');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND
 count(*) FILTER(WHERE generation=1 AND close_reason='first_payment_refund')=1 AND
 count(*) FILTER(WHERE generation=2 AND close_reason IS NULL)=1
 FROM private.subscription_generation_history
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Restart generation history is wrong');

SAVEPOINT starter_restart_case;
UPDATE private.subscription_billing_settings SET
 standard_reminder_policy_approved=true,
 standard_reminder_policy_version='synthetic-v1',
 standard_reminder_days_before=ARRAY[7,3,1],
 standard_reminder_hour_local=9,capabilities_enabled=true;
UPDATE private.organization_paid_subscription_grants SET
 period_start=now()-interval '1 month',paid_through_end=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET
 access_starts_at=now()-interval '1 month',access_ends_at=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
INSERT INTO private.subscription_renewal_changes(request_id,organization_id,
 requested_by,source_period_start,source_period_end,source_tier,target_tier,
 archive_account_ids,active_account_ids)
 SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',g.organization_id,
 'a1111111-1111-4111-8111-111111111111',g.period_start,g.paid_through_end,
 g.tier,NULL,'{}',ARRAY['a3333333-3333-4333-8333-333333333333']::UUID[]
 FROM private.organization_paid_subscription_grants g
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_review(
 'a2222222-2222-4222-8222-222222222222',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
 'a3333333-3333-4333-8333-333333333333',
 'restart','starter',0,'{}',true,'synthetic-v1')
 ->>'starter_reminder_policy_version'='synthetic-v1',
 'Starter restart review did not freeze reminder version');
SELECT pg_temp.assert_true(public.subscription_create_test_advanced_quote(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
 ->>'starter_reminder_reset_accepted'='true',
 'Starter restart quote did not acknowledge after intent creation');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_test_advanced_order(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')
 ->>'action'='create','Starter restart order was not claimed');
SELECT public.subscription_bind_test_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
 'order_StarterRestart','acc_AdvancedFull');
RESET ROLE;
SAVEPOINT stale_starter_policy;
UPDATE private.subscription_billing_settings SET capabilities_enabled=false;
UPDATE private.subscription_billing_settings SET
 standard_reminder_policy_version='synthetic-v2';
UPDATE private.subscription_billing_settings SET capabilities_enabled=true;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_test_advanced_order(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')$q$,'55000');
RESET ROLE;
ROLLBACK TO stale_starter_policy;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_advanced_payment(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','order_StarterRestart',
 'pay_StarterRestart','acc_AdvancedFull',79900,'INR',now())
 ->>'status'='verified','Captured Starter restart did not commit');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT tier='starter' AND term_generation=3
 FROM private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Starter restart grant missing');
ROLLBACK TO starter_restart_case;

-- Synthetic paid-slot renewal and cancellation in the same rolled-back run.
-- Set the source term to the renewal window before inserting synthetic slot
-- evidence; no provider charge is issued by this test.
SAVEPOINT paid_slot_cases;
UPDATE private.organization_paid_subscription_grants SET
 period_start=now()-interval '1 month',paid_through_end=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET
 access_starts_at=now()-interval '1 month',access_ends_at=now()-interval '1 second'
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
INSERT INTO private.organization_subscription_intents(request_id,organization_id,
 requested_by,billing_account_id,tier,amount_minor,kind,state,
 source_period_start,source_period_end,source_tier,expected_access_version,
 provider_order_id,provider_payment_id)
 SELECT 'a9999999-9999-4999-8999-999999999991',g.organization_id,
 'a1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333',
 'growth',49900,'addon_purchase','verified',g.period_start,g.paid_through_end,
 g.tier,a.version,'order_SyntheticSlot','pay_SyntheticSlot'
 FROM private.organization_paid_subscription_grants g
 JOIN private.organization_product_access a USING(organization_id)
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222222';
INSERT INTO private.organization_subscription_payments(provider_payment_id,
 provider_order_id,organization_id,intent_id,provider_merchant_id,
 provider_mode,amount_minor,currency,billing_timezone,verified_at)
 VALUES('pay_SyntheticSlot','order_SyntheticSlot',
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999991','acc_AdvancedFull',
 'test',49900,'INR','Asia/Kolkata',now());
INSERT INTO private.subscription_paid_branch_slots(id,organization_id,generation,
 source_intent_id,source_payment_id,active_from,paid_through_end)
 SELECT 'a9999999-9999-4999-8999-999999999992',g.organization_id,
 g.term_generation,'a9999999-9999-4999-8999-999999999991','pay_SyntheticSlot',
 g.period_start,g.paid_through_end
 FROM private.organization_paid_subscription_grants g
 WHERE g.organization_id='a2222222-2222-4222-8222-222222222222';
SAVEPOINT stale_slot_case;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_review_test_paid_slot_renewal(
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999997','{}','{}');
SELECT public.subscription_create_test_renewal_intent(
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999998',
 'a3333333-3333-4333-8333-333333333333');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_test_renewal_order(
 'a9999999-9999-4999-8999-999999999998',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull');
SELECT public.subscription_bind_test_order('a9999999-9999-4999-8999-999999999998',
 'order_StaleSlot','acc_AdvancedFull');
RESET ROLE;
UPDATE private.organization_product_access SET version=version+1
 WHERE organization_id='a2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_test_renewal_payment(
 'a9999999-9999-4999-8999-999999999998','order_StaleSlot',
 'pay_StaleSlot','acc_AdvancedFull',199800,'INR',now())
 ->>'status'='review_required','Stale captured renewal was not held');
SELECT pg_temp.assert_true(public.subscription_commit_test_renewal_payment(
 'a9999999-9999-4999-8999-999999999998','order_StaleSlot',
 'pay_StaleSlot','acc_AdvancedFull',199800,'INR',now())
 ->>'status'='review_required','Stale renewal replay changed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT paid_through_end<now()
 FROM private.organization_paid_subscription_grants
 WHERE organization_id='a2222222-2222-4222-8222-222222222222'),
 'Stale captured renewal changed paid term');
ROLLBACK TO stale_slot_case;
SAVEPOINT retain_slot_case;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_review_test_paid_slot_renewal(
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999993','{}','{}')
 ->>'target_tier'='growth','Paid-slot renewal review missing');
SELECT pg_temp.assert_true((public.subscription_create_test_renewal_intent(
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999994',
 'a3333333-3333-4333-8333-333333333333')->>'amount_minor')::BIGINT=199800,
 'Retained-slot renewal price wrong');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_test_renewal_order(
 'a9999999-9999-4999-8999-999999999994',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')->>'action'='create',
 'Paid-slot renewal order not claimed');
SELECT public.subscription_bind_test_order('a9999999-9999-4999-8999-999999999994',
 'order_RetainedSlot','acc_AdvancedFull');
SELECT pg_temp.assert_true((public.subscription_commit_test_renewal_payment(
 'a9999999-9999-4999-8999-999999999994','order_RetainedSlot',
 'pay_RetainedSlot','acc_AdvancedFull',199800,'INR',now())->'payment'
 ->>'provider_payment_id')='pay_RetainedSlot','Paid-slot renewal did not commit');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT s.cancelled_at IS NULL AND
 s.paid_through_end=g.paid_through_end
 FROM private.subscription_paid_branch_slots s
 JOIN private.organization_paid_subscription_grants g USING(organization_id)
 WHERE s.id='a9999999-9999-4999-8999-999999999992'),
 'Retained slot did not extend with base');
ROLLBACK TO retain_slot_case;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_review_test_paid_slot_renewal(
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999995',
 ARRAY['a9999999-9999-4999-8999-999999999992']::UUID[],'{}')
 ->>'target_tier'='growth','Slot cancellation review missing');
SELECT pg_temp.assert_true((public.subscription_create_test_renewal_intent(
 'a2222222-2222-4222-8222-222222222222',
 'a9999999-9999-4999-8999-999999999996',
 'a3333333-3333-4333-8333-333333333333')->>'amount_minor')::BIGINT=149900,
 'Cancelled slot was charged');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_test_renewal_order(
 'a9999999-9999-4999-8999-999999999996',
 'a2222222-2222-4222-8222-222222222222',
 'a1111111-1111-4111-8111-111111111111','acc_AdvancedFull')->>'action'='create',
 'Slot cancellation renewal order not claimed');
SELECT public.subscription_bind_test_order('a9999999-9999-4999-8999-999999999996',
 'order_CancelledSlot','acc_AdvancedFull');
SELECT pg_temp.assert_true((public.subscription_commit_test_renewal_payment(
 'a9999999-9999-4999-8999-999999999996','order_CancelledSlot',
 'pay_CancelledSlot','acc_AdvancedFull',149900,'INR',now())->'payment'
 ->>'provider_payment_id')='pay_CancelledSlot','Slot cancellation did not commit');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT cancelled_at IS NOT NULL
 FROM private.subscription_paid_branch_slots
 WHERE id='a9999999-9999-4999-8999-999999999992'),
 'Slot cancellation did not remove capacity');
ROLLBACK TO paid_slot_cases;
