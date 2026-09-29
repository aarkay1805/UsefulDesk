\set ON_ERROR_STOP on
-- Runs only in the rollback-only disposable full-schema acceptance runner.
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
SELECT pg_temp.assert_true((SELECT NOT complimentary_conversion_enabled
 FROM private.subscription_live_settings WHERE singleton),
 'Complimentary conversion did not default off');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings
 SET complimentary_conversion_enabled=TRUE WHERE singleton$q$,'23514');

INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
VALUES('c1111111-1111-4111-8111-111111111111',
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'complimentary-owner@example.invalid',now(),'{"full_name":"Synthetic pilot owner"}'::jsonb);
INSERT INTO public.organizations(id,name)
VALUES('c2222222-2222-4222-8222-222222222222','Synthetic complimentary pilot');
INSERT INTO public.legal_entities(id,organization_id,name)
VALUES('c3333333-3333-4333-8333-333333333333',
 'c2222222-2222-4222-8222-222222222222','Synthetic entity');
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
VALUES('c4444444-4444-4444-8444-444444444444','Synthetic Home office',
 'c2222222-2222-4222-8222-222222222222',
 'c1111111-1111-4111-8111-111111111111',
 'c3333333-3333-4333-8333-333333333333');
INSERT INTO public.organization_memberships(organization_id,user_id,role)
VALUES('c2222222-2222-4222-8222-222222222222',
 'c1111111-1111-4111-8111-111111111111','owner');
INSERT INTO public.account_memberships(account_id,user_id,role)
VALUES('c4444444-4444-4444-8444-444444444444',
 'c1111111-1111-4111-8111-111111111111','owner');
INSERT INTO private.organization_product_access(organization_id,mode)
VALUES('c2222222-2222-4222-8222-222222222222','complimentary')
ON CONFLICT(organization_id) DO UPDATE SET mode='complimentary',
 trial_started_at=NULL,trial_ends_at=NULL,access_starts_at=NULL,access_ends_at=NULL;
UPDATE private.subscription_live_settings SET
 merchant_id='acc_UsefulmadeLiveSynthetic',
 pilot_organization_id='c2222222-2222-4222-8222-222222222222',
 webhook_intake_enabled=TRUE,settlements_enabled=TRUE WHERE singleton;
ALTER TABLE private.subscription_live_settings
 DROP CONSTRAINT subscription_live_quotes_closed;
ALTER TABLE private.subscription_live_settings
 DROP CONSTRAINT subscription_live_complimentary_conversion_closed;
ALTER TABLE private.subscription_live_settings
 DROP CONSTRAINT subscription_live_settings_orders_enabled_check;
UPDATE private.subscription_live_settings SET
 quotes_enabled=TRUE,complimentary_conversion_enabled=TRUE,orders_enabled=TRUE
 WHERE singleton;
UPDATE private.subscription_billing_settings SET
 standard_reminder_policy_approved=TRUE,
 standard_reminder_policy_version='synthetic-comp-starter-v1',
 standard_reminder_days_before=ARRAY[7,3,1]::INTEGER[],
 standard_reminder_hour_local=9 WHERE singleton;
INSERT INTO private.subscription_live_offer_approvals
 (approval_id,organization_id,merchant_id,tier,amount_minor,term_policy,
  quote_validity_seconds,offer_reference,tax_decision_reference,
  refund_policy_reference,merchant_approval_reference,customer_tax_note,
  customer_terms_note,approved_at)
VALUES('c7777777-7777-4777-8777-777777777777',
 'c2222222-2222-4222-8222-222222222222','acc_UsefulmadeLiveSynthetic',
 'starter',79900,'calendar_month_from_capture_event',600,
 'synthetic-comp-offer','synthetic-tax-review','synthetic-refund-review',
 'synthetic-merchant-review','Synthetic tax note','Synthetic monthly term',
 now()-interval '1 day');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_quotes
 (request_id,organization_id,requested_by,billing_account_id,merchant_id,
  tier,amount_minor,term_policy,offer_reference,tax_decision_reference,
  expires_at,owner_reviewed_at,offer_approval_id,source_access_version)
VALUES('c9999999-9999-4999-8999-999999999998',
 'c2222222-2222-4222-8222-222222222222',
 'c1111111-1111-4111-8111-111111111111',
 'c4444444-4444-4444-8444-444444444444',
 'acc_UsefulmadeLiveSynthetic','starter',79900,
 'calendar_month_from_capture_event','synthetic-comp-offer',
 'synthetic-tax-review',now()+interval '10 minutes',now(),
 'c7777777-7777-4777-8777-777777777777',1)$q$,'23514');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true((public.subscription_live_offer_preview(
 'c2222222-2222-4222-8222-222222222222',
 'c4444444-4444-4444-8444-444444444444','starter')
 ->>'complimentary_conversion')::BOOLEAN,
 'Selected complimentary pilot did not receive conversion preview');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote(
 'c9999999-9999-4999-8999-999999999999',
 'c2222222-2222-4222-8222-222222222222',
 'c4444444-4444-4444-8444-444444444444',
 'c1111111-1111-4111-8111-111111111111',
 'c7777777-7777-4777-8777-777777777777',79900,'starter',
 'acc_UsefulmadeLiveSynthetic')$q$,'55000');
SELECT pg_temp.assert_true((public.subscription_create_live_quote(
 'c9999999-9999-4999-8999-999999999999',
 'c2222222-2222-4222-8222-222222222222',
 'c4444444-4444-4444-8444-444444444444',
 'c1111111-1111-4111-8111-111111111111',
 'c7777777-7777-4777-8777-777777777777',79900,'starter',
 'acc_UsefulmadeLiveSynthetic',TRUE)->>'complimentary_conversion')::BOOLEAN,
 'Acknowledged complimentary quote was not issued');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT source_access_mode='complimentary'
 AND source_access_version=(SELECT version FROM private.organization_product_access
   WHERE organization_id='c2222222-2222-4222-8222-222222222222')
 AND complimentary_conversion_accepted
 FROM private.subscription_live_quotes
 WHERE request_id='c9999999-9999-4999-8999-999999999999'),
 'Quote did not freeze complimentary mode, version and acknowledgement');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_quotes
 SET source_access_version=999
 WHERE request_id='c9999999-9999-4999-8999-999999999999'$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_acknowledge_live_starter_reminders(
 'c9999999-9999-4999-8999-999999999999');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='complimentary' AND access_ends_at IS NULL
 FROM private.organization_product_access
 WHERE organization_id='c2222222-2222-4222-8222-222222222222'),
 'Quote or reminder acknowledgement changed free access');
SAVEPOINT changed_before_order;
UPDATE private.organization_product_access SET version=version+1
 WHERE organization_id='c2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order(
 'c9999999-9999-4999-8999-999999999999',
 'c2222222-2222-4222-8222-222222222222',
 'c1111111-1111-4111-8111-111111111111',
 'acc_UsefulmadeLiveSynthetic')$q$,'55000');
ROLLBACK TO changed_before_order;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_order(
 'c9999999-9999-4999-8999-999999999999',
 'c2222222-2222-4222-8222-222222222222',
 'c1111111-1111-4111-8111-111111111111',
 'acc_UsefulmadeLiveSynthetic')->>'action'='create',
 'Eligible pilot order was not claimed');
SELECT public.subscription_bind_live_order(
 'c9999999-9999-4999-8999-999999999999','order_CompSynthetic',
 'acc_UsefulmadeLiveSynthetic',
 'c2222222-2222-4222-8222-222222222222');
RESET ROLE;
CREATE TEMP TABLE pg_temp.comp_capture(at TIMESTAMPTZ NOT NULL);
INSERT INTO pg_temp.comp_capture VALUES(clock_timestamp());
GRANT SELECT ON pg_temp.comp_capture TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event(
 'acc_UsefulmadeLiveSynthetic','c2222222-2222-4222-8222-222222222222',
 'evt_CompSynthetic','payment.captured','order_CompSynthetic',
 'pay_CompSynthetic',NULL,repeat('a',64),(SELECT at FROM pg_temp.comp_capture));
RESET ROLE;
SAVEPOINT changed_before_settlement;
UPDATE private.organization_product_access SET version=version+1
 WHERE organization_id='c2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'c9999999-9999-4999-8999-999999999999','order_CompSynthetic',
 'pay_CompSynthetic','acc_UsefulmadeLiveSynthetic',79900,'INR',
 (SELECT at FROM pg_temp.comp_capture))->>'status'='review_required',
 'Changed access did not hold captured funds');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='complimentary' AND access_ends_at IS NULL
 FROM private.organization_product_access
 WHERE organization_id='c2222222-2222-4222-8222-222222222222'),
 'Held captured payment changed free access');
ROLLBACK TO changed_before_settlement;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment(
 'c9999999-9999-4999-8999-999999999999','order_CompSynthetic',
 'pay_CompSynthetic','acc_UsefulmadeLiveSynthetic',79900,'INR',
 (SELECT at FROM pg_temp.comp_capture))->>'status'='verified',
 'Eligible signed captured payment did not settle');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at>now()
 AND trial_started_at IS NULL AND trial_ends_at IS NULL
 FROM private.organization_product_access
 WHERE organization_id='c2222222-2222-4222-8222-222222222222'),
 'Verified pilot capture did not start one paid month without trial history');
SAVEPOINT converted_full_refund;
INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,
  merchant_id,amount_minor,approved_policy_reference,owner_reviewed_at)
VALUES('c6666666-6666-4666-8666-666666666666',
 'c2222222-2222-4222-8222-222222222222',
 'c1111111-1111-4111-8111-111111111111',
 'pay_CompSynthetic','acc_UsefulmadeLiveSynthetic',79900,
 'synthetic-full-refund-policy',now());
INSERT INTO private.subscription_live_refunds
 (refund_request_id,provider_payment_id,provider_refund_id,
  organization_id,merchant_id,amount_minor,state)
VALUES('c6666666-6666-4666-8666-666666666666','pay_CompSynthetic',
 'rfnd_CompSynthetic','c2222222-2222-4222-8222-222222222222',
 'acc_UsefulmadeLiveSynthetic',79900,'processed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_commit_live_full_refund(
 'c6666666-6666-4666-8666-666666666666','pay_CompSynthetic',
 'rfnd_CompSynthetic','acc_UsefulmadeLiveSynthetic',79900,'INR');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at<=clock_timestamp()
 FROM private.organization_product_access
 WHERE organization_id='c2222222-2222-4222-8222-222222222222'),
 'Completed full refund did not end converted access');
ROLLBACK TO converted_full_refund;
SELECT 'PASS: selected complimentary pilot acknowledgement, frozen snapshot, changed-access hold and signed conversion' AS result;
