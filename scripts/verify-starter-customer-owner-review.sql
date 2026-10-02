-- Synthetic rollback-only operator preparation -> actual JWT owner -> closed scope -> service opening.
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
INSERT INTO public.organizations(id,name) VALUES('f1000000-0000-4000-8000-000000000001','Synthetic owner review');
INSERT INTO public.legal_entities(id,organization_id,name) VALUES('f7000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Synthetic legal business');
INSERT INTO public.accounts(id,name,organization_id,legal_entity_id,owner_user_id,default_currency)
 VALUES('f2000000-0000-4000-8000-000000000001','Synthetic INR branch','f1000000-0000-4000-8000-000000000001',
 'f7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','INR');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
 ('f1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','owner');
INSERT INTO private.organization_product_access(organization_id,mode,trial_started_at,trial_ends_at)
 VALUES('f1000000-0000-4000-8000-000000000001','trial',now()-interval '16 days',now()-interval '2 days')
 ON CONFLICT(organization_id) DO UPDATE SET mode='trial',trial_started_at=EXCLUDED.trial_started_at,trial_ends_at=EXCLUDED.trial_ends_at;
INSERT INTO private.subscription_live_offer_approvals
 (approval_id,organization_id,merchant_id,tier,amount_minor,term_policy,quote_validity_seconds,
 offer_reference,tax_decision_reference,refund_policy_reference,merchant_approval_reference,customer_tax_note,customer_terms_note,approved_at)
 VALUES('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK','starter',79900,
 'calendar_month_from_capture_event',1800,'synthetic-owner-offer','synthetic-tax','synthetic-refund','synthetic-provider','Synthetic tax note','Synthetic terms',now()-interval '1 hour');
INSERT INTO private.subscription_live_customer_preparations
 (review_id,offer_approval_id,organization_id,billing_account_id,merchant_id,commercial_context,reviewed_by,
 release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,issuer_financial_year_reference,
 tax_receipt_review_reference,provider_acceptance_reference,backup_recovery_reference,reminder_policy_version,reviewed_at,owner_user_id,source_access_version,opening_enabled)
 SELECT 'f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',x.organization_id,
 'f2000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK','customer_sale','e6000000-0000-4000-8000-000000000002',
 repeat('c',40),repeat('d',64),'synthetic-operator-authorization','synthetic-geography','synthetic-issuer-FY',
 'synthetic-documents','synthetic-provider','synthetic-recovery',b.standard_reminder_policy_version,now()-interval '1 minute',
 'e6000000-0000-4000-8000-000000000001',x.version,TRUE
 FROM private.organization_product_access x CROSS JOIN private.subscription_billing_settings b
 WHERE x.organization_id='f1000000-0000-4000-8000-000000000001' AND b.singleton;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews WHERE organization_id='f1000000-0000-4000-8000-000000000001'),'Preparation impersonated owner');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_preparations SET buyer_geography_reference='changed'$q$,'55000');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_preparations SET opening_enabled=TRUE$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79900,TRUE)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_open_reviewed_customer_scope('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001')$q$,'55000');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79900,TRUE)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_customer_review_preview('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001')$q$,'42501');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true(public.subscription_customer_review_preview('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001')->>'owner_reviewed'='false','Missing genuine review was hidden');
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79901,TRUE)$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79900,FALSE)$q$,'42501');
RESET ROLE;
SAVEPOINT preparation_drift;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='f1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79900,TRUE)$q$,'55000');
RESET ROLE;
ROLLBACK TO preparation_drift;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79900,TRUE);
SELECT public.subscription_approve_customer_review('f4000000-0000-4000-8000-000000000001',79900,TRUE);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT reviewed_by='e6000000-0000-4000-8000-000000000001' FROM private.subscription_live_customer_reviews WHERE review_id='f4000000-0000-4000-8000-000000000001'),'Operator authored owner review');
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='f1000000-0000-4000-8000-000000000001'),'Owner transaction did not commit closed');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_open_reviewed_customer_scope('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001');
SELECT public.subscription_open_reviewed_customer_scope('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT quotes_enabled AND orders_enabled AND NOT refunds_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='f1000000-0000-4000-8000-000000000001'),'Exact first checkout did not open');
UPDATE private.subscription_live_customer_preparations SET opening_enabled=FALSE WHERE review_id='f4000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled FROM private.subscription_live_customer_scopes WHERE organization_id='f1000000-0000-4000-8000-000000000001'),'Preparation containment left checkout open');
UPDATE private.subscription_live_customer_preparations SET opening_enabled=TRUE WHERE review_id='f4000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT public.subscription_open_reviewed_customer_scope('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001')$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id='f1000000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id='f1000000-0000-4000-8000-000000000001'),'Review created money or quote');
SELECT 'PASS: authenticated customer owner review, initially closed scope, separate one-time opening, drift refusal and containment';
