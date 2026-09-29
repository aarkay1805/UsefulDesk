\set ON_ERROR_STOP on
-- Caller streams Live migrations inside BEGIN/ROLLBACK on a disposable full
-- application schema. Synthetic provider facts here do not prove a capture.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(value BOOLEAN,message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
 IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',message; END IF;
END; $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(statement TEXT,expected_state TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN
 EXECUTE statement;
 RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded: %',expected_state,statement;
EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected_state THEN RAISE; END IF;
END; $$;

SELECT pg_temp.assert_true((SELECT NOT orders_enabled AND NOT refunds_enabled
 AND NOT webhook_intake_enabled AND NOT settlements_enabled
 FROM private.subscription_live_settings WHERE singleton),
 'Live billing switches did not default off');
SELECT pg_temp.assert_true((SELECT bool_and(c.relrowsecurity) FROM pg_class c
 WHERE c.oid IN ('private.subscription_live_quotes'::regclass,
   'private.subscription_live_orders'::regclass,
   'private.subscription_live_payments'::regclass,
   'private.subscription_live_grants'::regclass,
   'private.subscription_live_refunds'::regclass,
   'private.subscription_live_webhook_events'::regclass)),
 'A Live ledger table lacks RLS');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings
 SET orders_enabled=true WHERE singleton$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings
 SET refunds_enabled=true WHERE singleton$q$,'23514');

INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
VALUES('b1111111-1111-4111-8111-111111111111',
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'live-boundary-owner@example.invalid',now(),
 '{"full_name":"Synthetic Live owner"}'::jsonb);
INSERT INTO public.organizations(id,name)
VALUES('b2222222-2222-4222-8222-222222222222','Synthetic Live pilot');
INSERT INTO public.legal_entities(id,organization_id,name)
VALUES('b3333333-3333-4333-8333-333333333333',
 'b2222222-2222-4222-8222-222222222222','Synthetic Live entity');
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
VALUES('b4444444-4444-4444-8444-444444444444','Synthetic Live branch',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'b3333333-3333-4333-8333-333333333333');
INSERT INTO public.organization_memberships(organization_id,user_id,role)
VALUES('b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111','owner');
INSERT INTO public.account_memberships(account_id,user_id,role)
VALUES('b4444444-4444-4444-8444-444444444444',
 'b1111111-1111-4111-8111-111111111111','owner');
INSERT INTO private.organization_product_access
 (organization_id,mode,trial_started_at,trial_ends_at)
VALUES('b2222222-2222-4222-8222-222222222222','trial',
 now()-interval '15 days',now()-interval '1 day')
ON CONFLICT(organization_id) DO UPDATE SET mode='trial',
 trial_started_at=excluded.trial_started_at,
 trial_ends_at=excluded.trial_ends_at;
UPDATE private.subscription_live_settings SET
 merchant_id='acc_UsefulmadeLiveSynthetic',
 pilot_organization_id='b2222222-2222-4222-8222-222222222222',
 webhook_intake_enabled=true,settlements_enabled=true WHERE singleton;
INSERT INTO private.subscription_live_quotes
 (request_id,organization_id,requested_by,billing_account_id,merchant_id,
  tier,amount_minor,term_policy,offer_reference,tax_decision_reference,
  expires_at,owner_reviewed_at)
VALUES('b5555555-5555-4555-8555-555555555555',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'b4444444-4444-4444-8444-444444444444',
 'acc_UsefulmadeLiveSynthetic','growth',149900,
 'calendar_month_from_capture_event','synthetic-offer','synthetic-tax-review',
 now()-interval '30 seconds',now()-interval '3 minutes');
UPDATE private.subscription_billing_settings SET
 standard_reminder_policy_approved=TRUE,
 standard_reminder_policy_version='synthetic-live-starter-v1',
 standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[],
 standard_reminder_hour_local=9 WHERE singleton;
INSERT INTO private.subscription_live_quotes
 (request_id,organization_id,requested_by,billing_account_id,merchant_id,
  tier,amount_minor,term_policy,offer_reference,tax_decision_reference,
  expires_at,owner_reviewed_at)
VALUES('b5555555-5555-4555-8555-555555555557',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'b4444444-4444-4444-8444-444444444444',
 'acc_UsefulmadeLiveSynthetic','starter',79900,
 'calendar_month_from_capture_event','synthetic-starter-offer','synthetic-tax-review',
 now()+interval '10 minutes',now()-interval '1 minute');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings
 SET merchant_id='acc_Other' WHERE singleton$q$,'55000');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_orders
 (request_id,organization_id,merchant_id,state,provider_order_id,bound_at)
VALUES('b5555555-5555-4555-8555-555555555555',
 'b2222222-2222-4222-8222-222222222222','acc_Wrong','bound',
 'order_Wrong',now())$q$,'23503');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true((public.subscription_live_owner_quote(
 'b2222222-2222-4222-8222-222222222222')->>'amount_minor')::BIGINT=79900,
 'Owner quote did not show exact Live pilot amount');
SELECT pg_temp.assert_true(public.subscription_acknowledge_live_starter_reminders(
 'b5555555-5555-4555-8555-555555555557')->>'policy_version'=
 'synthetic-live-starter-v1','Live Starter owner acknowledgment did not persist');
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_live_quotes$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order(
 'b5555555-5555-4555-8555-555555555555',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'acc_UsefulmadeLiveSynthetic')$q$,'42501');
RESET ROLE;
SAVEPOINT starter_grant_test;
INSERT INTO private.subscription_live_orders
 (request_id,organization_id,merchant_id,state,provider_order_id,bound_at)
VALUES('b5555555-5555-4555-8555-555555555557',
 'b2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic','bound','order_LiveStarter',now());
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_LiveStarter','payment.captured','order_LiveStarter',
 'pay_LiveStarter',NULL,repeat('e',64),now());
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'b5555555-5555-4555-8555-555555555557','order_LiveStarter',
 'pay_LiveStarter','acc_UsefulmadeLiveSynthetic',79900,'INR',now())
 ->>'status'='verified','Live Starter grant did not commit after owner review');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.product_access_audit
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'
   AND action='subscription_live_starter_reminders_applied'),
 'Live Starter grant skipped reminder normalization');
ALTER TABLE public.renewal_reminder_settings
 DISABLE TRIGGER subscription_reminder_schedule_write;
INSERT INTO public.renewal_reminder_settings
 (account_id,days_before,service_days_before)
VALUES('b4444444-4444-4444-8444-444444444444',ARRAY[2]::INTEGER[],ARRAY[2]::INTEGER[])
ON CONFLICT(account_id) DO UPDATE SET days_before=excluded.days_before,
 service_days_before=excluded.service_days_before;
ALTER TABLE public.renewal_reminder_settings
 ENABLE TRIGGER subscription_reminder_schedule_write;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_billing_settings
 SET capabilities_enabled=TRUE WHERE singleton$q$,'55000');
ROLLBACK TO SAVEPOINT starter_grant_test;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order(
 'b5555555-5555-4555-8555-555555555555',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'acc_UsefulmadeLiveSynthetic')$q$,'55000');
RESET ROLE;
INSERT INTO private.subscription_live_orders
 (request_id,organization_id,merchant_id,state,provider_order_id,claimed_at,bound_at)
VALUES('b5555555-5555-4555-8555-555555555555',
 'b2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic','bound','order_LiveSynthetic1',
 now()-interval '2 minutes',now()-interval '2 minutes');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order(
 'b5555555-5555-4555-8555-555555555555',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'acc_UsefulmadeLiveSynthetic')$q$,'55000');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_quotes
 SET amount_minor=1 WHERE request_id='b5555555-5555-4555-8555-555555555555'$q$,'55000');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_record_live_webhook_event(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_LiveSynthetic1','payment.captured','order_LiveSynthetic1',
 'pay_LiveSynthetic1',NULL,repeat('a',64),now()-interval '1 minute')->>'status'='held',
 'Signed delivery was not held');
SELECT pg_temp.assert_true(public.subscription_record_live_webhook_event(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_LiveSynthetic1','payment.captured','order_LiveSynthetic1',
 'pay_LiveSynthetic1',NULL,repeat('a',64),now()-interval '1 minute')->>'status'='duplicate',
 'Identical delivery did not replay');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_webhook_event(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_LiveSynthetic1','payment.captured','order_LiveSynthetic1',
 'pay_LiveSynthetic1',NULL,repeat('b',64),now()-interval '1 minute')$q$,'23505');
INSERT INTO private.subscription_live_webhook_events
 (merchant_id,event_id,organization_id,request_id,event_type,
  provider_order_id,provider_payment_id,provider_refund_id,body_sha256)
SELECT 'acc_UsefulmadeLiveSynthetic','evt_ARefund'||n,
 'b2222222-2222-4222-8222-222222222222',
 'b5555555-5555-4555-8555-555555555555','refund.created',
 'order_LiveSynthetic1','pay_LiveSynthetic1','rfnd_Queued'||n,
 repeat('d',64) FROM generate_series(1,5) n;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM jsonb_array_elements(
 public.subscription_list_live_held_events('acc_UsefulmadeLiveSynthetic',
 'b2222222-2222-4222-8222-222222222222',5,TRUE,FALSE)) e
 WHERE e->>'event_type'='payment.captured'),
 'Disabled refund queue starved captured payment recovery');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'b5555555-5555-4555-8555-555555555555','order_LiveSynthetic1',
 'pay_LiveSynthetic1','acc_UsefulmadeLiveSynthetic',149900,'INR',now()-interval '1 minute')
 ->>'status'='verified','Synthetic Live first payment did not commit');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'b5555555-5555-4555-8555-555555555555','order_LiveSynthetic1',
 'pay_LiveSynthetic1','acc_UsefulmadeLiveSynthetic',149900,'INR',now()-interval '1 minute')
 ->>'status'='verified','Live replay changed first payment');
SELECT pg_temp.assert_true(public.subscription_mark_live_event_reconciled(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_LiveSynthetic1',repeat('a',64))->>'state'='reconciled',
 'Captured event was not marked after durable payment');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_grants
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'),
 'Duplicate Live grant');
SELECT pg_temp.assert_true((SELECT period_start=now()-interval '1 minute'
 FROM private.subscription_live_grants
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'),
 'Delayed processing shifted the paid term away from signed capture event');
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at>now()
 FROM private.organization_product_access
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'),
 'Verified Live payment did not grant access');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_payments
 SET amount_minor=1 WHERE provider_payment_id='pay_LiveSynthetic1'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_grants
 SET tier='ultimate' WHERE organization_id='b2222222-2222-4222-8222-222222222222'$q$,'55000');
UPDATE private.subscription_billing_settings SET
 standard_reminder_policy_approved=true,
 standard_reminder_policy_version='synthetic-live-check',
 standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[],
 standard_reminder_hour_local=9,capabilities_enabled=true WHERE singleton;
SELECT pg_temp.assert_true(private.subscription_capability_allowed(
 'b4444444-4444-4444-8444-444444444444','gym_autopay'),
 'Live Growth grant was not recognized by the named capability predicate');

SAVEPOINT live_refund_success;
INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,
  merchant_id,amount_minor,approved_policy_reference,owner_reviewed_at)
VALUES('b6666666-6666-4666-8666-666666666666',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'pay_LiveSynthetic1','acc_UsefulmadeLiveSynthetic',149900,
 'synthetic-full-refund-policy',now());
INSERT INTO private.subscription_live_refunds
 (refund_request_id,provider_payment_id,provider_refund_id,
  organization_id,merchant_id,amount_minor,state)
VALUES('b6666666-6666-4666-8666-666666666666','pay_LiveSynthetic1',
 'rfnd_LiveSynthetic1','b2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic',149900,'processed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund(
 'b6666666-6666-4666-8666-666666666666','pay_LiveSynthetic1',
 'rfnd_LiveSynthetic1','acc_UsefulmadeLiveSynthetic',149900,'INR')
 ->>'confirmed_at' IS NOT NULL,'Full Live refund did not confirm');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access_ends_at<=clock_timestamp()
 FROM private.organization_product_access
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'),
 'Confirmed full Live refund did not end access');
ROLLBACK TO live_refund_success;

-- A second captured charge cannot rewrite the existing term.
INSERT INTO private.subscription_live_quotes
 (request_id,organization_id,requested_by,billing_account_id,merchant_id,
  tier,amount_minor,term_policy,offer_reference,tax_decision_reference,
  expires_at,owner_reviewed_at)
VALUES('b5555555-5555-4555-8555-555555555556',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'b4444444-4444-4444-8444-444444444444',
 'acc_UsefulmadeLiveSynthetic','growth',149900,
 'calendar_month_from_capture_event','synthetic-offer','synthetic-tax-review',
 now()+interval '10 minutes',now()-interval '1 minute');
INSERT INTO private.subscription_live_orders
 (request_id,organization_id,merchant_id,state,provider_order_id,bound_at)
VALUES('b5555555-5555-4555-8555-555555555556',
 'b2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic','bound','order_LiveSynthetic2',now());
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event(
 'acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222',
 'evt_LiveSynthetic2','payment.captured','order_LiveSynthetic2',
 'pay_LiveSynthetic2',NULL,repeat('c',64),now());
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'b5555555-5555-4555-8555-555555555556','order_LiveSynthetic2',
 'pay_LiveSynthetic2','acc_UsefulmadeLiveSynthetic',149900,'INR',now())
 ->>'status'='review_required','Later captured charge was not review-held');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_grants
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'),
 'Held capture changed access');

INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,
  merchant_id,amount_minor,approved_policy_reference,owner_reviewed_at)
VALUES('b6666666-6666-4666-8666-666666666666',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'pay_LiveSynthetic1','acc_UsefulmadeLiveSynthetic',149900,
 'synthetic-full-refund-policy',now());
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_refund(
 'b6666666-6666-4666-8666-666666666666',
 'b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111',
 'acc_UsefulmadeLiveSynthetic')$q$,'55000');
RESET ROLE;
INSERT INTO private.subscription_live_refunds
 (refund_request_id,provider_payment_id,provider_refund_id,
  organization_id,merchant_id,amount_minor,state)
VALUES('b6666666-6666-4666-8666-666666666666','pay_LiveSynthetic1',
 'rfnd_LiveSynthetic1','b2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic',149900,'processed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund(
 'b6666666-6666-4666-8666-666666666666','pay_LiveSynthetic1',
 'rfnd_LiveSynthetic1','acc_UsefulmadeLiveSynthetic',149900,'INR')
 ->>'review_reason'='later_payment_or_access_change',
 'Later captured funds were not preserved for refund review');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access_ends_at>now()
 FROM private.organization_product_access
 WHERE organization_id='b2222222-2222-4222-8222-222222222222'),
 'Held processed refund ended access');
SELECT 'PASS: Live dark gates, owner review, Starter normalization, signed capture time, held queue, refund race' AS result;
