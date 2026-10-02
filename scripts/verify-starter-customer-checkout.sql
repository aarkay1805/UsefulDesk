-- Rollback-only synthetic customer acceptance; follows original pilot acceptance.
-- No provider I/O and no real customer/commercial evidence.
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews)
 AND NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes),'Customer authority was seeded');
CREATE TEMP TABLE customer_original_snapshot AS SELECT
 (SELECT to_jsonb(s) FROM private.subscription_live_settings s WHERE singleton) settings,
 (SELECT jsonb_agg(to_jsonb(q) ORDER BY request_id) FROM private.subscription_live_quotes q) quotes,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY provider_payment_id) FROM private.subscription_live_payments p) payments,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY refund_request_id) FROM private.subscription_live_refunds r) refunds,
 (SELECT jsonb_agg(to_jsonb(g) ORDER BY organization_id) FROM private.subscription_live_grants g) grants,
 (SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8') access,
 (SELECT count(*) FROM public.payments) gym_payments;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data)
SELECT ('e6000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'customer-scope-'||i||'@example.invalid',now(),'{"full_name":"Synthetic scope user"}' FROM generate_series(1,4) i;
DO $$ DECLARE i INTEGER; org UUID; branch UUID; entity UUID; approval UUID; review UUID; BEGIN
 FOR i IN 1..5 LOOP
  org:=('e1000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
  branch:=('e2000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
  approval:=('e3000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
  review:=('e4000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
  entity:=('e7000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
  INSERT INTO public.organizations(id,name) VALUES(org,'Synthetic customer '||i);
  INSERT INTO public.legal_entities(id,organization_id,name) VALUES(entity,org,'Synthetic issuer entity');
  INSERT INTO public.accounts(id,name,organization_id,legal_entity_id,owner_user_id,default_currency)
   VALUES(branch,'Synthetic customer branch',org,entity,'e6000000-0000-4000-8000-000000000001','INR');
  INSERT INTO public.organization_memberships(organization_id,user_id,role)
   VALUES(org,'e6000000-0000-4000-8000-000000000001','owner');
  INSERT INTO public.account_memberships(account_id,user_id,role)
   VALUES(branch,'e6000000-0000-4000-8000-000000000001','owner');
  IF i=3 THEN
   INSERT INTO public.organization_memberships(organization_id,user_id,role)
    VALUES(org,'e6000000-0000-4000-8000-000000000004','owner');
  END IF;
  INSERT INTO private.organization_product_access(organization_id,mode,trial_started_at,trial_ends_at)
   VALUES(org,'trial',now()-interval '16 days',now()-interval '2 days')
   ON CONFLICT(organization_id) DO UPDATE SET mode='trial',trial_started_at=EXCLUDED.trial_started_at,trial_ends_at=EXCLUDED.trial_ends_at;
  INSERT INTO private.subscription_live_offer_approvals
   (approval_id,organization_id,merchant_id,tier,amount_minor,term_policy,quote_validity_seconds,
    offer_reference,tax_decision_reference,refund_policy_reference,merchant_approval_reference,
    customer_tax_note,customer_terms_note,approved_at)
  VALUES(approval,org,'acc_TCJwBqanN9LTrK','starter',79900,'calendar_month_from_capture_event',1800,
   'synthetic-customer-offer-'||i,'synthetic-tax-review','synthetic-first-week-full-refund',
   'synthetic-merchant-preflight','Synthetic unissued tax note','Synthetic first-term terms',now()-interval '1 day');
  INSERT INTO private.subscription_live_customer_reviews
   (review_id,offer_approval_id,organization_id,billing_account_id,merchant_id,commercial_context,reviewed_by,
    release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,
    issuer_financial_year_reference,tax_receipt_review_reference,provider_acceptance_reference,
    backup_recovery_reference,reminder_policy_version,reviewed_at)
  VALUES(review,approval,org,branch,'acc_TCJwBqanN9LTrK','customer_sale',
   CASE WHEN i=3 THEN 'e6000000-0000-4000-8000-000000000004'::UUID
    ELSE 'e6000000-0000-4000-8000-000000000001'::UUID END,
   repeat('c',40),repeat('d',64),'synthetic-opening',
   'synthetic-buyer-geography','synthetic-PAN-financial-year','synthetic-unissued-documents',
   'synthetic-preflight','synthetic-backup','synthetic-starter-731-after09',now()-interval '1 minute');
  INSERT INTO private.subscription_live_customer_scopes(organization_id,merchant_id,review_id)
   VALUES(org,'acc_TCJwBqanN9LTrK',review);
 END LOOP;
END $$;
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES
 ('e2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','admin');
SELECT pg_temp.assert_true((SELECT bool_and(NOT quotes_enabled AND NOT orders_enabled AND NOT refunds_enabled)
 FROM private.subscription_live_customer_scopes),'Customer defaults opened initiation');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_scopes SET quotes_enabled=true$q$,'42501');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_live_customer_reviews$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',79900,'starter','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_reviews SET commercial_context='internal_acceptance'$q$,'55000');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_customer_reviews$q$,'55000');
UPDATE private.subscription_live_customer_scopes SET quotes_enabled=true,orders_enabled=true;
-- Trial deadlines and regional currency remain owner-owned facts; no coercion.
SAVEPOINT customer_active_trial;
UPDATE private.organization_product_access SET trial_ends_at=now()+interval '1 day'
 WHERE organization_id='e1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',79900,'starter','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO customer_active_trial;
SAVEPOINT customer_non_inr;
UPDATE public.accounts SET default_currency='AED' WHERE id='e2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',79900,'starter','acc_TCJwBqanN9LTrK')$q$,'55000');
RESET ROLE;
ROLLBACK TO customer_non_inr;

-- Staff and outsiders are refused at authenticated preview and quote/claim boundaries.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_live_offer_preview('e1000000-0000-4000-8000-000000000001',
 'e2000000-0000-4000-8000-000000000001','starter')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_resolve_live_scope('acc_TCJwBqanN9LTrK',NULL,'order_StarterOpeningSynthetic')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001',79900,'starter','acc_TCJwBqanN9LTrK')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001',79900,'starter','acc_TCJwBqanN9LTrK')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_quote('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002',
 'e6000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',79900,'starter','acc_TCJwBqanN9LTrK')$q$,'55000');
DO $$ DECLARE i INTEGER; BEGIN
 FOR i IN 1..4 LOOP
  PERFORM public.subscription_create_live_quote(
   ('e5000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
   ('e1000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
   ('e2000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
   'e6000000-0000-4000-8000-000000000001',
   ('e3000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,79900,'starter','acc_TCJwBqanN9LTrK');
 END LOOP;
END $$;
RESET ROLE;
-- Historical synthetic expired quote/order: seed exact immutable facts under the
-- fixture operator, with owner JWT for the reminder snapshot. No triggers disabled.
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
INSERT INTO private.subscription_live_quotes
 (request_id,organization_id,requested_by,billing_account_id,merchant_id,tier,amount_minor,currency,
 term_policy,offer_reference,tax_decision_reference,expires_at,owner_reviewed_at,created_at,
 offer_approval_id,source_access_mode,source_access_version)
SELECT 'e5000000-0000-4000-8000-000000000005',a.organization_id,'e6000000-0000-4000-8000-000000000001',
 'e2000000-0000-4000-8000-000000000005',a.merchant_id,a.tier,a.amount_minor,a.currency,a.term_policy,
 a.offer_reference,a.tax_decision_reference,now()-interval '1 minute',now()-interval '31 minutes',now()-interval '31 minutes',
 a.approval_id,x.mode,x.version FROM private.subscription_live_offer_approvals a
 JOIN private.organization_product_access x ON x.organization_id=a.organization_id
 WHERE a.approval_id='e3000000-0000-4000-8000-000000000005';
UPDATE private.subscription_live_quotes SET starter_reminder_reset_accepted=true,
 starter_reminder_policy_version='synthetic-starter-731-after09'
 WHERE request_id='e5000000-0000-4000-8000-000000000005';
INSERT INTO private.subscription_live_orders(request_id,organization_id,merchant_id,claimed_at)
 VALUES('e5000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000005',
 'acc_TCJwBqanN9LTrK',now()-interval '2 minutes');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT public.subscription_bind_live_order('e5000000-0000-4000-8000-000000000005','order_CustomerSynthetic5',
 'acc_TCJwBqanN9LTrK','e1000000-0000-4000-8000-000000000005');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(customer_review_id IS NOT NULL AND source_access_mode='trial'
 AND NOT complimentary_conversion_accepted AND expires_at=owner_reviewed_at+interval '1800 seconds')
 FROM private.subscription_live_quotes WHERE organization_id::TEXT LIKE 'e100%'),'Customer review/access snapshot not frozen');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_quotes SET customer_review_id=NULL WHERE organization_id::TEXT LIKE 'e100%'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_scopes SET review_id='e4000000-0000-4000-8000-000000000002'
 WHERE organization_id='e1000000-0000-4000-8000-000000000001'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_settings SET pilot_organization_id='e1000000-0000-4000-8000-000000000001'$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$ DECLARE i INTEGER; BEGIN FOR i IN 1..4 LOOP
 PERFORM public.subscription_acknowledge_live_starter_reminders(('e5000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID);
END LOOP; END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','acc_TCJwBqanN9LTrK')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_claim_live_order('e5000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000002','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')$q$,'22023');
DO $$ DECLARE i INTEGER; org UUID; req UUID; BEGIN FOR i IN 1..4 LOOP
 org:=('e1000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
 req:=('e5000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
 PERFORM pg_temp.assert_true(public.subscription_claim_live_order(req,org,'e6000000-0000-4000-8000-000000000001',
  'acc_TCJwBqanN9LTrK')->>'action'='create','Customer initial claim failed');
 PERFORM pg_temp.assert_true(public.subscription_claim_live_order(req,org,'e6000000-0000-4000-8000-000000000001',
  'acc_TCJwBqanN9LTrK')->>'action'='recovery','Customer claim permitted duplicate POST');
 IF i<>4 THEN PERFORM public.subscription_bind_live_order(req,'order_CustomerSynthetic'||i,'acc_TCJwBqanN9LTrK',org); END IF;
END LOOP; END $$;
SELECT pg_temp.expect_error($q$SELECT public.subscription_bind_live_order('e5000000-0000-4000-8000-000000000001',
 'order_CustomerSynthetic1','acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8')$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT public.subscription_resolve_live_scope('acc_TCJwBqanN9LTrK',NULL,'order_Foreign')$q$,'55000');
SELECT pg_temp.assert_true(public.subscription_resolve_live_scope('acc_TCJwBqanN9LTrK',NULL,'order_CustomerSynthetic1')->>'organization_id'=
 'e1000000-0000-4000-8000-000000000001','Durable customer scope not resolved');
RESET ROLE;
SELECT 'PASS: default-closed customer review, immutable binding, owner/staff/outsider and cross-organization isolation';
CREATE TEMP TABLE customer_capture_times AS SELECT request_id,clock_timestamp() AS at
 FROM private.subscription_live_quotes WHERE organization_id::TEXT LIKE 'e100%';
GRANT SELECT ON customer_capture_times TO service_role;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE i INTEGER; org UUID; req UUID; event_at TIMESTAMPTZ; BEGIN FOR i IN 1..5 LOOP
 org:=('e1000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
 req:=('e5000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID;
 SELECT at INTO event_at FROM pg_temp.customer_capture_times WHERE request_id=req;
 IF i<>4 THEN PERFORM public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK',org,
  'evt_CustomerSynthetic'||i,'payment.captured','order_CustomerSynthetic'||i,'pay_CustomerSynthetic'||i,
  NULL,repeat(i::TEXT,64),event_at); END IF;
END LOOP; END $$;
RESET ROLE;
-- Closing customer initiation leaves intake/order/refund recovery and original late events intact.
UPDATE private.subscription_live_customer_scopes SET quotes_enabled=false,orders_enabled=false;
UPDATE private.subscription_live_customer_reviews SET revoked_at=clock_timestamp()
 WHERE review_id='e4000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000001',
 'order_CustomerSynthetic1','pay_CustomerSynthetic1','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000001'))->>'status'='verified',
 'Customer shutdown stranded verified capture');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000002',
 'order_CustomerSynthetic2','pay_CustomerSynthetic2','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000002'))->>'status'='review_required',
 'Revoked customer review granted access');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000001',
 'order_CustomerSynthetic1','pay_CustomerSynthetic1','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000001'))->>'status'='verified','Capture replay failed');
SELECT pg_temp.assert_true(public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK',
 'e1000000-0000-4000-8000-000000000001','evt_CustomerSynthetic1','payment.captured',
 'order_CustomerSynthetic1','pay_CustomerSynthetic1',NULL,repeat('1',64),
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000001'))->>'status'='duplicate','Customer event replay failed');
SELECT pg_temp.expect_error($q$SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK',
 'e1000000-0000-4000-8000-000000000002','evt_CustomerSynthetic1','payment.captured',
 'order_CustomerSynthetic2','pay_CustomerSynthetic2',NULL,repeat('1',64),clock_timestamp())$q$,'23505');
SELECT pg_temp.assert_true(public.subscription_record_live_delivery_receipt('acc_TCJwBqanN9LTrK',
 '8826d9aa-03f2-4ad7-ae91-0553052131f8','evt_CustomerSynthetic1','provider','payment.captured',
 'order_CustomerSynthetic1','pay_CustomerSynthetic1',NULL,repeat('1',64),
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000001'),'saas')->>'status'='recorded','Customer receipt failed');
SELECT pg_temp.assert_true(jsonb_array_length(public.subscription_claim_live_recovery_items('acc_TCJwBqanN9LTrK',
 'e1000000-0000-4000-8000-000000000004',1,'e8000000-0000-4000-8000-000000000001'))=1,'Closed customer ambiguous order not recoverable');
SELECT public.subscription_bind_live_order('e5000000-0000-4000-8000-000000000004','order_CustomerSynthetic4',
 'acc_TCJwBqanN9LTrK','e1000000-0000-4000-8000-000000000004');
SELECT public.subscription_finish_live_recovery_item('order','e5000000-0000-4000-8000-000000000004',
 'e8000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK','e1000000-0000-4000-8000-000000000004',
 'recovered','order_bound_signed_event_required');
SELECT pg_temp.assert_true(public.subscription_resolve_live_scope('acc_TCJwBqanN9LTrK',NULL,'order_StarterOpeningSynthetic')->>'scope'='internal_acceptance',
 'Customer shutdown stranded original authority');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('d9999999-9999-4999-8999-999999999999',
 'order_StarterOpeningSynthetic','pay_StarterOpeningSynthetic','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.starter_capture))->>'status'='verified','Original post-refund capture replay failed');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000005',
 'order_CustomerSynthetic5','pay_CustomerSynthetic5','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000005'))->>'reason'='quote_expired_or_changed',
 'Late customer capture did not hold');
RESET ROLE;
-- The operator-reviewed owner remains; the separate quote author lost ownership.
SAVEPOINT customer_quote_owner_changed;
DELETE FROM public.organization_memberships WHERE organization_id='e1000000-0000-4000-8000-000000000003'
 AND user_id='e6000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(private.subscription_customer_review_active('e1000000-0000-4000-8000-000000000003',
 'e4000000-0000-4000-8000-000000000003'),'Second reviewed owner was not retained');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000003',
 'order_CustomerSynthetic3','pay_CustomerSynthetic3','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000003'))->>'reason'='customer_opening_review_changed',
 'Removed quote owner granted access or failed to retain a durable hold');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_grants
 WHERE organization_id='e1000000-0000-4000-8000-000000000003') AND EXISTS(SELECT 1 FROM private.subscription_live_payments
 WHERE organization_id='e1000000-0000-4000-8000-000000000003' AND state='review_required'),
 'Removed quote owner hold did not preserve payment without access');
ROLLBACK TO customer_quote_owner_changed;
SAVEPOINT customer_policy_changed;
UPDATE private.subscription_billing_settings SET standard_reminder_policy_version='synthetic-changed';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000003',
 'order_CustomerSynthetic3','pay_CustomerSynthetic3','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000003'))->>'status'='review_required',
 'Changed customer reminder review granted access');
RESET ROLE;
ROLLBACK TO customer_policy_changed;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_live_grants WHERE organization_id::TEXT LIKE 'e100%'),
 'Customer holds created grants');
SELECT pg_temp.assert_true((SELECT paid_through_end=period_start+interval '1 month'
 FROM private.subscription_live_grants WHERE organization_id='e1000000-0000-4000-8000-000000000001'),'Customer term changed');
SELECT pg_temp.assert_true((SELECT mode='trial' FROM private.organization_product_access
 WHERE organization_id='e1000000-0000-4000-8000-000000000002'),'Review hold changed trial access');
SELECT pg_temp.assert_true((SELECT NOT capabilities_enabled AND NOT enabled FROM private.subscription_billing_settings),
 'Customer checkout opened capabilities/Test');
SELECT pg_temp.assert_true((SELECT NOT renewals_enabled FROM private.subscription_live_settings),'Customer opened renewal');
SELECT pg_temp.assert_true((SELECT s.settings=(SELECT to_jsonb(x) FROM private.subscription_live_settings x)
 AND s.payments=(SELECT jsonb_agg(to_jsonb(p) ORDER BY provider_payment_id) FROM private.subscription_live_payments p WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8')
 AND s.refunds=(SELECT jsonb_agg(to_jsonb(r) ORDER BY refund_request_id) FROM private.subscription_live_refunds r WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8')
 AND s.grants=(SELECT jsonb_agg(to_jsonb(g) ORDER BY organization_id) FROM private.subscription_live_grants g WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8')
 AND s.access=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8')
 AND s.gym_payments=(SELECT count(*) FROM public.payments) FROM pg_temp.customer_original_snapshot s),'Customer changed original money/access/merchant or gym payments');
SELECT 'PASS: customer capture/replay, revoked/changed review and late capture holds, closed-scope recovery, receipts and original post-refund late-event preservation';

SAVEPOINT customer_first_refund;
UPDATE private.subscription_live_customer_scopes SET refunds_enabled=true
 WHERE organization_id='e1000000-0000-4000-8000-000000000001';
WITH review_clock AS MATERIALIZED (SELECT clock_timestamp() AS at)
INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,
 approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
SELECT 'e9000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
 'e6000000-0000-4000-8000-000000000001','pay_CustomerSynthetic1','acc_TCJwBqanN9LTrK',79900,
 'synthetic-first-week-full-refund',at,'synthetic-customer-refund-request',at FROM review_clock;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_refund('e9000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='create',
 'Customer first refund not independently authorized');
RESET ROLE;
UPDATE private.subscription_live_customer_scopes SET refunds_enabled=false;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(public.subscription_claim_live_refund('e9000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='recovery',
 'Closed customer refund was stranded');
SELECT public.subscription_observe_live_refund('e9000000-0000-4000-8000-000000000001',
 'pay_CustomerSynthetic1','rfnd_CustomerSynthetic1','acc_TCJwBqanN9LTrK',79900,'INR','processed');
SELECT pg_temp.assert_true(public.subscription_commit_live_full_refund('e9000000-0000-4000-8000-000000000001',
 'pay_CustomerSynthetic1','rfnd_CustomerSynthetic1','acc_TCJwBqanN9LTrK',79900,'INR')->>'confirmed_at' IS NOT NULL,
 'Customer full refund did not settle');
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('e5000000-0000-4000-8000-000000000001',
 'order_CustomerSynthetic1','pay_CustomerSynthetic1','acc_TCJwBqanN9LTrK',79900,'INR',
 (SELECT at FROM pg_temp.customer_capture_times WHERE request_id='e5000000-0000-4000-8000-000000000001'))->>'status'='verified',
 'Customer original post-refund capture replay failed');
SELECT pg_temp.assert_true(public.subscription_review_live_recovery_exception('payment',
 'e5000000-0000-4000-8000-000000000002','acc_TCJwBqanN9LTrK','e1000000-0000-4000-8000-000000000002',
 'e6000000-0000-4000-8000-000000000001','synthetic-authorization','synthetic-evidence','waiting_owner',
 'synthetic-owner','Review captured payment without granting access',clock_timestamp()+interval '1 day')->>'financial_hold_unchanged'='true',
 'Customer exception lacks owned metadata review');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT refund_confirmed_at IS NOT NULL FROM private.subscription_live_grants
 WHERE organization_id='e1000000-0000-4000-8000-000000000001'),'Capture replay undid customer refund');
ROLLBACK TO customer_first_refund;
SELECT 'PASS: separately closed customer refund claim/history/recovery and owned exception metadata';
