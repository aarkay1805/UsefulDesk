\set ON_ERROR_STOP on
-- Synthetic facts only. Caller MUST wrap migration + acceptance in BEGIN/ROLLBACK
-- on a disposable full-schema database or verified empty billing staging project.
-- Never Production. No provider calls; all fixture facts and gates roll back.
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
 AND NOT complimentary_conversion_enabled AND NOT renewals_enabled AND NOT settlements_enabled
 AND NOT webhook_intake_enabled AND pilot_opening_review_id IS NULL
 FROM private.subscription_live_settings WHERE singleton),'Migration opened a Live gate');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals)
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_pilot_opening_reviews),'Migration seeded approval evidence');
SELECT pg_temp.assert_true((SELECT NOT capabilities_enabled AND NOT enabled
 FROM private.subscription_billing_settings WHERE singleton),'Migration changed global capability/Test billing');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class
 WHERE oid='private.subscription_live_pilot_opening_reviews'::regclass),'Opening reviews lack RLS');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET quotes_enabled=true$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_pilot_opening_reviews DEFAULT VALUES$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_orders DEFAULT VALUES$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_refunds DEFAULT VALUES$q$,'42501');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET quotes_enabled=true$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET renewals_enabled=true$q$,'23514');
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
VALUES('d1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','starter-opening-owner@example.invalid',now(),'{"full_name":"Synthetic owner"}');
INSERT INTO public.organizations(id,name)
VALUES('8826d9aa-03f2-4ad7-ae91-0553052131f8','Synthetic internal acceptance only');
INSERT INTO public.legal_entities(id,organization_id,name)
VALUES('d3333333-3333-4333-8333-333333333333','8826d9aa-03f2-4ad7-ae91-0553052131f8','Synthetic entity');
INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
VALUES('d4444444-4444-4444-8444-444444444444','Synthetic Home office',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111',
 'd3333333-3333-4333-8333-333333333333');
INSERT INTO public.organization_memberships(organization_id,user_id,role)
VALUES('8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','owner');
INSERT INTO public.account_memberships(account_id,user_id,role)
VALUES('d4444444-4444-4444-8444-444444444444','d1111111-1111-4111-8111-111111111111','owner');
INSERT INTO private.organization_product_access(organization_id,mode)
VALUES('8826d9aa-03f2-4ad7-ae91-0553052131f8','complimentary')
ON CONFLICT(organization_id) DO UPDATE SET mode='complimentary',trial_started_at=NULL,
 trial_ends_at=NULL,access_starts_at=NULL,access_ends_at=NULL;
UPDATE private.subscription_live_settings SET merchant_id='acc_TCJwBqanN9LTrK',
 pilot_organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8',
 webhook_intake_enabled=true,settlements_enabled=true WHERE singleton;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET merchant_id=NULL$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET merchant_id='acc_OtherMerchant'$q$,'23514');
INSERT INTO private.subscription_live_offer_approvals
 (approval_id,organization_id,merchant_id,tier,amount_minor,term_policy,quote_validity_seconds,
 offer_reference,tax_decision_reference,refund_policy_reference,merchant_approval_reference,
 customer_tax_note,customer_terms_note,approved_at)
VALUES('d7777777-7777-4777-8777-777777777777','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'acc_TCJwBqanN9LTrK','starter',79900,'calendar_month_from_capture_event',1800,
 'synthetic-internal-offer','synthetic-internal-no-sale-no-self-invoice',
 'synthetic-first-week-full-refund','synthetic-merchant-preflight',
 'Synthetic internal acceptance; no customer sale or invoice','Synthetic capture-event month',now()-interval '1 day');
-- Each insert guard executes before uniqueness, so these mutations cannot hide
-- behind an existing offer index failure. No constraints are dropped for checks.
DO $$ DECLARE col TEXT; val TEXT; BEGIN
 FOR col,val IN SELECT * FROM (VALUES('tier',quote_literal('growth')),('tier',quote_literal('ultimate')),
 ('amount_minor','79901'),('quote_validity_seconds','600'),('currency',quote_literal('USD')),
 ('merchant_id',quote_literal('acc_OtherMerchant')),('organization_id',quote_literal('d2222222-2222-4222-8222-222222222222'))) x LOOP
  PERFORM pg_temp.expect_error('INSERT INTO private.subscription_live_offer_approvals SELECT '
    || 'approval_id,organization_id,merchant_id,provider_mode,tier,amount_minor,currency,term_policy,'
    || 'quote_validity_seconds,offer_reference,tax_decision_reference,refund_policy_reference,'
    || 'merchant_approval_reference,customer_tax_note,customer_terms_note,approved_at,revoked_at '
    || 'FROM jsonb_populate_record(NULL::private.subscription_live_offer_approvals,'
    || '(SELECT to_jsonb(a) FROM private.subscription_live_offer_approvals a LIMIT 1) || jsonb_build_object('
    || quote_literal(col)||','||val||'))','22023');
 END LOOP;
END $$;
INSERT INTO private.subscription_live_pilot_opening_reviews
 (review_id,offer_approval_id,organization_id,merchant_id,commercial_context,reviewed_by,
 release_sha,migration_manifest_sha256,authorization_reference,provider_acceptance_reference,
 tax_receipt_review_reference,backup_recovery_reference,reviewed_at)
VALUES('d8888888-8888-4888-8888-888888888888','d7777777-7777-4777-8777-777777777777',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','acc_TCJwBqanN9LTrK','internal_acceptance',
 'd1111111-1111-4111-8111-111111111111',repeat('a',40),repeat('b',64),
 'synthetic-operator-opening-approval','synthetic-preflight-and-test-routing',
 'synthetic-internal-no-sale-no-self-invoice','synthetic-backup-and-recovery',now());
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_pilot_opening_reviews SET release_sha=repeat('c',40)$q$,'55000');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_pilot_opening_reviews$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET pilot_opening_review_id=
 'd8888888-8888-4888-8888-888888888888',quotes_enabled=true$q$,'55000');
UPDATE private.subscription_billing_settings SET standard_reminder_policy_approved=true,
 standard_reminder_policy_version='synthetic-starter-731-after09',
 standard_reminder_days_before=ARRAY[7,3,1],standard_reminder_hour_local=9 WHERE singleton;
UPDATE private.subscription_live_settings SET pilot_opening_review_id='d8888888-8888-4888-8888-888888888888',
 quotes_enabled=true,orders_enabled=true,refunds_enabled=true,complimentary_conversion_enabled=true WHERE singleton;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET quotes_enabled=false$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET webhook_intake_enabled=false$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET renewals_enabled=true$q$,'23514');
SELECT 'PASS: default closed, operator-only opening evidence, exact merchant/pilot/economics and reminder prerequisites';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT pg_temp.assert_true((public.subscription_live_offer_preview('8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd4444444-4444-4444-8444-444444444444','starter')->>'complimentary_conversion')::BOOLEAN,'Internal conversion preview failed');
SELECT pg_temp.expect_error($q$SELECT public.subscription_live_offer_preview('8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd4444444-4444-4444-8444-444444444444','growth')$q$,'55000');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('d9999999-9999-4999-8999-999999999999',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d4444444-4444-4444-8444-444444444444',
 'd1111111-1111-4111-8111-111111111111','d7777777-7777-4777-8777-777777777777',79900,'starter',
 'acc_TCJwBqanN9LTrK',false)$q$,'55000');
SELECT public.subscription_create_live_quote('d9999999-9999-4999-8999-999999999999',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d4444444-4444-4444-8444-444444444444',
 'd1111111-1111-4111-8111-111111111111','d7777777-7777-4777-8777-777777777777',79900,'starter','acc_TCJwBqanN9LTrK',true);
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('d9999999-9999-4999-8999-999999999999',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT expires_at-owner_reviewed_at=interval '1800 seconds'
 AND source_access_mode='complimentary' AND complimentary_conversion_accepted
 FROM private.subscription_live_quotes),'Approved quote economics/snapshot changed');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET pilot_opening_review_id=NULL$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_quotes SET amount_minor=1$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT public.subscription_acknowledge_live_starter_reminders('d9999999-9999-4999-8999-999999999999');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_order('d9999999-9999-4999-8999-999999999999',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')->>'action'='create','First order claim failed');
SELECT pg_temp.assert_true(public.subscription_claim_live_order('d9999999-9999-4999-8999-999999999999',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')->>'action'='recovery','Unbound claim allowed another POST');
SELECT public.subscription_bind_live_order('d9999999-9999-4999-8999-999999999999','order_StarterOpeningSynthetic',
 'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8');
RESET ROLE;
CREATE TEMP TABLE pg_temp.starter_capture(at TIMESTAMPTZ NOT NULL);
INSERT INTO pg_temp.starter_capture VALUES(clock_timestamp());
GRANT SELECT ON pg_temp.starter_capture TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'evt_StarterOpeningSynthetic','payment.captured','order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic',
 NULL,repeat('a',64),(SELECT at FROM pg_temp.starter_capture));
RESET ROLE;
SAVEPOINT capture_after_shutdown;
UPDATE private.subscription_live_settings SET quotes_enabled=false,orders_enabled=false,refunds_enabled=false,
 complimentary_conversion_enabled=false WHERE singleton;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('d9999999-9999-4999-8999-999999999999',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')$q$,'55000');
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_list_live_held_events('acc_TCJwBqanN9LTrK',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8',20,true,true))=1,'Rollback discarded capture recovery');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('d9999999-9999-4999-8999-999999999999',
 'order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.starter_capture))->>'status'='review_required','Rollback did not durably hold conversion capture');
SELECT public.subscription_mark_live_event_reconciled('acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'evt_StarterOpeningSynthetic',repeat('a',64));
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='complimentary' AND access_ends_at IS NULL
 FROM private.organization_product_access WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),
 'Shutdown capture changed complimentary access');
ROLLBACK TO capture_after_shutdown;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('d9999999-9999-4999-8999-999999999999',
 'order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.starter_capture))->>'status'='verified','Signed capture failed');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('d9999999-9999-4999-8999-999999999999',
 'order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.starter_capture))->>'status'='verified','Capture replay changed result');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at=(SELECT at+interval '1 month' FROM pg_temp.starter_capture)
 FROM private.organization_product_access WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),
 'Capture did not commit exactly one calendar month');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_terms$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_payments SET amount_minor=1$q$,'55000');
SELECT 'PASS: reviewed complimentary quote, one-POST order, immutable monthly capture/replay and shutdown capture recovery';
-- STARTER_PILOT_CAPABILITY_ACCEPTANCE
-- Immutable approval revocation must immediately stop initiation and still allow
-- reconciliation of already claimed money. References are synthetic, not tax proof.
SAVEPOINT revoke_offer;
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp();
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled
 AND NOT complimentary_conversion_enabled AND webhook_intake_enabled AND settlements_enabled
 FROM private.subscription_live_settings),'Offer revocation failed to stop initiation/preserve recovery');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET quotes_enabled=true$q$,'55000');
ROLLBACK TO revoke_offer;
SAVEPOINT revoke_review;
UPDATE private.subscription_live_pilot_opening_reviews SET revoked_at=clock_timestamp();
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled
 AND webhook_intake_enabled AND settlements_enabled FROM private.subscription_live_settings),
 'Review revocation failed to stop initiation/preserve recovery');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_pilot_opening_reviews SET revoked_at=NULL$q$,'55000');
ROLLBACK TO revoke_review;
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,
 approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
 VALUES('d6666666-6666-4666-8666-666666666666','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd1111111-1111-4111-8111-111111111111','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,
 'unrelated-policy',clock_timestamp(),'synthetic-request',clock_timestamp())$q$,'55000');
-- A legitimate ownership transfer must not strand an organization refund.
SAVEPOINT refund_after_owner_transfer;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
VALUES('d1212121-1212-4121-8121-121212121212','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','starter-new-owner@example.invalid',now(),'{"full_name":"Synthetic new owner"}');
DELETE FROM public.organization_memberships
 WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'
 AND user_id='d1111111-1111-4111-8111-111111111111';
INSERT INTO public.organization_memberships(organization_id,user_id,role)
VALUES('8826d9aa-03f2-4ad7-ae91-0553052131f8','d1212121-1212-4121-8121-121212121212','owner');
INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,
 approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
VALUES('d6161616-6161-4616-8616-616161616161','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd1212121-1212-4121-8121-121212121212','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,
 'synthetic-first-week-full-refund',clock_timestamp(),'synthetic-transferred-owner-request',clock_timestamp());
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_refund('d6161616-6161-4616-8616-616161616161',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1212121-1212-4121-8121-121212121212','acc_TCJwBqanN9LTrK')->>'action'='create',
 'Legitimate current owner could not claim the organization first-payment refund');
RESET ROLE;
ROLLBACK TO refund_after_owner_transfer;
INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,
 approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
VALUES('d6666666-6666-4666-8666-666666666666','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'd1111111-1111-4111-8111-111111111111','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,
 'synthetic-first-week-full-refund',clock_timestamp(),'synthetic-request',clock_timestamp());
SAVEPOINT disabled_refund_initiation;
UPDATE private.subscription_live_settings SET quotes_enabled=false,orders_enabled=false,refunds_enabled=false,
 complimentary_conversion_enabled=false WHERE singleton;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_refund('d6666666-6666-4666-8666-666666666666',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO disabled_refund_initiation;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_refund('d6666666-6666-4666-8666-666666666666',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')->>'action'='create',
 'First full refund claim failed');
RESET ROLE;
UPDATE private.subscription_live_settings SET quotes_enabled=false,orders_enabled=false,refunds_enabled=false,
 complimentary_conversion_enabled=false WHERE singleton;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_refund('d6666666-6666-4666-8666-666666666666',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','d1111111-1111-4111-8111-111111111111','acc_TCJwBqanN9LTrK')->>'action'='recovery',
 'Rollback disabled GET-only refund claim recovery');
SELECT public.subscription_observe_live_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,'INR','processed');
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'evt_StarterRefundSynthetic','refund.processed','order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic',
 'rfnd_StarterOpeningSynthetic',repeat('b',64),clock_timestamp());
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund('d6666666-6666-4666-8666-666666666666',
 'pay_StarterOpeningSynthetic','rfnd_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,'INR')->>'confirmed_at' IS NOT NULL,
 'Rollback prevented confirmed full-refund reconciliation');
SELECT public.subscription_mark_live_event_reconciled('acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',
 'evt_StarterRefundSynthetic',repeat('b',64));
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_live_webhook_events$q$,'42501');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_live_settings$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at<=clock_timestamp()
 FROM private.organization_product_access WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8'),
 'Verified refund did not end paid access');
SELECT pg_temp.assert_true((SELECT bool_and(NOT has_table_privilege('service_role',c.oid,'TRUNCATE')
 AND NOT has_table_privilege('authenticated',c.oid,'TRUNCATE')
 AND NOT has_table_privilege('anon',c.oid,'TRUNCATE')
 AND has_table_privilege('postgres',c.oid,'TRUNCATE')
 AND has_table_privilege('postgres',c.oid,'INSERT')
 AND has_table_privilege('service_role',c.oid,'SELECT'))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='private' AND c.relkind='r' AND c.relname LIKE 'subscription_live_%'),
 'Ledger privileges permit evidence erasure or lost operator/service read access');
SELECT pg_temp.assert_true((SELECT NOT capabilities_enabled AND NOT enabled
 FROM private.subscription_billing_settings WHERE singleton),'Global capabilities/Test billing changed');
SELECT 'PASS: approval/review revocation, policy-bound first refund, GET recovery after shutdown, processed refund and TRUNCATE denial';
