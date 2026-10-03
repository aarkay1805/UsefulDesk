-- All evidence and organizations in this fixture are synthetic and rolled back.
SAVEPOINT monthly_transaction_acceptance;
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
INSERT INTO public.organizations(id,name) VALUES('c1000000-0000-4000-8000-000000000001','Synthetic monthly gym');
INSERT INTO public.legal_entities(id,organization_id,name,legal_name) VALUES
 ('c7000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Synthetic monthly brand','Synthetic monthly legal name');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.accounts(id,name,organization_id,legal_entity_id,owner_user_id,default_currency)
 SELECT ('c2000000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID,'Synthetic branch '||n,
 'c1000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','INR'
 FROM generate_series(1,5) n;
INSERT INTO public.invoice_profiles(account_id,business_name,legal_name,address_line1,city,state,postal_code,country,phone,email)
 SELECT id,'Synthetic monthly brand','Synthetic monthly buyer','Synthetic street','Synthetic city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid'
 FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001';
INSERT INTO public.membership_plans(account_id,name,is_active,price,duration_days)
 SELECT id,'Synthetic active plan',TRUE,1000,30 FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001';
INSERT INTO public.plan_pricing_options(account_id,plan_id,duration_count,duration_unit,price,is_active)
 SELECT account_id,id,1,'month',1000,TRUE FROM public.membership_plans WHERE account_id IN
 (SELECT id FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001');
UPDATE public.accounts SET readiness_state='ready',setup_reviewed_at=clock_timestamp(),setup_reviewed_by='e6000000-0000-4000-8000-000000000002'
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE monthly_input AS SELECT
 (SELECT evidence-ARRAY['offer_reference','customer_tax_note','customer_terms_note'] FROM signup_evidence)
 ||jsonb_build_object('capability_readiness_reference','synthetic separately reviewed enforcement') evidence,
 (SELECT jsonb_agg(jsonb_build_object('tier',tier,'amount_minor',amount_minor,'offer_reference','synthetic exact '||tier,
  'customer_tax_note','Synthetic tax '||tier,'customer_terms_note','Synthetic terms '||tier,
  'customer_refund_note','Synthetic first-payment refund '||tier,'document_treatment','usefulmade_unregistered_invoice_receipt_v1') ORDER BY amount_minor)
 FROM private.subscription_monthly_catalog) offers;
GRANT SELECT ON monthly_input TO authenticated;
INSERT INTO public.renewal_reminder_settings(account_id,days_before,service_days_before) SELECT id,ARRAY[14,7],ARRAY[14,7] FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access SET trial_started_at=now()-interval '16 days',trial_ends_at=now()-interval '2 days' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.subscription_billing_settings SET capabilities_enabled=TRUE WHERE singleton;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_prepare_monthly_offers('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'snapshot_token',
 (SELECT offers FROM monthly_input),(SELECT evidence FROM monthly_input),TRUE);
RESET ROLE;
CREATE TEMP TABLE monthly_selected AS SELECT o.* FROM private.subscription_monthly_offers o WHERE tier='growth';
GRANT SELECT ON monthly_selected TO authenticated,service_role;
CREATE TEMP TABLE monthly_alternatives AS SELECT * FROM private.subscription_monthly_offers;
GRANT SELECT ON monthly_alternatives TO authenticated;
CREATE FUNCTION pg_temp.monthly_approve() RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,TRUE) FROM monthly_selected;
$body$;
CREATE FUNCTION pg_temp.monthly_open() RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_open_reviewed_customer_scope(review_id,organization_id,'e6000000-0000-4000-8000-000000000001')
 FROM private.subscription_live_customer_preparations WHERE organization_id='c1000000-0000-4000-8000-000000000001';
$body$;
CREATE FUNCTION pg_temp.monthly_quote(p_request UUID DEFAULT 'c9000000-0000-4000-8000-000000000001') RETURNS JSONB LANGUAGE sql AS $body$
 SELECT public.subscription_create_monthly_quote(p_request,p.organization_id,p.billing_account_id,p.owner_user_id,p.review_id,p.monthly_offer_id,o.amount_minor,o.merchant_id)
 FROM private.subscription_live_customer_preparations p JOIN monthly_selected o USING(monthly_offer_id);
$body$;
SAVEPOINT tier_starter;
DELETE FROM monthly_selected;
INSERT INTO monthly_selected SELECT * FROM private.subscription_monthly_offers WHERE tier='starter';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY[billing_account_id]) FROM monthly_selected$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY['c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002']::UUID[]) FROM monthly_selected$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY['f2000000-0000-4000-8000-000000000001']::UUID[]) FROM monthly_selected$q$,'22023');
SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY['c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000005']::UUID[]) FROM monthly_selected;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=5 FROM public.membership_plans WHERE account_id IN(SELECT id FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001')),'Archive deleted branch history');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001' AND branch_status='archived'),'Archive was undone without payment');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_prepare_monthly_offers('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'snapshot_token',
 (SELECT offers FROM monthly_input),(SELECT evidence FROM monthly_input),TRUE);
RESET ROLE;
DELETE FROM monthly_selected;
INSERT INTO monthly_selected SELECT o.* FROM private.subscription_monthly_offers o JOIN private.subscription_monthly_offer_sets ms USING(offer_set_id) WHERE ms.revoked_at IS NULL AND o.tier='starter';
DELETE FROM monthly_alternatives;
INSERT INTO monthly_alternatives SELECT o.* FROM private.subscription_monthly_offers o JOIN private.subscription_monthly_offer_sets ms USING(offer_set_id) WHERE ms.revoked_at IS NULL;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor+1,TRUE) FROM monthly_selected$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,FALSE) FROM monthly_selected$q$,'42501');
RESET ROLE;
SAVEPOINT monthly_staff_roles;
INSERT INTO public.organizations(id,name) VALUES('c1000000-0000-4000-8000-000000000099','Synthetic other tenant');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES('c1000000-0000-4000-8000-000000000099','e6000000-0000-4000-8000-000000000002','owner');
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','admin');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
UPDATE public.account_memberships SET role='agent' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
UPDATE public.account_memberships SET role='viewer' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
ROLLBACK TO monthly_staff_roles;
SAVEPOINT refuse_active_trial;
UPDATE private.organization_product_access SET trial_ends_at=now()+interval '2 days' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_active_trial;
SAVEPOINT refuse_suspended;
UPDATE private.organization_product_access SET suspended_at=clock_timestamp() WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_suspended;
SAVEPOINT refuse_manual;
UPDATE private.organization_product_access SET mode='manual',access_starts_at=now()-interval '1 day',access_ends_at=now()+interval '1 day' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_manual;
SAVEPOINT refuse_complimentary;
UPDATE private.organization_product_access SET mode='complimentary' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_complimentary;
SAVEPOINT refuse_gate;
UPDATE private.subscription_billing_settings SET capabilities_enabled=FALSE WHERE singleton;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_gate;
SAVEPOINT refuse_noninr;
UPDATE public.accounts SET default_currency='USD' WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_noninr;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.monthly_approve();
SELECT pg_temp.monthly_approve();
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,TRUE)
 FROM monthly_alternatives WHERE tier<>(SELECT tier FROM monthly_selected) LIMIT 1$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Monthly review did not create closed scope');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_open()$q$,'55000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_authorize_monthly_opening(offer_set_id,
 public.platform_admin_monthly_offer_context(organization_id,billing_account_id)->>'snapshot_token','synthetic separate opening review',TRUE) FROM monthly_selected;
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.monthly_open();
SELECT pg_temp.monthly_open();
RESET ROLE;
SAVEPOINT boundary_buyer;
UPDATE public.invoice_profiles SET email='changed@example.invalid' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_buyer;
SAVEPOINT boundary_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_setup;
SAVEPOINT boundary_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_access;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.monthly_quote();
SELECT pg_temp.monthly_quote();
RESET ROLE;
SAVEPOINT monthly_containment;
UPDATE private.subscription_live_customer_scopes SET quotes_enabled=FALSE,orders_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_open()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO monthly_containment;
SAVEPOINT monthly_expired_quote;
-- Synthetic clock alignment only; no provider order exists in this savepoint.
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'23505');
SELECT pg_temp.monthly_quote('c9000000-0000-4000-8000-000000000002');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(DISTINCT monthly_offer_id)=1 AND count(*)=2 FROM private.subscription_live_quotes WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Expired replacement changed selected contract');
ROLLBACK TO monthly_expired_quote;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
RESET ROLE;
SAVEPOINT second_actual_owner;
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','owner');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_monthly_quote('c9000000-0000-4000-8000-000000000002',p.organization_id,p.billing_account_id,
 'e6000000-0000-4000-8000-000000000002',p.review_id,p.monthly_offer_id,o.amount_minor,o.merchant_id)
 FROM private.subscription_live_customer_preparations p JOIN monthly_selected o USING(monthly_offer_id)$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000002','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO second_actual_owner;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_monthly_offer_preview('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'selectedOfferId'=(SELECT monthly_offer_id::TEXT FROM monthly_selected),'Frozen selection lost after quote');
SELECT public.subscription_acknowledge_live_starter_reminders('c9000000-0000-4000-8000-000000000001');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
RESET ROLE;
SAVEPOINT boundary_buyer;
UPDATE public.invoice_profiles SET email='changed@example.invalid' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_buyer;
SAVEPOINT boundary_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_setup;
SAVEPOINT boundary_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_access;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK');
SELECT pg_temp.assert_true(public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='recovery','Ambiguous claim allowed another create');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote('c9000000-0000-4000-8000-000000000002')$q$,'55000');
SELECT public.subscription_bind_live_order('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error($q$SELECT public.subscription_bind_live_order('c9000000-0000-4000-8000-000000000001','order_ChangedMonthly','acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001')$q$,'23505');
RESET ROLE;
CREATE TEMP TABLE monthly_capture AS SELECT clock_timestamp() captured;
GRANT SELECT ON monthly_capture TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))$q$,'22023');
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001','evt_monthly_synthetic','payment.captured',
 'order_MonthlySynthetic','pay_MonthlySynthetic',NULL,repeat('d',64),(SELECT captured FROM monthly_capture));
RESET ROLE;
SAVEPOINT monthly_capture_contained;
UPDATE private.subscription_live_customer_preparations SET opening_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Initiation containment prevented existing signed settlement');
RESET ROLE;
ROLLBACK TO monthly_capture_contained;
SAVEPOINT capture_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Setup drift without access-version change escaped capture hold');
RESET ROLE;
ROLLBACK TO capture_setup;
SAVEPOINT monthly_late_capture;
-- Backdate the synthetic immutable quote's clock, restoring every guard before
-- invoking settlement. This isolates late-capture behavior without a 30m wait.
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'reason'='quote_expired_or_changed','Late capture did not persist hold');
RESET ROLE;
ROLLBACK TO monthly_late_capture;
SAVEPOINT capture_buyer;
UPDATE public.invoice_profiles SET legal_name='Synthetic changed buyer' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed buyer capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_buyer;
SAVEPOINT capture_owner;
DELETE FROM public.organization_memberships WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed owner capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_owner;
SAVEPOINT capture_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed access capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_access;
SAVEPOINT capture_roster;
UPDATE public.accounts SET branch_status='read_only' WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed roster capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_roster;
SAVEPOINT capture_revocation;
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed revocation capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_revocation;
SAVEPOINT capture_gate;
UPDATE private.subscription_billing_settings SET capabilities_enabled=FALSE WHERE singleton;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed gate capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_gate;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture));
RESET ROLE;
SELECT pg_temp.assert_true((SELECT g.tier=o.tier AND g.period_start=c.captured AND g.paid_through_end=c.captured+interval '1 month'
 FROM private.subscription_live_grants g CROSS JOIN monthly_selected o CROSS JOIN monthly_capture c WHERE g.organization_id=o.organization_id),'Selected tier/calendar month not granted');
SELECT pg_temp.assert_true((SELECT private.subscription_base_included_branches(g.tier)=o.included_branches FROM private.subscription_live_grants g CROSS JOIN monthly_selected o WHERE g.organization_id=o.organization_id),'Wrong base capacity');
SAVEPOINT monthly_capability_clock;
-- NOW() is frozen at BEGIN while captures use wall time. Align only synthetic
-- grant/access starts for active snapshot reads; rollback restores exact evidence.
ALTER TABLE private.subscription_live_grants DISABLE TRIGGER subscription_freeze_live_grant_evidence;
UPDATE private.subscription_live_grants SET period_start=now()-interval '1 minute' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access x SET access_starts_at=g.period_start FROM private.subscription_live_grants g WHERE x.organization_id=g.organization_id AND x.organization_id='c1000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_grants ENABLE TRIGGER subscription_freeze_live_grant_evidence;
SELECT pg_temp.assert_true((SELECT bool_and(private.subscription_capability_allowed('c2000000-0000-4000-8000-000000000001',cap)=(cap='standard_renewal_reminders' OR tier IN ('growth','ultimate')))
 FROM monthly_selected CROSS JOIN unnest(ARRAY['standard_renewal_reminders','custom_renewal_schedules','bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay']) cap),'SQL capability matrix differs from plans.ts');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_payments WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Payment duplicated');
SELECT pg_temp.assert_true((SELECT bool_and(r.days_before=CASE WHEN o.tier='starter' THEN ARRAY[7,3,1] ELSE ARRAY[14,7] END AND r.service_days_before=r.days_before) FROM public.renewal_reminder_settings r JOIN public.accounts a ON a.id=r.account_id CROSS JOIN monthly_selected o WHERE a.organization_id=o.organization_id),'Starter reset or Growth/Ultimate custom schedule preservation failed');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_renewal_releases(release_id,organization_id,merchant_id,customer_review_id,owner_user_id,
 release_sha,migration_manifest_sha256,authorization_reference,provider_acceptance_reference,backup_recovery_reference,reviewed_at)
 SELECT gen_random_uuid(),organization_id,merchant_id,review_id,reviewed_by,release_sha,migration_manifest_sha256,
 'synthetic forbidden renewal','synthetic','synthetic',clock_timestamp() FROM private.subscription_live_customer_reviews
 WHERE organization_id='c1000000-0000-4000-8000-000000000001'$q$,'55000');

SELECT pg_temp.assert_true(public.product_access_for_account('c2000000-0000-4000-8000-000000000001')->'subscription_capabilities'=
 CASE WHEN (SELECT tier FROM monthly_selected)='starter' THEN '["standard_renewal_reminders"]'::JSONB ELSE '["standard_renewal_reminders","custom_renewal_schedules","bulk_campaigns","configurable_automations","gym_payment_links","gym_autopay"]'::JSONB END,'Account capability snapshot differs');
ROLLBACK TO monthly_capability_clock;
UPDATE private.subscription_live_customer_preparations SET opening_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE monthly_replay_snapshot(table_name TEXT,rows JSONB);
INSERT INTO monthly_replay_snapshot SELECT 'subscription_monthly_offer_sets',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_monthly_offer_sets r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_monthly_offers',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_monthly_offers r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_offer_approvals',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_offer_approvals r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_customer_preparations',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_customer_preparations r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_customer_reviews',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_customer_reviews r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_customer_scopes',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_customer_scopes r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_quotes',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_quotes r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_orders',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_orders r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_payments',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_payments r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_grants',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_grants r;
INSERT INTO monthly_replay_snapshot SELECT 'subscription_live_terms',coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_terms r;
SET CONSTRAINTS ALL IMMEDIATE;
-- MONTHLY_POPULATED_REPLAY
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_monthly_offer_sets')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_monthly_offer_sets r),'Populated replay changed subscription_monthly_offer_sets');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_monthly_offers')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_monthly_offers r),'Populated replay changed subscription_monthly_offers');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_offer_approvals')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_offer_approvals r),'Populated replay changed subscription_live_offer_approvals');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_customer_preparations')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_customer_preparations r),'Populated replay changed subscription_live_customer_preparations');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_customer_reviews')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_customer_reviews r),'Populated replay changed subscription_live_customer_reviews');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_customer_scopes')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_customer_scopes r),'Populated replay changed subscription_live_customer_scopes');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_quotes')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_quotes r),'Populated replay changed subscription_live_quotes');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_orders')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_orders r),'Populated replay changed subscription_live_orders');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_payments')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_payments r),'Populated replay changed subscription_live_payments');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_grants')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_grants r),'Populated replay changed subscription_live_grants');
SELECT pg_temp.assert_true((SELECT rows FROM monthly_replay_snapshot WHERE table_name='subscription_live_terms')=(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) FROM private.subscription_live_terms r),'Populated replay changed subscription_live_terms');
DROP TABLE monthly_replay_snapshot;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Committed replay failed');
RESET ROLE;
SAVEPOINT monthly_conflict;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001','evt_monthly_conflict','payment.captured',
 'order_MonthlySynthetic','pay_MonthlyConflict',NULL,repeat('e',64),(SELECT captured FROM monthly_capture));
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlyConflict','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Conflicting capture lacks durable hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND latest_reason='monthly_capture_conflict'),'Conflict exception missing');
SELECT pg_temp.assert_true((SELECT state='verified' AND provider_payment_id='pay_MonthlySynthetic' FROM private.subscription_live_payments WHERE request_id='c9000000-0000-4000-8000-000000000001'),'Conflict overwrote original payment');
ROLLBACK TO monthly_conflict;
SAVEPOINT synthetic_refund_replay;
-- Task 6 owns refund dispatch. These synthetic confirmed-refund facts exercise
-- replay ordering without claiming a provider refund was executed.
UPDATE private.subscription_live_grants SET refund_confirmed_at=clock_timestamp(),renewal_stopped_at=clock_timestamp()
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access SET access_ends_at=clock_timestamp(),version=version+1,suspended_at=clock_timestamp()
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
CREATE TEMP TABLE monthly_refund_access AS SELECT to_jsonb(x) state FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Confirmed-refund identical replay failed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT state FROM monthly_refund_access)=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Replay restored refunded access');
ROLLBACK TO synthetic_refund_replay;
ROLLBACK TO tier_starter;
SELECT 'PASS: monthly starter archive/refresh, closed review, exact quote, source holds, capabilities, containment, expiry/conflict/refund replay and populated migration preservation';
SAVEPOINT tier_growth;
DELETE FROM monthly_selected;
INSERT INTO monthly_selected SELECT * FROM private.subscription_monthly_offers WHERE tier='growth';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY[billing_account_id]) FROM monthly_selected$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY['c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002']::UUID[]) FROM monthly_selected$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY['f2000000-0000-4000-8000-000000000001']::UUID[]) FROM monthly_selected$q$,'22023');
SELECT public.subscription_archive_monthly_branches(offer_set_id,ARRAY['c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000005']::UUID[]) FROM monthly_selected;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=5 FROM public.membership_plans WHERE account_id IN(SELECT id FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001')),'Archive deleted branch history');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM public.accounts WHERE organization_id='c1000000-0000-4000-8000-000000000001' AND branch_status='archived'),'Archive was undone without payment');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_prepare_monthly_offers('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 public.platform_admin_monthly_offer_context('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'snapshot_token',
 (SELECT offers FROM monthly_input),(SELECT evidence FROM monthly_input),TRUE);
RESET ROLE;
DELETE FROM monthly_selected;
INSERT INTO monthly_selected SELECT o.* FROM private.subscription_monthly_offers o JOIN private.subscription_monthly_offer_sets ms USING(offer_set_id) WHERE ms.revoked_at IS NULL AND o.tier='growth';
DELETE FROM monthly_alternatives;
INSERT INTO monthly_alternatives SELECT o.* FROM private.subscription_monthly_offers o JOIN private.subscription_monthly_offer_sets ms USING(offer_set_id) WHERE ms.revoked_at IS NULL;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor+1,TRUE) FROM monthly_selected$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,FALSE) FROM monthly_selected$q$,'42501');
RESET ROLE;
SAVEPOINT monthly_staff_roles;
INSERT INTO public.organizations(id,name) VALUES('c1000000-0000-4000-8000-000000000099','Synthetic other tenant');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES('c1000000-0000-4000-8000-000000000099','e6000000-0000-4000-8000-000000000002','owner');
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','admin');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
UPDATE public.account_memberships SET role='agent' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
UPDATE public.account_memberships SET role='viewer' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
ROLLBACK TO monthly_staff_roles;
SAVEPOINT refuse_active_trial;
UPDATE private.organization_product_access SET trial_ends_at=now()+interval '2 days' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_active_trial;
SAVEPOINT refuse_suspended;
UPDATE private.organization_product_access SET suspended_at=clock_timestamp() WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_suspended;
SAVEPOINT refuse_manual;
UPDATE private.organization_product_access SET mode='manual',access_starts_at=now()-interval '1 day',access_ends_at=now()+interval '1 day' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_manual;
SAVEPOINT refuse_complimentary;
UPDATE private.organization_product_access SET mode='complimentary' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_complimentary;
SAVEPOINT refuse_gate;
UPDATE private.subscription_billing_settings SET capabilities_enabled=FALSE WHERE singleton;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_gate;
SAVEPOINT refuse_noninr;
UPDATE public.accounts SET default_currency='USD' WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_noninr;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.monthly_approve();
SELECT pg_temp.monthly_approve();
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,TRUE)
 FROM monthly_alternatives WHERE tier<>(SELECT tier FROM monthly_selected) LIMIT 1$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Monthly review did not create closed scope');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_open()$q$,'55000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_authorize_monthly_opening(offer_set_id,
 public.platform_admin_monthly_offer_context(organization_id,billing_account_id)->>'snapshot_token','synthetic separate opening review',TRUE) FROM monthly_selected;
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.monthly_open();
SELECT pg_temp.monthly_open();
RESET ROLE;
SAVEPOINT boundary_buyer;
UPDATE public.invoice_profiles SET email='changed@example.invalid' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_buyer;
SAVEPOINT boundary_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_setup;
SAVEPOINT boundary_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_access;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.monthly_quote();
SELECT pg_temp.monthly_quote();
RESET ROLE;
SAVEPOINT monthly_containment;
UPDATE private.subscription_live_customer_scopes SET quotes_enabled=FALSE,orders_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_open()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO monthly_containment;
SAVEPOINT monthly_expired_quote;
-- Synthetic clock alignment only; no provider order exists in this savepoint.
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'23505');
SELECT pg_temp.monthly_quote('c9000000-0000-4000-8000-000000000002');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(DISTINCT monthly_offer_id)=1 AND count(*)=2 FROM private.subscription_live_quotes WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Expired replacement changed selected contract');
ROLLBACK TO monthly_expired_quote;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
RESET ROLE;
SAVEPOINT second_actual_owner;
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','owner');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_monthly_quote('c9000000-0000-4000-8000-000000000002',p.organization_id,p.billing_account_id,
 'e6000000-0000-4000-8000-000000000002',p.review_id,p.monthly_offer_id,o.amount_minor,o.merchant_id)
 FROM private.subscription_live_customer_preparations p JOIN monthly_selected o USING(monthly_offer_id)$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000002','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO second_actual_owner;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_monthly_offer_preview('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'selectedOfferId'=(SELECT monthly_offer_id::TEXT FROM monthly_selected),'Frozen selection lost after quote');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
RESET ROLE;
SAVEPOINT boundary_buyer;
UPDATE public.invoice_profiles SET email='changed@example.invalid' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_buyer;
SAVEPOINT boundary_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_setup;
SAVEPOINT boundary_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_access;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK');
SELECT pg_temp.assert_true(public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='recovery','Ambiguous claim allowed another create');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote('c9000000-0000-4000-8000-000000000002')$q$,'55000');
SELECT public.subscription_bind_live_order('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error($q$SELECT public.subscription_bind_live_order('c9000000-0000-4000-8000-000000000001','order_ChangedMonthly','acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001')$q$,'23505');
RESET ROLE;
CREATE TEMP TABLE monthly_capture AS SELECT clock_timestamp() captured;
GRANT SELECT ON monthly_capture TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))$q$,'22023');
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001','evt_monthly_synthetic','payment.captured',
 'order_MonthlySynthetic','pay_MonthlySynthetic',NULL,repeat('d',64),(SELECT captured FROM monthly_capture));
RESET ROLE;
SAVEPOINT monthly_capture_contained;
UPDATE private.subscription_live_customer_preparations SET opening_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Initiation containment prevented existing signed settlement');
RESET ROLE;
ROLLBACK TO monthly_capture_contained;
SAVEPOINT capture_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Setup drift without access-version change escaped capture hold');
RESET ROLE;
ROLLBACK TO capture_setup;
SAVEPOINT monthly_late_capture;
-- Backdate the synthetic immutable quote's clock, restoring every guard before
-- invoking settlement. This isolates late-capture behavior without a 30m wait.
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'reason'='quote_expired_or_changed','Late capture did not persist hold');
RESET ROLE;
ROLLBACK TO monthly_late_capture;
SAVEPOINT capture_buyer;
UPDATE public.invoice_profiles SET legal_name='Synthetic changed buyer' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed buyer capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_buyer;
SAVEPOINT capture_owner;
DELETE FROM public.organization_memberships WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed owner capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_owner;
SAVEPOINT capture_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed access capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_access;
SAVEPOINT capture_roster;
UPDATE public.accounts SET branch_status='read_only' WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed roster capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_roster;
SAVEPOINT capture_revocation;
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed revocation capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_revocation;
SAVEPOINT capture_gate;
UPDATE private.subscription_billing_settings SET capabilities_enabled=FALSE WHERE singleton;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed gate capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_gate;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture));
RESET ROLE;
SELECT pg_temp.assert_true((SELECT g.tier=o.tier AND g.period_start=c.captured AND g.paid_through_end=c.captured+interval '1 month'
 FROM private.subscription_live_grants g CROSS JOIN monthly_selected o CROSS JOIN monthly_capture c WHERE g.organization_id=o.organization_id),'Selected tier/calendar month not granted');
SELECT pg_temp.assert_true((SELECT private.subscription_base_included_branches(g.tier)=o.included_branches FROM private.subscription_live_grants g CROSS JOIN monthly_selected o WHERE g.organization_id=o.organization_id),'Wrong base capacity');
SAVEPOINT monthly_capability_clock;
-- NOW() is frozen at BEGIN while captures use wall time. Align only synthetic
-- grant/access starts for active snapshot reads; rollback restores exact evidence.
ALTER TABLE private.subscription_live_grants DISABLE TRIGGER subscription_freeze_live_grant_evidence;
UPDATE private.subscription_live_grants SET period_start=now()-interval '1 minute' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access x SET access_starts_at=g.period_start FROM private.subscription_live_grants g WHERE x.organization_id=g.organization_id AND x.organization_id='c1000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_grants ENABLE TRIGGER subscription_freeze_live_grant_evidence;
SELECT pg_temp.assert_true((SELECT bool_and(private.subscription_capability_allowed('c2000000-0000-4000-8000-000000000001',cap)=(cap='standard_renewal_reminders' OR tier IN ('growth','ultimate')))
 FROM monthly_selected CROSS JOIN unnest(ARRAY['standard_renewal_reminders','custom_renewal_schedules','bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay']) cap),'SQL capability matrix differs from plans.ts');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_payments WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Payment duplicated');
SELECT pg_temp.assert_true((SELECT bool_and(r.days_before=CASE WHEN o.tier='starter' THEN ARRAY[7,3,1] ELSE ARRAY[14,7] END AND r.service_days_before=r.days_before) FROM public.renewal_reminder_settings r JOIN public.accounts a ON a.id=r.account_id CROSS JOIN monthly_selected o WHERE a.organization_id=o.organization_id),'Starter reset or Growth/Ultimate custom schedule preservation failed');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_renewal_releases(release_id,organization_id,merchant_id,customer_review_id,owner_user_id,
 release_sha,migration_manifest_sha256,authorization_reference,provider_acceptance_reference,backup_recovery_reference,reviewed_at)
 SELECT gen_random_uuid(),organization_id,merchant_id,review_id,reviewed_by,release_sha,migration_manifest_sha256,
 'synthetic forbidden renewal','synthetic','synthetic',clock_timestamp() FROM private.subscription_live_customer_reviews
 WHERE organization_id='c1000000-0000-4000-8000-000000000001'$q$,'55000');

SELECT pg_temp.assert_true(public.product_access_for_account('c2000000-0000-4000-8000-000000000001')->'subscription_capabilities'=
 CASE WHEN (SELECT tier FROM monthly_selected)='starter' THEN '["standard_renewal_reminders"]'::JSONB ELSE '["standard_renewal_reminders","custom_renewal_schedules","bulk_campaigns","configurable_automations","gym_payment_links","gym_autopay"]'::JSONB END,'Account capability snapshot differs');
ROLLBACK TO monthly_capability_clock;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Committed replay failed');
RESET ROLE;
SAVEPOINT monthly_conflict;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001','evt_monthly_conflict','payment.captured',
 'order_MonthlySynthetic','pay_MonthlyConflict',NULL,repeat('e',64),(SELECT captured FROM monthly_capture));
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlyConflict','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Conflicting capture lacks durable hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND latest_reason='monthly_capture_conflict'),'Conflict exception missing');
SELECT pg_temp.assert_true((SELECT state='verified' AND provider_payment_id='pay_MonthlySynthetic' FROM private.subscription_live_payments WHERE request_id='c9000000-0000-4000-8000-000000000001'),'Conflict overwrote original payment');
ROLLBACK TO monthly_conflict;
SAVEPOINT synthetic_refund_replay;
-- Task 6 owns refund dispatch. These synthetic confirmed-refund facts exercise
-- replay ordering without claiming a provider refund was executed.
UPDATE private.subscription_live_grants SET refund_confirmed_at=clock_timestamp(),renewal_stopped_at=clock_timestamp()
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access SET access_ends_at=clock_timestamp(),version=version+1,suspended_at=clock_timestamp()
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
CREATE TEMP TABLE monthly_refund_access AS SELECT to_jsonb(x) state FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Confirmed-refund identical replay failed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT state FROM monthly_refund_access)=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Replay restored refunded access');
ROLLBACK TO synthetic_refund_replay;
ROLLBACK TO tier_growth;
SELECT 'PASS: monthly growth archive/refresh, closed review, exact quote, source holds, capabilities, containment and expiry/conflict/refund replay';
SAVEPOINT tier_ultimate;
DELETE FROM monthly_selected;
INSERT INTO monthly_selected SELECT * FROM private.subscription_monthly_offers WHERE tier='ultimate';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor+1,TRUE) FROM monthly_selected$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,FALSE) FROM monthly_selected$q$,'42501');
RESET ROLE;
SAVEPOINT monthly_staff_roles;
INSERT INTO public.organizations(id,name) VALUES('c1000000-0000-4000-8000-000000000099','Synthetic other tenant');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES('c1000000-0000-4000-8000-000000000099','e6000000-0000-4000-8000-000000000002','owner');
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','admin');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
UPDATE public.account_memberships SET role='agent' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
UPDATE public.account_memberships SET role='viewer' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
ROLLBACK TO monthly_staff_roles;
SAVEPOINT refuse_active_trial;
UPDATE private.organization_product_access SET trial_ends_at=now()+interval '2 days' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_active_trial;
SAVEPOINT refuse_suspended;
UPDATE private.organization_product_access SET suspended_at=clock_timestamp() WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_suspended;
SAVEPOINT refuse_manual;
UPDATE private.organization_product_access SET mode='manual',access_starts_at=now()-interval '1 day',access_ends_at=now()+interval '1 day' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_manual;
SAVEPOINT refuse_complimentary;
UPDATE private.organization_product_access SET mode='complimentary' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_complimentary;
SAVEPOINT refuse_gate;
UPDATE private.subscription_billing_settings SET capabilities_enabled=FALSE WHERE singleton;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_gate;
SAVEPOINT refuse_noninr;
UPDATE public.accounts SET default_currency='USD' WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'55000');
RESET ROLE;
ROLLBACK TO refuse_noninr;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.monthly_approve();
SELECT pg_temp.monthly_approve();
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_monthly_review(offer_set_id,monthly_offer_id,amount_minor,TRUE)
 FROM monthly_alternatives WHERE tier<>(SELECT tier FROM monthly_selected) LIMIT 1$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Monthly review did not create closed scope');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_open()$q$,'55000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT public.platform_admin_authorize_monthly_opening(offer_set_id,
 public.platform_admin_monthly_offer_context(organization_id,billing_account_id)->>'snapshot_token','synthetic separate opening review',TRUE) FROM monthly_selected;
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.monthly_open();
SELECT pg_temp.monthly_open();
RESET ROLE;
SAVEPOINT boundary_buyer;
UPDATE public.invoice_profiles SET email='changed@example.invalid' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_buyer;
SAVEPOINT boundary_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_setup;
SAVEPOINT boundary_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_access;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.monthly_quote();
SELECT pg_temp.monthly_quote();
RESET ROLE;
SAVEPOINT monthly_containment;
UPDATE private.subscription_live_customer_scopes SET quotes_enabled=FALSE,orders_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_open()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO monthly_containment;
SAVEPOINT monthly_expired_quote;
-- Synthetic clock alignment only; no provider order exists in this savepoint.
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote()$q$,'23505');
SELECT pg_temp.monthly_quote('c9000000-0000-4000-8000-000000000002');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(DISTINCT monthly_offer_id)=1 AND count(*)=2 FROM private.subscription_live_quotes WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Expired replacement changed selected contract');
ROLLBACK TO monthly_expired_quote;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
RESET ROLE;
SAVEPOINT second_actual_owner;
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','owner');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_approve()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_monthly_quote('c9000000-0000-4000-8000-000000000002',p.organization_id,p.billing_account_id,
 'e6000000-0000-4000-8000-000000000002',p.review_id,p.monthly_offer_id,o.amount_minor,o.merchant_id)
 FROM private.subscription_live_customer_preparations p JOIN monthly_selected o USING(monthly_offer_id)$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000002','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO second_actual_owner;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_monthly_offer_preview('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'selectedOfferId'=(SELECT monthly_offer_id::TEXT FROM monthly_selected),'Frozen selection lost after quote');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
RESET ROLE;
SAVEPOINT boundary_buyer;
UPDATE public.invoice_profiles SET email='changed@example.invalid' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_buyer;
SAVEPOINT boundary_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_setup;
SAVEPOINT boundary_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO boundary_access;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK');
SELECT pg_temp.assert_true(public.subscription_claim_live_order('c9000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='recovery','Ambiguous claim allowed another create');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_quote('c9000000-0000-4000-8000-000000000002')$q$,'55000');
SELECT public.subscription_bind_live_order('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error($q$SELECT public.subscription_bind_live_order('c9000000-0000-4000-8000-000000000001','order_ChangedMonthly','acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001')$q$,'23505');
RESET ROLE;
CREATE TEMP TABLE monthly_capture AS SELECT clock_timestamp() captured;
GRANT SELECT ON monthly_capture TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))$q$,'22023');
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001','evt_monthly_synthetic','payment.captured',
 'order_MonthlySynthetic','pay_MonthlySynthetic',NULL,repeat('d',64),(SELECT captured FROM monthly_capture));
RESET ROLE;
SAVEPOINT monthly_capture_contained;
UPDATE private.subscription_live_customer_preparations SET opening_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Initiation containment prevented existing signed settlement');
RESET ROLE;
ROLLBACK TO monthly_capture_contained;
SAVEPOINT capture_setup;
UPDATE public.plan_pricing_options SET price=price+1 WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Setup drift without access-version change escaped capture hold');
RESET ROLE;
ROLLBACK TO capture_setup;
SAVEPOINT monthly_late_capture;
-- Backdate the synthetic immutable quote's clock, restoring every guard before
-- invoking settlement. This isolates late-capture behavior without a 30m wait.
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1 hour',expires_at=now()-interval '30 minutes'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'reason'='quote_expired_or_changed','Late capture did not persist hold');
RESET ROLE;
ROLLBACK TO monthly_late_capture;
SAVEPOINT capture_buyer;
UPDATE public.invoice_profiles SET legal_name='Synthetic changed buyer' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed buyer capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_buyer;
SAVEPOINT capture_owner;
DELETE FROM public.organization_memberships WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed owner capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_owner;
SAVEPOINT capture_access;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed access capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_access;
SAVEPOINT capture_roster;
UPDATE public.accounts SET branch_status='read_only' WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed roster capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_roster;
SAVEPOINT capture_revocation;
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed revocation capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_revocation;
SAVEPOINT capture_gate;
UPDATE private.subscription_billing_settings SET capabilities_enabled=FALSE WHERE singleton;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Changed gate capture did not persist hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>''),'Capture hold has no owner/next action');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held capture granted access');
ROLLBACK TO capture_gate;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture));
RESET ROLE;
SELECT pg_temp.assert_true((SELECT g.tier=o.tier AND g.period_start=c.captured AND g.paid_through_end=c.captured+interval '1 month'
 FROM private.subscription_live_grants g CROSS JOIN monthly_selected o CROSS JOIN monthly_capture c WHERE g.organization_id=o.organization_id),'Selected tier/calendar month not granted');
SELECT pg_temp.assert_true((SELECT private.subscription_base_included_branches(g.tier)=o.included_branches FROM private.subscription_live_grants g CROSS JOIN monthly_selected o WHERE g.organization_id=o.organization_id),'Wrong base capacity');
SAVEPOINT monthly_capability_clock;
-- NOW() is frozen at BEGIN while captures use wall time. Align only synthetic
-- grant/access starts for active snapshot reads; rollback restores exact evidence.
ALTER TABLE private.subscription_live_grants DISABLE TRIGGER subscription_freeze_live_grant_evidence;
UPDATE private.subscription_live_grants SET period_start=now()-interval '1 minute' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access x SET access_starts_at=g.period_start FROM private.subscription_live_grants g WHERE x.organization_id=g.organization_id AND x.organization_id='c1000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_grants ENABLE TRIGGER subscription_freeze_live_grant_evidence;
SELECT pg_temp.assert_true((SELECT bool_and(private.subscription_capability_allowed('c2000000-0000-4000-8000-000000000001',cap)=(cap='standard_renewal_reminders' OR tier IN ('growth','ultimate')))
 FROM monthly_selected CROSS JOIN unnest(ARRAY['standard_renewal_reminders','custom_renewal_schedules','bulk_campaigns','configurable_automations','gym_payment_links','gym_autopay']) cap),'SQL capability matrix differs from plans.ts');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_payments WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Payment duplicated');
SELECT pg_temp.assert_true((SELECT bool_and(r.days_before=CASE WHEN o.tier='starter' THEN ARRAY[7,3,1] ELSE ARRAY[14,7] END AND r.service_days_before=r.days_before) FROM public.renewal_reminder_settings r JOIN public.accounts a ON a.id=r.account_id CROSS JOIN monthly_selected o WHERE a.organization_id=o.organization_id),'Starter reset or Growth/Ultimate custom schedule preservation failed');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_renewal_releases(release_id,organization_id,merchant_id,customer_review_id,owner_user_id,
 release_sha,migration_manifest_sha256,authorization_reference,provider_acceptance_reference,backup_recovery_reference,reviewed_at)
 SELECT gen_random_uuid(),organization_id,merchant_id,review_id,reviewed_by,release_sha,migration_manifest_sha256,
 'synthetic forbidden renewal','synthetic','synthetic',clock_timestamp() FROM private.subscription_live_customer_reviews
 WHERE organization_id='c1000000-0000-4000-8000-000000000001'$q$,'55000');

SELECT pg_temp.assert_true(public.product_access_for_account('c2000000-0000-4000-8000-000000000001')->'subscription_capabilities'=
 CASE WHEN (SELECT tier FROM monthly_selected)='starter' THEN '["standard_renewal_reminders"]'::JSONB ELSE '["standard_renewal_reminders","custom_renewal_schedules","bulk_campaigns","configurable_automations","gym_payment_links","gym_autopay"]'::JSONB END,'Account capability snapshot differs');
ROLLBACK TO monthly_capability_clock;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Committed replay failed');
RESET ROLE;
SAVEPOINT monthly_conflict;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','c1000000-0000-4000-8000-000000000001','evt_monthly_conflict','payment.captured',
 'order_MonthlySynthetic','pay_MonthlyConflict',NULL,repeat('e',64),(SELECT captured FROM monthly_capture));
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlyConflict','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='review_required','Conflicting capture lacks durable hold');
RESET ROLE;
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='c9000000-0000-4000-8000-000000000001' AND latest_reason='monthly_capture_conflict'),'Conflict exception missing');
SELECT pg_temp.assert_true((SELECT state='verified' AND provider_payment_id='pay_MonthlySynthetic' FROM private.subscription_live_payments WHERE request_id='c9000000-0000-4000-8000-000000000001'),'Conflict overwrote original payment');
ROLLBACK TO monthly_conflict;
SAVEPOINT synthetic_refund_replay;
-- Task 6 owns refund dispatch. These synthetic confirmed-refund facts exercise
-- replay ordering without claiming a provider refund was executed.
UPDATE private.subscription_live_grants SET refund_confirmed_at=clock_timestamp(),renewal_stopped_at=clock_timestamp()
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.organization_product_access SET access_ends_at=clock_timestamp(),version=version+1,suspended_at=clock_timestamp()
 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
CREATE TEMP TABLE monthly_refund_access AS SELECT to_jsonb(x) state FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001','order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',
 (SELECT amount_minor FROM monthly_selected),'INR',(SELECT captured FROM monthly_capture))->>'status'='verified','Confirmed-refund identical replay failed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT state FROM monthly_refund_access)=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Replay restored refunded access');
ROLLBACK TO synthetic_refund_replay;
ROLLBACK TO tier_ultimate;
SELECT 'PASS: monthly ultimate five-branch review, exact quote, source holds, capabilities, containment and expiry/conflict/refund replay';
DO $$ DECLARE r RECORD; BEGIN
 FOR r IN SELECT p.oid,p.proname,p.proowner,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE '%_before_monthly') OR (n.nspname='public' AND p.proname IN
   ('platform_admin_authorize_monthly_opening','subscription_approve_monthly_review','subscription_archive_monthly_branches','subscription_create_monthly_quote')) LOOP
  PERFORM pg_temp.assert_true(r.proowner='postgres'::regrole AND r.prosecdef AND r.proconfig=ARRAY['search_path=""']::TEXT[],'Unsafe monthly transaction definer');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',r.oid,'EXECUTE'),'Anonymous monthly transaction granted');
  IF r.proname LIKE '%_before_monthly' THEN
   PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated',r.oid,'EXECUTE') AND NOT has_function_privilege('service_role',r.oid,'EXECUTE'),'Original private writer exposed');
  ELSE
   PERFORM pg_temp.assert_true(has_function_privilege('service_role',r.oid,'EXECUTE')=(r.proname='subscription_create_monthly_quote')
    AND has_function_privilege('authenticated',r.oid,'EXECUTE')=(r.proname<>'subscription_create_monthly_quote'),'Monthly transaction role grant differs');
  END IF;
 END LOOP;
END $$;
ROLLBACK TO monthly_transaction_acceptance;
