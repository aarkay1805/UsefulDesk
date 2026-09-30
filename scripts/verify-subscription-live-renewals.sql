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

SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled
 AND NOT webhook_intake_enabled AND NOT settlements_enabled
 FROM private.subscription_live_settings WHERE singleton),
 'Live billing switches did not default off');
SELECT pg_temp.assert_true((SELECT bool_and(c.relrowsecurity) FROM pg_class c
 WHERE c.oid IN ('private.subscription_live_quotes'::regclass,
   'private.subscription_live_offer_approvals'::regclass,
   'private.subscription_live_orders'::regclass,
   'private.subscription_live_payments'::regclass,
   'private.subscription_live_grants'::regclass,
   'private.subscription_live_refunds'::regclass,
   'private.subscription_live_webhook_events'::regclass)),
 'A Live ledger table lacks RLS');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings
 SET orders_enabled=true WHERE singleton$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings
 SET quotes_enabled=true WHERE singleton$q$,'23514');
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
INSERT INTO private.subscription_live_offer_approvals
 (approval_id,organization_id,merchant_id,tier,amount_minor,term_policy,
  quote_validity_seconds,offer_reference,tax_decision_reference,
  refund_policy_reference,merchant_approval_reference,customer_tax_note,
  customer_terms_note,approved_at)
VALUES
 ('b7777777-7777-4777-8777-777777777777',
  'b2222222-2222-4222-8222-222222222222','acc_UsefulmadeLiveSynthetic',
  'growth',149900,'calendar_month_from_capture_event',1800,
  'synthetic-offer','synthetic-tax-review','synthetic-refund-review',
  'synthetic-merchant-review','Synthetic tax note','Synthetic monthly term',
  now()-interval '1 day'),
 ('b8888888-8888-4888-8888-888888888888',
  'b2222222-2222-4222-8222-222222222222','acc_UsefulmadeLiveSynthetic',
  'starter',79900,'calendar_month_from_capture_event',1800,
  'synthetic-starter-offer','synthetic-tax-review','synthetic-refund-review',
 'synthetic-merchant-review','Synthetic tax note','Synthetic monthly term',
  now()-interval '1 day');

SELECT pg_temp.assert_true((SELECT NOT renewals_enabled FROM private.subscription_live_settings), 'Renewals default on');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET renewals_enabled=TRUE$q$,'23514');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='private.subscription_live_terms'::regclass), 'History missing RLS');
-- Only this rollback fixture removes charge constraints. No installed gate changes.
ALTER TABLE private.subscription_live_settings DROP CONSTRAINT subscription_live_quotes_closed;
ALTER TABLE private.subscription_live_settings DROP CONSTRAINT subscription_live_settings_orders_enabled_check;
ALTER TABLE private.subscription_live_settings DROP CONSTRAINT subscription_live_renewals_closed;
UPDATE private.subscription_live_settings SET quotes_enabled=TRUE,orders_enabled=TRUE,renewals_enabled=TRUE;
UPDATE private.subscription_billing_settings SET standard_reminder_policy_approved=TRUE,
 standard_reminder_policy_version='synthetic-live-starter-v1',
 standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[],standard_reminder_hour_local=9;
INSERT INTO private.subscription_live_quotes
 (request_id,organization_id,requested_by,billing_account_id,merchant_id,tier,amount_minor,
 term_policy,offer_reference,tax_decision_reference,expires_at,owner_reviewed_at,created_at,offer_approval_id)
VALUES('b5555555-5555-4555-8555-555555555557','b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111','b4444444-4444-4444-8444-444444444444',
 'acc_UsefulmadeLiveSynthetic','starter',79900,'calendar_month_from_capture_event',
 'synthetic-starter-offer','synthetic-tax-review',now()-interval '1 month 23 hours',
 now()-interval '1 month 25 hours',now()-interval '1 month 25 hours','b8888888-8888-4888-8888-888888888888');
SET LOCAL request.jwt.claims='{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
-- Historical owner acknowledgment fixture; current RPC intentionally refuses expired quotes.
UPDATE private.subscription_live_quotes SET starter_reminder_reset_accepted=TRUE,
 starter_reminder_policy_version='synthetic-live-starter-v1';
INSERT INTO private.subscription_live_orders(request_id,organization_id,merchant_id,state,provider_order_id,claimed_at,bound_at)
VALUES('b5555555-5555-4555-8555-555555555557','b2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic','bound','order_InitialRenewalFixture',now()-interval '1 month 24 hours',now()-interval '1 month 24 hours');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_UsefulmadeLiveSynthetic',
 'b2222222-2222-4222-8222-222222222222','evt_InitialRenewalFixture','payment.captured',
 'order_InitialRenewalFixture','pay_InitialRenewalFixture',NULL,repeat('a',64),now()-interval '1 month 24 hours');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b5555555-5555-4555-8555-555555555557',
 'order_InitialRenewalFixture','pay_InitialRenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()-interval '1 month 24 hours')
 ->>'status'='verified','Initial fixture did not settle');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_terms),'Initial term history missing');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_live_renewal_preview('b2222222-2222-4222-8222-222222222222',
 'b4444444-4444-4444-8444-444444444444','starter')->>'renewal_of_request_id'='b5555555-5555-4555-8555-555555555557',
 'Renewal preview lost previous term');
SELECT pg_temp.expect_error($q$SELECT public.subscription_live_renewal_preview('b2222222-2222-4222-8222-222222222222',
 'b4444444-4444-4444-8444-444444444444','growth')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_live_terms$q$,'42501');
SET LOCAL request.jwt.claims='{"sub":"b9999999-9999-4999-8999-999999999999","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_cancel_live_renewal('b2222222-2222-4222-8222-222222222222',
 'b5555555-5555-4555-8555-555555555557')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_create_live_renewal_quote('b9999999-9999-4999-8999-999999999999',
 'b2222222-2222-4222-8222-222222222222','b4444444-4444-4444-8444-444444444444',
 'b1111111-1111-4111-8111-111111111111','b8888888-8888-4888-8888-888888888888',79900,'starter',
 'acc_UsefulmadeLiveSynthetic','b5555555-5555-4555-8555-555555555557');
SELECT pg_temp.assert_true(public.subscription_create_live_renewal_quote('b9999999-9999-4999-8999-999999999999',
 'b2222222-2222-4222-8222-222222222222','b4444444-4444-4444-8444-444444444444',
 'b1111111-1111-4111-8111-111111111111','b8888888-8888-4888-8888-888888888888',79900,'starter',
 'acc_UsefulmadeLiveSynthetic','b5555555-5555-4555-8555-555555555557')->>'request_id'='b9999999-9999-4999-8999-999999999999',
 'Quote retry changed identity');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_renewal_quote('b9999999-9999-4999-8999-999999999998',
 'b2222222-2222-4222-8222-222222222222','b4444444-4444-4444-8444-444444444444',
 'b1111111-1111-4111-8111-111111111111','b8888888-8888-4888-8888-888888888888',79900,'starter',
 'acc_UsefulmadeLiveSynthetic','b5555555-5555-4555-8555-555555555557')$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT expires_at-owner_reviewed_at=interval '30 minutes' FROM private.subscription_live_quotes
 WHERE request_id='b9999999-9999-4999-8999-999999999999'),'Renewal quote lifetime changed');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_quotes SET previous_access_version=999
 WHERE request_id='b9999999-9999-4999-8999-999999999999'$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_acknowledge_live_starter_reminders('b9999999-9999-4999-8999-999999999999');
RESET ROLE;
-- This transaction began before the quote existed. A transaction-start now()
-- would still allow Checkout after the wall-clock expiry.
SAVEPOINT quote_expiry_wall_clock;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
UPDATE private.subscription_live_quotes SET expires_at=clock_timestamp()+interval '100 milliseconds'
 WHERE request_id='b9999999-9999-4999-8999-999999999999';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
SELECT pg_sleep(0.2);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('b9999999-9999-4999-8999-999999999999',
 'b2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','acc_UsefulmadeLiveSynthetic')$q$,'55000');
ROLLBACK TO quote_expiry_wall_clock;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_order('b9999999-9999-4999-8999-999999999999',
 'b2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','acc_UsefulmadeLiveSynthetic')->>'action'='create',
 'Renewal order was not claimed');
SELECT pg_temp.assert_true(public.subscription_claim_live_order('b9999999-9999-4999-8999-999999999999',
 'b2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','acc_UsefulmadeLiveSynthetic')->>'action'='recovery',
 'Ambiguous renewal order permitted second POST');
SELECT public.subscription_bind_live_order('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','acc_UsefulmadeLiveSynthetic','b2222222-2222-4222-8222-222222222222');
-- Capture after quote creation; wall clock differs from transaction-start now().
SELECT public.subscription_record_live_webhook_event('acc_UsefulmadeLiveSynthetic',
 'b2222222-2222-4222-8222-222222222222','evt_RenewalFixture','payment.captured',
 'order_RenewalFixture','pay_RenewalFixture',NULL,repeat('b',64),now()+interval '1 second');
SAVEPOINT before_settlement;
RESET ROLE;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='b2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'reason'='renewal_changed_or_stopped','Stale access was renewed');
ROLLBACK TO before_settlement;

RESET ROLE;
UPDATE public.accounts SET default_currency='USD' WHERE id='b4444444-4444-4444-8444-444444444444';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'reason'='branch_roster_changed','Changed billing currency was renewed');
ROLLBACK TO before_settlement;

RESET ROLE;
UPDATE private.subscription_billing_settings SET standard_reminder_policy_approved=FALSE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'reason'='starter_reminder_policy_changed','Changed reminder policy was renewed');
ROLLBACK TO before_settlement;

RESET ROLE;
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_refund_reviews(
 refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,
 amount_minor,approved_policy_reference,request_received_at,
 request_evidence_reference,owner_reviewed_at)
VALUES('b6666666-6666-4666-8666-666666666666','b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111','pay_InitialRenewalFixture',
 'acc_UsefulmadeLiveSynthetic',79900,'synthetic-policy',now()-interval '1 second',
 'synthetic-late-request',now())$q$,'22023');
INSERT INTO private.subscription_live_refund_reviews(refund_request_id,organization_id,requested_by,
 provider_payment_id,merchant_id,amount_minor,approved_policy_reference,request_received_at,
 request_evidence_reference,owner_reviewed_at,review_kind,exception_reason)
VALUES('b6666666-6666-4666-8666-666666666666','b2222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111','pay_InitialRenewalFixture',
 'acc_UsefulmadeLiveSynthetic',79900,'synthetic-policy',now()-interval '1 second',
 'synthetic-exception-request',now(),'exception_review',
 'synthetic exceptional correction after standard window');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'reason'='renewal_changed_or_stopped','Pending refund was renewed');
ROLLBACK TO before_settlement;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_cancel_live_renewal('b2222222-2222-4222-8222-222222222222','b5555555-5555-4555-8555-555555555557');
SELECT public.subscription_cancel_live_renewal('b2222222-2222-4222-8222-222222222222','b5555555-5555-4555-8555-555555555557');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.product_access_audit WHERE action='subscription_live_renewal_cancelled'),
 'Cancellation audit duplicated');
SELECT pg_temp.assert_true((SELECT access_ends_at=(SELECT paid_through_end FROM private.subscription_live_grants)
 FROM private.organization_product_access WHERE organization_id='b2222222-2222-4222-8222-222222222222'), 'Cancellation cut paid access');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'reason'='renewal_changed_or_stopped','Cancellation did not hold captured money');
ROLLBACK TO before_settlement;
RESET ROLE;
-- Checkout and quote switches may be closed during an outage; held money still settles.
UPDATE private.subscription_live_settings SET orders_enabled=FALSE,quotes_enabled=FALSE,renewals_enabled=FALSE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'status'='verified','Renewal did not settle while initiation darkened');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()+interval '1 second')
 ->>'status'='verified','Renewal duplicate failed');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b5555555-5555-4555-8555-555555555557',
 'order_InitialRenewalFixture','pay_InitialRenewalFixture','acc_UsefulmadeLiveSynthetic',79900,'INR',now()-interval '1 month 24 hours')
 ->>'status'='verified','Historical payment replay failed after renewal');
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_live_initial_payment('b9999999-9999-4999-8999-999999999999',
 'order_RenewalFixture','pay_RenewalFixture','acc_UsefulmadeLiveSynthetic',79900,NULL,now()+interval '1 second')$q$,'22023');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_grants SET paid_through_end=now()$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM private.subscription_live_terms),'Term history overwritten');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_terms SET paid_through_end=now()$q$,'55000');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.product_access_audit WHERE action='verified_subscription_renewal' AND organization_id='b2222222-2222-4222-8222-222222222222'),
 'Renewal audit duplicated');
SELECT pg_temp.assert_true((SELECT paid_through_end=now()+interval '1 second 1 month' FROM private.subscription_live_grants),
 'Renewal did not start a capture-event calendar month');
UPDATE private.subscription_live_settings SET orders_enabled=TRUE,quotes_enabled=TRUE,renewals_enabled=TRUE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_live_renewal_preview('b2222222-2222-4222-8222-222222222222',
 'b4444444-4444-4444-8444-444444444444','starter')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_cancel_live_renewal('b2222222-2222-4222-8222-222222222222',
 'b5555555-5555-4555-8555-555555555557')$q$,'55000');
RESET ROLE;
SELECT 'PASS: Live expiry-only renewal, term history, owner review, dark recovery, duplicate and cancellation hold' AS result;
