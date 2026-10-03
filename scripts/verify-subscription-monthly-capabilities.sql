-- Actual monthly grants and intended authenticated roles; enclosing tier savepoint
-- restores all synthetic writes. Server/worker tests cover ordinary service checks.
SAVEPOINT monthly_capability_roles;
INSERT INTO public.account_memberships(account_id,user_id,role) VALUES
 ('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','owner'),
 ('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','agent')
 ON CONFLICT(account_id,user_id) DO UPDATE SET role=excluded.role;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL request.headers='{"x-usefuldesk-account-id":"c2000000-0000-4000-8000-000000000001"}';
SELECT pg_temp.assert_true((public.product_access_for_account('c2000000-0000-4000-8000-000000000001')->>'allowed')::BOOLEAN,'Paid monthly owner product access denied');
WITH changed AS (UPDATE public.renewal_reminder_settings SET enabled=false WHERE account_id='c2000000-0000-4000-8000-000000000001' RETURNING account_id)
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM changed),'Owner standard reminder toggle silently denied by RLS');
\if :monthly_starter
SELECT pg_temp.expect_error($q$UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7] WHERE account_id='c2000000-0000-4000-8000-000000000001'$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.automations(account_id,user_id,name,trigger_type) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','Synthetic monthly forbidden automation','new_contact_created')$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.broadcasts(account_id,user_id,name,template_name) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','Synthetic monthly forbidden campaign','synthetic')$q$,'42501');
\else
WITH changed AS (UPDATE public.renewal_reminder_settings SET days_before=ARRAY[14,7,3],service_days_before=ARRAY[14,7,3] WHERE account_id='c2000000-0000-4000-8000-000000000001' RETURNING account_id)
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM changed),'Paid tier custom schedule silently denied');
INSERT INTO public.automations(account_id,user_id,name,trigger_type,is_active) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','Synthetic monthly allowed automation','new_contact_created',false);
INSERT INTO public.broadcasts(account_id,user_id,name,template_name,status) VALUES('c2000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','Synthetic monthly allowed campaign','synthetic','draft');
\endif
RESET ROLE;
-- Payment provider records are service-written; Starter rejects before any
-- provider reservation. Higher-tier merchant requirements remain separate.
\if :monthly_starter
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.expect_error($q$INSERT INTO public.payment_mandates(account_id) VALUES('c2000000-0000-4000-8000-000000000001')$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.razorpay_payment_links(account_id) VALUES('c2000000-0000-4000-8000-000000000001')$q$,'42501');
RESET ROLE;
\endif
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"e6000000-0000-4000-8000-000000000002","role":"authenticated"}';
WITH changed AS (UPDATE public.renewal_reminder_settings SET enabled=true WHERE account_id='c2000000-0000-4000-8000-000000000001' RETURNING account_id)
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM changed),'Agent bypassed settings permission with paid capability');
RESET ROLE;
UPDATE public.account_memberships SET role='viewer' WHERE account_id='c2000000-0000-4000-8000-000000000001' AND user_id='e6000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
WITH changed AS (UPDATE public.renewal_reminder_settings SET enabled=true WHERE account_id='c2000000-0000-4000-8000-000000000001' RETURNING account_id)
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM changed),'Viewer bypassed settings permission with paid capability');
RESET ROLE;
ROLLBACK TO monthly_capability_roles;
RELEASE SAVEPOINT monthly_capability_roles;
SELECT 'PASS: monthly '||:'monthly_tier'||' authenticated capability/RLS and ordinary owner/agent/viewer settings boundaries';
