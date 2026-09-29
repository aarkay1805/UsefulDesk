\set ON_ERROR_STOP on
-- Disposable schema only. Synthetic verified inputs test SQL, not Razorpay.
BEGIN;
\i supabase/migrations/20260928160000_subscription_capability_boundary.sql
CREATE OR REPLACE FUNCTION pg_temp.expect_error(statement TEXT, expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded: %',expected_state,statement;
EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected_state THEN RAISE; END IF; END; $$;
CREATE OR REPLACE FUNCTION pg_temp.assert_true(value BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
  IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',message; END IF;
END; $$;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('f1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','renewal-owner@example.invalid',now(),'{"full_name":"Synthetic capability owner"}'::jsonb);
INSERT INTO public.organizations(id,name) VALUES ('f2222222-2222-4222-8222-222222222222','Synthetic renewal gym');
INSERT INTO public.legal_entities(id,organization_id,name) VALUES('f4444444-4444-4444-8444-444444444444','f2222222-2222-4222-8222-222222222222','Synthetic legal');
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id) VALUES
 ('f3333333-3333-4333-8333-333333333331','Retained branch','f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','f4444444-4444-4444-8444-444444444444'),
 ('f3333333-3333-4333-8333-333333333332','Owner archive choice','f2222222-2222-4222-8222-222222222222','f1111111-1111-4111-8111-111111111111','f4444444-4444-4444-8444-444444444444');
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
 VALUES('f2222222-2222-4222-8222-222222222222','manual',now()-interval '30 days',now()+interval '1 hour') ON CONFLICT(organization_id) DO UPDATE SET mode='manual',access_starts_at=excluded.access_starts_at,access_ends_at=excluded.access_ends_at;
UPDATE private.subscription_billing_settings SET enabled=true,test_merchant_account_id='acc_RenewalTest';
UPDATE private.product_access_settings SET enforcement_enabled=true;

-- Synthetic Test-only approval: the real owner has not approved this cadence.
SELECT pg_temp.expect_error($q$UPDATE private.subscription_billing_settings SET capabilities_enabled=true$q$,'23514');
UPDATE private.subscription_billing_settings SET standard_reminder_policy_approved=true,
  standard_reminder_policy_version='synthetic-capability-test-v1',
  standard_reminder_days_before=ARRAY[7,3,1],standard_reminder_hour_local=9,
  capabilities_enabled=true;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_billing_settings SET standard_reminder_policy_version='unreviewed-v2'$q$,'55000');
SELECT pg_temp.assert_true(private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','gym_autopay'),'Ultimate capability missing');
INSERT INTO public.renewal_reminder_settings(account_id,days_before,service_days_before)
 VALUES('f3333333-3333-4333-8333-333333333331',ARRAY[14,7],ARRAY[14,7]);
INSERT INTO public.contacts(id,user_id,account_id,phone)
 VALUES('f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111',
   'f3333333-3333-4333-8333-333333333331','+919999999999');
INSERT INTO public.memberships(id,account_id,contact_id,user_id,start_date,end_date,member_number)
 VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','f3333333-3333-4333-8333-333333333331',
   'f9999999-9999-4999-8999-999999999999','f1111111-1111-4111-8111-111111111111',
   CURRENT_DATE-interval '30 days',CURRENT_DATE+interval '14 days',980001);
INSERT INTO public.renewal_reminders_sent(account_id,membership_id,contact_id,end_date,days_before,delivery_state)
 VALUES('f3333333-3333-4333-8333-333333333331','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
   'f9999999-9999-4999-8999-999999999999',CURRENT_DATE+interval '14 days',14,'claimed');
INSERT INTO public.renewal_reminders_sent(account_id,membership_id,contact_id,end_date,days_before,delivery_state,provider_attempted_at)
 VALUES('f3333333-3333-4333-8333-333333333331','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
   'f9999999-9999-4999-8999-999999999999',CURRENT_DATE+interval '14 days',30,'attempting',now());
INSERT INTO public.invoices(id,account_id,contact_id,source,currency)
 VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac','f3333333-3333-4333-8333-333333333331',
   'f9999999-9999-4999-8999-999999999999','sale','INR');
INSERT INTO public.invoice_lines(id,account_id,invoice_id,kind,description,unit_amount,line_amount)
 VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad','f3333333-3333-4333-8333-333333333331',
   'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac','service','Synthetic PT',100,100);
INSERT INTO public.member_services(id,account_id,contact_id,invoice_line_id,item_name_snapshot,
 option_duration_count,option_duration_unit,start_date,end_date,sold_amount)
 VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae','f3333333-3333-4333-8333-333333333331',
   'f9999999-9999-4999-8999-999999999999','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
   'Synthetic PT',1,'month',CURRENT_DATE-interval '15 days',CURRENT_DATE+interval '14 days',100);
INSERT INTO public.service_renewal_reminders_sent(account_id,member_service_id,end_date,days_before,status,provider_attempted_at)
 VALUES('f3333333-3333-4333-8333-333333333331','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
   CURRENT_DATE+interval '14 days',14,'failed',NULL);
INSERT INTO public.service_renewal_reminders_sent(account_id,member_service_id,end_date,days_before,status,provider_attempted_at)
 VALUES('f3333333-3333-4333-8333-333333333331','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
   CURRENT_DATE+interval '14 days',30,'attempting',now());
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,billing_account_id,
 tier,amount_minor,kind,source_period_start,source_period_end,source_tier,expected_access_version)
SELECT 'f8888888-8888-4888-8888-888888888888',g.organization_id,'f1111111-1111-4111-8111-111111111111',
 'f3333333-3333-4333-8333-333333333331','starter',79900,'renewal',g.period_start,g.paid_through_end,
 g.tier,a.version
FROM private.organization_paid_subscription_grants g
JOIN private.organization_product_access a USING(organization_id)
WHERE g.organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.expect_error($q$SELECT private.subscription_assert_starter_reminder_review('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888')$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true((public.subscription_acknowledge_starter_reminders('f8888888-8888-4888-8888-888888888888')->>'policy_version')='synthetic-capability-test-v1','Owner reminder reset acknowledgement missing');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE private.organization_subscription_intents SET starter_reminder_policy_version='rewritten' WHERE request_id='f8888888-8888-4888-8888-888888888888'$q$,'42501');
SELECT pg_temp.expect_error($q$UPDATE private.organization_paid_subscription_grants SET tier='starter' WHERE organization_id='f2222222-2222-4222-8222-222222222222'$q$,'55000');
SELECT pg_temp.assert_true(
  (private.subscription_apply_starter_reminder_policy('f2222222-2222-4222-8222-222222222222','f8888888-8888-4888-8888-888888888888')->>'settings_normalized')::INTEGER=1,
  'Custom renewal schedule was not normalized');
SELECT pg_temp.assert_true((SELECT days_before=ARRAY[7,3,1] AND service_days_before=ARRAY[7,3,1]
 FROM public.renewal_reminder_settings WHERE account_id='f3333333-3333-4333-8333-333333333331'),
 'Starter schedule did not use the reviewed policy');
SELECT pg_temp.assert_true((SELECT delivery_state='retired' FROM public.renewal_reminders_sent
 WHERE membership_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' AND days_before=14),
 'Unattempted custom reminder was not retired');
SELECT pg_temp.assert_true((SELECT delivery_state='attempting' FROM public.renewal_reminders_sent
 WHERE membership_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' AND days_before=30),
 'Provider-attempted reminder history was changed');
SELECT pg_temp.assert_true((SELECT status='retired' FROM public.service_renewal_reminders_sent
 WHERE member_service_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae' AND days_before=14),
 'Retryable custom service reminder was not retired');
SELECT pg_temp.assert_true((SELECT status='attempting' FROM public.service_renewal_reminders_sent
 WHERE member_service_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae' AND days_before=30),
 'Provider-attempted service reminder history was changed');
INSERT INTO public.renewal_reminders_sent(account_id,membership_id,contact_id,end_date,days_before,delivery_state)
 VALUES('f3333333-3333-4333-8333-333333333331','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
   'f9999999-9999-4999-8999-999999999999',CURRENT_DATE+interval '14 days',14,'claimed')
 ON CONFLICT(membership_id,end_date,days_before) DO NOTHING;
SELECT pg_temp.assert_true((SELECT delivery_state='retired' FROM public.renewal_reminders_sent
 WHERE membership_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' AND days_before=14),
 'Retired custom reminder could be reclaimed');
INSERT INTO public.service_renewal_reminders_sent(account_id,member_service_id,end_date,days_before,status)
 VALUES('f3333333-3333-4333-8333-333333333331','faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
   CURRENT_DATE+interval '14 days',14,'claimed')
 ON CONFLICT(member_service_id,end_date,days_before) DO UPDATE SET status='claimed'
 WHERE public.service_renewal_reminders_sent.status='failed';
SELECT pg_temp.assert_true((SELECT status='retired' FROM public.service_renewal_reminders_sent
 WHERE member_service_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae' AND days_before=14),
 'Retired custom service reminder could be reclaimed');
UPDATE private.organization_paid_subscription_grants SET tier='starter' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SAVEPOINT activation_guard_case;
UPDATE private.subscription_billing_settings SET capabilities_enabled=false;
UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7]
 WHERE account_id='f3333333-3333-4333-8333-333333333331';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_billing_settings SET capabilities_enabled=true$q$,'55000');
ROLLBACK TO activation_guard_case;
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','gym_autopay'),'Starter AutoPay permitted');
SELECT pg_temp.assert_true(private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','standard_renewal_reminders'),'Starter standard reminders missing');
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','unknown'),'Unknown capability permitted');
INSERT INTO public.renewal_reminder_settings(account_id)
 VALUES('f3333333-3333-4333-8333-333333333331') ON CONFLICT(account_id) DO NOTHING;
SELECT pg_temp.expect_error($q$UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7] WHERE account_id='f3333333-3333-4333-8333-333333333331'$q$,'42501');
SELECT pg_temp.expect_error($q$UPDATE public.renewal_reminder_settings SET service_days_before=ARRAY[14,7] WHERE account_id='f3333333-3333-4333-8333-333333333331'$q$,'42501');
SELECT pg_temp.expect_error($q$UPDATE public.renewal_reminder_settings SET account_id='f3333333-3333-4333-8333-333333333332' WHERE account_id='f3333333-3333-4333-8333-333333333331'$q$,'42501');
UPDATE private.organization_paid_subscription_grants SET tier='growth' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7],service_days_before=ARRAY[14,7]
 WHERE account_id='f3333333-3333-4333-8333-333333333331';
UPDATE private.organization_paid_subscription_grants SET tier='starter' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE public.renewal_reminder_settings SET enabled=false,service_enabled=false
 WHERE account_id='f3333333-3333-4333-8333-333333333331';
SELECT pg_temp.expect_error($q$INSERT INTO public.payment_mandates(account_id) VALUES('f3333333-3333-4333-8333-333333333331')$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.razorpay_payment_links(account_id) VALUES('f3333333-3333-4333-8333-333333333331')$q$,'42501');

SELECT pg_temp.expect_error($q$INSERT INTO public.automations(account_id,user_id,name,trigger_type) VALUES('f3333333-3333-4333-8333-333333333331','f1111111-1111-4111-8111-111111111111','Denied','new_contact_created')$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.broadcasts(account_id,user_id,name,template_name) VALUES('f3333333-3333-4333-8333-333333333331','f1111111-1111-4111-8111-111111111111','Denied','template')$q$,'42501');
UPDATE private.organization_paid_subscription_grants SET tier='growth' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
INSERT INTO public.automations(id,account_id,user_id,name,trigger_type,is_active) VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','f3333333-3333-4333-8333-333333333331','f1111111-1111-4111-8111-111111111111','Retained automation','new_contact_created',true);
INSERT INTO public.broadcasts(id,account_id,user_id,name,template_name,status) VALUES('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','f3333333-3333-4333-8333-333333333331','f1111111-1111-4111-8111-111111111111','Retained campaign','template','scheduled');
INSERT INTO public.automation_pending_executions(automation_id,user_id,account_id,next_step_position,run_at,status,lease_owner,lease_until)
VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','f1111111-1111-4111-8111-111111111111','f3333333-3333-4333-8333-333333333331',0,now(),'running','fccccccc-cccc-4ccc-8ccc-cccccccccccc',now()+interval '5 minutes');
UPDATE private.organization_paid_subscription_grants SET tier='starter' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true((SELECT status='failed' FROM public.broadcasts WHERE id='fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'Old campaign survived downgrade');
SELECT pg_temp.assert_true((SELECT status='failed' AND lease_owner IS NULL AND lease_until IS NULL FROM public.automation_pending_executions WHERE automation_id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Old automation lease survived downgrade');
UPDATE public.automations SET is_active=false WHERE id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.expect_error($q$UPDATE public.automations SET is_active=true WHERE id='faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.automation_steps(automation_id,step_type,position) VALUES('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','send_message',0)$q$,'42501');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true((public.product_access_for_account('f3333333-3333-4333-8333-333333333331')->'subscription_capabilities')='["standard_renewal_reminders"]'::jsonb,'Snapshot does not match Starter');
SELECT pg_temp.expect_error($q$INSERT INTO public.broadcasts(account_id,user_id,name,template_name) VALUES('f3333333-3333-4333-8333-333333333331','f1111111-1111-4111-8111-111111111111','Denied authenticated','template')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','gym_autopay')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.product_access_for_account('f3333333-3333-4333-8333-333333333339')$q$,'42501');
RESET ROLE;
SAVEPOINT grace_case;
UPDATE private.organization_paid_subscription_grants SET paid_through_end=now()-interval '1 hour' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
UPDATE private.organization_product_access SET access_ends_at=now()+interval '71 hours' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','standard_renewal_reminders'),'Unproven grace granted capability');
INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,billing_account_id,tier,amount_minor,kind,source_period_start,source_period_end,source_tier,expected_access_version,first_failed_at)
SELECT 'fddddddd-dddd-4ddd-8ddd-dddddddddddd',g.organization_id,'f1111111-1111-4111-8111-111111111111','f3333333-3333-4333-8333-333333333331',g.tier,79900,'renewal',g.period_start,g.paid_through_end,g.tier,a.version,now()
FROM private.organization_paid_subscription_grants g JOIN private.organization_product_access a USING(organization_id) WHERE g.organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true(private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','standard_renewal_reminders'),'Verified grace lost old tier');
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','gym_autopay'),'Grace granted higher tier');
UPDATE private.organization_product_access SET access_ends_at=now() WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','standard_renewal_reminders'),'Exact expiry allowed');
ROLLBACK TO grace_case;
SAVEPOINT legacy_case;
DELETE FROM private.organization_paid_subscription_grants WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true(private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','gym_autopay'),'Grandfathered manual term lost access');
ROLLBACK TO legacy_case;
UPDATE private.organization_product_access SET suspended_at=now() WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true(NOT private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','standard_renewal_reminders'),'Suspension bypass');
UPDATE private.organization_product_access SET suspended_at=NULL,mode='complimentary' WHERE organization_id='f2222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true(private.subscription_capability_allowed('f3333333-3333-4333-8333-333333333331','gym_autopay'),'Complimentary changed');
ROLLBACK;
