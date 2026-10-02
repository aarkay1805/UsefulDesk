-- Synthetic rollback-only issue controls. Runs after scoped customer fixtures.
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
SELECT pg_temp.assert_true(to_regclass('private.subscription_live_document_issues') IS NOT NULL,
 'Durable subscription document ledger is missing');
INSERT INTO public.invoice_profiles(account_id,business_name,legal_name,address_line1,city,state,postal_code,country,phone,email)
 VALUES('e2000000-0000-4000-8000-000000000001','Synthetic customer','Synthetic buyer','Synthetic street','Synthetic city','Punjab','140603','India','+919999999999','buyer@example.invalid');
CREATE TEMP TABLE document_preservation AS SELECT
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY provider_payment_id) FROM private.subscription_live_payments p) payments,
 (SELECT jsonb_agg(to_jsonb(g) ORDER BY organization_id) FROM private.subscription_live_grants g) grants,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY request_id) FROM private.subscription_live_terms t) terms,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY organization_id) FROM private.organization_product_access a) access,
 (SELECT count(*) FROM public.payments) gym_payments;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
CREATE TEMP TABLE document_candidate AS SELECT public.subscription_preview_live_document_issue(
 'e5000000-0000-4000-8000-000000000001',
 '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic-supplier-review"}'::JSONB) snapshot;
SELECT pg_temp.assert_true((SELECT snapshot->>'amount_minor'='79900' AND snapshot->>'currency'='INR'
 AND snapshot->>'provider_payment_id'='pay_CustomerSynthetic1' AND snapshot->'buyer'->>'legal_name'='Synthetic buyer'
 AND snapshot->>'invoice_number' LIKE 'UM/%/000001' AND snapshot->>'receipt_number' LIKE 'UM-R/%/000001'
 FROM document_candidate),'Candidate did not bind verified payment, buyer and next unissued numbers');
SELECT pg_temp.expect_error($q$SELECT public.subscription_preview_live_document_issue(
 'd9999999-9999-4999-8999-999999999999',
 '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic-supplier-review"}')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_preview_live_document_issue(
 'e5000000-0000-4000-8000-000000000002',
 '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic-supplier-review"}')$q$,'55000');
SELECT pg_temp.expect_error($q$SELECT public.subscription_issue_live_document_pair(
 'e5000000-0000-4000-8000-000000000001',(SELECT snapshot||'{"amount_minor":1}'::JSONB FROM document_candidate),
 encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),
 encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),
 'e6000000-0000-4000-8000-000000000002','synthetic-issue-review')$q$,'40001');
SELECT pg_temp.expect_error($q$SELECT public.subscription_issue_live_document_pair(
 'e5000000-0000-4000-8000-000000000001',(SELECT snapshot FROM document_candidate),'not-a-pdf','not-a-pdf',
 'e6000000-0000-4000-8000-000000000002','synthetic-issue-review')$q$,'22023');
CREATE TEMP TABLE document_result AS SELECT public.subscription_issue_live_document_pair(
 'e5000000-0000-4000-8000-000000000001',(SELECT snapshot FROM document_candidate),
 encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),
 encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),
 'e6000000-0000-4000-8000-000000000002','synthetic-issue-review') result;
SELECT pg_temp.assert_true((SELECT result->>'status'='issued' FROM document_result),'Documents were not issued atomically');
SELECT pg_temp.assert_true(public.subscription_issue_live_document_pair(
 'e5000000-0000-4000-8000-000000000001',(SELECT snapshot FROM document_candidate),
 encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),
 encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),
 'e6000000-0000-4000-8000-000000000002','synthetic-issue-review')->>'status'='already_issued','Issue retry duplicated documents');
SELECT pg_temp.expect_error($q$SELECT public.subscription_issue_live_document_pair(
 'e5000000-0000-4000-8000-000000000001',(SELECT snapshot FROM document_candidate),
 encode(convert_to('%PDF-1.4'||repeat('changed',100)||'%%EOF','UTF8'),'base64'),
 encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),
 'e6000000-0000-4000-8000-000000000002','synthetic-issue-review')$q$,'23505');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_document_issues SET evidence_reference='changed'$q$,'42501');
SELECT pg_temp.expect_error($q$TRUNCATE private.subscription_live_document_issues$q$,'42501');
RESET ROLE;
SELECT pg_temp.expect_error($q$DELETE FROM private.subscription_live_document_issues$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_live_document_issues SET evidence_reference='changed'$q$,'55000');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(sequence_number=1) FROM private.subscription_live_document_issues),'Failed calls consumed numbers or duplicated issue');
SELECT pg_temp.assert_true((SELECT invoice_sha256=encode(extensions.digest(invoice_pdf,'sha256'),'hex')
 AND receipt_sha256=encode(extensions.digest(receipt_pdf,'sha256'),'hex') FROM private.subscription_live_document_issues),'Durable bytes/hash mismatch');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"e6000000-0000-4000-8000-000000000001"}';
SELECT pg_temp.expect_error($q$SELECT * FROM private.subscription_live_document_issues$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.subscription_preview_live_document_issue(
 'e5000000-0000-4000-8000-000000000001','{}')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT
 payments=(SELECT jsonb_agg(to_jsonb(p) ORDER BY provider_payment_id) FROM private.subscription_live_payments p)
 AND grants=(SELECT jsonb_agg(to_jsonb(g) ORDER BY organization_id) FROM private.subscription_live_grants g)
 AND terms=(SELECT jsonb_agg(to_jsonb(t) ORDER BY request_id) FROM private.subscription_live_terms t)
 AND access=(SELECT jsonb_agg(to_jsonb(a) ORDER BY organization_id) FROM private.organization_product_access a)
 AND gym_payments=(SELECT count(*) FROM public.payments) FROM document_preservation),'Document issuance mutated money/access/gym facts');
SELECT 'PASS: private atomic subscription invoice/receipt, numbering, bytes/hashes, duplicate/conflict refusal, financial/access preservation';
