-- Genuine functions; synthetic users/businesses only, entire runner rolls back.
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
INSERT INTO private.subscription_starter_signup_policies
 (policy_id,selection_scope,registrations_from,approved_by,authorization_reference,approved_at,enabled)
 VALUES('b3000000-0000-4000-8000-000000000001','all_new_gym_business_accounts',now()-interval '1 minute',
 'e6000000-0000-4000-8000-000000000002','synthetic preparation selection',now()-interval '1 minute',TRUE);
UPDATE private.product_access_settings SET enforcement_enabled=TRUE,trial_days=14;
INSERT INTO public.organizations(id,name) VALUES('b1000000-0000-4000-8000-000000000001','Synthetic next gym');
INSERT INTO public.legal_entities(id,organization_id,name,legal_name) VALUES
 ('b7000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Synthetic brand','Synthetic actual legal name');
INSERT INTO public.accounts(id,name,organization_id,legal_entity_id,owner_user_id,default_currency) VALUES
 ('b2000000-0000-4000-8000-000000000001','Synthetic first branch','b1000000-0000-4000-8000-000000000001',
 'b7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','INR');
UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()) WHERE id='e6000000-0000-4000-8000-000000000001';
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('b1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES
 ('b2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','owner');
CREATE TEMP TABLE signup_before AS SELECT to_jsonb(x) access FROM private.organization_product_access x WHERE organization_id='b1000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT trial_ends_at-trial_started_at=interval '14 days' FROM private.organization_product_access WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Normal 14-day trial missing');
CREATE TEMP TABLE signup_context AS SELECT private.subscription_starter_signup_context('b1000000-0000-4000-8000-000000000001') context;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true((SELECT item->'missing_facts' ? 'buyer_details' AND item->'missing_facts' ? 'gym_setup' FROM jsonb_array_elements(public.platform_admin_starter_signup_queue()->'items') item WHERE item->>'organization_id'='b1000000-0000-4000-8000-000000000001'),'Missing buyer/setup facts were hidden');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_save_starter_signup_work('f1000000-0000-4000-8000-000000000001',0,'wrong','e6000000-0000-4000-8000-000000000002','in_review','Review buyer','{}')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',0,'wrong','e6000000-0000-4000-8000-000000000002','in_review','Review buyer','{}')$q$,'40001');
RESET ROLE;
GRANT SELECT ON signup_context TO authenticated;
SET LOCAL ROLE authenticated;
SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',0,(SELECT context->>'snapshot_token' FROM signup_context),'e6000000-0000-4000-8000-000000000002','awaiting_facts','Collect actual buyer details','{}');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',1,TRUE)$q$,'55000');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',1,TRUE)$q$,'42501');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',1,'wrong','e6000000-0000-4000-8000-000000000002','blocked','Collect details','{}')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_starter_signup_queue()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',1,TRUE)$q$,'42501');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_starter_signup_work$q$,'42501');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
INSERT INTO public.invoice_profiles(account_id,business_name,legal_name,address_line1,city,state,postal_code,country,phone,email)
 VALUES('b2000000-0000-4000-8000-000000000001','Synthetic brand','Synthetic actual legal name','Synthetic street','Synthetic city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid');
INSERT INTO public.membership_plans(id,account_id,name,is_active,price,duration_days) VALUES
 ('b8000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Synthetic approved plan',TRUE,1000,30);
INSERT INTO public.plan_pricing_options(account_id,plan_id,duration_count,duration_unit,price,is_active) VALUES
 ('b2000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001',1,'month',1000,TRUE);
UPDATE public.accounts SET readiness_state='ready',setup_reviewed_at=clock_timestamp(),setup_reviewed_by='e6000000-0000-4000-8000-000000000002' WHERE id='b2000000-0000-4000-8000-000000000001';
UPDATE signup_context SET context=private.subscription_starter_signup_context('b1000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE signup_evidence AS SELECT jsonb_build_object(
 'authorization_reference','synthetic operator preparation only', 'buyer_geography_reference','synthetic verified geography',
 'issuer_financial_year_reference','synthetic current supplier financial year', 'tax_receipt_review_reference','synthetic inspected documents',
 'provider_acceptance_reference','synthetic actual preflight', 'backup_recovery_reference','synthetic current backup',
 'refund_policy_reference','synthetic refund and support review', 'merchant_approval_reference','synthetic merchant readiness',
 'offer_reference','synthetic exact offer', 'customer_tax_note','Synthetic customer tax treatment', 'customer_terms_note','Synthetic actual customer terms',
 'release_sha',repeat('a',40), 'migration_manifest_sha256',repeat('b',64)) evidence;
GRANT SELECT ON signup_evidence TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',1,(SELECT context->>'snapshot_token' FROM signup_context),'e6000000-0000-4000-8000-000000000002','in_review','Inspect exact offer and evidence',(SELECT evidence FROM signup_evidence));
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',1,'wrong','e6000000-0000-4000-8000-000000000002','blocked','Overwrite stale review','{}')$q$,'40001');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',2,FALSE)$q$,'42501');
RESET ROLE;
SAVEPOINT prepared_active_trial;
SET LOCAL ROLE authenticated;
SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',2,TRUE);
SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',2,TRUE);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(NOT opening_enabled AND opened_at IS NULL) FROM private.subscription_live_customer_preparations WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Preparation was duplicated or enabled');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(tier='starter' AND amount_minor=79900 AND quote_validity_seconds=1800) FROM private.subscription_live_offer_approvals WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Exact Starter offer changed');
SELECT pg_temp.assert_true((SELECT to_jsonb(x)=(SELECT access FROM signup_before) FROM private.organization_product_access x WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Preparation changed normal trial');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews WHERE organization_id='b1000000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes WHERE organization_id='b1000000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Operator invented owner authority');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_customer_review_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001') IS NULL,'Current trial saw payable review');
RESET ROLE;
-- Explicit synthetic expiry/opening for existing flow acceptance, never Production.
UPDATE private.organization_product_access SET trial_started_at=now()-interval '15 days',trial_ends_at=now()-interval '1 day' WHERE organization_id='b1000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_preparations SET opening_enabled=TRUE WHERE organization_id='b1000000-0000-4000-8000-000000000001'$q$,'55000');
-- Changed facts require revoking and separately reviewing a replacement; never rewrite a frozen review.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true((SELECT item->>'preparation_stale'='true' FROM jsonb_array_elements(public.platform_admin_starter_signup_queue()->'items') item WHERE item->>'organization_id'='b1000000-0000-4000-8000-000000000001'),'Stale preparation hidden');
RESET ROLE;
ROLLBACK TO prepared_active_trial;
UPDATE private.organization_product_access SET trial_started_at=now()-interval '15 days',trial_ends_at=now()-interval '1 day' WHERE organization_id='b1000000-0000-4000-8000-000000000001';
UPDATE signup_context SET context=private.subscription_starter_signup_context('b1000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',2,(SELECT context->>'snapshot_token' FROM signup_context),'e6000000-0000-4000-8000-000000000002','in_review','Authorize exact release after expiry',(SELECT evidence FROM signup_evidence));
SELECT public.platform_admin_freeze_starter_signup_preparation('b1000000-0000-4000-8000-000000000001',3,TRUE);
RESET ROLE;
UPDATE private.subscription_live_customer_preparations SET opening_enabled=TRUE WHERE organization_id='b1000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.organization_audit_log WHERE organization_id='b1000000-0000-4000-8000-000000000001' AND (details ? 'evidence' OR details ? 'next_action')),'Private operator references leaked into owner-readable audit');
CREATE TEMP TABLE frozen_preparation AS SELECT review_id,offer_approval_id FROM private.subscription_live_customer_preparations WHERE organization_id='b1000000-0000-4000-8000-000000000001';
GRANT SELECT ON frozen_preparation TO authenticated,service_role;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT public.subscription_approve_customer_review((SELECT review_id FROM frozen_preparation),79900,TRUE);
SELECT public.subscription_approve_customer_review((SELECT review_id FROM frozen_preparation),79900,TRUE);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Actual owner review skipped initially closed scope');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_open_reviewed_customer_scope((SELECT review_id FROM frozen_preparation),'b1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001');
SELECT public.subscription_create_live_quote('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',(SELECT offer_approval_id FROM frozen_preparation),79900,'starter','acc_TCJwBqanN9LTrK',FALSE);
RESET ROLE;
SELECT pg_temp.assert_true(private.subscription_customer_review_active('b1000000-0000-4000-8000-000000000001',(SELECT review_id FROM frozen_preparation)),'Quote creation incorrectly made its own immutable preparation stale');
SAVEPOINT bookkeeping_only;
UPDATE public.invoice_profiles SET updated_at=clock_timestamp()+interval '1 second' WHERE account_id='b2000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(private.subscription_customer_review_active('b1000000-0000-4000-8000-000000000001',(SELECT review_id FROM frozen_preparation)),'Unchanged buyer bookkeeping invalidated reviewed authority');
ROLLBACK TO bookkeeping_only;
UPDATE public.membership_plans SET updated_at=clock_timestamp() WHERE id='b8000000-0000-4000-8000-000000000001';
UPDATE public.plan_pricing_options SET updated_at=clock_timestamp() WHERE account_id='b2000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(private.subscription_customer_review_active('b1000000-0000-4000-8000-000000000001',(SELECT review_id FROM frozen_preparation)),'Unchanged plan bookkeeping invalidated authority');
SAVEPOINT changed_price;
UPDATE public.plan_pricing_options SET duration_count=2 WHERE account_id='b2000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT private.subscription_customer_review_active('b1000000-0000-4000-8000-000000000001',(SELECT review_id FROM frozen_preparation)),'Changed plan facts retained authority');
ROLLBACK TO changed_price;
SAVEPOINT changed_buyer;
UPDATE public.invoice_profiles SET city='Changed actual buyer city' WHERE account_id='b2000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT private.subscription_customer_review_active('b1000000-0000-4000-8000-000000000001',(SELECT review_id FROM frozen_preparation)),'Changed buyer facts retained payable authority');
ROLLBACK TO changed_buyer;
-- PREPARATION_CAPTURE_ACCEPTANCE: genuine owner acknowledgement and bound signed intake.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT public.subscription_acknowledge_live_starter_reminders('b5000000-0000-4000-8000-000000000001');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_live_order('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK');
SELECT public.subscription_bind_live_order('b5000000-0000-4000-8000-000000000001','order_PreparationSynthetic','acc_TCJwBqanN9LTrK','b1000000-0000-4000-8000-000000000001');
RESET ROLE;
CREATE TEMP TABLE preparation_capture_time AS SELECT clock_timestamp() at;
GRANT SELECT ON preparation_capture_time TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','b1000000-0000-4000-8000-000000000001','evt_PreparationSynthetic','payment.captured','order_PreparationSynthetic','pay_PreparationSynthetic',NULL,repeat('b',64),(SELECT at FROM preparation_capture_time));
RESET ROLE;
SAVEPOINT captured_stale_buyer;
UPDATE public.invoice_profiles SET city='Changed before settlement' WHERE account_id='b2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b5000000-0000-4000-8000-000000000001','order_PreparationSynthetic','pay_PreparationSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',(SELECT at FROM preparation_capture_time))->>'status'='review_required','Changed buyer capture granted access');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Held capture created a grant');
ROLLBACK TO captured_stale_buyer;
-- Accountability can change; immutable evidence and fingerprints cannot.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',4,(SELECT context->>'snapshot_token' FROM signup_context),'e6000000-0000-4000-8000-000000000002','blocked','Review the release before opening',(SELECT evidence FROM signup_evidence));
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_save_starter_signup_work('b1000000-0000-4000-8000-000000000001',5,(SELECT context->>'snapshot_token' FROM signup_context),'e6000000-0000-4000-8000-000000000002','in_review','Rewrite frozen evidence','{}')$q$,'55000');
RESET ROLE;
UPDATE private.subscription_live_customer_preparations SET opening_enabled=FALSE WHERE organization_id='b1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_open_reviewed_customer_scope((SELECT review_id FROM frozen_preparation),'b1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001')$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id='b1000000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Unpaid owner review granted access');
SELECT 'PASS: durable selected-gym work, missing facts, MFA denial, stale/duplicate review, exact closed preparation and unchanged 14-day trial';
-- Containment after order creation preserves settlement of its original signed capture.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b5000000-0000-4000-8000-000000000001','order_PreparationSynthetic','pay_PreparationSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',(SELECT at FROM preparation_capture_time))->>'status'='verified','Tracked exact capture failed after containment');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('b5000000-0000-4000-8000-000000000001','order_PreparationSynthetic','pay_PreparationSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',(SELECT at FROM preparation_capture_time))->>'status'='verified','Tracked capture retry failed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT mode='manual' AND access_ends_at=at+interval '1 month' FROM private.organization_product_access CROSS JOIN preparation_capture_time WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Verified capture did not grant the exact calendar month');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_payments WHERE organization_id='b1000000-0000-4000-8000-000000000001') AND (SELECT count(*)=1 FROM private.subscription_live_grants WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Capture retry duplicated paid ledgers');
SELECT pg_temp.assert_true(private.subscription_customer_review_active('b1000000-0000-4000-8000-000000000001',(SELECT review_id FROM frozen_preparation)),'Legitimate verified paid-access transition invalidated commercial review');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true((SELECT item->>'review_status'='payment_verified' AND item->>'preparation_stale'='false' FROM jsonb_array_elements(public.platform_admin_starter_signup_queue()->'items') item WHERE item->>'organization_id'='b1000000-0000-4000-8000-000000000001'),'Paid queue state marked unchanged preparation stale');
RESET ROLE;
INSERT INTO private.subscription_live_renewal_releases(release_id,organization_id,merchant_id,customer_review_id,owner_user_id,release_sha,migration_manifest_sha256,authorization_reference,provider_acceptance_reference,backup_recovery_reference,reviewed_at)
SELECT 'b9000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK',review_id,'e6000000-0000-4000-8000-000000000001',repeat('a',40),repeat('b',64),'synthetic future renewal release','synthetic provider acceptance','synthetic backup',clock_timestamp() FROM frozen_preparation;
UPDATE private.subscription_live_customer_scopes SET renewal_release_id='b9000000-0000-4000-8000-000000000001' WHERE organization_id='b1000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(private.subscription_customer_renewal_release_active('b1000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001'),'Tracked paid transition blocked separately reviewed renewal release');
SELECT pg_temp.assert_true((SELECT NOT renewals_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='b1000000-0000-4000-8000-000000000001'),'Preparation opened renewal gate');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_live_renewal_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','starter')$q$,'55000');
RESET ROLE;
UPDATE public.invoice_profiles SET city='Changed after payment' WHERE account_id='b2000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(NOT private.subscription_customer_renewal_release_active('b1000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001'),'Changed buyer retained renewal authority');
SELECT 'PASS: tracked signed capture, stale buyer hold, containment, idempotent calendar-month grant and closed/fresh renewal authority';
