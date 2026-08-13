-- Test-project acceptance for organization branch setup copy.
--
-- Run only after applying organization_branch_setup_copy to the isolated
-- Supabase Test project. The entire fixture is rollback-scoped. This file is
-- deliberately not a migration: it creates temporary users/configuration,
-- exercises authenticated JWT + selected-account header behavior, and leaves
-- the project unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'branch setup acceptance failed: %', p_message;
  END IF;
END;
$$;

-- Deterministic fixture identities make post-failure inspection unambiguous.
SELECT set_config(
  'acceptance.actor',
  (SELECT id::TEXT FROM auth.users ORDER BY created_at, id LIMIT 1),
  TRUE
);
SELECT pg_temp.assert_true(
  NULLIF(current_setting('acceptance.actor', TRUE), '') IS NOT NULL,
  'Test project must contain one authenticated fixture user'
);
SELECT set_config('acceptance.other', '00000000-0000-4000-8000-00000000a002', TRUE);
SELECT set_config('acceptance.org_a', '00000000-0000-4000-8000-00000000b001', TRUE);
SELECT set_config('acceptance.org_b', '00000000-0000-4000-8000-00000000b002', TRUE);
SELECT set_config('acceptance.legal_a', '00000000-0000-4000-8000-00000000c001', TRUE);
SELECT set_config('acceptance.legal_usd', '00000000-0000-4000-8000-00000000c002', TRUE);
SELECT set_config('acceptance.legal_b', '00000000-0000-4000-8000-00000000c003', TRUE);
SELECT set_config('acceptance.source', '00000000-0000-4000-8000-00000000d001', TRUE);
SELECT set_config('acceptance.cross_source', '00000000-0000-4000-8000-00000000d002', TRUE);
SELECT set_config('acceptance.unreviewed_source', '00000000-0000-4000-8000-00000000d003', TRUE);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) VALUES (
  current_setting('acceptance.other')::UUID,
  'authenticated', 'authenticated',
  'branch-setup-acceptance-other@example.invalid', 'acceptance-not-a-login',
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::JSONB,
  '{"full_name":"Branch Setup Acceptance Other"}'::JSONB,
  pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
);

INSERT INTO public.organizations (id, name) VALUES
  (current_setting('acceptance.org_a')::UUID, 'Branch Setup Acceptance A'),
  (current_setting('acceptance.org_b')::UUID, 'Branch Setup Acceptance B');

INSERT INTO public.legal_entities (
  id, organization_id, name, legal_name, default_currency
) VALUES
  (current_setting('acceptance.legal_a')::UUID,
   current_setting('acceptance.org_a')::UUID,
   'Acceptance INR', 'Acceptance INR Pvt Ltd', 'INR'),
  (current_setting('acceptance.legal_usd')::UUID,
   current_setting('acceptance.org_a')::UUID,
   'Acceptance USD', 'Acceptance USD LLC', 'USD'),
  (current_setting('acceptance.legal_b')::UUID,
   current_setting('acceptance.org_b')::UUID,
   'Acceptance Cross Org', 'Acceptance Cross Org Pvt Ltd', 'INR');

INSERT INTO public.organization_memberships (
  organization_id, user_id, role, created_by_user_id
) VALUES (
  current_setting('acceptance.org_a')::UUID,
  current_setting('acceptance.actor')::UUID,
  'owner',
  current_setting('acceptance.actor')::UUID
);

INSERT INTO public.accounts (
  id, name, owner_user_id, organization_id, legal_entity_id,
  branch_status, readiness_state, setup_reviewed_at, setup_reviewed_by,
  default_currency
) VALUES
  (current_setting('acceptance.source')::UUID, 'Acceptance Source',
   current_setting('acceptance.actor')::UUID,
   current_setting('acceptance.org_a')::UUID,
   current_setting('acceptance.legal_a')::UUID,
   'active', 'ready', pg_catalog.now(), current_setting('acceptance.actor')::UUID,
   'INR'),
  (current_setting('acceptance.cross_source')::UUID, 'Acceptance Cross Source',
   current_setting('acceptance.actor')::UUID,
   current_setting('acceptance.org_b')::UUID,
   current_setting('acceptance.legal_b')::UUID,
   'active', 'ready', pg_catalog.now(), current_setting('acceptance.actor')::UUID,
   'INR'),
  (current_setting('acceptance.unreviewed_source')::UUID, 'Acceptance Unreviewed',
   current_setting('acceptance.actor')::UUID,
   current_setting('acceptance.org_a')::UUID,
   current_setting('acceptance.legal_a')::UUID,
   'active', 'attention', NULL, NULL, 'INR');

INSERT INTO public.account_memberships (
  account_id, user_id, role, created_by_user_id
) VALUES
  (current_setting('acceptance.source')::UUID,
   current_setting('acceptance.actor')::UUID, 'owner',
   current_setting('acceptance.actor')::UUID),
  (current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'agent',
   current_setting('acceptance.actor')::UUID),
  (current_setting('acceptance.cross_source')::UUID,
   current_setting('acceptance.actor')::UUID, 'owner',
   current_setting('acceptance.actor')::UUID),
  (current_setting('acceptance.unreviewed_source')::UUID,
   current_setting('acceptance.actor')::UUID, 'owner',
   current_setting('acceptance.actor')::UUID);

-- Positive allowlist plus deliberately excluded inactive rows.
INSERT INTO public.membership_plans (
  id, account_id, name, price, duration_days, description, is_active,
  plan_type, attendance_limit_count, attendance_limit_interval
) VALUES
  ('00000000-0000-4000-8000-00000000e001', current_setting('acceptance.source')::UUID,
   'Acceptance Monthly', 1200, 30, 'active with price', TRUE,
   'recurring', 20, 'month'),
  ('00000000-0000-4000-8000-00000000e002', current_setting('acceptance.source')::UUID,
   'Acceptance No Price', 900, 30, 'active without active price', TRUE,
   'recurring', NULL, NULL),
  ('00000000-0000-4000-8000-00000000e003', current_setting('acceptance.source')::UUID,
   'Acceptance Archived Plan', 500, 7, 'must not copy', FALSE,
   'non_recurring', NULL, NULL);

INSERT INTO public.plan_pricing_options (
  id, account_id, plan_id, duration_count, duration_unit,
  price, setup_fee, is_active, sort_order
) VALUES
  ('00000000-0000-4000-8000-00000000f001', current_setting('acceptance.source')::UUID,
   '00000000-0000-4000-8000-00000000e001', 1, 'month', 1200, 100, TRUE, 0),
  ('00000000-0000-4000-8000-00000000f002', current_setting('acceptance.source')::UUID,
   '00000000-0000-4000-8000-00000000e002', 1, 'month', 900, 0, FALSE, 0);

INSERT INTO public.catalog_items (
  id, account_id, kind, name, description, requires_trainer, is_active, created_by
) VALUES
  ('10000000-0000-4000-8000-000000000001', current_setting('acceptance.source')::UUID,
   'service', 'Acceptance PT', 'trainer + missing standard price', TRUE, TRUE,
   current_setting('acceptance.other')::UUID),
  ('10000000-0000-4000-8000-000000000002', current_setting('acceptance.source')::UUID,
   'merchandise', 'Acceptance Archived Item', 'must not copy', FALSE, FALSE,
   current_setting('acceptance.other')::UUID);

INSERT INTO public.catalog_options (
  id, account_id, item_id, duration_count, duration_unit,
  standard_price, is_active, sort_order
) VALUES
  ('10000000-0000-4000-8000-000000000011', current_setting('acceptance.source')::UUID,
   '10000000-0000-4000-8000-000000000001', 1, 'month', NULL, TRUE, 0),
  ('10000000-0000-4000-8000-000000000012', current_setting('acceptance.source')::UUID,
   '10000000-0000-4000-8000-000000000001', 2, 'month', NULL, FALSE, 1);

INSERT INTO public.lead_field_options (
  id, account_id, field, key, label, color, sort_order
) VALUES (
  '20000000-0000-4000-8000-000000000001', current_setting('acceptance.source')::UUID,
  'status', 'qualified', 'Qualified', '#22c55e', 1
);
INSERT INTO public.tags (id, account_id, user_id, name, color) VALUES (
  '20000000-0000-4000-8000-000000000011', current_setting('acceptance.source')::UUID,
  current_setting('acceptance.other')::UUID, 'Acceptance VIP', '#7c3aed'
);
INSERT INTO public.custom_fields (
  id, account_id, user_id, field_name, field_type, field_options
) VALUES (
  '20000000-0000-4000-8000-000000000021', current_setting('acceptance.source')::UUID,
  current_setting('acceptance.other')::UUID, 'Acceptance Goal', 'select',
  '["Strength","Mobility"]'::JSONB
);
INSERT INTO public.lead_capture_forms (
  id, account_id, token, is_active, headline, intro, consent_text, created_by
) VALUES (
  '20000000-0000-4000-8000-000000000031', current_setting('acceptance.source')::UUID,
  repeat('a', 64), TRUE, 'Join Acceptance Gym', 'Safe intro', 'Safe consent',
  current_setting('acceptance.other')::UUID
);
INSERT INTO public.renewal_reminder_settings (
  account_id, enabled, days_before, service_enabled, service_days_before
) VALUES (
  current_setting('acceptance.source')::UUID, TRUE, ARRAY[9, 2], TRUE, ARRAY[5, 1]
);

-- One valid automation exercises assignment reset, webhook clearing,
-- template review, tag remapping, and custom-field remapping. Two invalid
-- definitions prove whole-definition skips.
INSERT INTO public.automations (
  id, account_id, user_id, name, description, trigger_type, trigger_config,
  is_active, execution_count, last_executed_at
) VALUES
  ('30000000-0000-4000-8000-000000000001', current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'Acceptance Valid Automation', 'copy me',
   'new_contact_created', '{}'::JSONB, TRUE, 42, pg_catalog.now()),
  ('30000000-0000-4000-8000-000000000002', current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'Acceptance Time Automation', 'skip trigger',
   'time_based', '{"timezone":"Asia/Kolkata"}'::JSONB, TRUE, 2, pg_catalog.now()),
  ('30000000-0000-4000-8000-000000000003', current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'Acceptance Deal Automation', 'skip step',
   'new_contact_created', '{}'::JSONB, TRUE, 3, pg_catalog.now());

INSERT INTO public.automation_steps (
  id, automation_id, parent_step_id, branch, step_type, step_config, position
) VALUES
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   NULL, NULL, 'assign_conversation',
   jsonb_build_object('mode','specific','agent_id',current_setting('acceptance.other')), 0),
  ('31000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   NULL, NULL, 'send_webhook',
   '{"url":"https://example.invalid/hook","headers":{"Authorization":"secret"},"body_template":"secret body"}'::JSONB, 1),
  ('31000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001',
   NULL, NULL, 'send_template',
   '{"template_name":"gym_renewal_reminder","language":"en","variables":{"1":"{{name}}"}}'::JSONB, 2),
  ('31000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001',
   NULL, NULL, 'update_contact_field',
   '{"field":"custom:20000000-0000-4000-8000-000000000021","value":"Mobility"}'::JSONB, 3),
  ('31000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001',
   NULL, NULL, 'add_tag',
   '{"tag_id":"20000000-0000-4000-8000-000000000011"}'::JSONB, 4),
  ('31000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000002',
   NULL, NULL, 'send_message', '{"text":"skip"}'::JSONB, 0),
  ('31000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000003',
   NULL, NULL, 'create_deal', '{"title":"skip"}'::JSONB, 0);

-- Valid flow exercises tag remapping, media clearing, and handoff clearing.
-- Manual-trigger and HTTP-node definitions must be skipped whole.
INSERT INTO public.flows (
  id, account_id, user_id, name, description, status, trigger_type,
  trigger_config, entry_node_id, fallback_policy, execution_count, last_executed_at
) VALUES
  ('40000000-0000-4000-8000-000000000001', current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'Acceptance Valid Flow', 'copy me', 'active',
   'keyword', '{"keywords":["join"],"match_type":"exact","case_sensitive":true}'::JSONB,
   'start', '{"on_unknown_reply":"reprompt","max_reprompts":3,"on_timeout_hours":12,"on_exhaust":"end","ignored":"drop"}'::JSONB,
   17, pg_catalog.now()),
  ('40000000-0000-4000-8000-000000000002', current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'Acceptance Manual Flow', 'skip trigger', 'draft',
   'manual', '{}'::JSONB, 'end', '{}'::JSONB, 0, NULL),
  ('40000000-0000-4000-8000-000000000003', current_setting('acceptance.source')::UUID,
   current_setting('acceptance.other')::UUID, 'Acceptance HTTP Flow', 'skip node', 'draft',
   'first_inbound_message', '{}'::JSONB, 'fetch', '{}'::JSONB, 0, NULL);

INSERT INTO public.flow_nodes (
  id, flow_id, node_key, node_type, config, position_x, position_y
) VALUES
  ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'start', 'start', '{"next_node_key":"tag"}'::JSONB, 0, 0),
  ('41000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001',
   'tag', 'set_tag',
   '{"mode":"add","tag_id":"20000000-0000-4000-8000-000000000011","next_node_key":"media"}'::JSONB, 10, 10),
  ('41000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
   'media', 'send_media',
   '{"media_type":"image","media_url":"https://example.invalid/private.jpg","filename":"private.jpg","caption":"Safe caption","next_node_key":"handoff"}'::JSONB, 20, 20),
  ('41000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001',
   'handoff', 'handoff',
   jsonb_build_object('assign_to',current_setting('acceptance.other'),'note','Safe handoff note'), 30, 30),
  ('41000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000002',
   'end', 'end', '{}'::JSONB, 0, 0),
  ('41000000-0000-4000-8000-000000000021', '40000000-0000-4000-8000-000000000003',
   'fetch', 'http_fetch', '{"url":"https://example.invalid/private"}'::JSONB, 0, 0);

-- Operational/authentication/execution rows are present at the source so a
-- zero target count proves exclusion rather than an empty-source coincidence.
INSERT INTO public.contacts (
  id, account_id, user_id, phone, name, created_by
) VALUES (
  '50000000-0000-4000-8000-000000000001', current_setting('acceptance.source')::UUID,
  current_setting('acceptance.other')::UUID, '+919999999991',
  'Acceptance Member', current_setting('acceptance.other')::UUID
);
INSERT INTO public.memberships (
  id, account_id, contact_id, user_id, plan_id, pricing_option_id,
  start_date, end_date, fee_amount, status
) VALUES (
  '50000000-0000-4000-8000-000000000011', current_setting('acceptance.source')::UUID,
  '50000000-0000-4000-8000-000000000001', current_setting('acceptance.other')::UUID,
  '00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000f001',
  CURRENT_DATE, CURRENT_DATE + 30, 1200, 'active'
);
INSERT INTO public.automation_logs (
  id, automation_id, user_id, account_id, trigger_event, status
) VALUES (
  '50000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000001',
  current_setting('acceptance.other')::UUID, current_setting('acceptance.source')::UUID,
  'acceptance', 'success'
);
INSERT INTO public.automation_pending_executions (
  id, automation_id, user_id, account_id, next_step_position, run_at
) VALUES (
  '50000000-0000-4000-8000-000000000031', '30000000-0000-4000-8000-000000000001',
  current_setting('acceptance.other')::UUID, current_setting('acceptance.source')::UUID,
  5, pg_catalog.now() + INTERVAL '1 hour'
);
INSERT INTO public.flow_runs (
  id, flow_id, user_id, contact_id, status, current_node_key, account_id
) VALUES (
  '50000000-0000-4000-8000-000000000041', '40000000-0000-4000-8000-000000000001',
  current_setting('acceptance.other')::UUID, '50000000-0000-4000-8000-000000000001',
  'active', 'start', current_setting('acceptance.source')::UUID
);
INSERT INTO public.whatsapp_config (
  id, account_id, user_id, phone_number_id, access_token, verify_token, status
) VALUES (
  '50000000-0000-4000-8000-000000000051', current_setting('acceptance.source')::UUID,
  current_setting('acceptance.other')::UUID, 'acceptance-phone-id',
  'acceptance-secret-token', 'acceptance-verify-token', 'connected'
);

CREATE TEMP TABLE branch_setup_source_before AS
SELECT private.branch_setup_source_snapshot(
  current_setting('acceptance.source')::UUID,
  ARRAY['membership_catalog','lead_setup','reminders','automations','flows']::TEXT[]
) AS snapshot;

-- A trigger mutation after target-account insert proves all analysis/inserts
-- use the already-built coherent snapshot. A second branch forces a statement
-- error after account insert to prove request/account/config/audit rollback.
CREATE OR REPLACE FUNCTION pg_temp.branch_setup_acceptance_account_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.name = 'Acceptance Snapshot Copy' THEN
    UPDATE public.tags
    SET name = 'Changed after snapshot'
    WHERE id = '20000000-0000-4000-8000-000000000011'::UUID;
  ELSIF NEW.name = 'Acceptance Forced Failure' THEN
    RAISE EXCEPTION 'acceptance forced failure after account insert';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_branch_setup_acceptance_account_trigger
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION pg_temp.branch_setup_acceptance_account_trigger();

-- Static database contract acceptance.
DO $$
DECLARE
  v_proc REGPROCEDURE;
BEGIN
  PERFORM pg_temp.assert_true(
    to_regclass('private.branch_creation_requests') IS NOT NULL,
    'private request ledger must exist'
  );
  PERFORM pg_temp.assert_true(
    (SELECT relrowsecurity FROM pg_class WHERE oid='private.branch_creation_requests'::REGCLASS),
    'private request ledger must have RLS enabled'
  );
  PERFORM pg_temp.assert_true(
    NOT has_table_privilege('authenticated','private.branch_creation_requests','SELECT')
    AND NOT has_table_privilege('service_role','private.branch_creation_requests','SELECT'),
    'private request ledger must not be client/service-role readable'
  );
  PERFORM pg_temp.assert_true(
    (SELECT confdeltype='c'
     FROM pg_constraint
     WHERE conrelid='private.branch_creation_requests'::REGCLASS
       AND conname='branch_creation_requests_actor_user_id_fkey'),
    'actor deletion must be catalog-declared CASCADE'
  );

  FOREACH v_proc IN ARRAY ARRAY[
    'public.preview_organization_branch_setup(uuid,uuid,text,uuid,text[])'::REGPROCEDURE,
    'public.create_organization_branch_from_setup(uuid,uuid,uuid,text,text,uuid,text[])'::REGPROCEDURE,
    'public.create_organization_branch(uuid,uuid,text)'::REGPROCEDURE,
    'public.complete_organization_branch_setup(uuid,boolean)'::REGPROCEDURE,
    'public.restore_branch(uuid)'::REGPROCEDURE,
    'public.my_branch_accounts()'::REGPROCEDURE
  ] LOOP
    PERFORM pg_temp.assert_true(
      (SELECT prosecdef FROM pg_proc WHERE oid=v_proc),
      v_proc::TEXT || ' must be SECURITY DEFINER'
    );
    PERFORM pg_temp.assert_true(
      (SELECT proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid=v_proc),
      v_proc::TEXT || ' must have an empty search_path'
    );
    PERFORM pg_temp.assert_true(
      has_function_privilege('authenticated', v_proc, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_proc, 'EXECUTE')
      AND NOT has_function_privilege('service_role', v_proc, 'EXECUTE'),
      v_proc::TEXT || ' grants must be authenticated-only'
    );
  END LOOP;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('acceptance.actor'),
    'role', 'authenticated'
  )::TEXT,
  TRUE
);
SELECT set_config(
  'request.headers',
  jsonb_build_object(
    'x-usefuldesk-account-id', current_setting('acceptance.source'),
    'x-acceptance-context', 'branch-setup-stage-4'
  )::TEXT,
  TRUE
);

-- Protected lifecycle/review fields are function-only while allowlisted
-- account settings remain editable under branch RLS.
DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
  v_rows INTEGER;
BEGIN
  BEGIN
    UPDATE public.accounts
    SET readiness_state='setup', setup_reviewed_at=NULL
    WHERE id=current_setting('acceptance.source')::UUID;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_blocked, 'direct readiness/review update must be denied');

  UPDATE public.accounts SET name='Acceptance Source Renamed'
  WHERE id=current_setting('acceptance.source')::UUID;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=1, 'allowlisted account name update must work');
  UPDATE public.accounts SET name='Acceptance Source'
  WHERE id=current_setting('acceptance.source')::UUID;
END;
$$;

-- Caller, tenant, source-readiness, pack, and currency validation.
DO $$
DECLARE
  v_failed BOOLEAN;
BEGIN
  v_failed := FALSE;
  BEGIN
    PERFORM public.preview_organization_branch_setup(
      current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_b')::UUID,
      'blank', NULL, ARRAY[]::TEXT[]
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'cross-organization legal entity must fail');

  v_failed := FALSE;
  BEGIN
    PERFORM public.preview_organization_branch_setup(
      current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_a')::UUID,
      'copy', current_setting('acceptance.cross_source')::UUID,
      ARRAY['lead_setup']::TEXT[]
    );
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '42501' THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'cross-organization source must fail');

  v_failed := FALSE;
  BEGIN
    PERFORM public.create_organization_branch_from_setup(
      gen_random_uuid(), current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_a')::UUID,
      'Bad Unreviewed', 'copy', current_setting('acceptance.unreviewed_source')::UUID,
      ARRAY['lead_setup']::TEXT[]
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'unreviewed/attention source must fail');

  v_failed := FALSE;
  BEGIN
    PERFORM public.create_organization_branch_from_setup(
      gen_random_uuid(), current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_usd')::UUID,
      'Bad Currency', 'copy', current_setting('acceptance.source')::UUID,
      ARRAY['membership_catalog']::TEXT[]
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'membership/catalog currency mismatch must fail');

  v_failed := FALSE;
  BEGIN
    PERFORM public.preview_organization_branch_setup(
      current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_a')::UUID,
      'copy', current_setting('acceptance.source')::UUID,
      ARRAY['unknown_pack']::TEXT[]
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'unknown pack must fail closed');
END;
$$;

DO $$
DECLARE
  v_preview JSONB;
  v_response JSONB;
  v_replay JSONB;
  v_request UUID := '60000000-0000-4000-8000-000000000001';
  v_target UUID;
  v_failed BOOLEAN;
  v_warning_codes TEXT[];
  v_rows INTEGER;
  v_target_tag UUID;
  v_target_custom UUID;
BEGIN
  v_preview := public.preview_organization_branch_setup(
    current_setting('acceptance.org_a')::UUID,
    current_setting('acceptance.legal_a')::UUID,
    'copy', current_setting('acceptance.source')::UUID,
    ARRAY['flows','automations','reminders','lead_setup','membership_catalog','flows']::TEXT[]
  );
  PERFORM pg_temp.assert_true((v_preview->>'eligible')::BOOLEAN, 'full preview must be eligible');
  PERFORM pg_temp.assert_true(
    v_preview->'packs' = '["automations","flows","lead_setup","membership_catalog","reminders"]'::JSONB,
    'packs must be deduplicated and canonicalized'
  );
  PERFORM pg_temp.assert_true(
    v_preview->'copied'->>'totalRows' = '21'
    AND v_preview->'copied'->'breakdown' =
      '{"membershipPlans":2,"planPricingOptions":1,"catalogItems":1,"catalogOptions":1,"leadFieldOptions":1,"tags":1,"customFields":1,"leadForms":1,"reminderSettings":1,"automations":1,"automationSteps":5,"flows":1,"flowNodes":4}'::JSONB,
    'preview counts must match the allowlist exactly'
  );
  PERFORM pg_temp.assert_true(
    v_preview->'skipped' = '{"automations":2,"flows":2}'::JSONB,
    'preview skipped definition counts must be exact'
  );
  PERFORM pg_temp.assert_true(
    v_preview->'exclusions' =
      '["operational_records","staff_access","credentials","provider_state","storage_objects","execution_history","historical_authorship"]'::JSONB,
    'preview exclusion inventory must stay fixed'
  );

  v_response := public.create_organization_branch_from_setup(
    v_request,
    current_setting('acceptance.org_a')::UUID,
    current_setting('acceptance.legal_a')::UUID,
    'Acceptance Copied Branch', 'copy',
    current_setting('acceptance.source')::UUID,
    ARRAY['flows','automations','reminders','lead_setup','membership_catalog']::TEXT[]
  );
  v_target := (v_response->>'accountId')::UUID;
  PERFORM set_config('acceptance.target', v_target::TEXT, TRUE);
  PERFORM set_config(
    'request.headers',
    jsonb_build_object('x-usefuldesk-account-id',v_target::TEXT)::TEXT,
    TRUE
  );

  PERFORM pg_temp.assert_true(v_response->>'readinessState'='setup', 'new branch must start in setup');
  PERFORM pg_temp.assert_true(v_response->'setupReviewedAt'='null'::JSONB, 'new branch must be unreviewed');
  PERFORM pg_temp.assert_true(v_response->'credentialsCloned'='false'::JSONB, 'credentialsCloned must be false');
  PERFORM pg_temp.assert_true(v_response->'copied'=v_preview->'copied', 'preview/create counts must match');
  PERFORM pg_temp.assert_true(v_response->'systemSeeded'->>'expenseCategories'='9', 'expense trigger must seed nine defaults');

  SELECT array_agg(w->>'code' ORDER BY w->>'code') INTO v_warning_codes
  FROM jsonb_array_elements(v_response->'warnings') w;
  PERFORM pg_temp.assert_true(
    v_warning_codes = ARRAY[
      'AUTOMATION_ASSIGNMENT_RESET','AUTOMATION_SKIPPED_UNSUPPORTED_STEP',
      'AUTOMATION_SKIPPED_UNSUPPORTED_TRIGGER','AUTOMATION_TEMPLATE_REVIEW_REQUIRED',
      'AUTOMATION_WEBHOOK_CLEARED','CATALOG_STANDARD_PRICE_MISSING',
      'CATALOG_TRAINER_REQUIRED','FLOW_HANDOFF_CLEARED','FLOW_MEDIA_CLEARED',
      'FLOW_SKIPPED_UNSUPPORTED_NODE','FLOW_SKIPPED_UNSUPPORTED_TRIGGER',
      'LEAD_FORM_DISABLED','PLAN_WITHOUT_ACTIVE_PRICE','REMINDERS_DISABLED'
    ]::TEXT[],
    'warning codes must be complete and stable'
  );
  PERFORM pg_temp.assert_true(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_response->'warnings') w
      WHERE w ?| ARRAY['sourceAccountId','displayName','accountId','name']
         OR (w->>'count')::INTEGER <> 1
    ),
    'stored warnings must contain only stable non-source context and exact counts'
  );
  PERFORM pg_temp.assert_true(
    (SELECT details->'warnings' FROM public.organization_audit_log
      WHERE account_id=v_target AND operation='branch.created') = v_response->'warnings',
    'audit warning storage must match the response'
  );
  PERFORM set_config('acceptance.expected_warnings', (v_response->'warnings')::TEXT, TRUE);

  v_replay := public.create_organization_branch_from_setup(
    v_request,
    current_setting('acceptance.org_a')::UUID,
    current_setting('acceptance.legal_a')::UUID,
    'Acceptance Copied Branch', 'copy',
    current_setting('acceptance.source')::UUID,
    ARRAY['membership_catalog','lead_setup','reminders','automations','flows']::TEXT[]
  );
  PERFORM pg_temp.assert_true(
    v_replay->>'accountId'=v_target::TEXT AND (v_replay->>'replayed')::BOOLEAN,
    'equal request replay must return the same branch'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.accounts WHERE id=v_target)=1
    AND (SELECT count(*) FROM public.organization_audit_log WHERE account_id=v_target AND operation='branch.created')=1,
    'replay must not duplicate account or audit'
  );
  v_failed := FALSE;
  BEGIN
    PERFORM public.create_organization_branch_from_setup(
      v_request, current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_a')::UUID,
      'Acceptance Mismatched Replay', 'blank', NULL, ARRAY[]::TEXT[]
    );
  EXCEPTION WHEN unique_violation THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'mismatched request reuse must conflict');

  -- ID remapping, target authorship, state resets, and reference sanitation.
  SELECT id INTO v_target_tag FROM public.tags WHERE account_id=v_target AND name='Acceptance VIP';
  SELECT id INTO v_target_custom FROM public.custom_fields WHERE account_id=v_target AND field_name='Acceptance Goal';
  PERFORM pg_temp.assert_true(v_target_tag IS NOT NULL AND v_target_tag <> '20000000-0000-4000-8000-000000000011'::UUID, 'tag ID must remap');
  PERFORM pg_temp.assert_true(v_target_custom IS NOT NULL AND v_target_custom <> '20000000-0000-4000-8000-000000000021'::UUID, 'custom field ID must remap');
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM public.membership_plans WHERE account_id=v_target AND id IN ('00000000-0000-4000-8000-00000000e001','00000000-0000-4000-8000-00000000e002'))
    AND EXISTS (
      SELECT 1 FROM public.plan_pricing_options o JOIN public.membership_plans p ON p.id=o.plan_id
      WHERE o.account_id=v_target AND p.account_id=v_target
    ),
    'plan and pricing IDs must remap with target-local parents'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.automations WHERE account_id=v_target)=1
    AND (SELECT bool_and(NOT is_active AND execution_count=0 AND last_executed_at IS NULL AND user_id=current_setting('acceptance.actor')::UUID) FROM public.automations WHERE account_id=v_target),
    'only valid automation must copy as inactive actor-authored reset state'
  );
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1 FROM public.automation_steps s JOIN public.automations a ON a.id=s.automation_id
      WHERE a.account_id=v_target AND s.step_type='assign_conversation'
        AND s.step_config='{"mode":"round_robin"}'::JSONB
    )
    AND EXISTS (
      SELECT 1 FROM public.automation_steps s JOIN public.automations a ON a.id=s.automation_id
      WHERE a.account_id=v_target AND s.step_type='send_webhook'
        AND s.step_config='{"url":"","headers":{},"body_template":""}'::JSONB
    )
    AND EXISTS (
      SELECT 1 FROM public.automation_steps s JOIN public.automations a ON a.id=s.automation_id
      WHERE a.account_id=v_target AND s.step_type='update_contact_field'
        AND s.step_config->>'field'='custom:' || v_target_custom::TEXT
    )
    AND EXISTS (
      SELECT 1 FROM public.automation_steps s JOIN public.automations a ON a.id=s.automation_id
      WHERE a.account_id=v_target AND s.step_type='add_tag'
        AND s.step_config->>'tag_id'=v_target_tag::TEXT
    ),
    'automation secrets/assignments must clear and references must remap'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.flows WHERE account_id=v_target)=1
    AND (SELECT bool_and(status='draft' AND execution_count=0 AND last_executed_at IS NULL AND user_id=current_setting('acceptance.actor')::UUID) FROM public.flows WHERE account_id=v_target),
    'only valid flow must copy as actor-authored draft reset state'
  );
  PERFORM pg_temp.assert_true(
    EXISTS (
      SELECT 1 FROM public.flow_nodes n JOIN public.flows f ON f.id=n.flow_id
      WHERE f.account_id=v_target AND n.node_type='set_tag'
        AND n.config->>'tag_id'=v_target_tag::TEXT
    )
    AND EXISTS (
      SELECT 1 FROM public.flow_nodes n JOIN public.flows f ON f.id=n.flow_id
      WHERE f.account_id=v_target AND n.node_type='send_media'
        AND n.config->>'media_url'='' AND n.config->>'filename'=''
        AND n.config->>'caption'='Safe caption'
    )
    AND EXISTS (
      SELECT 1 FROM public.flow_nodes n JOIN public.flows f ON f.id=n.flow_id
      WHERE f.account_id=v_target AND n.node_type='handoff'
        AND NOT (n.config ? 'assign_to') AND n.config->>'note'='Safe handoff note'
    ),
    'flow references must remap and assignments/media secrets must clear'
  );
  PERFORM pg_temp.assert_true(
    (SELECT enabled=FALSE AND service_enabled=FALSE AND days_before=ARRAY[9,2] AND service_days_before=ARRAY[5,1]
     FROM public.renewal_reminder_settings WHERE account_id=v_target),
    'reminder timing must copy disabled'
  );
  PERFORM pg_temp.assert_true(
    (SELECT length(token)=64 AND token ~ '^[0-9a-f]{64}$' AND NOT is_active
            AND revoked_at IS NOT NULL AND token <> repeat('a',64)
     FROM public.lead_capture_forms WHERE account_id=v_target),
    'lead form must receive a fresh revoked 256-bit token'
  );

  -- Positive allowlist means every operational/credential/runtime table stays empty.
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.account_memberships WHERE account_id=v_target)=1
    AND (SELECT count(*) FROM public.contacts WHERE account_id=v_target)=0
    AND (SELECT count(*) FROM public.memberships WHERE account_id=v_target)=0
    AND (SELECT count(*) FROM public.payments WHERE account_id=v_target)=0
    AND (SELECT count(*) FROM public.whatsapp_config WHERE account_id=v_target)=0
    AND (SELECT count(*) FROM public.automation_logs WHERE account_id=v_target)=0
    AND (SELECT count(*) FROM public.automation_pending_executions WHERE account_id=v_target)=0
    AND (SELECT count(*) FROM public.flow_runs WHERE account_id=v_target)=0,
    'staff, operational records, credentials, and execution history must not copy'
  );

END;
$$;

RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT snapshot FROM branch_setup_source_before) = private.branch_setup_source_snapshot(
    current_setting('acceptance.source')::UUID,
    ARRAY['membership_catalog','lead_setup','reminders','automations','flows']::TEXT[]
  ),
  'source snapshot must be immutable during normal copy'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('acceptance.actor'),'role','authenticated')::TEXT,
  TRUE
);
SELECT set_config(
  'request.headers',
  jsonb_build_object('x-usefuldesk-account-id',current_setting('acceptance.source'))::TEXT,
  TRUE
);

-- Authorship RLS: an admin/owner may delete another author's definition but
-- cannot edit it; child write permission inherits the parent author.
DO $$
DECLARE
  v_rows INTEGER;
  v_blocked BOOLEAN := FALSE;
BEGIN
  UPDATE public.automations SET name='Forbidden edit'
  WHERE id='30000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=0, 'non-author admin must not edit automation');

  UPDATE public.automation_steps SET position=99
  WHERE id='31000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=0, 'non-author admin must not edit automation child');

  UPDATE public.flows SET name='Forbidden edit'
  WHERE id='40000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=0, 'non-author admin must not edit flow');

  UPDATE public.flow_nodes SET position_x=99
  WHERE id='41000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=0, 'non-author admin must not edit flow child');
END;
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('acceptance.other'),'role','authenticated')::TEXT,
  TRUE
);
DO $$
DECLARE
  v_rows INTEGER;
  v_blocked BOOLEAN := FALSE;
BEGIN
  UPDATE public.automations SET name='Acceptance Valid Automation Authored'
  WHERE id='30000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=1, 'author must edit automation');
  UPDATE public.automation_steps SET position=6
  WHERE id='31000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.assert_true(v_rows=1, 'author must edit automation child');

  BEGIN
    UPDATE public.automations
    SET user_id=current_setting('acceptance.actor')::UUID
    WHERE id='30000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_blocked, 'authored parent identity must be immutable');

  v_blocked := FALSE;
  BEGIN
    UPDATE public.automation_steps
    SET automation_id='30000000-0000-4000-8000-000000000002'
    WHERE id='31000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_blocked, 'authored child parent must be immutable');
END;
$$;

-- Return to the organization owner for snapshot, completion, rollback, and
-- deletion acceptance.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('acceptance.actor'),'role','authenticated')::TEXT,
  TRUE
);
SELECT set_config(
  'request.headers',
  jsonb_build_object('x-usefuldesk-account-id',current_setting('acceptance.source'))::TEXT,
  TRUE
);

DO $$
DECLARE
  v_response JSONB;
  v_target UUID;
  v_request UUID := '60000000-0000-4000-8000-000000000002';
BEGIN
  v_response := public.create_organization_branch_from_setup(
    v_request, current_setting('acceptance.org_a')::UUID,
    current_setting('acceptance.legal_a')::UUID,
    'Acceptance Snapshot Copy', 'copy', current_setting('acceptance.source')::UUID,
    ARRAY['lead_setup']::TEXT[]
  );
  v_target := (v_response->>'accountId')::UUID;
  PERFORM set_config('acceptance.snapshot_target',v_target::TEXT,TRUE);
  PERFORM set_config(
    'request.headers',
    jsonb_build_object('x-usefuldesk-account-id',v_target::TEXT)::TEXT,
    TRUE
  );
  PERFORM pg_temp.assert_true(
    (SELECT name FROM public.tags WHERE account_id=v_target)='Acceptance VIP',
    'target must use one coherent pre-mutation snapshot'
  );
END;
$$;

RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT name FROM public.tags
   WHERE id='20000000-0000-4000-8000-000000000011')='Changed after snapshot',
  'snapshot acceptance trigger must mutate the source after capture'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',current_setting('acceptance.actor'),'role','authenticated')::TEXT,
  TRUE
);

-- Completion uses selected target context, revalidates the active plan+price
-- prerequisite on every call, and creates only one completion audit.
SELECT set_config(
  'request.headers',
  jsonb_build_object('x-usefuldesk-account-id',current_setting('acceptance.target'))::TEXT,
  TRUE
);
DO $$
DECLARE
  v_first JSONB;
  v_second JSONB;
  v_failed BOOLEAN := FALSE;
BEGIN
  v_first := public.complete_organization_branch_setup(
    current_setting('acceptance.target')::UUID, TRUE
  );
  v_second := public.complete_organization_branch_setup(
    current_setting('acceptance.target')::UUID, TRUE
  );
  PERFORM pg_temp.assert_true(
    NOT (v_first->>'alreadyComplete')::BOOLEAN
    AND (v_second->>'alreadyComplete')::BOOLEAN
    AND v_first->>'setupReviewedBy'=current_setting('acceptance.actor')
    AND (SELECT readiness_state='ready' AND setup_reviewed_at IS NOT NULL
         FROM public.accounts WHERE id=current_setting('acceptance.target')::UUID)
    AND (SELECT count(*) FROM public.organization_audit_log
         WHERE account_id=current_setting('acceptance.target')::UUID
           AND operation='branch.setup_completed')=1,
    'completion and idempotent completion audit must be exact'
  );

  UPDATE public.plan_pricing_options SET is_active=FALSE
  WHERE account_id=current_setting('acceptance.target')::UUID;
  BEGIN
    PERFORM public.complete_organization_branch_setup(
      current_setting('acceptance.target')::UUID, TRUE
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := TRUE;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'already-complete branch must revalidate active pricing');
END;
$$;

-- Forced post-account-insert failure must leave no request, account, seeded
-- expense rows, configuration, or audit row.
SELECT set_config(
  'request.headers',
  jsonb_build_object('x-usefuldesk-account-id',current_setting('acceptance.source'))::TEXT,
  TRUE
);
DO $$
DECLARE
  v_request UUID := '60000000-0000-4000-8000-000000000003';
  v_failed BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.create_organization_branch_from_setup(
      v_request, current_setting('acceptance.org_a')::UUID,
      current_setting('acceptance.legal_a')::UUID,
      'Acceptance Forced Failure', 'copy', current_setting('acceptance.source')::UUID,
      ARRAY['lead_setup']::TEXT[]
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%acceptance forced failure%' THEN v_failed := TRUE; ELSE RAISE; END IF;
  END;
  PERFORM pg_temp.assert_true(v_failed, 'forced failure trigger must fire');
END;
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM private.branch_creation_requests
              WHERE actor_user_id=current_setting('acceptance.actor')::UUID
                AND request_id='60000000-0000-4000-8000-000000000003'::UUID)
  AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE name='Acceptance Forced Failure')
  AND NOT EXISTS (SELECT 1 FROM public.organization_audit_log
                  WHERE operation='branch.created'
                    AND details->>'request_id'='60000000-0000-4000-8000-000000000003'),
  'forced failure must roll back the full creation transaction'
);

SELECT pg_temp.assert_true(
  (SELECT response->'warnings'
   FROM private.branch_creation_requests
   WHERE actor_user_id=current_setting('acceptance.actor')::UUID
     AND request_id='60000000-0000-4000-8000-000000000001'::UUID)
    = current_setting('acceptance.expected_warnings')::JSONB,
  'private idempotency warning storage must match the response'
);

-- Foreign-key deletion behavior: source deletion nulls the replay reference,
-- target deletion removes replay state, and actor deletion cascades requests.
DO $$
DECLARE
  v_source UUID := '70000000-0000-4000-8000-000000000001';
  v_source_request UUID := '70000000-0000-4000-8000-000000000011';
BEGIN
  INSERT INTO public.accounts (
    id,name,owner_user_id,organization_id,legal_entity_id,default_currency
  ) VALUES (
    v_source,'Acceptance Deletable Source',current_setting('acceptance.actor')::UUID,
    current_setting('acceptance.org_a')::UUID,current_setting('acceptance.legal_a')::UUID,'INR'
  );
  INSERT INTO private.branch_creation_requests (
    actor_user_id,request_id,organization_id,legal_entity_id,source_account_id,normalized_request
  ) VALUES (
    current_setting('acceptance.actor')::UUID,v_source_request,
    current_setting('acceptance.org_a')::UUID,current_setting('acceptance.legal_a')::UUID,
    v_source,'{"test":"source-delete"}'::JSONB
  );
  DELETE FROM public.accounts WHERE id=v_source;
  PERFORM pg_temp.assert_true(
    (SELECT source_account_id IS NULL FROM private.branch_creation_requests
     WHERE actor_user_id=current_setting('acceptance.actor')::UUID AND request_id=v_source_request),
    'source deletion must retain replay row and null only source reference'
  );

  DELETE FROM public.account_memberships WHERE account_id=current_setting('acceptance.target')::UUID;
  DELETE FROM public.accounts WHERE id=current_setting('acceptance.target')::UUID;
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM private.branch_creation_requests
      WHERE created_account_id=current_setting('acceptance.target')::UUID),
    'target deletion must cascade replay state'
  );
END;
$$;

ROLLBACK;

SELECT jsonb_build_object(
  'status', 'passed',
  'suite', 'organization_branch_setup_copy',
  'rollbackScoped', TRUE,
  'authenticatedJwtAndHeaderContext', TRUE,
  'assertionGroups', ARRAY[
    'protected_accounts', 'caller_and_tenant_validation',
    'authorship_rls_and_children', 'id_remapping_and_source_immutability',
    'allowlist_and_exclusions', 'automation_and_flow_sanitization',
    'exact_counts_and_warnings', 'grants_and_search_paths',
    'request_source_target_deletion', 'coherent_snapshot',
    'seeded_expense_categories', 'forced_failure_rollback',
    'completion_revalidation'
  ]
) AS acceptance;
