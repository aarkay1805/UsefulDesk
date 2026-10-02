-- Synthetic expiry-only customer renewal, after the customer boundary fixture.
SELECT pg_temp.assert_true((SELECT bool_and(NOT renewals_enabled) FROM private.subscription_live_customer_scopes),
 'Customer renewal default opened');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_scopes SET renewals_enabled=true$q$,'55000');
SELECT 'PASS: customer renewal is separately hard-closed';
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_renewal_releases), 'Renewal release authority was seeded');
CREATE TEMP TABLE renewal_fixture (i INTEGER, org UUID, branch UUID, approval UUID, review UUID, release UUID, original UUID, renewal UUID, capture_at TIMESTAMPTZ);
INSERT INTO renewal_fixture SELECT i,
 ('f1000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 ('f2000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 ('f3000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 ('f4000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 ('f9000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 ('f5000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 ('f8000000-0000-4000-8000-'||lpad(i::TEXT,12,'0'))::UUID,
 CASE WHEN i=2 THEN now()-interval '15 days' ELSE now()-interval '2 months' END
 FROM generate_series(1,7) i;
GRANT SELECT ON renewal_fixture TO service_role,authenticated;
DO $$ DECLARE f RECORD; entity UUID; BEGIN FOR f IN SELECT * FROM renewal_fixture LOOP
 entity:=('f7000000-0000-4000-8000-'||lpad(f.i::TEXT,12,'0'))::UUID;
 INSERT INTO public.organizations(id,name) VALUES(f.org,'Synthetic renewal '||f.i);
 INSERT INTO public.legal_entities(id,organization_id,name) VALUES(entity,f.org,'Synthetic renewal entity');
 INSERT INTO public.accounts(id,name,organization_id,legal_entity_id,owner_user_id,default_currency)
 VALUES(f.branch,'Synthetic renewal branch',f.org,entity,'e6000000-0000-4000-8000-000000000001','INR');
 INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES(f.org,'e6000000-0000-4000-8000-000000000001','owner');
 INSERT INTO public.account_memberships(account_id,user_id,role) VALUES(f.branch,'e6000000-0000-4000-8000-000000000001','owner');
 INSERT INTO private.organization_product_access(organization_id,mode,trial_started_at,trial_ends_at)
 VALUES(f.org,'trial',f.capture_at-interval '16 days',f.capture_at-interval '2 days') ON CONFLICT(organization_id)
 DO UPDATE SET mode='trial',trial_started_at=excluded.trial_started_at,trial_ends_at=excluded.trial_ends_at;
 INSERT INTO private.subscription_live_offer_approvals(approval_id,organization_id,merchant_id,tier,amount_minor,term_policy,
 quote_validity_seconds,offer_reference,tax_decision_reference,refund_policy_reference,merchant_approval_reference,
 customer_tax_note,customer_terms_note,approved_at)
 VALUES(f.approval,f.org,'acc_TCJwBqanN9LTrK','starter',79900,'calendar_month_from_capture_event',1800,
 'synthetic-renewal-offer','synthetic-tax','synthetic-refund','synthetic-merchant',
 'GST not charged — supplier unregistered.','Synthetic expiry-only monthly terms',f.capture_at-interval '1 day');
 INSERT INTO private.subscription_live_customer_reviews(review_id,offer_approval_id,organization_id,billing_account_id,merchant_id,
 commercial_context,reviewed_by,release_sha,migration_manifest_sha256,authorization_reference,buyer_geography_reference,
 issuer_financial_year_reference,tax_receipt_review_reference,provider_acceptance_reference,backup_recovery_reference,
 reminder_policy_version,reviewed_at)
 VALUES(f.review,f.approval,f.org,f.branch,'acc_TCJwBqanN9LTrK','customer_sale','e6000000-0000-4000-8000-000000000001',
 repeat('c',40),repeat('d',64),'synthetic','synthetic','synthetic','synthetic','synthetic','synthetic',
 'synthetic-starter-731-after09',f.capture_at-interval '1 hour');
 INSERT INTO private.subscription_live_customer_scopes(organization_id,merchant_id,review_id)
 VALUES(f.org,'acc_TCJwBqanN9LTrK',f.review);
 UPDATE private.subscription_live_customer_scopes SET quotes_enabled=true,orders_enabled=true WHERE organization_id=f.org;
 -- Historical signed capture fixture, preserving all production triggers.
 INSERT INTO private.subscription_live_quotes(request_id,organization_id,requested_by,billing_account_id,merchant_id,tier,amount_minor,
 term_policy,offer_reference,tax_decision_reference,expires_at,owner_reviewed_at,created_at,offer_approval_id,source_access_mode,source_access_version)
 SELECT f.original,f.org,'e6000000-0000-4000-8000-000000000001',f.branch,'acc_TCJwBqanN9LTrK','starter',79900,
 'calendar_month_from_capture_event','synthetic-renewal-offer','synthetic-tax',f.capture_at+interval '29 minutes',
 f.capture_at-interval '1 minute',f.capture_at-interval '1 minute',f.approval,'trial',x.version
 FROM private.organization_product_access x WHERE organization_id=f.org;
 PERFORM set_config('request.jwt.claims','{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 UPDATE private.subscription_live_quotes SET starter_reminder_reset_accepted=true,
 starter_reminder_policy_version='synthetic-starter-731-after09' WHERE request_id=f.original;
 INSERT INTO private.subscription_live_orders(request_id,organization_id,merchant_id,state,provider_order_id,claimed_at,bound_at)
 VALUES(f.original,f.org,'acc_TCJwBqanN9LTrK','bound','order_RenewalOriginal'||f.i,f.capture_at,f.capture_at);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK',f.org,'evt_RenewalOriginal'||f.i,
 'payment.captured','order_RenewalOriginal'||f.i,'pay_RenewalOriginal'||f.i,NULL,repeat('a',64),f.capture_at);
 PERFORM pg_temp.assert_true(public.subscription_commit_live_initial_payment(f.original,'order_RenewalOriginal'||f.i,
 'pay_RenewalOriginal'||f.i,'acc_TCJwBqanN9LTrK',79900,'INR',f.capture_at)->>'status'='verified','Historical initial fixture failed');
 INSERT INTO private.subscription_live_renewal_releases(release_id,organization_id,merchant_id,customer_review_id,owner_user_id,
 release_sha,migration_manifest_sha256,authorization_reference,provider_acceptance_reference,backup_recovery_reference,reviewed_at)
 VALUES(f.release,f.org,'acc_TCJwBqanN9LTrK',f.review,'e6000000-0000-4000-8000-000000000001',
 repeat('e',40),repeat('f',64),'synthetic-release-only','synthetic-provider-only','synthetic-backup-only',clock_timestamp());
END LOOP; END $$;
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_renewal_releases SET release_sha=repeat('a',40)$q$,'55000');
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_renewal_releases$q$,'55000');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_live_renewal_preview((SELECT org FROM renewal_fixture WHERE i=1),(SELECT branch FROM renewal_fixture WHERE i=1),'starter')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_live_renewal_releases$q$,'42501');
RESET ROLE;
-- Only this rollback-only fixture removes the hard constraint; release/tenant checks remain.
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_customer_scopes c SET renewals_enabled=true,renewal_release_id=f.release FROM renewal_fixture f WHERE f.org=c.organization_id$q$,'23514');
ALTER TABLE private.subscription_live_customer_scopes DROP CONSTRAINT subscription_customer_renewals_closed;
UPDATE private.subscription_live_customer_scopes c SET renewals_enabled=true,renewal_release_id=f.release FROM renewal_fixture f WHERE f.org=c.organization_id;
-- CUSTOMER_RENEWAL_RACE_SEED
-- Historical renewal for genuine late-event semantics without future event time.
INSERT INTO private.subscription_live_quotes(request_id,organization_id,requested_by,billing_account_id,merchant_id,tier,amount_minor,
 term_policy,offer_reference,tax_decision_reference,expires_at,owner_reviewed_at,created_at,offer_approval_id,
 renewal_of_request_id,previous_paid_through_end,previous_access_version,source_access_mode,source_access_version)
SELECT f.renewal,f.org,'e6000000-0000-4000-8000-000000000001',f.branch,'acc_TCJwBqanN9LTrK','starter',79900,
 'calendar_month_from_capture_event','synthetic-renewal-offer','synthetic-tax',now()-interval '1 minute',now()-interval '31 minutes',
 now()-interval '31 minutes',f.approval,f.original,g.paid_through_end,x.version,'manual',x.version
 FROM renewal_fixture f JOIN private.subscription_live_grants g ON g.organization_id=f.org
 JOIN private.organization_product_access x ON x.organization_id=f.org WHERE i=6;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_renewal_quote(f.renewal,f.org,f.branch,
 'e6000000-0000-4000-8000-000000000001',f.approval,79900,'starter','acc_TCJwBqanN9LTrK',f.original)
 FROM renewal_fixture f WHERE i=2$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_renewal_quote(f.renewal,f.org,f.branch,
 'e6000000-0000-4000-8000-000000000002',f.approval,79900,'starter','acc_TCJwBqanN9LTrK',f.original)
 FROM renewal_fixture f WHERE i=1$q$,'42501');
DO $$ DECLARE f RECORD; BEGIN FOR f IN SELECT * FROM renewal_fixture WHERE i NOT IN (2,6) LOOP
 PERFORM public.subscription_create_live_renewal_quote(f.renewal,f.org,f.branch,'e6000000-0000-4000-8000-000000000001',f.approval,79900,'starter','acc_TCJwBqanN9LTrK',f.original);
 PERFORM pg_temp.assert_true(public.subscription_create_live_renewal_quote(f.renewal,f.org,f.branch,'e6000000-0000-4000-8000-000000000001',f.approval,79900,'starter','acc_TCJwBqanN9LTrK',f.original)->>'renewal_of_request_id'=f.original::TEXT,'Quote replay changed predecessor');
END LOOP; END $$;
SELECT pg_temp.expect_error($q$SELECT public.subscription_create_live_renewal_quote('fa000000-0000-4000-8000-000000000001',f.org,f.branch,
 'e6000000-0000-4000-8000-000000000001',f.approval,79900,'starter','acc_TCJwBqanN9LTrK',f.original) FROM renewal_fixture f WHERE i=1$q$,'55000');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(q.renewal_release_id=f.release AND q.previous_access_version=x.version AND q.previous_paid_through_end=g.paid_through_end
 AND q.expires_at=q.owner_reviewed_at+interval '30 minutes') FROM renewal_fixture f JOIN private.subscription_live_quotes q ON q.request_id=f.renewal
 JOIN private.organization_product_access x ON x.organization_id=f.org JOIN private.subscription_live_grants g ON g.organization_id=f.org),'Renewal quote snapshots changed');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$ DECLARE f RECORD; BEGIN FOR f IN SELECT * FROM renewal_fixture WHERE i NOT IN (2,6) LOOP
 PERFORM public.subscription_acknowledge_live_starter_reminders(f.renewal);
END LOOP; END $$;
RESET ROLE;
UPDATE private.subscription_live_quotes SET starter_reminder_reset_accepted=true,starter_reminder_policy_version='synthetic-starter-731-after09'
 WHERE request_id=(SELECT renewal FROM renewal_fixture WHERE i=6);
INSERT INTO private.subscription_live_orders(request_id,organization_id,merchant_id,state,provider_order_id,claimed_at,bound_at)
 SELECT renewal,org,'acc_TCJwBqanN9LTrK','bound','order_CustomerRenewal6',now()-interval '2 minutes',now()-interval '2 minutes'
 FROM renewal_fixture WHERE i=6;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE f RECORD; BEGIN FOR f IN SELECT * FROM renewal_fixture WHERE i NOT IN (2,6) LOOP
 PERFORM pg_temp.assert_true(public.subscription_claim_live_order(f.renewal,f.org,'e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='create','Renewal claim failed');
 PERFORM pg_temp.assert_true(public.subscription_claim_live_order(f.renewal,f.org,'e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK')->>'action'='recovery','Renewal duplicate POST permitted');
 PERFORM public.subscription_bind_live_order(f.renewal,'order_CustomerRenewal'||f.i,'acc_TCJwBqanN9LTrK',f.org);
END LOOP; END $$;
RESET ROLE;
CREATE TEMP TABLE renewal_captures AS SELECT i,clock_timestamp() AS at FROM renewal_fixture;
GRANT SELECT ON renewal_captures TO service_role;
-- Distinct captured-money holds: cancellation, access change, revoked release, late capture, roster change.
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT public.subscription_cancel_live_renewal(org,original) FROM renewal_fixture WHERE i=3;
UPDATE private.organization_product_access x SET version=version+1 FROM renewal_fixture f WHERE i=4 AND x.organization_id=f.org;
UPDATE private.subscription_live_renewal_releases r SET revoked_at=clock_timestamp() FROM renewal_fixture f WHERE i=5 AND r.release_id=f.release;
UPDATE public.accounts x SET branch_status='archived' FROM renewal_fixture f WHERE i=7 AND x.id=f.branch;
UPDATE private.subscription_live_customer_scopes SET renewals_enabled=false,quotes_enabled=false,orders_enabled=false;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE f RECORD; result JSONB; BEGIN FOR f IN SELECT x.*,c.at FROM renewal_fixture x JOIN renewal_captures c USING(i) WHERE i<>2 LOOP
 PERFORM public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK',f.org,'evt_CustomerRenewal'||f.i,
 'payment.captured','order_CustomerRenewal'||f.i,'pay_CustomerRenewal'||f.i,NULL,repeat('b',64),f.at);
 result:=public.subscription_commit_live_initial_payment(f.renewal,'order_CustomerRenewal'||f.i,'pay_CustomerRenewal'||f.i,'acc_TCJwBqanN9LTrK',79900,'INR',f.at);
 PERFORM pg_temp.assert_true(result->>'status'=CASE WHEN f.i=1 THEN 'verified' ELSE 'review_required' END,'Renewal hold/settlement wrong: '||result::TEXT);
 PERFORM public.subscription_commit_live_initial_payment(f.original,'order_RenewalOriginal'||f.i,'pay_RenewalOriginal'||f.i,'acc_TCJwBqanN9LTrK',79900,'INR',f.capture_at);
 PERFORM pg_temp.assert_true(public.subscription_commit_live_initial_payment(f.renewal,'order_CustomerRenewal'||f.i,'pay_CustomerRenewal'||f.i,'acc_TCJwBqanN9LTrK',79900,'INR',f.at)->>'status'=result->>'status','Renewal replay changed');
END LOOP; END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT g.request_id=f.renewal AND g.period_start=c.at AND g.paid_through_end=c.at+interval '1 month'
 FROM renewal_fixture f JOIN renewal_captures c USING(i) JOIN private.subscription_live_grants g ON g.organization_id=f.org WHERE i=1),'Current term rolled back or wrong monthly end');
SELECT pg_temp.assert_true((SELECT count(*)=8 FROM private.subscription_live_terms WHERE organization_id IN(SELECT org FROM renewal_fixture)), 'Term history changed');
SELECT pg_temp.assert_true((SELECT count(*)=5 FROM private.subscription_live_payments WHERE state='review_required' AND organization_id IN(SELECT org FROM renewal_fixture)), 'Captured holds lost');
SELECT pg_temp.assert_true((SELECT s.gym_payments=(SELECT count(*) FROM public.payments) AND s.access=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='8826d9aa-03f2-4ad7-ae91-0553052131f8') FROM customer_original_snapshot s),'Renewal changed gym payments or original manual access');
SELECT 'PASS: expiry-only customer quotes/replay, owner isolation, one-order recovery, shutdown settlement, cancellation/access/release/late/roster holds and immutable term history';
