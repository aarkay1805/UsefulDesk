BEGIN;

-- Run only after the gym-name signup migration is applied through the approved
-- Supabase migration connector. Every fixture and mutation is transaction-local
-- and rolled back. The probe sends no messages and invokes no external provider.

CREATE OR REPLACE FUNCTION pg_temp.assert_gym_name_signup(
  p_condition BOOLEAN,
  p_message TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'gym-name signup verification failed: %', p_message;
  END IF;
END;
$function$;

SELECT pg_temp.assert_gym_name_signup(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'name_setup_completed_at'
      AND is_nullable = 'YES'
      AND data_type = 'timestamp with time zone'
  ),
  'nullable organization completion column is missing'
);

SELECT pg_temp.assert_gym_name_signup(
  (SELECT pg_catalog.min(name_setup_completed_at) FROM public.organizations)
    IS NOT NULL,
  'no grandfathered organization timestamp was found'
);

SELECT pg_temp.assert_gym_name_signup(
  NOT EXISTS (
    SELECT 1
    FROM public.organizations organization
    WHERE organization.name_setup_completed_at IS NULL
      AND organization.created_at < (
        SELECT pg_catalog.min(existing.name_setup_completed_at)
        FROM public.organizations existing
      )
  ),
  'an organization predating the backfill remains pending'
);

SELECT pg_temp.assert_gym_name_signup(
  has_function_privilege(
    'authenticated',
    'public.complete_organization_name_setup(uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.complete_organization_name_setup(uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.complete_organization_name_setup(uuid,text)',
    'EXECUTE'
  ),
  'completion RPC execution grants are incorrect'
);

SELECT pg_temp.assert_gym_name_signup(
  has_function_privilege('authenticated', 'public.my_branch_accounts()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_branch_accounts()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.my_branch_accounts()', 'EXECUTE'),
  'branch projection execution grants are incorrect'
);

SELECT pg_temp.assert_gym_name_signup(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'complete_organization_name_setup'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
  ),
  'completion RPC must be SECURITY DEFINER with an empty search_path'
);

SELECT set_config('gym_probe.email_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.pending_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.admin_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.agent_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.viewer_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.outsider_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.branch_owner_only_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.org_owner_only_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.multi_branch_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);
SELECT set_config('gym_probe.multi_entity_user', pg_catalog.gen_random_uuid()::TEXT, TRUE);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) VALUES
  (
    current_setting('gym_probe.email_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-email-' || current_setting('gym_probe.email_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    pg_catalog.jsonb_build_object(
      'full_name', '  Email Owner  ',
      'gym_name', U&'\00A0Pulse \+01F3CB\FE0F Fitness\FEFF',
      'country_code', 'GB',
      'locale', 'en-GB',
      'default_currency', 'GBP',
      'timezone', 'Europe/London',
      'date_order', 'DMY',
      'time_format', '24h',
      'week_start', '1',
      'phone_country_code', '+44',
      'measurement_system', 'metric'
    ),
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.pending_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-pending-' || current_setting('gym_probe.pending_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"google","providers":["google"]}'::JSONB,
    '{"name":"Google Owner"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.admin_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-admin-' || current_setting('gym_probe.admin_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Completed Branch Admin"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.agent_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-agent-' || current_setting('gym_probe.agent_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Completed Branch Agent"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.viewer_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-viewer-' || current_setting('gym_probe.viewer_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Completed Branch Viewer"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.outsider_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-outsider-' || current_setting('gym_probe.outsider_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Branch Outsider"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.branch_owner_only_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-branch-owner-' || current_setting('gym_probe.branch_owner_only_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Branch Owner Only"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.org_owner_only_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-org-owner-' || current_setting('gym_probe.org_owner_only_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Organization Owner Only"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.multi_branch_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-multi-branch-' || current_setting('gym_probe.multi_branch_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Multi Branch Owner"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  ),
  (
    current_setting('gym_probe.multi_entity_user')::UUID,
    'authenticated', 'authenticated',
    'gym-name-multi-entity-' || current_setting('gym_probe.multi_entity_user') || '@example.invalid',
    'rollback-probe-not-a-login', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"full_name":"Multi Entity Owner"}'::JSONB,
    pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
  );

SELECT set_config('gym_probe.email_account', profile.account_id::TEXT, TRUE),
       set_config('gym_probe.email_org', account.organization_id::TEXT, TRUE),
       set_config('gym_probe.email_legal', account.legal_entity_id::TEXT, TRUE)
FROM public.profiles profile
JOIN public.accounts account ON account.id = profile.account_id
WHERE profile.user_id = current_setting('gym_probe.email_user')::UUID;

SELECT set_config('gym_probe.pending_account', profile.account_id::TEXT, TRUE),
       set_config('gym_probe.pending_org', account.organization_id::TEXT, TRUE),
       set_config('gym_probe.pending_legal', account.legal_entity_id::TEXT, TRUE)
FROM public.profiles profile
JOIN public.accounts account ON account.id = profile.account_id
WHERE profile.user_id = current_setting('gym_probe.pending_user')::UUID;

SELECT set_config('gym_probe.multi_branch_account', profile.account_id::TEXT, TRUE),
       set_config('gym_probe.multi_branch_org', account.organization_id::TEXT, TRUE),
       set_config('gym_probe.multi_branch_legal', account.legal_entity_id::TEXT, TRUE)
FROM public.profiles profile
JOIN public.accounts account ON account.id = profile.account_id
WHERE profile.user_id = current_setting('gym_probe.multi_branch_user')::UUID;

SELECT set_config('gym_probe.multi_entity_account', profile.account_id::TEXT, TRUE),
       set_config('gym_probe.multi_entity_org', account.organization_id::TEXT, TRUE)
FROM public.profiles profile
JOIN public.accounts account ON account.id = profile.account_id
WHERE profile.user_id = current_setting('gym_probe.multi_entity_user')::UUID;

SELECT pg_temp.assert_gym_name_signup(
  EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.accounts account ON account.id = profile.account_id
    JOIN public.organizations organization ON organization.id = account.organization_id
    JOIN public.legal_entities legal_entity ON legal_entity.id = account.legal_entity_id
    WHERE profile.user_id = current_setting('gym_probe.email_user')::UUID
      AND profile.full_name = 'Email Owner'
      AND account.name = U&'Pulse \+01F3CB\FE0F Fitness'
      AND organization.name = U&'Pulse \+01F3CB\FE0F Fitness'
      AND legal_entity.name = U&'Pulse \+01F3CB\FE0F Fitness'
      AND legal_entity.legal_name = U&'Pulse \+01F3CB\FE0F Fitness'
      AND organization.name_setup_completed_at IS NOT NULL
      AND account.country_code = 'GB'
      AND account.locale = 'en-GB'
      AND account.default_currency = 'GBP'
      AND account.timezone = 'Europe/London'
      AND account.date_order = 'DMY'
      AND account.time_format = '24h'
      AND account.week_start = 1
      AND account.phone_country_code = '+44'
      AND account.measurement_system = 'metric'
  ),
  'email provisioning did not preserve person, business, and locale identities'
);

SELECT pg_temp.assert_gym_name_signup(
  EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.accounts account ON account.id = profile.account_id
    JOIN public.organizations organization ON organization.id = account.organization_id
    JOIN public.legal_entities legal_entity ON legal_entity.id = account.legal_entity_id
    WHERE profile.user_id = current_setting('gym_probe.pending_user')::UUID
      AND profile.full_name = 'Google Owner'
      AND account.name = 'Google Owner'
      AND organization.name = 'Google Owner'
      AND legal_entity.name = 'Google Owner'
      AND legal_entity.legal_name = 'Google Owner'
      AND organization.name_setup_completed_at IS NULL
  ),
  'missing gym_name did not create an atomic provisional tenant'
);

DO $function$
DECLARE
  v_rejected BOOLEAN;
  v_user UUID;
  v_metadata JSONB;
BEGIN
  FOREACH v_metadata IN ARRAY ARRAY[
    pg_catalog.jsonb_build_object('full_name', 'Malformed', 'gym_name', U&'\00A0\FEFF'),
    pg_catalog.jsonb_build_object('full_name', 'Malformed', 'gym_name', pg_catalog.repeat(U&'\+01F600', 81)),
    pg_catalog.jsonb_build_object('full_name', 'Malformed', 'gym_name', 123)
  ]::JSONB[]
  LOOP
    v_rejected := FALSE;
    v_user := pg_catalog.gen_random_uuid();
    BEGIN
      INSERT INTO auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        is_sso_user, is_anonymous
      ) VALUES (
        v_user, 'authenticated', 'authenticated',
        'gym-name-malformed-' || v_user || '@example.invalid',
        'rollback-probe-not-a-login', pg_catalog.now(),
        '{"provider":"email","providers":["email"]}'::JSONB,
        v_metadata,
        pg_catalog.now(), pg_catalog.now(), FALSE, FALSE
      );
    EXCEPTION WHEN invalid_parameter_value THEN
      v_rejected := TRUE;
    END;
    PERFORM pg_temp.assert_gym_name_signup(
      v_rejected,
      'present malformed gym_name was accepted'
    );
  END LOOP;
END;
$function$;

INSERT INTO public.account_memberships (
  account_id, user_id, role, created_by_user_id
) VALUES
  (
    current_setting('gym_probe.email_account')::UUID,
    current_setting('gym_probe.admin_user')::UUID,
    'admin', current_setting('gym_probe.email_user')::UUID
  ),
  (
    current_setting('gym_probe.email_account')::UUID,
    current_setting('gym_probe.agent_user')::UUID,
    'agent', current_setting('gym_probe.email_user')::UUID
  ),
  (
    current_setting('gym_probe.email_account')::UUID,
    current_setting('gym_probe.viewer_user')::UUID,
    'viewer', current_setting('gym_probe.email_user')::UUID
  ),
  (
    current_setting('gym_probe.pending_account')::UUID,
    current_setting('gym_probe.branch_owner_only_user')::UUID,
    'owner', current_setting('gym_probe.pending_user')::UUID
  ),
  (
    current_setting('gym_probe.pending_account')::UUID,
    current_setting('gym_probe.org_owner_only_user')::UUID,
    'admin', current_setting('gym_probe.pending_user')::UUID
  );

INSERT INTO public.organization_memberships (
  organization_id, user_id, role, created_by_user_id
) VALUES (
  current_setting('gym_probe.pending_org')::UUID,
  current_setting('gym_probe.org_owner_only_user')::UUID,
  'owner', current_setting('gym_probe.pending_user')::UUID
);

INSERT INTO public.accounts (
  name, owner_user_id, organization_id, legal_entity_id,
  country_code, locale, default_currency, timezone,
  date_order, time_format, week_start, phone_country_code,
  measurement_system
)
SELECT
  'Unexpected second branch',
  current_setting('gym_probe.multi_branch_user')::UUID,
  source.organization_id,
  source.legal_entity_id,
  source.country_code,
  source.locale,
  source.default_currency,
  source.timezone,
  source.date_order,
  source.time_format,
  source.week_start,
  source.phone_country_code,
  source.measurement_system
FROM public.accounts source
WHERE source.id = current_setting('gym_probe.multi_branch_account')::UUID;

INSERT INTO public.legal_entities (
  organization_id, name, legal_name, default_currency
) VALUES (
  current_setting('gym_probe.multi_entity_org')::UUID,
  'Unexpected second entity',
  'Unexpected second entity',
  'INR'
);

-- Both owner relationships are required while the selected organization is
-- still pending. Run these checks before the successful completion below.
SET LOCAL ROLE authenticated;
DO $function$
DECLARE
  v_denied BOOLEAN;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('gym_probe.branch_owner_only_user'),
      'role', 'authenticated'
    )::TEXT,
    TRUE
  );
  v_denied := FALSE;
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.pending_account')::UUID,
      'Branch owner only'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_denied, 'branch-only owner completed setup');

  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('gym_probe.org_owner_only_user'),
      'role', 'authenticated'
    )::TEXT,
    TRUE
  );
  v_denied := FALSE;
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.pending_account')::UUID,
      'Organization owner only'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_denied, 'organization-only owner completed setup');
END;
$function$;
RESET ROLE;

-- A real authenticated database role invokes the RPC and projection. Spoofing
-- auth.uid() while remaining postgres would not prove the EXECUTE boundary.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', current_setting('gym_probe.pending_user'),
    'role', 'authenticated'
  )::TEXT,
  TRUE
);
SELECT set_config(
  'gym_probe.completed_result',
  public.complete_organization_name_setup(
    current_setting('gym_probe.pending_account')::UUID,
    U&'\3000Recovery \+01F3CB\FE0F Gym\2028'
  )::TEXT,
  TRUE
);
RESET ROLE;

SELECT pg_temp.assert_gym_name_signup(
  current_setting('gym_probe.completed_result')::JSONB
    = '{"status":"completed"}'::JSONB,
  'owner completion did not return the fixed completed payload'
);

SELECT pg_temp.assert_gym_name_signup(
  EXISTS (
    SELECT 1
    FROM public.accounts account
    JOIN public.organizations organization ON organization.id = account.organization_id
    JOIN public.legal_entities legal_entity ON legal_entity.id = account.legal_entity_id
    WHERE account.id = current_setting('gym_probe.pending_account')::UUID
      AND account.name = U&'Recovery \+01F3CB\FE0F Gym'
      AND organization.name = U&'Recovery \+01F3CB\FE0F Gym'
      AND legal_entity.name = U&'Recovery \+01F3CB\FE0F Gym'
      AND legal_entity.legal_name = U&'Recovery \+01F3CB\FE0F Gym'
      AND organization.name_setup_completed_at IS NOT NULL
  ),
  'completion did not atomically update all four business names and timestamp'
);

SELECT pg_temp.assert_gym_name_signup(
  (
    SELECT pg_catalog.count(*)
    FROM public.organization_audit_log audit
    WHERE audit.organization_id = current_setting('gym_probe.pending_org')::UUID
      AND audit.operation = 'organization.name_setup_completed'
      AND audit.actor_user_id = current_setting('gym_probe.pending_user')::UUID
      AND audit.details->>'previous_organization_name' = 'Google Owner'
      AND audit.details->>'previous_legal_entity_name' = 'Google Owner'
      AND audit.details->>'previous_legal_name' = 'Google Owner'
      AND audit.details->>'previous_branch_name' = 'Google Owner'
      AND audit.details->>'final_name' = U&'Recovery \+01F3CB\FE0F Gym'
  ) = 1,
  'completion audit event is missing or malformed'
);

-- Retry the organization that was just completed with both the same and a
-- different name. Neither input may mutate names or create another audit row.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', current_setting('gym_probe.pending_user'),
    'role', 'authenticated'
  )::TEXT,
  TRUE
);
SELECT set_config(
  'gym_probe.same_name_retry',
  public.complete_organization_name_setup(
    current_setting('gym_probe.pending_account')::UUID,
    U&'Recovery \+01F3CB\FE0F Gym'
  )::TEXT,
  TRUE
);
SELECT set_config(
  'gym_probe.different_name_retry',
  public.complete_organization_name_setup(
    current_setting('gym_probe.pending_account')::UUID,
    'Must Not Rename Completed Gym'
  )::TEXT,
  TRUE
);
RESET ROLE;

SELECT pg_temp.assert_gym_name_signup(
  current_setting('gym_probe.same_name_retry')::JSONB
    = '{"status":"already_complete"}'::JSONB
  AND current_setting('gym_probe.different_name_retry')::JSONB
    = '{"status":"already_complete"}'::JSONB,
  'completed organization retries did not return already_complete'
);

SELECT pg_temp.assert_gym_name_signup(
  (
    SELECT organization.name
    FROM public.organizations organization
    WHERE organization.id = current_setting('gym_probe.pending_org')::UUID
  ) = U&'Recovery \+01F3CB\FE0F Gym',
  'different-name retry renamed the completed organization'
);

SET LOCAL ROLE authenticated;
DO $function$
DECLARE
  v_account UUID := current_setting('gym_probe.email_account')::UUID;
  v_user_setting TEXT;
  v_role TEXT;
  v_result JSONB;
  v_state TIMESTAMPTZ;
BEGIN
  FOR v_user_setting, v_role IN
    SELECT * FROM (VALUES
      ('gym_probe.email_user', 'owner'),
      ('gym_probe.admin_user', 'admin'),
      ('gym_probe.agent_user', 'agent'),
      ('gym_probe.viewer_user', 'viewer')
    ) AS roles(user_setting, expected_role)
  LOOP
    PERFORM set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', current_setting(v_user_setting),
        'role', 'authenticated'
      )::TEXT,
      TRUE
    );

    SELECT branch.organization_name_setup_completed_at
    INTO v_state
    FROM public.my_branch_accounts() branch
    WHERE branch.account_id = v_account
      AND branch.role::TEXT = v_role;

    PERFORM pg_temp.assert_gym_name_signup(
      v_state IS NOT NULL,
      'completed branch projection failed for role ' || v_role
    );

    v_result := public.complete_organization_name_setup(v_account, '');
    PERFORM pg_temp.assert_gym_name_signup(
      v_result = '{"status":"already_complete"}'::JSONB,
      'completed no-op failed for role ' || v_role
    );
  END LOOP;
END;
$function$;
RESET ROLE;

SELECT pg_temp.assert_gym_name_signup(
  (
    SELECT pg_catalog.count(*)
    FROM public.organization_audit_log audit
    WHERE audit.organization_id = current_setting('gym_probe.pending_org')::UUID
      AND audit.operation = 'organization.name_setup_completed'
  ) = 1,
  'completion retry duplicated the audit event'
);

SELECT pg_temp.assert_gym_name_signup(
  (
    SELECT organization.name
    FROM public.organizations organization
    WHERE organization.id = current_setting('gym_probe.email_org')::UUID
  ) = U&'Pulse \+01F3CB\FE0F Fitness',
  'completed no-op renamed an existing organization'
);

SET LOCAL ROLE authenticated;
DO $function$
DECLARE
  v_denied BOOLEAN;
  v_conflicted BOOLEAN;
BEGIN
  -- A non-member cannot discover the target through the projection or receive
  -- its already-complete state through the RPC.
  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('gym_probe.outsider_user'),
      'role', 'authenticated'
    )::TEXT,
    TRUE
  );
  PERFORM pg_temp.assert_gym_name_signup(
    NOT EXISTS (
      SELECT 1 FROM public.my_branch_accounts() branch
      WHERE branch.account_id = current_setting('gym_probe.email_account')::UUID
    ),
    'projection exposed a branch to a non-member'
  );
  v_denied := FALSE;
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.email_account')::UUID,
      'Must not expose state'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_denied, 'non-member received completion state');

  -- Both unsupported pending shapes fail with the conflict SQLSTATE.
  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('gym_probe.multi_branch_user'),
      'role', 'authenticated'
    )::TEXT,
    TRUE
  );
  v_conflicted := FALSE;
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.multi_branch_account')::UUID,
      'Multi Branch Conflict'
    );
  EXCEPTION WHEN unique_violation THEN
    v_conflicted := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_conflicted, 'pending multi-branch shape was accepted');

  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('gym_probe.multi_entity_user'),
      'role', 'authenticated'
    )::TEXT,
    TRUE
  );
  v_conflicted := FALSE;
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.multi_entity_account')::UUID,
      'Multi Entity Conflict'
    );
  EXCEPTION WHEN unique_violation THEN
    v_conflicted := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_conflicted, 'pending multi-entity shape was accepted');
END;
$function$;
RESET ROLE;

-- Exercise denial through real database roles. These calls must fail at the
-- function ACL before any body-level membership or completion-state logic.
SET LOCAL ROLE anon;
DO $function$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.email_account')::UUID,
      'Anonymous must not call'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_denied, 'anon executed completion RPC');
END;
$function$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $function$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.complete_organization_name_setup(
      current_setting('gym_probe.email_account')::UUID,
      'Service role must not call'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  PERFORM pg_temp.assert_gym_name_signup(v_denied, 'service_role executed completion RPC');
END;
$function$;
RESET ROLE;

ROLLBACK;

SELECT 'passed: gym-name signup database verification; all test changes rolled back' AS verification;
