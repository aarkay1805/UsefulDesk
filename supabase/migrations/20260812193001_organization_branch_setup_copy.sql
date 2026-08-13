-- ============================================================
-- Organization branch setup copy.
--
-- One migration owns the review marker, idempotent branch creation,
-- positive copy allowlists, authorship RLS hardening, and the public RPC
-- contract. Runtime/API/UI integration lands after this additive schema.
-- Existing branches are deliberately not marked reviewed.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS setup_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_reviewed_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_setup_reviewed
  ON public.accounts (organization_id, setup_reviewed_at)
  WHERE setup_reviewed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_setup_reviewed_by
  ON public.accounts (setup_reviewed_by)
  WHERE setup_reviewed_by IS NOT NULL;

-- Support same-organization foreign keys from the private request ledger.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.accounts'::pg_catalog.regclass
      AND conname = 'accounts_organization_id_id_key'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_organization_id_id_key
      UNIQUE (organization_id, id);
  END IF;
END
$$;

-- Account lifecycle and readiness are function-only. RLS still chooses the
-- row; column grants choose which settings an authenticated client may edit.
REVOKE UPDATE ON TABLE public.accounts FROM authenticated;
GRANT UPDATE (
  name,
  default_currency,
  upi_vpa,
  upi_payee_name,
  country_code,
  locale,
  timezone,
  date_order,
  time_format,
  week_start,
  phone_country_code,
  measurement_system,
  onboarding_dismissed_at
) ON TABLE public.accounts TO authenticated;

CREATE TABLE IF NOT EXISTS private.branch_creation_requests (
  actor_user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL,
  source_account_id UUID,
  created_account_id UUID,
  normalized_request JSONB NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (actor_user_id, request_id),
  CONSTRAINT branch_creation_requests_organization_legal_entity_fkey
    FOREIGN KEY (organization_id, legal_entity_id)
    REFERENCES public.legal_entities(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT branch_creation_requests_organization_source_fkey
    FOREIGN KEY (organization_id, source_account_id)
    REFERENCES public.accounts(organization_id, id)
    ON DELETE SET NULL (source_account_id),
  CONSTRAINT branch_creation_requests_organization_created_fkey
    FOREIGN KEY (organization_id, created_account_id)
    REFERENCES public.accounts(organization_id, id)
    ON DELETE CASCADE,
  CHECK (pg_catalog.jsonb_typeof(normalized_request) = 'object'),
  CHECK (response IS NULL OR pg_catalog.jsonb_typeof(response) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_branch_creation_requests_created_scope
  ON private.branch_creation_requests (organization_id, created_account_id)
  WHERE created_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branch_creation_requests_source_scope
  ON private.branch_creation_requests (organization_id, source_account_id)
  WHERE source_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branch_creation_requests_legal_entity_scope
  ON private.branch_creation_requests (organization_id, legal_entity_id);

ALTER TABLE private.branch_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.branch_creation_requests
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_updated_at
  ON private.branch_creation_requests;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON private.branch_creation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Authored-content identity protection and RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION private.protect_authored_parent_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Authored content account and author are immutable'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_authored_child_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'automation_steps'
     AND (pg_catalog.to_jsonb(NEW)->>'automation_id')
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)->>'automation_id') THEN
    RAISE EXCEPTION 'Automation step parent is immutable'
      USING ERRCODE = '22023';
  ELSIF TG_TABLE_NAME = 'flow_nodes'
        AND (pg_catalog.to_jsonb(NEW)->>'flow_id')
          IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)->>'flow_id') THEN
    RAISE EXCEPTION 'Flow node parent is immutable'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.protect_authored_parent_identity() OWNER TO postgres;
ALTER FUNCTION private.protect_authored_child_parent() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.protect_authored_parent_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_authored_child_parent()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS protect_automation_identity ON public.automations;
CREATE TRIGGER protect_automation_identity
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION private.protect_authored_parent_identity();

DROP TRIGGER IF EXISTS protect_flow_identity ON public.flows;
CREATE TRIGGER protect_flow_identity
  BEFORE UPDATE ON public.flows
  FOR EACH ROW EXECUTE FUNCTION private.protect_authored_parent_identity();

DROP TRIGGER IF EXISTS protect_automation_step_parent ON public.automation_steps;
CREATE TRIGGER protect_automation_step_parent
  BEFORE UPDATE ON public.automation_steps
  FOR EACH ROW EXECUTE FUNCTION private.protect_authored_child_parent();

DROP TRIGGER IF EXISTS protect_flow_node_parent ON public.flow_nodes;
CREATE TRIGGER protect_flow_node_parent
  BEFORE UPDATE ON public.flow_nodes
  FOR EACH ROW EXECUTE FUNCTION private.protect_authored_child_parent();

DROP POLICY IF EXISTS automations_select ON public.automations;
DROP POLICY IF EXISTS automations_insert ON public.automations;
DROP POLICY IF EXISTS automations_update ON public.automations;
DROP POLICY IF EXISTS automations_delete ON public.automations;
CREATE POLICY automations_select ON public.automations
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY automations_insert ON public.automations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND user_id = (SELECT auth.uid())
  );
CREATE POLICY automations_update ON public.automations
  FOR UPDATE TO authenticated
  USING (
    public.is_account_member(account_id, 'agent')
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND user_id = (SELECT auth.uid())
  );
CREATE POLICY automations_delete ON public.automations
  FOR DELETE TO authenticated
  USING (
    public.is_account_member(account_id, 'agent')
    AND (
      user_id = (SELECT auth.uid())
      OR public.is_account_member(account_id, 'admin')
    )
  );

DROP POLICY IF EXISTS flows_select ON public.flows;
DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;
CREATE POLICY flows_select ON public.flows
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY flows_insert ON public.flows
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND user_id = (SELECT auth.uid())
  );
CREATE POLICY flows_update ON public.flows
  FOR UPDATE TO authenticated
  USING (
    public.is_account_member(account_id, 'agent')
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND user_id = (SELECT auth.uid())
  );
CREATE POLICY flows_delete ON public.flows
  FOR DELETE TO authenticated
  USING (
    public.is_account_member(account_id, 'agent')
    AND (
      user_id = (SELECT auth.uid())
      OR public.is_account_member(account_id, 'admin')
    )
  );

DROP POLICY IF EXISTS automation_steps_select ON public.automation_steps;
DROP POLICY IF EXISTS automation_steps_modify ON public.automation_steps;
DROP POLICY IF EXISTS automation_steps_insert ON public.automation_steps;
DROP POLICY IF EXISTS automation_steps_update ON public.automation_steps;
DROP POLICY IF EXISTS automation_steps_delete ON public.automation_steps;
CREATE POLICY automation_steps_select ON public.automation_steps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations a
      WHERE a.id = automation_steps.automation_id
        AND public.is_account_member(a.account_id)
    )
  );
CREATE POLICY automation_steps_insert ON public.automation_steps
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.automations a
      WHERE a.id = automation_steps.automation_id
        AND a.user_id = (SELECT auth.uid())
        AND public.is_account_member(a.account_id, 'agent')
    )
  );
CREATE POLICY automation_steps_update ON public.automation_steps
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations a
      WHERE a.id = automation_steps.automation_id
        AND a.user_id = (SELECT auth.uid())
        AND public.is_account_member(a.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.automations a
      WHERE a.id = automation_steps.automation_id
        AND a.user_id = (SELECT auth.uid())
        AND public.is_account_member(a.account_id, 'agent')
    )
  );
CREATE POLICY automation_steps_delete ON public.automation_steps
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations a
      WHERE a.id = automation_steps.automation_id
        AND public.is_account_member(a.account_id, 'agent')
        AND (
          a.user_id = (SELECT auth.uid())
          OR public.is_account_member(a.account_id, 'admin')
        )
    )
  );

DROP POLICY IF EXISTS flow_nodes_select ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_modify ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_insert ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_update ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_delete ON public.flow_nodes;
CREATE POLICY flow_nodes_select ON public.flow_nodes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND public.is_account_member(f.account_id)
    )
  );
CREATE POLICY flow_nodes_insert ON public.flow_nodes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND f.user_id = (SELECT auth.uid())
        AND public.is_account_member(f.account_id, 'agent')
    )
  );
CREATE POLICY flow_nodes_update ON public.flow_nodes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND f.user_id = (SELECT auth.uid())
        AND public.is_account_member(f.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND f.user_id = (SELECT auth.uid())
        AND public.is_account_member(f.account_id, 'agent')
    )
  );
CREATE POLICY flow_nodes_delete ON public.flow_nodes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND public.is_account_member(f.account_id, 'agent')
        AND (
          f.user_id = (SELECT auth.uid())
          OR public.is_account_member(f.account_id, 'admin')
        )
    )
  );

-- Remove legacy FOR ALL policy names in case this migration is applied to a
-- history that retained the pre-account-sharing policies.
DROP POLICY IF EXISTS "Users can manage own automations" ON public.automations;
DROP POLICY IF EXISTS "Users can manage steps of own automations" ON public.automation_steps;
DROP POLICY IF EXISTS "Users can manage own flows" ON public.flows;
DROP POLICY IF EXISTS "Users manage nodes on their flows" ON public.flow_nodes;

-- ============================================================
-- Snapshot and canonicalization helpers.
-- ============================================================

CREATE OR REPLACE FUNCTION private.normalize_branch_setup_packs(p_packs TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_packs TEXT[];
  v_unknown TEXT;
BEGIN
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT p ORDER BY p), ARRAY[]::TEXT[])
  INTO v_packs
  FROM pg_catalog.unnest(COALESCE(p_packs, ARRAY[]::TEXT[])) AS p;

  SELECT p INTO v_unknown
  FROM pg_catalog.unnest(v_packs) AS p
  WHERE p <> ALL (ARRAY[
    'membership_catalog', 'lead_setup', 'reminders', 'automations', 'flows'
  ]::TEXT[])
  LIMIT 1;

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown branch setup pack: %', v_unknown
      USING ERRCODE = '22023';
  END IF;

  IF ('automations' = ANY(v_packs) OR 'flows' = ANY(v_packs))
     AND NOT ('lead_setup' = ANY(v_packs)) THEN
    v_packs := pg_catalog.array_append(v_packs, 'lead_setup');
    SELECT pg_catalog.array_agg(p ORDER BY p) INTO v_packs
    FROM pg_catalog.unnest(v_packs) AS p;
  END IF;

  RETURN v_packs;
END;
$$;

CREATE OR REPLACE FUNCTION private.branch_setup_source_snapshot(
  p_source_account_id UUID,
  p_packs TEXT[]
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'account', pg_catalog.jsonb_build_object(
      'id', a.id,
      'organization_id', a.organization_id,
      'default_currency', a.default_currency,
      'country_code', a.country_code,
      'locale', a.locale,
      'timezone', a.timezone,
      'date_order', a.date_order,
      'time_format', a.time_format,
      'week_start', a.week_start,
      'phone_country_code', a.phone_country_code,
      'measurement_system', a.measurement_system,
      'branch_status', a.branch_status,
      'readiness_state', a.readiness_state,
      'archived_at', a.archived_at,
      'setup_reviewed_at', a.setup_reviewed_at
    ),
    'membership_plans', CASE WHEN 'membership_catalog' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(mp) || pg_catalog.jsonb_build_object(
          'pricing_options', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ppo) ORDER BY ppo.sort_order, ppo.created_at, ppo.id)
            FROM public.plan_pricing_options ppo
            WHERE ppo.account_id = p_source_account_id
              AND ppo.plan_id = mp.id
              AND ppo.is_active
          ), '[]'::JSONB)
        ) ORDER BY mp.created_at, mp.id
      ), '[]'::JSONB)
      FROM public.membership_plans mp
      WHERE mp.account_id = p_source_account_id AND mp.is_active
    ) ELSE '[]'::JSONB END,
    'catalog_items', CASE WHEN 'membership_catalog' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(ci) || pg_catalog.jsonb_build_object(
          'options', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(co) ORDER BY co.sort_order, co.created_at, co.id)
            FROM public.catalog_options co
            WHERE co.account_id = p_source_account_id
              AND co.item_id = ci.id
              AND co.is_active
          ), '[]'::JSONB)
        ) ORDER BY ci.created_at, ci.id
      ), '[]'::JSONB)
      FROM public.catalog_items ci
      WHERE ci.account_id = p_source_account_id AND ci.is_active
    ) ELSE '[]'::JSONB END,
    'lead_field_options', CASE WHEN 'lead_setup' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(lfo) ORDER BY lfo.field, lfo.sort_order, lfo.id), '[]'::JSONB)
      FROM public.lead_field_options lfo
      WHERE lfo.account_id = p_source_account_id
    ) ELSE '[]'::JSONB END,
    'tags', CASE WHEN 'lead_setup' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.created_at, t.id), '[]'::JSONB)
      FROM public.tags t WHERE t.account_id = p_source_account_id
    ) ELSE '[]'::JSONB END,
    'custom_fields', CASE WHEN 'lead_setup' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cf) ORDER BY cf.created_at, cf.id), '[]'::JSONB)
      FROM public.custom_fields cf WHERE cf.account_id = p_source_account_id
    ) ELSE '[]'::JSONB END,
    'lead_forms', CASE WHEN 'lead_setup' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(lcf) ORDER BY lcf.created_at, lcf.id), '[]'::JSONB)
      FROM public.lead_capture_forms lcf WHERE lcf.account_id = p_source_account_id
    ) ELSE '[]'::JSONB END,
    'reminder_settings', CASE WHEN 'reminders' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rrs)), '[]'::JSONB)
      FROM public.renewal_reminder_settings rrs
      WHERE rrs.account_id = p_source_account_id
    ) ELSE '[]'::JSONB END,
    'automations', CASE WHEN 'automations' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(au) || pg_catalog.jsonb_build_object(
          'steps', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ast) ORDER BY ast.position, ast.created_at, ast.id)
            FROM public.automation_steps ast WHERE ast.automation_id = au.id
          ), '[]'::JSONB)
        ) ORDER BY au.created_at, au.id
      ), '[]'::JSONB)
      FROM public.automations au WHERE au.account_id = p_source_account_id
    ) ELSE '[]'::JSONB END,
    'flows', CASE WHEN 'flows' = ANY(p_packs) THEN (
      SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(f) || pg_catalog.jsonb_build_object(
          'nodes', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(fn) ORDER BY fn.created_at, fn.id)
            FROM public.flow_nodes fn WHERE fn.flow_id = f.id
          ), '[]'::JSONB)
        ) ORDER BY f.created_at, f.id
      ), '[]'::JSONB)
      FROM public.flows f
      WHERE f.account_id = p_source_account_id AND f.status <> 'archived'
    ) ELSE '[]'::JSONB END
  )
  FROM public.accounts a
  WHERE a.id = p_source_account_id;
$$;

CREATE OR REPLACE FUNCTION private.branch_setup_identity_map(p_rows JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_object_agg(r->>'id', r->>'id'), '{}'::JSONB)
  FROM pg_catalog.jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) AS r;
$$;

CREATE OR REPLACE FUNCTION private.canonical_branch_automation_trigger(
  p_trigger_type TEXT,
  p_config JSONB,
  p_tag_map JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_keywords JSONB;
  v_tag TEXT;
  v_match_type TEXT;
BEGIN
  IF pg_catalog.jsonb_typeof(COALESCE(p_config, '{}'::JSONB)) <> 'object' THEN
    RETURN NULL;
  END IF;

  IF p_trigger_type = ANY(ARRAY[
    'new_message_received', 'first_inbound_message', 'new_contact_created',
    'conversation_assigned'
  ]::TEXT[]) THEN
    RETURN '{}'::JSONB;
  ELSIF p_trigger_type = 'keyword_match' THEN
    v_keywords := p_config->'keywords';
    IF pg_catalog.jsonb_typeof(v_keywords) <> 'array' THEN
      RETURN NULL;
    END IF;
    IF pg_catalog.jsonb_array_length(v_keywords) = 0
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements(v_keywords) AS k
         WHERE pg_catalog.jsonb_typeof(k) <> 'string'
           OR pg_catalog.btrim(k #>> '{}') = ''
       ) THEN
      RETURN NULL;
    END IF;
    v_match_type := COALESCE(p_config->>'match_type', 'contains');
    IF v_match_type <> ALL(ARRAY['exact', 'contains', 'word']::TEXT[]) THEN
      RETURN NULL;
    END IF;
    IF p_config ? 'case_sensitive'
       AND pg_catalog.jsonb_typeof(p_config->'case_sensitive') <> 'boolean' THEN
      RETURN NULL;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'keywords', v_keywords,
      'match_type', v_match_type,
      'case_sensitive', COALESCE((p_config->>'case_sensitive')::BOOLEAN, FALSE)
    );
  ELSIF p_trigger_type = 'tag_added' THEN
    v_tag := p_tag_map->>(p_config->>'tag_id');
    IF v_tag IS NULL THEN RETURN NULL; END IF;
    RETURN pg_catalog.jsonb_build_object('tag_id', v_tag);
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.canonical_branch_automation_step(
  p_step_type TEXT,
  p_config JSONB,
  p_tag_map JSONB,
  p_custom_field_map JSONB,
  p_status_keys TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_field TEXT;
  v_tag TEXT;
  v_variables JSONB;
  v_subject TEXT;
  v_operand TEXT;
BEGIN
  IF pg_catalog.jsonb_typeof(COALESCE(p_config, '{}'::JSONB)) <> 'object' THEN
    RETURN NULL;
  END IF;

  CASE p_step_type
    WHEN 'send_message' THEN
      IF pg_catalog.btrim(COALESCE(p_config->>'text', '')) = '' THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('text', p_config->>'text');
    WHEN 'send_template' THEN
      IF pg_catalog.btrim(COALESCE(p_config->>'template_name', '')) = '' THEN RETURN NULL; END IF;
      IF p_config ? 'language' AND pg_catalog.jsonb_typeof(p_config->'language') <> 'string' THEN RETURN NULL; END IF;
      IF p_config ? 'variables' AND pg_catalog.jsonb_typeof(p_config->'variables') <> 'object' THEN RETURN NULL; END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_each(
          CASE WHEN pg_catalog.jsonb_typeof(p_config->'variables') = 'object'
            THEN p_config->'variables' ELSE '{}'::JSONB END
        ) AS v
        WHERE pg_catalog.jsonb_typeof(v.value) <> 'string'
      ) THEN RETURN NULL; END IF;
      v_variables := CASE WHEN pg_catalog.jsonb_typeof(p_config->'variables') = 'object'
        THEN p_config->'variables' ELSE '{}'::JSONB END;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'template_name', p_config->>'template_name',
        'language', p_config->>'language',
        'variables', v_variables
      ));
    WHEN 'add_tag' THEN
      v_tag := p_tag_map->>(p_config->>'tag_id');
      IF v_tag IS NULL THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('tag_id', v_tag);
    WHEN 'remove_tag' THEN
      v_tag := p_tag_map->>(p_config->>'tag_id');
      IF v_tag IS NULL THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('tag_id', v_tag);
    WHEN 'assign_conversation' THEN
      IF (p_config->>'mode') IS NULL
         OR (p_config->>'mode') <> ALL(ARRAY['specific', 'round_robin']::TEXT[])
         OR (
           p_config->>'mode' = 'specific'
           AND pg_catalog.btrim(COALESCE(p_config->>'agent_id', '')) = ''
         ) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('mode', 'round_robin');
    WHEN 'update_contact_field' THEN
      v_field := p_config->>'field';
      IF v_field IS NULL THEN
        RETURN NULL;
      ELSIF v_field LIKE 'custom:%' THEN
        v_field := p_custom_field_map->>pg_catalog.substr(v_field, 8);
        IF v_field IS NULL THEN RETURN NULL; END IF;
        v_field := 'custom:' || v_field;
      ELSIF v_field <> ALL(ARRAY['name', 'email', 'company']::TEXT[]) THEN
        RETURN NULL;
      END IF;
      IF NOT (p_config ? 'value') OR pg_catalog.jsonb_typeof(p_config->'value') <> 'string' THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('field', v_field, 'value', p_config->>'value');
    WHEN 'set_lead_status' THEN
      IF pg_catalog.btrim(COALESCE(p_config->>'status', '')) = ''
         OR NOT ((p_config->>'status') = ANY(p_status_keys)) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('status', p_config->>'status');
    WHEN 'assign_lead' THEN
      IF (p_config->>'mode') IS NULL
         OR (p_config->>'mode') <> ALL(ARRAY['specific', 'round_robin']::TEXT[])
         OR (
           p_config->>'mode' = 'specific'
           AND pg_catalog.btrim(COALESCE(p_config->>'agent_id', '')) = ''
         )
         OR (
           p_config ? 'only_if_unassigned'
           AND pg_catalog.jsonb_typeof(p_config->'only_if_unassigned') <> 'boolean'
         ) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object(
        'mode', 'round_robin',
        'only_if_unassigned', COALESCE((p_config->>'only_if_unassigned')::BOOLEAN, FALSE)
      );
    WHEN 'create_follow_up' THEN
      IF pg_catalog.jsonb_typeof(p_config->'due_in_days') <> 'number' THEN RETURN NULL; END IF;
      IF (p_config->>'task_type') IS NULL
         OR (p_config->>'task_type') <> ALL(ARRAY['call', 'email', 'todo']::TEXT[])
         OR (p_config->>'assign_mode') IS NULL
         OR (p_config->>'assign_mode') <> ALL(ARRAY['lead_owner', 'specific']::TEXT[])
         OR (
           p_config->>'assign_mode' = 'specific'
           AND pg_catalog.btrim(COALESCE(p_config->>'agent_id', '')) = ''
         )
         OR (p_config->>'due_in_days')::NUMERIC <> pg_catalog.trunc((p_config->>'due_in_days')::NUMERIC)
         OR (p_config ? 'note' AND pg_catalog.jsonb_typeof(p_config->'note') <> 'string') THEN
        RETURN NULL;
      END IF;
      IF (p_config->>'due_in_days')::NUMERIC < 0 THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'task_type', p_config->>'task_type',
        'due_in_days', (p_config->>'due_in_days')::INTEGER,
        'assign_mode', 'lead_owner',
        'note', p_config->>'note'
      ));
    WHEN 'wait' THEN
      IF pg_catalog.jsonb_typeof(p_config->'amount') <> 'number'
         OR (p_config->>'unit') IS NULL
         OR (p_config->>'unit') <> ALL(ARRAY['minutes', 'hours', 'days']::TEXT[]) THEN RETURN NULL; END IF;
      IF (p_config->>'amount')::NUMERIC <= 0 THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object(
        'amount', (p_config->>'amount')::NUMERIC,
        'unit', p_config->>'unit'
      );
    WHEN 'condition' THEN
      v_subject := p_config->>'subject';
      IF v_subject IS NULL OR v_subject = 'time_of_day'
         OR v_subject <> ALL(ARRAY['contact_field', 'tag_presence', 'message_content']::TEXT[]) THEN RETURN NULL; END IF;
      v_operand := p_config->>'operand';
      IF pg_catalog.btrim(COALESCE(v_operand, '')) = '' THEN RETURN NULL; END IF;
      IF v_subject = 'tag_presence' THEN
        v_operand := p_tag_map->>v_operand;
        IF v_operand IS NULL THEN RETURN NULL; END IF;
      ELSIF v_subject = 'contact_field' AND v_operand LIKE 'custom:%' THEN
        v_operand := p_custom_field_map->>pg_catalog.substr(v_operand, 8);
        IF v_operand IS NULL THEN RETURN NULL; END IF;
        v_operand := 'custom:' || v_operand;
      ELSIF v_subject = 'contact_field'
            AND v_operand <> ALL(ARRAY['name', 'email', 'phone', 'company']::TEXT[]) THEN
        RETURN NULL;
      END IF;
      IF p_config ? 'value' AND pg_catalog.jsonb_typeof(p_config->'value') <> 'string' THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'subject', v_subject,
        'operand', v_operand,
        'value', p_config->>'value'
      ));
    WHEN 'send_webhook' THEN
      IF pg_catalog.btrim(COALESCE(p_config->>'url', '')) = ''
         OR (p_config ? 'headers' AND pg_catalog.jsonb_typeof(p_config->'headers') <> 'object')
         OR EXISTS (
           SELECT 1 FROM pg_catalog.jsonb_each(
             CASE WHEN pg_catalog.jsonb_typeof(p_config->'headers') = 'object'
               THEN p_config->'headers' ELSE '{}'::JSONB END
           ) AS h
           WHERE pg_catalog.jsonb_typeof(h.value) <> 'string'
         )
         OR (p_config ? 'body_template' AND pg_catalog.jsonb_typeof(p_config->'body_template') <> 'string') THEN
        RETURN NULL;
      END IF;
      RETURN pg_catalog.jsonb_build_object('url', '', 'headers', '{}'::JSONB, 'body_template', '');
    WHEN 'close_conversation' THEN
      RETURN '{}'::JSONB;
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

ALTER FUNCTION private.normalize_branch_setup_packs(TEXT[]) OWNER TO postgres;
ALTER FUNCTION private.branch_setup_source_snapshot(UUID, TEXT[]) OWNER TO postgres;
ALTER FUNCTION private.branch_setup_identity_map(JSONB) OWNER TO postgres;
ALTER FUNCTION private.canonical_branch_automation_trigger(TEXT, JSONB, JSONB) OWNER TO postgres;
ALTER FUNCTION private.canonical_branch_automation_step(TEXT, JSONB, JSONB, JSONB, TEXT[]) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.normalize_branch_setup_packs(TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.branch_setup_source_snapshot(UUID, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.branch_setup_identity_map(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.canonical_branch_automation_trigger(TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.canonical_branch_automation_step(TEXT, JSONB, JSONB, JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.canonical_branch_flow_trigger(
  p_trigger_type TEXT,
  p_config JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_keywords JSONB;
  v_match_type TEXT;
BEGIN
  IF pg_catalog.jsonb_typeof(COALESCE(p_config, '{}'::JSONB)) <> 'object' THEN
    RETURN NULL;
  END IF;

  IF p_trigger_type = 'first_inbound_message' THEN
    RETURN '{}'::JSONB;
  ELSIF p_trigger_type <> 'keyword' THEN
    RETURN NULL;
  END IF;

  v_keywords := p_config->'keywords';
  IF pg_catalog.jsonb_typeof(v_keywords) <> 'array' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_array_length(v_keywords) = 0
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_keywords) AS k
       WHERE pg_catalog.jsonb_typeof(k) <> 'string'
         OR pg_catalog.btrim(k #>> '{}') = ''
     ) THEN
    RETURN NULL;
  END IF;

  v_match_type := COALESCE(p_config->>'match_type', 'contains');
  IF v_match_type <> ALL(ARRAY['exact', 'contains']::TEXT[]) THEN
    RETURN NULL;
  END IF;
  IF p_config ? 'case_sensitive'
     AND pg_catalog.jsonb_typeof(p_config->'case_sensitive') <> 'boolean' THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'keywords', v_keywords,
    'match_type', v_match_type,
    'case_sensitive', COALESCE((p_config->>'case_sensitive')::BOOLEAN, FALSE)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.canonical_branch_flow_fallback(p_policy JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.jsonb_typeof(COALESCE(p_policy, '{}'::JSONB)) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF (p_policy ? 'max_reprompts'
      AND pg_catalog.jsonb_typeof(p_policy->'max_reprompts') <> 'number')
     OR (p_policy ? 'on_timeout_hours'
      AND pg_catalog.jsonb_typeof(p_policy->'on_timeout_hours') <> 'number') THEN
    RETURN NULL;
  END IF;
  IF COALESCE(p_policy->>'on_unknown_reply', 'reprompt')
          <> ALL(ARRAY['reprompt', 'handoff', 'ignore']::TEXT[])
     OR COALESCE(p_policy->>'on_exhaust', 'handoff')
          <> ALL(ARRAY['handoff', 'end']::TEXT[])
     OR COALESCE((p_policy->>'max_reprompts')::NUMERIC, 2) < 0
     OR COALESCE((p_policy->>'max_reprompts')::NUMERIC, 2)
          <> pg_catalog.trunc(COALESCE((p_policy->>'max_reprompts')::NUMERIC, 2))
     OR COALESCE((p_policy->>'on_timeout_hours')::NUMERIC, 24) <= 0
     OR COALESCE((p_policy->>'on_timeout_hours')::NUMERIC, 24)
          <> pg_catalog.trunc(COALESCE((p_policy->>'on_timeout_hours')::NUMERIC, 24)) THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'on_unknown_reply', COALESCE(p_policy->>'on_unknown_reply', 'reprompt'),
    'max_reprompts', COALESCE((p_policy->>'max_reprompts')::INTEGER, 2),
    'on_timeout_hours', COALESCE((p_policy->>'on_timeout_hours')::INTEGER, 24),
    'on_exhaust', COALESCE(p_policy->>'on_exhaust', 'handoff')
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.canonical_branch_flow_node(
  p_node_type TEXT,
  p_config JSONB,
  p_tag_map JSONB,
  p_node_keys TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_next TEXT;
  v_tag TEXT;
  v_buttons JSONB;
  v_sections JSONB;
  v_subject_key TEXT;
  v_validation TEXT;
BEGIN
  IF pg_catalog.jsonb_typeof(COALESCE(p_config, '{}'::JSONB)) <> 'object' THEN
    RETURN NULL;
  END IF;

  CASE p_node_type
    WHEN 'start' THEN
      v_next := p_config->>'next_node_key';
      IF v_next IS NULL OR NOT (v_next = ANY(p_node_keys)) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('next_node_key', v_next);
    WHEN 'send_message' THEN
      v_next := p_config->>'next_node_key';
      IF pg_catalog.btrim(COALESCE(p_config->>'text', '')) = ''
         OR v_next IS NULL OR NOT (v_next = ANY(p_node_keys)) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object('text', p_config->>'text', 'next_node_key', v_next);
    WHEN 'send_media' THEN
      v_next := p_config->>'next_node_key';
      IF (p_config->>'media_type') IS NULL
         OR (p_config->>'media_type') <> ALL(ARRAY['image', 'video', 'document']::TEXT[])
         OR pg_catalog.btrim(COALESCE(p_config->>'media_url', '')) = ''
         OR v_next IS NULL OR NOT (v_next = ANY(p_node_keys))
         OR (p_config ? 'caption' AND pg_catalog.jsonb_typeof(p_config->'caption') <> 'string')
         OR (p_config ? 'filename' AND pg_catalog.jsonb_typeof(p_config->'filename') <> 'string') THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'media_type', p_config->>'media_type',
        'media_url', '',
        'filename', '',
        'caption', p_config->>'caption',
        'next_node_key', v_next
      ));
    WHEN 'send_buttons' THEN
      IF pg_catalog.jsonb_typeof(p_config->'buttons') <> 'array' THEN RETURN NULL; END IF;
      IF pg_catalog.btrim(COALESCE(p_config->>'text', '')) = ''
         OR pg_catalog.jsonb_array_length(p_config->'buttons') NOT BETWEEN 1 AND 3
         OR (p_config ? 'header_text' AND pg_catalog.jsonb_typeof(p_config->'header_text') <> 'string')
         OR (p_config ? 'footer_text' AND pg_catalog.jsonb_typeof(p_config->'footer_text') <> 'string')
         OR EXISTS (
           SELECT 1 FROM pg_catalog.jsonb_array_elements(p_config->'buttons') AS b
           WHERE pg_catalog.jsonb_typeof(b) <> 'object'
             OR pg_catalog.btrim(COALESCE(b->>'reply_id', '')) = ''
             OR pg_catalog.btrim(COALESCE(b->>'title', '')) = ''
             OR pg_catalog.length(b->>'title') > 20
             OR (b->>'next_node_key') IS NULL
             OR NOT ((b->>'next_node_key') = ANY(p_node_keys))
         )
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_array_elements(p_config->'buttons') AS b
         ) <> (
           SELECT pg_catalog.count(DISTINCT b->>'reply_id')
           FROM pg_catalog.jsonb_array_elements(p_config->'buttons') AS b
         ) THEN RETURN NULL; END IF;
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'reply_id', b->>'reply_id', 'title', b->>'title',
        'next_node_key', b->>'next_node_key'
      )) INTO v_buttons
      FROM pg_catalog.jsonb_array_elements(p_config->'buttons') AS b;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'text', p_config->>'text',
        'header_text', p_config->>'header_text',
        'footer_text', p_config->>'footer_text',
        'buttons', v_buttons
      ));
    WHEN 'send_list' THEN
      IF pg_catalog.jsonb_typeof(p_config->'sections') <> 'array' THEN RETURN NULL; END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_config->'sections') s
        WHERE pg_catalog.jsonb_typeof(s) <> 'object'
           OR pg_catalog.jsonb_typeof(s->'rows') <> 'array'
      ) THEN RETURN NULL; END IF;
      IF pg_catalog.btrim(COALESCE(p_config->>'text', '')) = ''
         OR pg_catalog.btrim(COALESCE(p_config->>'button_label', '')) = ''
         OR (p_config ? 'header_text' AND pg_catalog.jsonb_typeof(p_config->'header_text') <> 'string')
         OR (p_config ? 'footer_text' AND pg_catalog.jsonb_typeof(p_config->'footer_text') <> 'string')
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_array_elements(p_config->'sections') s,
                LATERAL pg_catalog.jsonb_array_elements(COALESCE(s->'rows', '[]'::JSONB)) r
         ) NOT BETWEEN 1 AND 10
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(p_config->'sections') s,
                LATERAL pg_catalog.jsonb_array_elements(COALESCE(s->'rows', '[]'::JSONB)) r
           WHERE (s ? 'title' AND pg_catalog.jsonb_typeof(s->'title') <> 'string')
              OR pg_catalog.jsonb_typeof(r) <> 'object'
              OR pg_catalog.btrim(COALESCE(r->>'reply_id', '')) = ''
              OR pg_catalog.btrim(COALESCE(r->>'title', '')) = ''
              OR pg_catalog.length(r->>'title') > 24
              OR (r ? 'description' AND pg_catalog.jsonb_typeof(r->'description') <> 'string')
              OR pg_catalog.length(COALESCE(r->>'description', '')) > 72
              OR (r->>'next_node_key') IS NULL
              OR NOT ((r->>'next_node_key') = ANY(p_node_keys))
         )
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_array_elements(p_config->'sections') s,
                LATERAL pg_catalog.jsonb_array_elements(COALESCE(s->'rows', '[]'::JSONB)) r
         ) <> (
           SELECT pg_catalog.count(DISTINCT r->>'reply_id')
           FROM pg_catalog.jsonb_array_elements(p_config->'sections') s,
                LATERAL pg_catalog.jsonb_array_elements(COALESCE(s->'rows', '[]'::JSONB)) r
         ) THEN RETURN NULL; END IF;
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'title', s->>'title',
        'rows', (
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'reply_id', r->>'reply_id', 'title', r->>'title',
            'description', r->>'description', 'next_node_key', r->>'next_node_key'
          )))
          FROM pg_catalog.jsonb_array_elements(s->'rows') AS r
        )
      ))) INTO v_sections
      FROM pg_catalog.jsonb_array_elements(p_config->'sections') AS s;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'text', p_config->>'text', 'button_label', p_config->>'button_label',
        'header_text', p_config->>'header_text', 'footer_text', p_config->>'footer_text',
        'sections', v_sections
      ));
    WHEN 'collect_input' THEN
      v_next := p_config->>'next_node_key';
      v_validation := COALESCE(p_config->>'validation', 'any');
      IF pg_catalog.btrim(COALESCE(p_config->>'prompt_text', '')) = ''
         OR COALESCE(p_config->>'var_key', '') !~ '^[a-zA-Z_][a-zA-Z0-9_]*$'
         OR v_validation <> ALL(ARRAY['any', 'email', 'phone', 'regex']::TEXT[])
         OR (v_validation = 'regex' AND pg_catalog.btrim(COALESCE(p_config->>'regex', '')) = '')
         OR v_next IS NULL OR NOT (v_next = ANY(p_node_keys)) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'prompt_text', p_config->>'prompt_text', 'var_key', p_config->>'var_key',
        'validation', v_validation, 'regex', p_config->>'regex', 'next_node_key', v_next
      ));
    WHEN 'condition' THEN
      IF (p_config->>'subject') IS NULL
         OR (p_config->>'subject') <> ALL(ARRAY['var', 'tag', 'contact_field']::TEXT[])
         OR (p_config->>'operator') IS NULL
         OR (p_config->>'operator') <> ALL(ARRAY['equals', 'contains', 'present', 'absent']::TEXT[])
         OR pg_catalog.btrim(COALESCE(p_config->>'subject_key', '')) = ''
         OR (p_config->>'true_next') IS NULL
         OR NOT ((p_config->>'true_next') = ANY(p_node_keys))
         OR (p_config->>'false_next') IS NULL
         OR NOT ((p_config->>'false_next') = ANY(p_node_keys))
         OR (p_config ? 'value' AND pg_catalog.jsonb_typeof(p_config->'value') <> 'string') THEN RETURN NULL; END IF;
      v_subject_key := p_config->>'subject_key';
      IF p_config->>'subject' = 'tag' THEN
        v_subject_key := p_tag_map->>v_subject_key;
        IF v_subject_key IS NULL THEN RETURN NULL; END IF;
      ELSIF p_config->>'subject' = 'contact_field'
            AND v_subject_key <> ALL(ARRAY['name', 'email', 'phone', 'company']::TEXT[]) THEN
        RETURN NULL;
      END IF;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'subject', p_config->>'subject', 'subject_key', v_subject_key,
        'operator', p_config->>'operator', 'value', p_config->>'value',
        'true_next', p_config->>'true_next', 'false_next', p_config->>'false_next'
      ));
    WHEN 'set_tag' THEN
      v_tag := p_tag_map->>(p_config->>'tag_id');
      v_next := p_config->>'next_node_key';
      IF v_tag IS NULL
         OR (p_config->>'mode') IS NULL
         OR (p_config->>'mode') <> ALL(ARRAY['add', 'remove']::TEXT[])
         OR v_next IS NULL OR NOT (v_next = ANY(p_node_keys)) THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_build_object(
        'mode', p_config->>'mode', 'tag_id', v_tag, 'next_node_key', v_next
      );
    WHEN 'handoff' THEN
      IF p_config ? 'note' AND pg_catalog.jsonb_typeof(p_config->'note') <> 'string' THEN RETURN NULL; END IF;
      RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('note', p_config->>'note'));
    WHEN 'end' THEN
      RETURN '{}'::JSONB;
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

ALTER FUNCTION private.canonical_branch_flow_trigger(TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION private.canonical_branch_flow_fallback(JSONB) OWNER TO postgres;
ALTER FUNCTION private.canonical_branch_flow_node(TEXT, JSONB, JSONB, TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.canonical_branch_flow_trigger(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.canonical_branch_flow_fallback(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.canonical_branch_flow_node(TEXT, JSONB, JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.compact_branch_setup_warnings(p_warnings JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'code', grouped.code,
      'pack', grouped.pack,
      'count', grouped.warning_count
    ) ORDER BY grouped.pack, grouped.code
  ), '[]'::JSONB)
  FROM (
    SELECT w->>'code' AS code,
           w->>'pack' AS pack,
           pg_catalog.sum(COALESCE((w->>'count')::INTEGER, 1))::INTEGER AS warning_count
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_warnings, '[]'::JSONB)) AS w
    GROUP BY w->>'code', w->>'pack'
  ) AS grouped;
$$;

CREATE OR REPLACE FUNCTION private.analyze_branch_setup_snapshot(
  p_snapshot JSONB,
  p_packs TEXT[],
  p_target_currency TEXT
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_breakdown JSONB := pg_catalog.jsonb_build_object(
    'membershipPlans', 0, 'planPricingOptions', 0,
    'catalogItems', 0, 'catalogOptions', 0,
    'leadFieldOptions', 0, 'tags', 0, 'customFields', 0,
    'leadForms', 0, 'reminderSettings', 0,
    'automations', 0, 'automationSteps', 0,
    'flows', 0, 'flowNodes', 0
  );
  v_warnings JSONB := '[]'::JSONB;
  v_tag_map JSONB := private.branch_setup_identity_map(p_snapshot->'tags');
  v_custom_map JSONB := private.branch_setup_identity_map(p_snapshot->'custom_fields');
  v_status_keys TEXT[];
  v_eligible_automations JSONB := '[]'::JSONB;
  v_eligible_flows JSONB := '[]'::JSONB;
  v_definition JSONB;
  v_child JSONB;
  v_canonical JSONB;
  v_valid BOOLEAN;
  v_step_ids TEXT[];
  v_reached TEXT[];
  v_previous_count INTEGER;
  v_node_keys TEXT[];
  v_count INTEGER;
  v_total INTEGER;
  v_pack_count INTEGER;
BEGIN
  SELECT CASE WHEN pg_catalog.count(*) = 0
    THEN ARRAY['new', 'contacted', 'interested', 'trial_booked', 'lost']::TEXT[]
    ELSE pg_catalog.array_prepend('new', pg_catalog.array_agg(r->>'key'))
  END
  INTO v_status_keys
  FROM pg_catalog.jsonb_array_elements(COALESCE(p_snapshot->'lead_field_options', '[]'::JSONB)) AS r
  WHERE r->>'field' = 'status';

  IF 'membership_catalog' = ANY(p_packs) THEN
    v_count := pg_catalog.jsonb_array_length(p_snapshot->'membership_plans');
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{membershipPlans}', pg_catalog.to_jsonb(v_count));
    SELECT COALESCE(pg_catalog.sum(pg_catalog.jsonb_array_length(p->'pricing_options')), 0)::INTEGER
    INTO v_count FROM pg_catalog.jsonb_array_elements(p_snapshot->'membership_plans') AS p;
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{planPricingOptions}', pg_catalog.to_jsonb(v_count));
    SELECT pg_catalog.count(*)::INTEGER INTO v_count
    FROM pg_catalog.jsonb_array_elements(p_snapshot->'membership_plans') AS p
    WHERE pg_catalog.jsonb_array_length(p->'pricing_options') = 0;
    IF v_count > 0 THEN
      v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'PLAN_WITHOUT_ACTIVE_PRICE', 'pack', 'membership_catalog', 'count', v_count
      ));
    END IF;

    v_count := pg_catalog.jsonb_array_length(p_snapshot->'catalog_items');
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{catalogItems}', pg_catalog.to_jsonb(v_count));
    SELECT COALESCE(pg_catalog.sum(pg_catalog.jsonb_array_length(i->'options')), 0)::INTEGER
    INTO v_count FROM pg_catalog.jsonb_array_elements(p_snapshot->'catalog_items') AS i;
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{catalogOptions}', pg_catalog.to_jsonb(v_count));
    SELECT pg_catalog.count(*)::INTEGER INTO v_count
    FROM pg_catalog.jsonb_array_elements(p_snapshot->'catalog_items') AS i
    WHERE COALESCE((i->>'requires_trainer')::BOOLEAN, FALSE);
    IF v_count > 0 THEN
      v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'CATALOG_TRAINER_REQUIRED', 'pack', 'membership_catalog', 'count', v_count
      ));
    END IF;
    SELECT pg_catalog.count(*)::INTEGER INTO v_count
    FROM pg_catalog.jsonb_array_elements(p_snapshot->'catalog_items') AS i,
         LATERAL pg_catalog.jsonb_array_elements(i->'options') AS o
    WHERE o->'standard_price' IS NULL OR o->'standard_price' = 'null'::JSONB;
    IF v_count > 0 THEN
      v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'CATALOG_STANDARD_PRICE_MISSING', 'pack', 'membership_catalog', 'count', v_count
      ));
    END IF;
  END IF;

  IF 'lead_setup' = ANY(p_packs) THEN
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{leadFieldOptions}', pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(p_snapshot->'lead_field_options')));
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{tags}', pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(p_snapshot->'tags')));
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{customFields}', pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(p_snapshot->'custom_fields')));
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{leadForms}', pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(p_snapshot->'lead_forms')));
    IF pg_catalog.jsonb_array_length(p_snapshot->'lead_forms') > 0 THEN
      v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'LEAD_FORM_DISABLED', 'pack', 'lead_setup', 'count', 1
      ));
    END IF;
  END IF;

  IF 'reminders' = ANY(p_packs) THEN
    v_count := pg_catalog.jsonb_array_length(p_snapshot->'reminder_settings');
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{reminderSettings}', pg_catalog.to_jsonb(v_count));
    IF v_count > 0 THEN
      v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'REMINDERS_DISABLED', 'pack', 'reminders', 'count', 1
      ));
    END IF;
  END IF;

  IF 'automations' = ANY(p_packs) THEN
    FOR v_definition IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'automations') LOOP
      v_valid := private.canonical_branch_automation_trigger(
        v_definition->>'trigger_type', v_definition->'trigger_config', v_tag_map
      ) IS NOT NULL;
      IF NOT v_valid THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'AUTOMATION_SKIPPED_UNSUPPORTED_TRIGGER', 'pack', 'automations', 'count', 1
        ));
        CONTINUE;
      END IF;

      IF pg_catalog.jsonb_array_length(v_definition->'steps') = 0 THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'AUTOMATION_SKIPPED_INVALID_CONFIG', 'pack', 'automations', 'count', 1
        ));
        CONTINUE;
      END IF;

      v_valid := TRUE;
      FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(v_definition->'steps') LOOP
        v_canonical := private.canonical_branch_automation_step(
          v_child->>'step_type', v_child->'step_config', v_tag_map, v_custom_map, v_status_keys
        );
        IF v_canonical IS NULL THEN
          v_valid := FALSE;
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_valid THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', CASE WHEN EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
            WHERE s->>'step_type' = 'create_deal'
          ) THEN 'AUTOMATION_SKIPPED_UNSUPPORTED_STEP'
          ELSE 'AUTOMATION_SKIPPED_INVALID_CONFIG' END,
          'pack', 'automations', 'count', 1
        ));
        CONTINUE;
      END IF;

      SELECT COALESCE(pg_catalog.array_agg(s->>'id'), ARRAY[]::TEXT[]) INTO v_step_ids
      FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s;
      SELECT COALESCE(pg_catalog.array_agg(s->>'id'), ARRAY[]::TEXT[]) INTO v_reached
      FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
      WHERE s->'parent_step_id' IS NULL OR s->'parent_step_id' = 'null'::JSONB;
      LOOP
        v_previous_count := pg_catalog.cardinality(v_reached);
        SELECT COALESCE(pg_catalog.array_agg(DISTINCT id), ARRAY[]::TEXT[]) INTO v_reached
        FROM (
          SELECT pg_catalog.unnest(v_reached) AS id
          UNION ALL
          SELECT s->>'id'
          FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
          WHERE s->>'parent_step_id' = ANY(v_reached)
        ) reached;
        EXIT WHEN pg_catalog.cardinality(v_reached) = v_previous_count;
      END LOOP;
      IF pg_catalog.cardinality(v_reached) <> pg_catalog.cardinality(v_step_ids)
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
           WHERE (s->'parent_step_id' IS NULL OR s->'parent_step_id' = 'null'::JSONB)
                 <> (s->'branch' IS NULL OR s->'branch' = 'null'::JSONB)
              OR (
                s->>'parent_step_id' IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'steps') parent
                  WHERE parent->>'id' = s->>'parent_step_id'
                    AND parent->>'step_type' = 'condition'
                )
              )
         ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'AUTOMATION_SKIPPED_UNRESOLVED_REFERENCE', 'pack', 'automations', 'count', 1
        ));
        CONTINUE;
      END IF;

      v_eligible_automations := v_eligible_automations || pg_catalog.jsonb_build_array(v_definition->>'id');
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
        WHERE s->>'step_type' IN ('assign_conversation', 'assign_lead', 'create_follow_up')
      ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'AUTOMATION_ASSIGNMENT_RESET', 'pack', 'automations', 'count', 1
        ));
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
        WHERE s->>'step_type' = 'send_webhook'
      ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'AUTOMATION_WEBHOOK_CLEARED', 'pack', 'automations', 'count', 1
        ));
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'steps') s
        WHERE s->>'step_type' = 'send_template'
      ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'AUTOMATION_TEMPLATE_REVIEW_REQUIRED', 'pack', 'automations', 'count', 1
        ));
      END IF;
    END LOOP;
    v_count := pg_catalog.jsonb_array_length(v_eligible_automations);
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{automations}', pg_catalog.to_jsonb(v_count));
    SELECT COALESCE(pg_catalog.sum(pg_catalog.jsonb_array_length(a->'steps')), 0)::INTEGER INTO v_count
    FROM pg_catalog.jsonb_array_elements(p_snapshot->'automations') a
    WHERE v_eligible_automations ? (a->>'id');
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{automationSteps}', pg_catalog.to_jsonb(v_count));
  END IF;

  IF 'flows' = ANY(p_packs) THEN
    FOR v_definition IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot->'flows') LOOP
      SELECT COALESCE(pg_catalog.array_agg(n->>'node_key'), ARRAY[]::TEXT[]) INTO v_node_keys
      FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') n;
      IF private.canonical_branch_flow_trigger(v_definition->>'trigger_type', v_definition->'trigger_config') IS NULL THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'FLOW_SKIPPED_UNSUPPORTED_TRIGGER', 'pack', 'flows', 'count', 1
        ));
        CONTINUE;
      END IF;
      IF private.canonical_branch_flow_fallback(v_definition->'fallback_policy') IS NULL
         OR pg_catalog.cardinality(v_node_keys) = 0
         OR NOT ((v_definition->>'entry_node_id') = ANY(v_node_keys))
         OR pg_catalog.cardinality(v_node_keys) <> (
           SELECT pg_catalog.count(DISTINCT n->>'node_key')::INTEGER
           FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') n
         ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'FLOW_SKIPPED_INVALID_GRAPH', 'pack', 'flows', 'count', 1
        ));
        CONTINUE;
      END IF;
      v_valid := TRUE;
      FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') LOOP
        IF private.canonical_branch_flow_node(
          v_child->>'node_type', v_child->'config', v_tag_map, v_node_keys
        ) IS NULL THEN
          v_valid := FALSE;
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_valid THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', CASE WHEN EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') n
            WHERE n->>'node_type' = 'http_fetch'
          ) THEN 'FLOW_SKIPPED_UNSUPPORTED_NODE'
          ELSE 'FLOW_SKIPPED_UNRESOLVED_REFERENCE' END,
          'pack', 'flows', 'count', 1
        ));
        CONTINUE;
      END IF;
      v_eligible_flows := v_eligible_flows || pg_catalog.jsonb_build_array(v_definition->>'id');
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') n
        WHERE n->>'node_type' = 'handoff' AND n->'config' ? 'assign_to'
      ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'FLOW_HANDOFF_CLEARED', 'pack', 'flows', 'count', 1
        ));
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') n
        WHERE n->>'node_type' = 'send_media'
      ) THEN
        v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'FLOW_MEDIA_CLEARED', 'pack', 'flows', 'count', 1
        ));
      END IF;
    END LOOP;
    v_count := pg_catalog.jsonb_array_length(v_eligible_flows);
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{flows}', pg_catalog.to_jsonb(v_count));
    SELECT COALESCE(pg_catalog.sum(pg_catalog.jsonb_array_length(f->'nodes')), 0)::INTEGER INTO v_count
    FROM pg_catalog.jsonb_array_elements(p_snapshot->'flows') f
    WHERE v_eligible_flows ? (f->>'id');
    v_breakdown := pg_catalog.jsonb_set(v_breakdown, '{flowNodes}', pg_catalog.to_jsonb(v_count));
  END IF;

  FOR v_definition IN SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.unnest(p_packs) AS p LOOP
    CASE v_definition #>> '{}'
      WHEN 'membership_catalog' THEN
        v_pack_count := (v_breakdown->>'membershipPlans')::INTEGER
          + (v_breakdown->>'planPricingOptions')::INTEGER
          + (v_breakdown->>'catalogItems')::INTEGER
          + (v_breakdown->>'catalogOptions')::INTEGER;
      WHEN 'lead_setup' THEN
        v_pack_count := (v_breakdown->>'leadFieldOptions')::INTEGER
          + (v_breakdown->>'tags')::INTEGER + (v_breakdown->>'customFields')::INTEGER
          + (v_breakdown->>'leadForms')::INTEGER;
      WHEN 'reminders' THEN v_pack_count := (v_breakdown->>'reminderSettings')::INTEGER;
      WHEN 'automations' THEN v_pack_count := (v_breakdown->>'automations')::INTEGER;
      WHEN 'flows' THEN v_pack_count := (v_breakdown->>'flows')::INTEGER;
      ELSE v_pack_count := 0;
    END CASE;
    IF v_pack_count = 0 THEN
      v_warnings := v_warnings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'PACK_EMPTY', 'pack', v_definition #>> '{}', 'count', 1
      ));
    END IF;
  END LOOP;

  SELECT COALESCE(pg_catalog.sum(value::INTEGER), 0)::INTEGER INTO v_total
  FROM pg_catalog.jsonb_each_text(v_breakdown);

  RETURN pg_catalog.jsonb_build_object(
    'copied', pg_catalog.jsonb_build_object('totalRows', v_total, 'breakdown', v_breakdown),
    'warnings', private.compact_branch_setup_warnings(v_warnings),
    'eligibleAutomationIds', v_eligible_automations,
    'eligibleFlowIds', v_eligible_flows,
    'sourceBytes', pg_catalog.octet_length(pg_catalog.convert_to(p_snapshot::TEXT, 'UTF8'))
  );
END;
$$;

ALTER FUNCTION private.compact_branch_setup_warnings(JSONB) OWNER TO postgres;
ALTER FUNCTION private.analyze_branch_setup_snapshot(JSONB, TEXT[], TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.compact_branch_setup_warnings(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.analyze_branch_setup_snapshot(JSONB, TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Caller-facing preview and creation RPCs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.preview_organization_branch_setup(
  p_organization_id UUID,
  p_legal_entity_id UUID,
  p_start_mode TEXT,
  p_source_account_id UUID DEFAULT NULL,
  p_packs TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_packs TEXT[];
  v_legal_entity public.legal_entities%ROWTYPE;
  v_source public.accounts%ROWTYPE;
  v_snapshot JSONB;
  v_analysis JSONB;
  v_reasons JSONB := '[]'::JSONB;
  v_pack_eligibility JSONB := '{}'::JSONB;
  v_pack TEXT;
  v_pack_eligible BOOLEAN;
  v_pack_reason TEXT;
  v_eligible BOOLEAN := TRUE;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner can preview branch setup'
      USING ERRCODE = '42501';
  END IF;
  IF p_start_mode <> ALL(ARRAY['blank', 'copy']::TEXT[]) THEN
    RAISE EXCEPTION 'Start mode must be blank or copy' USING ERRCODE = '22023';
  END IF;

  v_packs := private.normalize_branch_setup_packs(p_packs);
  IF p_start_mode = 'blank' THEN
    IF p_source_account_id IS NOT NULL OR pg_catalog.cardinality(v_packs) <> 0 THEN
      RAISE EXCEPTION 'Blank branch setup cannot include a source or packs'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_source_account_id IS NULL OR pg_catalog.cardinality(v_packs) = 0 THEN
    RAISE EXCEPTION 'Copy branch setup requires a source and at least one pack'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_legal_entity
  FROM public.legal_entities
  WHERE id = p_legal_entity_id
    AND organization_id = p_organization_id
    AND archived_at IS NULL;
  IF v_legal_entity.id IS NULL THEN
    RAISE EXCEPTION 'Legal entity does not belong to the organization'
      USING ERRCODE = '22023';
  END IF;

  IF p_start_mode = 'blank' THEN
    RETURN pg_catalog.jsonb_build_object(
      'startMode', 'blank',
      'packs', '[]'::JSONB,
      'eligible', TRUE,
      'reasonCodes', '[]'::JSONB,
      'source', NULL,
      'targetCurrency', v_legal_entity.default_currency,
      'packEligibility', '{}'::JSONB,
      'copied', pg_catalog.jsonb_build_object(
        'totalRows', 0,
        'breakdown', pg_catalog.jsonb_build_object(
          'membershipPlans', 0, 'planPricingOptions', 0,
          'catalogItems', 0, 'catalogOptions', 0,
          'leadFieldOptions', 0, 'tags', 0, 'customFields', 0,
          'leadForms', 0, 'reminderSettings', 0,
          'automations', 0, 'automationSteps', 0,
          'flows', 0, 'flowNodes', 0
        )
      ),
      'warnings', '[]'::JSONB,
      'exclusions', pg_catalog.to_jsonb(ARRAY[
        'operational_records', 'staff_access', 'credentials', 'provider_state',
        'storage_objects', 'execution_history', 'historical_authorship'
      ]::TEXT[])
    );
  END IF;

  IF NOT public.has_account_membership(p_source_account_id) THEN
    RAISE EXCEPTION 'You do not have access to the source branch'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_source
  FROM public.accounts
  WHERE id = p_source_account_id
    AND organization_id = p_organization_id;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'Source branch does not belong to the organization'
      USING ERRCODE = '42501';
  END IF;

  IF v_source.branch_status <> 'active' OR v_source.archived_at IS NOT NULL THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"SOURCE_NOT_ACTIVE"'::JSONB;
  END IF;
  IF v_source.readiness_state <> 'ready' THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"SOURCE_NOT_READY"'::JSONB;
  END IF;
  IF v_source.setup_reviewed_at IS NULL THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"SOURCE_NOT_REVIEWED"'::JSONB;
  END IF;

  v_snapshot := private.branch_setup_source_snapshot(p_source_account_id, v_packs);
  v_analysis := private.analyze_branch_setup_snapshot(
    v_snapshot, v_packs, v_legal_entity.default_currency
  );
  IF (v_analysis->>'sourceBytes')::INTEGER > 8388608 THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"SNAPSHOT_TOO_LARGE"'::JSONB;
  END IF;
  IF (v_analysis->'copied'->>'totalRows')::INTEGER > 10000 THEN
    v_eligible := FALSE;
    v_reasons := v_reasons || '"ROW_LIMIT_EXCEEDED"'::JSONB;
  END IF;

  FOREACH v_pack IN ARRAY v_packs LOOP
    v_pack_eligible := TRUE;
    v_pack_reason := NULL;
    IF NOT v_eligible THEN
      v_pack_eligible := FALSE;
      v_pack_reason := v_reasons->>0;
    END IF;
    IF v_pack = 'membership_catalog'
       AND v_source.default_currency <> v_legal_entity.default_currency THEN
      v_pack_eligible := FALSE;
      v_pack_reason := 'CURRENCY_MISMATCH';
      v_eligible := FALSE;
      IF NOT (v_reasons ? 'CURRENCY_MISMATCH') THEN
        v_reasons := v_reasons || '"CURRENCY_MISMATCH"'::JSONB;
      END IF;
    END IF;
    v_pack_eligibility := v_pack_eligibility || pg_catalog.jsonb_build_object(
      v_pack,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'eligible', v_pack_eligible,
        'reasonCode', v_pack_reason
      ))
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'startMode', 'copy',
    'packs', pg_catalog.to_jsonb(v_packs),
    'eligible', v_eligible,
    'reasonCodes', v_reasons,
    'source', pg_catalog.jsonb_build_object(
      'accountId', v_source.id,
      'currency', v_source.default_currency,
      'branchStatus', v_source.branch_status,
      'readinessState', v_source.readiness_state,
      'setupReviewedAt', v_source.setup_reviewed_at
    ),
    'targetCurrency', v_legal_entity.default_currency,
    'packEligibility', v_pack_eligibility,
    'copied', v_analysis->'copied',
    'warnings', v_analysis->'warnings',
    'skipped', pg_catalog.jsonb_build_object(
      'automations', pg_catalog.jsonb_array_length(v_snapshot->'automations')
        - pg_catalog.jsonb_array_length(v_analysis->'eligibleAutomationIds'),
      'flows', pg_catalog.jsonb_array_length(v_snapshot->'flows')
        - pg_catalog.jsonb_array_length(v_analysis->'eligibleFlowIds')
    ),
    'exclusions', pg_catalog.to_jsonb(ARRAY[
      'operational_records', 'staff_access', 'credentials', 'provider_state',
      'storage_objects', 'execution_history', 'historical_authorship'
    ]::TEXT[])
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization_branch_from_setup(
  p_request_id UUID,
  p_organization_id UUID,
  p_legal_entity_id UUID,
  p_name TEXT,
  p_start_mode TEXT,
  p_source_account_id UUID DEFAULT NULL,
  p_packs TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor UUID := (SELECT auth.uid());
  v_packs TEXT[];
  v_normalized JSONB;
  v_request private.branch_creation_requests%ROWTYPE;
  v_inserted INTEGER;
  v_organization public.organizations%ROWTYPE;
  v_legal_entity public.legal_entities%ROWTYPE;
  v_regional_source public.accounts%ROWTYPE;
  v_copy_source public.accounts%ROWTYPE;
  v_snapshot JSONB;
  v_analysis JSONB;
  v_new_account_id UUID := pg_catalog.gen_random_uuid();
  v_new_id UUID;
  v_parent_new_id UUID;
  v_plan_map JSONB := '{}'::JSONB;
  v_item_map JSONB := '{}'::JSONB;
  v_tag_map JSONB := '{}'::JSONB;
  v_custom_map JSONB := '{}'::JSONB;
  v_step_map JSONB;
  v_status_keys TEXT[];
  v_row JSONB;
  v_child JSONB;
  v_definition JSONB;
  v_config JSONB;
  v_node_keys TEXT[];
  v_progress BOOLEAN;
  v_expense_count INTEGER;
  v_response JSONB;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Branch name must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_start_mode <> ALL(ARRAY['blank', 'copy']::TEXT[]) THEN
    RAISE EXCEPTION 'Start mode must be blank or copy' USING ERRCODE = '22023';
  END IF;
  v_packs := private.normalize_branch_setup_packs(p_packs);
  IF p_start_mode = 'blank' THEN
    IF p_source_account_id IS NOT NULL OR pg_catalog.cardinality(v_packs) <> 0 THEN
      RAISE EXCEPTION 'Blank branch setup cannot include a source or packs'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_source_account_id IS NULL OR pg_catalog.cardinality(v_packs) = 0 THEN
    RAISE EXCEPTION 'Copy branch setup requires a source and at least one pack'
      USING ERRCODE = '22023';
  END IF;

  -- Read-only preflight gives stable authorization/validation errors before
  -- the request ledger's composite foreign keys are exercised. Locks and all
  -- checks are repeated below after the idempotency row is claimed.
  IF NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner can create a branch'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.legal_entities le
    WHERE le.id = p_legal_entity_id
      AND le.organization_id = p_organization_id
      AND le.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Legal entity does not belong to the organization'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_account_id IS NOT NULL AND (
    NOT public.has_account_membership(p_source_account_id)
    OR NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = p_source_account_id
        AND a.organization_id = p_organization_id
    )
  ) THEN
    RAISE EXCEPTION 'Source branch is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_normalized := pg_catalog.jsonb_build_object(
    'name', pg_catalog.btrim(p_name),
    'startMode', p_start_mode,
    'sourceAccountId', p_source_account_id,
    'packs', pg_catalog.to_jsonb(v_packs)
  );

  -- Fixed lock order begins with the idempotency claim.
  INSERT INTO private.branch_creation_requests (
    actor_user_id, request_id, organization_id, legal_entity_id,
    source_account_id, normalized_request
  ) VALUES (
    v_actor, p_request_id, p_organization_id, p_legal_entity_id,
    p_source_account_id, v_normalized
  )
  ON CONFLICT (actor_user_id, request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_request
  FROM private.branch_creation_requests
  WHERE actor_user_id = v_actor AND request_id = p_request_id
  FOR UPDATE;
  IF v_request.normalized_request IS DISTINCT FROM v_normalized
     OR v_request.organization_id IS DISTINCT FROM p_organization_id
     OR v_request.legal_entity_id IS DISTINCT FROM p_legal_entity_id THEN
    RAISE EXCEPTION 'Request ID was already used with different input'
      USING ERRCODE = '23505';
  END IF;
  IF v_request.response IS NOT NULL THEN
    RETURN pg_catalog.jsonb_set(v_request.response, '{replayed}', 'true'::JSONB);
  END IF;

  SELECT * INTO v_organization
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;
  IF v_organization.id IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner can create a branch'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_legal_entity
  FROM public.legal_entities
  WHERE id = p_legal_entity_id
    AND organization_id = p_organization_id
  FOR UPDATE;
  IF v_legal_entity.id IS NULL OR v_legal_entity.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Legal entity does not belong to the organization'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_regional_source
  FROM public.accounts
  WHERE id = COALESCE(p_source_account_id, private.requested_account_id())
  FOR UPDATE;
  IF v_regional_source.id IS NULL
     OR v_regional_source.organization_id <> p_organization_id
     OR v_regional_source.archived_at IS NOT NULL
     OR NOT public.has_account_membership(v_regional_source.id) THEN
    RAISE EXCEPTION 'Regional source branch is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_start_mode = 'copy' THEN
    v_copy_source := v_regional_source;
    IF v_copy_source.branch_status <> 'active'
       OR v_copy_source.readiness_state <> 'ready'
       OR v_copy_source.setup_reviewed_at IS NULL THEN
      RAISE EXCEPTION 'Copy source must be active, ready, and reviewed'
        USING ERRCODE = '22023';
    END IF;
    IF 'membership_catalog' = ANY(v_packs)
       AND v_copy_source.default_currency <> v_legal_entity.default_currency THEN
      RAISE EXCEPTION 'Membership and catalog currency does not match the legal entity'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_snapshot := private.branch_setup_source_snapshot(v_regional_source.id, v_packs);
  v_analysis := private.analyze_branch_setup_snapshot(
    v_snapshot, v_packs, v_legal_entity.default_currency
  );
  IF (v_analysis->>'sourceBytes')::INTEGER > 8388608 THEN
    RAISE EXCEPTION 'Branch setup snapshot exceeds 8 MiB'
      USING ERRCODE = '54000';
  END IF;
  IF (v_analysis->'copied'->>'totalRows')::INTEGER > 10000 THEN
    RAISE EXCEPTION 'Branch setup copy exceeds 10000 rows'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.accounts (
    id, name, owner_user_id, organization_id, legal_entity_id,
    branch_status, readiness_state, setup_reviewed_at, setup_reviewed_by,
    default_currency, country_code, locale, timezone, date_order,
    time_format, week_start, phone_country_code, measurement_system
  ) VALUES (
    v_new_account_id, pg_catalog.btrim(p_name), v_actor,
    p_organization_id, p_legal_entity_id,
    'active', 'setup', NULL, NULL,
    v_legal_entity.default_currency,
    v_regional_source.country_code, v_regional_source.locale,
    v_regional_source.timezone, v_regional_source.date_order,
    v_regional_source.time_format, v_regional_source.week_start,
    v_regional_source.phone_country_code, v_regional_source.measurement_system
  );

  INSERT INTO public.account_memberships (
    account_id, user_id, role, created_by_user_id
  ) VALUES (v_new_account_id, v_actor, 'owner', v_actor);

  IF 'membership_catalog' = ANY(v_packs) THEN
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'membership_plans') LOOP
      v_new_id := pg_catalog.gen_random_uuid();
      v_plan_map := v_plan_map || pg_catalog.jsonb_build_object(v_row->>'id', v_new_id);
      INSERT INTO public.membership_plans (
        id, account_id, name, price, duration_days, description, is_active,
        plan_type, attendance_limit_count, attendance_limit_interval, sessions_count
      ) VALUES (
        v_new_id, v_new_account_id, v_row->>'name',
        (v_row->>'price')::NUMERIC, (v_row->>'duration_days')::INTEGER,
        v_row->>'description', TRUE,
        (v_row->>'plan_type')::public.plan_type_enum,
        (v_row->>'attendance_limit_count')::INTEGER,
        v_row->>'attendance_limit_interval',
        (v_row->>'sessions_count')::INTEGER
      );
      FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(v_row->'pricing_options') LOOP
        INSERT INTO public.plan_pricing_options (
          id, account_id, plan_id, duration_count, duration_unit,
          price, setup_fee, is_active, sort_order
        ) VALUES (
          pg_catalog.gen_random_uuid(), v_new_account_id, v_new_id,
          (v_child->>'duration_count')::INTEGER, v_child->>'duration_unit',
          (v_child->>'price')::NUMERIC, (v_child->>'setup_fee')::NUMERIC,
          TRUE, (v_child->>'sort_order')::INTEGER
        );
      END LOOP;
    END LOOP;

    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'catalog_items') LOOP
      v_new_id := pg_catalog.gen_random_uuid();
      v_item_map := v_item_map || pg_catalog.jsonb_build_object(v_row->>'id', v_new_id);
      INSERT INTO public.catalog_items (
        id, account_id, kind, name, description, requires_trainer,
        is_active, created_by
      ) VALUES (
        v_new_id, v_new_account_id, v_row->>'kind', v_row->>'name',
        v_row->>'description', (v_row->>'requires_trainer')::BOOLEAN,
        TRUE, v_actor
      );
      FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(v_row->'options') LOOP
        INSERT INTO public.catalog_options (
          id, account_id, item_id, duration_count, duration_unit,
          standard_price, is_active, sort_order
        ) VALUES (
          pg_catalog.gen_random_uuid(), v_new_account_id, v_new_id,
          (v_child->>'duration_count')::INTEGER, v_child->>'duration_unit',
          (v_child->>'standard_price')::NUMERIC, TRUE,
          (v_child->>'sort_order')::INTEGER
        );
      END LOOP;
    END LOOP;
  END IF;

  IF 'lead_setup' = ANY(v_packs) THEN
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'lead_field_options') LOOP
      INSERT INTO public.lead_field_options (
        id, account_id, field, key, label, color, sort_order
      ) VALUES (
        pg_catalog.gen_random_uuid(), v_new_account_id, v_row->>'field',
        v_row->>'key', v_row->>'label', v_row->>'color',
        (v_row->>'sort_order')::INTEGER
      );
    END LOOP;
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'tags') LOOP
      v_new_id := pg_catalog.gen_random_uuid();
      v_tag_map := v_tag_map || pg_catalog.jsonb_build_object(v_row->>'id', v_new_id);
      INSERT INTO public.tags (id, account_id, user_id, name, color)
      VALUES (v_new_id, v_new_account_id, v_actor, v_row->>'name', v_row->>'color');
    END LOOP;
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'custom_fields') LOOP
      v_new_id := pg_catalog.gen_random_uuid();
      v_custom_map := v_custom_map || pg_catalog.jsonb_build_object(v_row->>'id', v_new_id);
      INSERT INTO public.custom_fields (
        id, account_id, user_id, field_name, field_type, field_options
      ) VALUES (
        v_new_id, v_new_account_id, v_actor, v_row->>'field_name',
        v_row->>'field_type', NULLIF(v_row->'field_options', 'null'::JSONB)
      );
    END LOOP;
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'lead_forms') LOOP
      INSERT INTO public.lead_capture_forms (
        id, account_id, token, is_active, headline, intro, consent_text,
        created_by, revoked_at
      ) VALUES (
        pg_catalog.gen_random_uuid(), v_new_account_id,
        pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
        FALSE, v_row->>'headline', v_row->>'intro', v_row->>'consent_text',
        v_actor, pg_catalog.now()
      );
    END LOOP;
  END IF;

  IF 'reminders' = ANY(v_packs) THEN
    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'reminder_settings') LOOP
      INSERT INTO public.renewal_reminder_settings (
        account_id, enabled, days_before, service_enabled, service_days_before
      ) VALUES (
        v_new_account_id, FALSE,
        ARRAY(SELECT value::INTEGER FROM pg_catalog.jsonb_array_elements_text(v_row->'days_before')),
        FALSE,
        ARRAY(SELECT value::INTEGER FROM pg_catalog.jsonb_array_elements_text(v_row->'service_days_before'))
      );
    END LOOP;
  END IF;

  SELECT CASE WHEN pg_catalog.count(*) = 0
    THEN ARRAY['new', 'contacted', 'interested', 'trial_booked', 'lost']::TEXT[]
    ELSE pg_catalog.array_prepend('new', pg_catalog.array_agg(r->>'key'))
  END INTO v_status_keys
  FROM pg_catalog.jsonb_array_elements(v_snapshot->'lead_field_options') AS r
  WHERE r->>'field' = 'status';

  IF 'automations' = ANY(v_packs) THEN
    FOR v_definition IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'automations') LOOP
      IF NOT (v_analysis->'eligibleAutomationIds' ? (v_definition->>'id')) THEN CONTINUE; END IF;
      v_new_id := pg_catalog.gen_random_uuid();
      INSERT INTO public.automations (
        id, account_id, user_id, name, description, trigger_type,
        trigger_config, is_active, execution_count, last_executed_at
      ) VALUES (
        v_new_id, v_new_account_id, v_actor, v_definition->>'name',
        v_definition->>'description', v_definition->>'trigger_type',
        private.canonical_branch_automation_trigger(
          v_definition->>'trigger_type', v_definition->'trigger_config', v_tag_map
        ), FALSE, 0, NULL
      );

      v_step_map := '{}'::JSONB;
      LOOP
        v_progress := FALSE;
        FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(v_definition->'steps') LOOP
          IF v_step_map ? (v_child->>'id') THEN CONTINUE; END IF;
          IF v_child->>'parent_step_id' IS NOT NULL
             AND NOT (v_step_map ? (v_child->>'parent_step_id')) THEN CONTINUE; END IF;
          v_parent_new_id := NULL;
          IF v_child->>'parent_step_id' IS NOT NULL THEN
            v_parent_new_id := (v_step_map->>(v_child->>'parent_step_id'))::UUID;
          END IF;
          v_config := private.canonical_branch_automation_step(
            v_child->>'step_type', v_child->'step_config',
            v_tag_map, v_custom_map, v_status_keys
          );
          IF v_config IS NULL THEN
            RAISE EXCEPTION 'Canonical automation changed after analysis'
              USING ERRCODE = '55000';
          END IF;
          INSERT INTO public.automation_steps (
            id, automation_id, parent_step_id, branch, step_type,
            step_config, position
          ) VALUES (
            pg_catalog.gen_random_uuid(), v_new_id, v_parent_new_id,
            v_child->>'branch', v_child->>'step_type', v_config,
            (v_child->>'position')::INTEGER
          ) RETURNING id INTO v_parent_new_id;
          v_step_map := v_step_map || pg_catalog.jsonb_build_object(v_child->>'id', v_parent_new_id);
          v_progress := TRUE;
        END LOOP;
        EXIT WHEN (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.jsonb_object_keys(v_step_map)
        ) = pg_catalog.jsonb_array_length(v_definition->'steps');
        IF NOT v_progress THEN
          RAISE EXCEPTION 'Automation step graph became unresolved'
            USING ERRCODE = '55000';
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF 'flows' = ANY(v_packs) THEN
    FOR v_definition IN SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'flows') LOOP
      IF NOT (v_analysis->'eligibleFlowIds' ? (v_definition->>'id')) THEN CONTINUE; END IF;
      SELECT pg_catalog.array_agg(n->>'node_key') INTO v_node_keys
      FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') n;
      v_new_id := pg_catalog.gen_random_uuid();
      INSERT INTO public.flows (
        id, account_id, user_id, name, description, status, trigger_type,
        trigger_config, entry_node_id, fallback_policy,
        execution_count, last_executed_at
      ) VALUES (
        v_new_id, v_new_account_id, v_actor, v_definition->>'name',
        v_definition->>'description', 'draft', v_definition->>'trigger_type',
        private.canonical_branch_flow_trigger(
          v_definition->>'trigger_type', v_definition->'trigger_config'
        ),
        v_definition->>'entry_node_id',
        private.canonical_branch_flow_fallback(v_definition->'fallback_policy'),
        0, NULL
      );
      FOR v_child IN SELECT value FROM pg_catalog.jsonb_array_elements(v_definition->'nodes') LOOP
        INSERT INTO public.flow_nodes (
          id, flow_id, node_key, node_type, config, position_x, position_y
        ) VALUES (
          pg_catalog.gen_random_uuid(), v_new_id, v_child->>'node_key',
          v_child->>'node_type',
          private.canonical_branch_flow_node(
            v_child->>'node_type', v_child->'config', v_tag_map, v_node_keys
          ),
          (v_child->>'position_x')::INTEGER,
          (v_child->>'position_y')::INTEGER
        );
      END LOOP;
    END LOOP;
  END IF;

  SELECT pg_catalog.count(*)::INTEGER INTO v_expense_count
  FROM public.expense_categories
  WHERE account_id = v_new_account_id;

  v_response := pg_catalog.jsonb_build_object(
    'accountId', v_new_account_id,
    'readinessState', 'setup',
    'setupReviewedAt', NULL,
    'replayed', FALSE,
    'setup', pg_catalog.jsonb_build_object(
      'startMode', p_start_mode,
      'sourceAccountId', p_source_account_id,
      'packs', pg_catalog.to_jsonb(v_packs)
    ),
    'copied', v_analysis->'copied',
    'systemSeeded', pg_catalog.jsonb_build_object('expenseCategories', v_expense_count),
    'warnings', v_analysis->'warnings',
    'credentialsCloned', FALSE
  );

  UPDATE private.branch_creation_requests
  SET created_account_id = v_new_account_id,
      response = v_response
  WHERE actor_user_id = v_actor AND request_id = p_request_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  ) VALUES (
    p_organization_id, v_new_account_id, v_actor, 'branch.created',
    pg_catalog.jsonb_build_object(
      'request_id', p_request_id,
      'legal_entity_id', p_legal_entity_id,
      'source_account_id', p_source_account_id,
      'start_mode', p_start_mode,
      'packs', pg_catalog.to_jsonb(v_packs),
      'copied', v_analysis->'copied',
      'warnings', v_analysis->'warnings',
      'credentials_cloned', FALSE
    )
  );

  RETURN v_response;
END;
$$;

ALTER FUNCTION public.preview_organization_branch_setup(UUID, UUID, TEXT, UUID, TEXT[]) OWNER TO postgres;
ALTER FUNCTION public.create_organization_branch_from_setup(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_organization_branch_setup(UUID, UUID, TEXT, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_organization_branch_from_setup(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_organization_branch_setup(UUID, UUID, TEXT, UUID, TEXT[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_branch_from_setup(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT[])
  TO authenticated;

-- Preserve the legacy three-argument identity as blank creation.
CREATE OR REPLACE FUNCTION public.create_organization_branch(
  p_organization_id UUID,
  p_legal_entity_id UUID,
  p_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.create_organization_branch_from_setup(
    pg_catalog.gen_random_uuid(),
    p_organization_id,
    p_legal_entity_id,
    p_name,
    'blank',
    NULL,
    ARRAY[]::TEXT[]
  );
  RETURN (v_result->>'accountId')::UUID;
END;
$$;

ALTER FUNCTION public.create_organization_branch(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_organization_branch(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_organization_branch(UUID, UUID, TEXT)
  TO authenticated;

-- ============================================================
-- Completion, restore, and branch discovery.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_organization_branch_setup(
  p_account_id UUID,
  p_configuration_reviewed BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor UUID := (SELECT auth.uid());
  v_account public.accounts%ROWTYPE;
  v_has_prerequisite BOOLEAN;
  v_reviewed_at TIMESTAMPTZ;
BEGIN
  IF v_actor IS NULL OR p_configuration_reviewed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Configuration review acknowledgement is required'
      USING ERRCODE = '22023';
  END IF;
  IF private.requested_account_id() IS DISTINCT FROM p_account_id
     OR NOT public.has_account_membership(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Selected branch admin access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;
  IF v_account.id IS NULL OR v_account.branch_status <> 'active'
     OR v_account.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an active branch can complete setup'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.membership_plans mp
    JOIN public.plan_pricing_options ppo
      ON ppo.account_id = mp.account_id
     AND ppo.plan_id = mp.id
     AND ppo.is_active
    WHERE mp.account_id = p_account_id
      AND mp.is_active
  ) INTO v_has_prerequisite;
  IF NOT v_has_prerequisite THEN
    RAISE EXCEPTION 'An active plan with an active pricing option is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_account.readiness_state = 'ready'
     AND v_account.setup_reviewed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'accountId', p_account_id,
      'readinessState', 'ready',
      'setupReviewedAt', v_account.setup_reviewed_at,
      'setupReviewedBy', v_account.setup_reviewed_by,
      'alreadyComplete', TRUE
    );
  END IF;

  v_reviewed_at := pg_catalog.now();
  UPDATE public.accounts
  SET readiness_state = 'ready',
      setup_reviewed_at = v_reviewed_at,
      setup_reviewed_by = v_actor
  WHERE id = p_account_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  ) VALUES (
    v_account.organization_id, p_account_id, v_actor,
    'branch.setup_completed',
    pg_catalog.jsonb_build_object(
      'prior_readiness_state', v_account.readiness_state,
      'prerequisite', 'active_plan_with_active_pricing_option'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'accountId', p_account_id,
    'readinessState', 'ready',
    'setupReviewedAt', v_reviewed_at,
    'setupReviewedBy', v_actor,
    'alreadyComplete', FALSE
  );
END;
$$;

ALTER FUNCTION public.complete_organization_branch_setup(UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_organization_branch_setup(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_organization_branch_setup(UUID, BOOLEAN)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_branch(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target public.accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_target
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF (SELECT auth.uid()) IS NULL
     OR v_target.id IS NULL
     OR NOT public.is_organization_owner(v_target.organization_id)
     OR NOT public.has_account_membership(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can restore it'
      USING ERRCODE = '42501';
  END IF;
  IF v_target.branch_status <> 'archived' THEN
    RAISE EXCEPTION 'Only an archived branch can be restored'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.accounts
  SET branch_status = 'active',
      readiness_state = 'attention',
      setup_reviewed_at = NULL,
      setup_reviewed_by = NULL,
      archived_at = NULL
  WHERE id = p_account_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation
  ) VALUES (
    v_target.organization_id, p_account_id, (SELECT auth.uid()), 'branch.restored'
  );
END;
$$;

ALTER FUNCTION public.restore_branch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.restore_branch(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_branch(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.my_branch_accounts();
CREATE FUNCTION public.my_branch_accounts()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  organization_id UUID,
  organization_name TEXT,
  legal_entity_id UUID,
  legal_entity_name TEXT,
  role public.account_role_enum,
  branch_status public.branch_status_enum,
  readiness_state public.branch_readiness_enum,
  default_currency TEXT,
  timezone TEXT,
  is_organization_owner BOOLEAN,
  setup_reviewed_at TIMESTAMPTZ,
  setup_reviewed_by UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    a.id,
    a.name,
    a.organization_id,
    o.name,
    a.legal_entity_id,
    le.name,
    am.role,
    a.branch_status,
    a.readiness_state,
    a.default_currency,
    a.timezone,
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = a.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = 'owner'
    ),
    a.setup_reviewed_at,
    a.setup_reviewed_by
  FROM public.account_memberships am
  JOIN public.accounts a ON a.id = am.account_id
  JOIN public.organizations o ON o.id = a.organization_id
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE am.user_id = (SELECT auth.uid())
  ORDER BY o.name, a.name, a.id;
$$;

ALTER FUNCTION public.my_branch_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_branch_accounts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_branch_accounts() TO authenticated;
