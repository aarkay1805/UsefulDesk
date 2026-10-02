-- Synthetic businesses in a disposable rollback transaction only.
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
INSERT INTO private.platform_admins(user_id) VALUES('e6000000-0000-4000-8000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO public.organizations(id,name,created_at)
 VALUES('a1000000-0000-4000-8000-000000000001','Synthetic existing gym',now()-interval '1 day');
INSERT INTO private.subscription_starter_signup_policies
 (policy_id,selection_scope,registrations_from,approved_by,authorization_reference,approved_at,enabled)
 VALUES('a3000000-0000-4000-8000-000000000001','all_new_gym_business_accounts',now()-interval '1 minute',
 'e6000000-0000-4000-8000-000000000002','synthetic explicit future-business selection',now()-interval '1 minute',TRUE);
INSERT INTO public.organizations(id,name,created_at) VALUES
 ('a1000000-0000-4000-8000-000000000002','Synthetic newly registered gym',now()),
 ('a1000000-0000-4000-8000-000000000003','Synthetic old-date business',now()-interval '2 days');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_starter_signup_selections),'New-business selection included existing or old-date gym');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM private.subscription_starter_signup_selections WHERE organization_id='a1000000-0000-4000-8000-000000000002'),'New gym was not selected');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations WHERE organization_id='a1000000-0000-4000-8000-000000000002') AND
 NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_reviews WHERE organization_id='a1000000-0000-4000-8000-000000000002') AND
 NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes WHERE organization_id='a1000000-0000-4000-8000-000000000002') AND
 NOT EXISTS(SELECT 1 FROM private.subscription_live_offer_approvals WHERE organization_id='a1000000-0000-4000-8000-000000000002') AND
 NOT EXISTS(SELECT 1 FROM private.subscription_live_quotes WHERE organization_id='a1000000-0000-4000-8000-000000000002') AND
 NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id='a1000000-0000-4000-8000-000000000002'),'Selection created approval, payment authority or money');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_starter_signup_policies SET registrations_from=now()-interval '1 year'$q$,'55000');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_starter_signup_selections SET selected_at=now()$q$,'55000');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$UPDATE private.subscription_starter_signup_policies SET enabled=TRUE$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO private.subscription_starter_signup_selections(organization_id,policy_id,organization_created_at) VALUES('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',now())$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_starter_signup_queue()$q$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_starter_signup_queue()$q$,'42501');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_starter_signup_queue()$q$,'42501');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true(public.platform_admin_starter_signup_queue()->'items'->0->>'review_status'='commercial_review_required','Queue mistook selection for commercial/owner approval');
SELECT pg_temp.expect_error($q$SELECT public.platform_admin_starter_signup_queue(101,0)$q$,'22023');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
SAVEPOINT effective_checkout_queue;
-- Reuse the earlier genuine synthetic owner-review fixture, isolated by savepoint.
INSERT INTO private.subscription_starter_signup_selections(organization_id,policy_id,organization_created_at)
 VALUES('f1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',now());
UPDATE private.subscription_live_settings SET webhook_intake_enabled=TRUE,settlements_enabled=TRUE,
 quotes_enabled=FALSE,orders_enabled=FALSE,refunds_enabled=FALSE,complimentary_conversion_enabled=FALSE;
UPDATE private.subscription_live_customer_scopes SET quotes_enabled=TRUE,orders_enabled=TRUE
 WHERE organization_id='f1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true((SELECT v->>'review_status' FROM jsonb_array_elements(public.platform_admin_starter_signup_queue()->'items') v
 WHERE v->>'organization_id'='f1000000-0000-4000-8000-000000000001')='checkout_opened','Effective checkout was not shown');
RESET ROLE;
UPDATE private.subscription_live_settings SET webhook_intake_enabled=FALSE,settlements_enabled=FALSE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT v->>'review_status' FROM jsonb_array_elements(public.platform_admin_starter_signup_queue()->'items') v
 WHERE v->>'organization_id'='f1000000-0000-4000-8000-000000000001')='checkout_paused','Global shutdown was hidden by raw customer flags');
RESET ROLE;
UPDATE private.subscription_live_settings SET webhook_intake_enabled=TRUE,settlements_enabled=TRUE;
DELETE FROM public.organization_memberships WHERE organization_id='f1000000-0000-4000-8000-000000000001'
 AND user_id='e6000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT v->>'review_status' FROM jsonb_array_elements(public.platform_admin_starter_signup_queue()->'items') v
 WHERE v->>'organization_id'='f1000000-0000-4000-8000-000000000001')='checkout_paused','Lost owner authority was hidden by raw customer flags');
RESET ROLE;
ROLLBACK TO effective_checkout_queue;
SET LOCAL request.jwt.claims='{}';
SAVEPOINT removed_approver_containment;
DELETE FROM private.platform_admins WHERE user_id='e6000000-0000-4000-8000-000000000002';
UPDATE private.subscription_starter_signup_policies SET enabled=FALSE,revoked_at=clock_timestamp();
SELECT pg_temp.assert_true((SELECT NOT enabled AND revoked_at IS NOT NULL FROM private.subscription_starter_signup_policies),
 'Removed historical approver blocked containment');
ROLLBACK TO removed_approver_containment;
UPDATE private.subscription_starter_signup_policies SET enabled=FALSE,revoked_at=clock_timestamp();
INSERT INTO public.organizations(id,name) VALUES('a1000000-0000-4000-8000-000000000004','Synthetic after containment');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_starter_signup_selections),'Contained policy selected another gym or erased history');
SELECT pg_temp.expect_error($q$UPDATE private.subscription_starter_signup_policies SET enabled=TRUE$q$,'55000');
-- Selected trial businesses retain the existing genuine-owner erasure path.
INSERT INTO public.organization_memberships(organization_id,user_id,role)
 VALUES('a1000000-0000-4000-8000-000000000002','e6000000-0000-4000-8000-000000000001','owner');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
SELECT public.delete_organization('a1000000-0000-4000-8000-000000000002');
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
SELECT pg_temp.assert_true(public.platform_admin_starter_signup_queue()->>'total'='0' AND
 jsonb_array_length(public.platform_admin_starter_signup_queue()->'items')=0,'Erased gym remained in live review queue');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.subscription_starter_signup_selections),'Erasure changed immutable UUID-only selection history');
SELECT 'PASS: prospective new-gym selection, no commercial/owner/money authority, private immutable history, MFA admin queue and containment';
