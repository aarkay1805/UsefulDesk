-- Synthetic rollback-only Task 6 acceptance, composed once for each tier.
SAVEPOINT monthly_documents_refunds;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true((SELECT
 public.subscription_live_owner_term(organization_id) @> jsonb_build_object(
 'tier',tier,'amount_minor',amount_minor,'currency','INR','renewal_available',FALSE,
 'offer_contract_version','monthly_first_v1','catalog_version','monthly_inr_2026_10_v1')
 AND public.subscription_live_owner_term(organization_id)->>'period_start' IS NOT NULL
 FROM monthly_selected),'Monthly paid status must expose frozen tier, amount, period and contract');
RESET ROLE;
CREATE FUNCTION pg_temp.monthly_document_preview() RETURNS JSONB LANGUAGE sql AS $fn$
 SELECT public.subscription_preview_live_document_issue('c9000000-0000-4000-8000-000000000001',
 '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic monthly supplier review"}');
$fn$;
CREATE FUNCTION pg_temp.monthly_document_issue(p_snapshot JSONB) RETURNS JSONB LANGUAGE sql AS $fn$
 SELECT public.subscription_issue_live_document_pair('c9000000-0000-4000-8000-000000000001',p_snapshot,
 encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),
 encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),
 'e6000000-0000-4000-8000-000000000002','synthetic monthly issuance');
$fn$;
CREATE FUNCTION pg_temp.monthly_refund_review(p_received TIMESTAMPTZ,p_amount BIGINT,p_policy TEXT DEFAULT NULL) RETURNS VOID LANGUAGE sql AS $fn$
 INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,
 approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
 SELECT 'ca000000-0000-4000-8000-000000000001',q.organization_id,q.requested_by,p.provider_payment_id,q.merchant_id,p_amount,
 coalesce(p_policy,a.refund_policy_reference),p_received,'synthetic monthly refund request',clock_timestamp()
 FROM private.subscription_live_quotes q JOIN private.subscription_live_payments p USING(request_id)
 JOIN private.subscription_live_offer_approvals a ON a.approval_id=q.offer_approval_id
 WHERE q.request_id='c9000000-0000-4000-8000-000000000001';
$fn$;
CREATE FUNCTION pg_temp.monthly_refund_claim() RETURNS JSONB LANGUAGE sql AS $fn$
 SELECT public.subscription_claim_live_refund('ca000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','acc_TCJwBqanN9LTrK');
$fn$;
CREATE FUNCTION pg_temp.monthly_refund_observe(p_state TEXT,p_amount BIGINT,p_payment TEXT DEFAULT 'pay_MonthlySynthetic') RETURNS JSONB LANGUAGE sql AS $fn$
 SELECT public.subscription_observe_live_refund('ca000000-0000-4000-8000-000000000001',p_payment,
 'rfnd_MonthlySynthetic','acc_TCJwBqanN9LTrK',p_amount,'INR',p_state);
$fn$;
CREATE FUNCTION pg_temp.monthly_refund_commit(p_amount BIGINT,p_payment TEXT DEFAULT 'pay_MonthlySynthetic') RETURNS JSONB LANGUAGE sql AS $fn$
 SELECT public.subscription_commit_live_full_refund('ca000000-0000-4000-8000-000000000001',p_payment,
 'rfnd_MonthlySynthetic','acc_TCJwBqanN9LTrK',p_amount,'INR');
$fn$;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT public.subscription_preview_live_document_issue('c9000000-0000-4000-8000-000000000001','{}')$q$,'22023');
CREATE TEMP TABLE monthly_document_candidate AS SELECT pg_temp.monthly_document_preview() snapshot;
SELECT pg_temp.assert_true((SELECT snapshot @> jsonb_build_object('tier',o.tier,'amount_minor',o.amount_minor,
 'included_branches',o.included_branches,'paid_extra_branch_slots',0,'currency','INR',
 'monthly_offer_id',o.monthly_offer_id,'offer_contract_version','monthly_first_v1',
 'document_treatment','usefulmade_unregistered_invoice_receipt_v1')
 AND snapshot->'buyer'->>'legal_name'='Synthetic monthly buyer'
 AND snapshot->>'period_start'=(SELECT to_jsonb(p.capture_event_at)#>>'{}' FROM private.subscription_live_payments p WHERE p.request_id='c9000000-0000-4000-8000-000000000001')
 FROM monthly_document_candidate CROSS JOIN monthly_selected o),'Monthly document candidate identity mismatch');
RESET ROLE;
-- Global series is shared with the original invoice already issued in this runner.
SELECT pg_temp.assert_true((SELECT (snapshot->>'sequence_number')::INTEGER=2 FROM monthly_document_candidate),'Monthly documents did not continue original global series');
SAVEPOINT monthly_document_year_partition;
-- Synthetic future-year row exercises year isolation without changing wall clock.
ALTER TABLE private.subscription_live_document_issues DISABLE TRIGGER subscription_freeze_document_issue;
UPDATE private.subscription_live_document_issues SET financial_year=financial_year+1,sequence_number=999999;
ALTER TABLE private.subscription_live_document_issues ENABLE TRIGGER subscription_freeze_document_issue;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_document_preview()->>'sequence_number'='1','Other financial year exhausted current series');
RESET ROLE;
ROLLBACK TO monthly_document_year_partition;
RELEASE SAVEPOINT monthly_document_year_partition;
-- Preserve the exact reviewed original April rollover calculation and timezone.
SELECT pg_temp.assert_true(
 substring(pg_get_functiondef('private.subscription_document_candidate(uuid,jsonb)'::regprocedure) FROM 'v_day:=[\s\S]+?v_suffix:=')=
 substring(pg_get_functiondef('private.subscription_document_candidate_before_monthly(uuid,jsonb)'::regprocedure) FROM 'v_day:=[\s\S]+?v_suffix:='),
 'Monthly fiscal year or numbering algorithm drifted from original');
SAVEPOINT document_buyer;
UPDATE public.invoice_profiles SET city='Synthetic changed after preview' WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))$q$,'55000');
RESET ROLE;
ROLLBACK TO document_buyer;
RELEASE SAVEPOINT document_buyer;
SAVEPOINT document_missing_buyer;
UPDATE public.invoice_profiles SET legal_name=NULL WHERE account_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))$q$,'55000');
RESET ROLE;
ROLLBACK TO document_missing_buyer;
RELEASE SAVEPOINT document_missing_buyer;
SAVEPOINT document_setup;
UPDATE public.accounts SET setup_reviewed_at=NULL WHERE id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))$q$,'55000');
RESET ROLE;
ROLLBACK TO document_setup;
RELEASE SAVEPOINT document_setup;
SAVEPOINT document_access_version;
UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))$q$,'55000');
RESET ROLE;
ROLLBACK TO document_access_version;
RELEASE SAVEPOINT document_access_version;
SAVEPOINT document_review;
UPDATE private.subscription_live_customer_reviews SET revoked_at=clock_timestamp() WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))$q$,'55000');
RESET ROLE;
ROLLBACK TO document_review;
RELEASE SAVEPOINT document_review;
SAVEPOINT document_held;
ALTER TABLE private.subscription_live_payments DISABLE TRIGGER subscription_freeze_live_payment_evidence; UPDATE private.subscription_live_payments SET state='review_required',hold_reason='monthly_source_changed' WHERE request_id='c9000000-0000-4000-8000-000000000001'; ALTER TABLE private.subscription_live_payments ENABLE TRIGGER subscription_freeze_live_payment_evidence;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))$q$,'55000');
RESET ROLE;
ROLLBACK TO document_held;
RELEASE SAVEPOINT document_held;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot||'{"amount_minor":1}' FROM monthly_document_candidate))$q$,'40001');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot||'{"document_treatment":"unreviewed"}' FROM monthly_document_candidate))$q$,'40001');
CREATE TEMP TABLE monthly_document_result AS SELECT pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate)) result;
SELECT pg_temp.assert_true((SELECT result->>'status'='issued' FROM monthly_document_result),'Monthly documents not issued');
SELECT pg_temp.assert_true(pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))->>'status'='already_issued','Document retry failed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_document_issue((SELECT snapshot||'{"tier":"other"}' FROM monthly_document_candidate))$q$,'23505');
RESET ROLE;
CREATE TEMP TABLE monthly_document_frozen AS SELECT to_jsonb(d) row FROM private.subscription_live_document_issues d WHERE request_id='c9000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT sequence_number=(SELECT max(sequence_number) FROM private.subscription_live_document_issues WHERE financial_year=d.financial_year)
 AND sequence_number=(SELECT (snapshot->>'sequence_number')::INTEGER FROM monthly_document_candidate)
 AND invoice_sha256=encode(extensions.digest(invoice_pdf,'sha256'),'hex')
 AND receipt_sha256=encode(extensions.digest(receipt_pdf,'sha256'),'hex')
 FROM private.subscription_live_document_issues d WHERE request_id='c9000000-0000-4000-8000-000000000001'),'Number/hash constraints changed');
-- Frozen timezone day 7 qualifies despite a mutable account locale; day 8 fails.
-- Backdate only the synthetic payment clock under a savepoint, restoring evidence afterward.
SAVEPOINT monthly_refund_day_boundary;
ALTER TABLE private.subscription_live_payments DISABLE TRIGGER subscription_freeze_live_payment_evidence;
UPDATE private.subscription_live_payments SET capture_event_at=((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date-8+time '23:50') AT TIME ZONE 'Asia/Kolkata',billing_timezone='Asia/Kolkata'
 WHERE request_id='c9000000-0000-4000-8000-000000000001';
ALTER TABLE private.subscription_live_payments ENABLE TRIGGER subscription_freeze_live_payment_evidence;
UPDATE public.accounts SET timezone='America/Los_Angeles' WHERE id='c2000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT billing_timezone='Asia/Kolkata' FROM private.subscription_live_payments WHERE request_id='c9000000-0000-4000-8000-000000000001'),'Payment timezone changed with locale');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_review(p.capture_event_at+interval '7 days 20 minutes',o.amount_minor)
 FROM private.subscription_live_payments p CROSS JOIN monthly_selected o WHERE p.request_id='c9000000-0000-4000-8000-000000000001'$q$,'22023');
SELECT pg_temp.monthly_refund_review(p.capture_event_at+interval '6 days 20 minutes',o.amount_minor)
 FROM private.subscription_live_payments p CROSS JOIN monthly_selected o WHERE p.request_id='c9000000-0000-4000-8000-000000000001';
ROLLBACK TO monthly_refund_day_boundary;
RELEASE SAVEPOINT monthly_refund_day_boundary;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_review(clock_timestamp(),amount_minor-1) FROM monthly_selected$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_review(clock_timestamp(),amount_minor,'wrong policy') FROM monthly_selected$q$,'55000');
SELECT pg_temp.monthly_refund_review(clock_timestamp(),amount_minor) FROM monthly_selected;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_review(clock_timestamp(),amount_minor) FROM monthly_selected$q$,'23505');
-- A new request UUID cannot buy a second allowance for the same organization/payment.
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_live_refund_reviews
 (refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,currency,
 approved_policy_reference,owner_reviewed_at,request_received_at,request_evidence_reference)
 SELECT 'ca000000-0000-4000-8000-000000000002',organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,currency,
 approved_policy_reference,owner_reviewed_at,request_received_at,request_evidence_reference
 FROM private.subscription_live_refund_reviews WHERE refund_request_id='ca000000-0000-4000-8000-000000000001'$q$,'23505');
CREATE TEMP TABLE monthly_before_refund AS SELECT to_jsonb(x) access FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_claim()$q$,'55000');
RESET ROLE;
UPDATE private.subscription_live_customer_scopes SET refunds_enabled=TRUE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_refund_claim()->>'action'='create','Monthly full refund not claimed');
SELECT pg_temp.assert_true(pg_temp.monthly_refund_claim()->>'action'='recovery','Duplicate refund claim allowed another POST');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_observe('processed',amount_minor-1) FROM monthly_selected$q$,'23505');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_observe('processed',amount_minor,'pay_WrongParent') FROM monthly_selected$q$,'23505');
SELECT pg_temp.monthly_refund_observe('pending',amount_minor) FROM monthly_selected;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_commit(amount_minor) FROM monthly_selected$q$,'22023');
SELECT pg_temp.monthly_refund_observe('failed',amount_minor) FROM monthly_selected;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access FROM monthly_before_refund)=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Pending/failed refund changed access');
UPDATE private.subscription_live_customer_scopes SET refunds_enabled=FALSE,quotes_enabled=FALSE,orders_enabled=FALSE WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_refund_claim()->>'action'='bound','Closure stranded GET-only refund reconciliation');
SELECT pg_temp.monthly_refund_observe('processed',amount_minor) FROM monthly_selected;
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_commit(amount_minor-1) FROM monthly_selected$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT pg_temp.monthly_refund_commit(amount_minor,'pay_WrongParent') FROM monthly_selected$q$,'22023');
RESET ROLE;
SAVEPOINT monthly_refund_access_hold;
UPDATE private.organization_product_access SET access_ends_at=access_ends_at+interval '1 day' WHERE organization_id='c1000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE monthly_changed_refund_access AS SELECT to_jsonb(x) access FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_refund_commit(amount_minor)->>'review_reason'='later_payment_or_access_change','Changed access escaped refund hold') FROM monthly_selected;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access FROM monthly_changed_refund_access)=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Held refund truncated changed access');
ROLLBACK TO monthly_refund_access_hold;
RELEASE SAVEPOINT monthly_refund_access_hold;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_refund_commit(amount_minor)->>'confirmed_at' IS NOT NULL,'Monthly full refund unconfirmed') FROM monthly_selected;
RESET ROLE;
SELECT pg_temp.expect_error($q$SELECT private.subscription_document_candidate('c9000000-0000-4000-8000-000000000001',(SELECT snapshot->'issuer' FROM monthly_document_candidate))$q$,'55000');
CREATE TEMP TABLE monthly_after_refund AS SELECT to_jsonb(x) access FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT (access->>'version')::INTEGER FROM monthly_after_refund)=(SELECT (access->>'version')::INTEGER+1 FROM monthly_before_refund),'Refund access version must advance once');
SELECT pg_temp.assert_true((SELECT refund_confirmed_at IS NOT NULL AND renewal_stopped_at IS NOT NULL FROM private.subscription_live_grants WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Refund did not stop paid term');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_refund_commit(amount_minor)->>'confirmed_at' IS NOT NULL,'Refund replay failed') FROM monthly_selected;
SELECT pg_temp.monthly_refund_observe('failed',amount_minor) FROM monthly_selected;
SELECT pg_temp.assert_true(public.subscription_commit_live_initial_payment('c9000000-0000-4000-8000-000000000001',
 'order_MonthlySynthetic','pay_MonthlySynthetic','acc_TCJwBqanN9LTrK',(SELECT amount_minor FROM monthly_selected),'INR',
 (SELECT captured FROM monthly_capture))->>'status'='verified','Refunded capture replay failed');
SELECT pg_temp.assert_true(pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))->>'status'='already_issued','Refund/closure blocked document readback');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT access FROM monthly_after_refund)=(SELECT to_jsonb(x) FROM private.organization_product_access x WHERE organization_id='c1000000-0000-4000-8000-000000000001'),'Later refund/capture replay changed access');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.assert_true((SELECT public.subscription_live_owner_term(organization_id) @>
 jsonb_build_object('tier',tier,'amount_minor',amount_minor,'refunded',TRUE,'renewal_stopped',TRUE,
 'renewal_available',FALSE,'refund_state','processed') FROM monthly_selected),'Closed monthly owner term lost refund status');
RESET ROLE;
UPDATE private.organization_product_access SET access_starts_at=clock_timestamp()-interval '2 days',access_ends_at=clock_timestamp()-interval '1 day',suspended_at=clock_timestamp() WHERE organization_id='c1000000-0000-4000-8000-000000000001';
UPDATE private.subscription_live_offer_approvals SET revoked_at=clock_timestamp() WHERE approval_id=(SELECT approval_id FROM monthly_selected);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_true(pg_temp.monthly_document_issue((SELECT snapshot FROM monthly_document_candidate))->>'status'='already_issued','Expiry/revocation blocked frozen document readback');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT row FROM monthly_document_frozen)=(SELECT to_jsonb(d) FROM private.subscription_live_document_issues d WHERE request_id='c9000000-0000-4000-8000-000000000001'),'Issued document bytes/numbers changed after refund');
ROLLBACK TO monthly_documents_refunds;
RELEASE SAVEPOINT monthly_documents_refunds;
SELECT 'PASS: monthly '||:'monthly_tier'||' paid status, frozen documents/source refusal, full refund/day7-day8/closure and immutable replay';
