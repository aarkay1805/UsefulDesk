-- ============================================================
-- Organization-over-accounts multi-branch foundation.
--
-- Existing accounts remain the operational/RLS tenant boundary and become
-- branches. Organizations group branches for owner access and read-only
-- consolidated reporting. No operational row moves and no integration
-- credential is copied.
--
-- Rollout compatibility:
--   * account_memberships is the authorization source of truth.
--   * profiles.account_id/account_role remain as a non-authoritative default
--     for old URLs while branch-aware clients send x-usefuldesk-account-id.
--   * is_account_member requires the requested branch to equal the row's
--     account, so an accidental unfiltered query can never return A + B.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_role_enum') THEN
    CREATE TYPE public.organization_role_enum AS ENUM ('owner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'branch_status_enum') THEN
    CREATE TYPE public.branch_status_enum AS ENUM ('active', 'read_only', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'branch_readiness_enum') THEN
    CREATE TYPE public.branch_readiness_enum AS ENUM ('setup', 'ready', 'attention');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_action_enum') THEN
    CREATE TYPE public.consent_action_enum AS ENUM ('opt_in', 'opt_out');
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  legal_name TEXT,
  tax_identifier TEXT,
  default_currency TEXT NOT NULL DEFAULT 'INR'
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS legal_entity_id UUID REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_status public.branch_status_enum NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS readiness_state public.branch_readiness_enum NOT NULL DEFAULT 'setup',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- owner_user_id remains the branch's primary-owner pointer, but an owner may
-- now own multiple branch accounts.
DROP INDEX IF EXISTS public.idx_accounts_one_per_owner;

CREATE TABLE IF NOT EXISTS public.account_memberships (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.account_role_enum NOT NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.organization_role_enum NOT NULL DEFAULT 'owner',
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operation TEXT NOT NULL CHECK (length(btrim(operation)) > 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Minimal organization-level discovery index. Branch-local contacts remain
-- authoritative and no automatic merge is performed.
CREATE TABLE IF NOT EXISTS public.organization_contact_index (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone_normalized TEXT NOT NULL CHECK (phone_normalized <> ''),
  display_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, contact_id)
);

-- An organization opt-out suppresses proactive messaging everywhere by
-- default. A later branch+purpose opt-in is an explicit narrow exception;
-- it never deletes or rewrites the suppression audit record.
CREATE TABLE IF NOT EXISTS public.organization_message_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  phone_normalized TEXT NOT NULL CHECK (phone_normalized <> ''),
  source_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  reason TEXT,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suppressed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lifted_at TIMESTAMPTZ,
  lifted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_suppressions_active_phone
  ON public.organization_message_suppressions (organization_id, phone_normalized)
  WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.contact_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_normalized TEXT NOT NULL CHECK (phone_normalized <> ''),
  purpose TEXT NOT NULL CHECK (length(btrim(purpose)) > 0),
  action public.consent_action_enum NOT NULL,
  source TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_memberships_user
  ON public.account_memberships (user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_account_memberships_account_role
  ON public.account_memberships (account_id, role);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_user
  ON public.organization_memberships (user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_accounts_organization
  ON public.accounts (organization_id, branch_status);
CREATE INDEX IF NOT EXISTS idx_accounts_legal_entity
  ON public.accounts (legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_legal_entities_organization
  ON public.legal_entities (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_created
  ON public.organization_audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_contact_phone
  ON public.organization_contact_index (organization_id, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_consent_scope_created
  ON public.contact_consent_events
    (organization_id, phone_normalized, account_id, purpose, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON public.legal_entities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.legal_entities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON public.account_memberships;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.account_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- One organization + legal entity per existing account is deliberately the
-- conservative backfill. Owners can group branches later without ever
-- guessing that two similarly named gyms share a legal/payment boundary.
DO $$
DECLARE
  v_account RECORD;
  v_organization_id UUID;
  v_legal_entity_id UUID;
BEGIN
  FOR v_account IN
    SELECT a.*
    FROM public.accounts a
    WHERE a.organization_id IS NULL OR a.legal_entity_id IS NULL
    ORDER BY a.created_at, a.id
  LOOP
    IF v_account.organization_id IS NULL THEN
      INSERT INTO public.organizations (name)
      VALUES (v_account.name)
      RETURNING id INTO v_organization_id;
    ELSE
      v_organization_id := v_account.organization_id;
    END IF;

    IF v_account.legal_entity_id IS NULL THEN
      INSERT INTO public.legal_entities (
        organization_id, name, legal_name, default_currency
      )
      VALUES (
        v_organization_id,
        v_account.name,
        v_account.name,
        v_account.default_currency
      )
      RETURNING id INTO v_legal_entity_id;
    ELSE
      v_legal_entity_id := v_account.legal_entity_id;
    END IF;

    UPDATE public.accounts
    SET organization_id = v_organization_id,
        legal_entity_id = v_legal_entity_id,
        readiness_state = CASE
          WHEN EXISTS (
            SELECT 1 FROM public.whatsapp_config wc
            WHERE wc.account_id = v_account.id
          ) THEN 'ready'::public.branch_readiness_enum
          ELSE 'setup'::public.branch_readiness_enum
        END
    WHERE id = v_account.id;
  END LOOP;

  INSERT INTO public.account_memberships (account_id, user_id, role, created_by_user_id, created_at)
  SELECT p.account_id, p.user_id, p.account_role, p.user_id, COALESCE(p.created_at, now())
  FROM public.profiles p
  ON CONFLICT (account_id, user_id) DO UPDATE
    SET role = EXCLUDED.role;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, created_by_user_id
  )
  SELECT DISTINCT a.organization_id, a.owner_user_id,
         'owner'::public.organization_role_enum, a.owner_user_id
  FROM public.accounts a
  ON CONFLICT (organization_id, user_id) DO NOTHING;
END $$;

ALTER TABLE public.accounts
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN legal_entity_id SET NOT NULL;

-- The composite FK prevents assigning a branch to a legal entity from a
-- different organization.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_organization_legal_entity_fkey'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_organization_legal_entity_fkey
      FOREIGN KEY (organization_id, legal_entity_id)
      REFERENCES public.legal_entities(organization_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================
-- Authorization helpers.
-- ============================================================

CREATE OR REPLACE FUNCTION private.requested_account_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_headers JSONB;
  v_header TEXT;
  v_legacy UUID;
BEGIN
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  v_header := NULLIF(btrim(v_headers->>'x-usefuldesk-account-id'), '');
  IF v_header IS NOT NULL THEN
    IF v_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN NULL;
    END IF;
    RETURN v_header::uuid;
  END IF;

  -- Compatibility only: old URLs keep their existing branch, never all
  -- memberships. New branch-aware clients always send the header.
  SELECT p.account_id INTO v_legacy
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
  RETURN v_legacy;
END;
$$;

ALTER FUNCTION private.requested_account_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.requested_account_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.requested_account_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_account_membership(
  target_account_id UUID,
  min_role public.account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_memberships am
    WHERE am.account_id = target_account_id
      AND am.user_id = auth.uid()
      AND CASE am.role
            WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
            WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1
          END
          >=
          CASE min_role
            WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
            WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION public.has_account_membership(UUID, public.account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_account_membership(UUID, public.account_role_enum)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_account_membership(UUID, public.account_role_enum)
  TO authenticated, service_role;

-- SECURITY DEFINER operations that validate a target teammate use this
-- internal predicate. A user's profile can name only their legacy/default
-- branch and is never a valid multi-branch membership lookup.
CREATE OR REPLACE FUNCTION private.user_has_account_membership(
  target_account_id UUID,
  target_user_id UUID,
  min_role public.account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_memberships am
    WHERE am.account_id = target_account_id
      AND am.user_id = target_user_id
      AND CASE am.role
            WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
            WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1
          END
          >=
          CASE min_role
            WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
            WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION private.user_has_account_membership(
  UUID, UUID, public.account_role_enum
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.user_has_account_membership(
  UUID, UUID, public.account_role_enum
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.user_has_account_membership(
  UUID, UUID, public.account_role_enum
) TO service_role;

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role public.account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT target_account_id = private.requested_account_id()
    AND public.has_account_membership(target_account_id, min_role);
$$;

ALTER FUNCTION public.is_account_member(UUID, public.account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_member(UUID, public.account_role_enum)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, public.account_role_enum)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_organization_owner(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = target_organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
  );
$$;

ALTER FUNCTION public.is_organization_owner(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_organization_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_organization_owner(UUID)
  TO authenticated, service_role;

-- ============================================================
-- RLS for new organization/membership tables.
-- ============================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contact_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_message_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_organization_owner(id));

DROP POLICY IF EXISTS legal_entities_select ON public.legal_entities;
CREATE POLICY legal_entities_select ON public.legal_entities
  FOR SELECT TO authenticated
  USING (public.is_organization_owner(organization_id));
DROP POLICY IF EXISTS legal_entities_insert ON public.legal_entities;
CREATE POLICY legal_entities_insert ON public.legal_entities
  FOR INSERT TO authenticated
  WITH CHECK (public.is_organization_owner(organization_id));
DROP POLICY IF EXISTS legal_entities_update ON public.legal_entities;
CREATE POLICY legal_entities_update ON public.legal_entities
  FOR UPDATE TO authenticated
  USING (public.is_organization_owner(organization_id))
  WITH CHECK (public.is_organization_owner(organization_id));

DROP POLICY IF EXISTS account_memberships_select ON public.account_memberships;
CREATE POLICY account_memberships_select ON public.account_memberships
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS organization_memberships_select ON public.organization_memberships;
CREATE POLICY organization_memberships_select ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (public.is_organization_owner(organization_id));

DROP POLICY IF EXISTS organization_audit_log_select ON public.organization_audit_log;
CREATE POLICY organization_audit_log_select ON public.organization_audit_log
  FOR SELECT TO authenticated
  USING (public.is_organization_owner(organization_id));

DROP POLICY IF EXISTS organization_contact_index_select ON public.organization_contact_index;
CREATE POLICY organization_contact_index_select ON public.organization_contact_index
  FOR SELECT TO authenticated
  USING (
    public.is_organization_owner(organization_id)
    AND public.has_account_membership(account_id)
  );

DROP POLICY IF EXISTS organization_message_suppressions_select
  ON public.organization_message_suppressions;
CREATE POLICY organization_message_suppressions_select
  ON public.organization_message_suppressions
  FOR SELECT TO authenticated
  USING (public.is_organization_owner(organization_id));

DROP POLICY IF EXISTS contact_consent_events_select ON public.contact_consent_events;
CREATE POLICY contact_consent_events_select ON public.contact_consent_events
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

-- New public-schema tables are not guaranteed to be Data API exposed on
-- current Supabase projects. Grant only the read/write surfaces used by
-- authenticated code; RLS remains mandatory above.
GRANT SELECT ON public.organizations, public.legal_entities,
  public.account_memberships, public.organization_memberships,
  public.organization_audit_log, public.organization_contact_index,
  public.organization_message_suppressions, public.contact_consent_events
  TO authenticated;
GRANT INSERT, UPDATE ON public.legal_entities TO authenticated;

-- ============================================================
-- Branch discovery, audit, lifecycle, and staff management RPCs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_branch_accounts()
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
  is_organization_owner BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
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
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  FROM public.account_memberships am
  JOIN public.accounts a ON a.id = am.account_id
  JOIN public.organizations o ON o.id = a.organization_id
  JOIN public.legal_entities le ON le.id = a.legal_entity_id
  WHERE am.user_id = auth.uid()
  ORDER BY o.name, a.name, a.id;
$$;

ALTER FUNCTION public.my_branch_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_branch_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_branch_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_branch_switch(p_target_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org UUID;
  v_from UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_account_membership(p_target_account_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_org
  FROM public.accounts
  WHERE id = p_target_account_id
    AND branch_status <> 'archived';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Branch is archived or unavailable' USING ERRCODE = '22023';
  END IF;

  v_from := private.requested_account_id();
  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  VALUES (
    v_org, p_target_account_id, auth.uid(), 'branch.switch',
    jsonb_build_object('from_account_id', v_from, 'to_account_id', p_target_account_id)
  );
END;
$$;

ALTER FUNCTION public.record_branch_switch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_branch_switch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_branch_switch(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_account_members(p_account_id UUID)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  role public.account_role_enum,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'Branch context is invalid' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    am.user_id,
    p.full_name,
    CASE
      WHEN public.is_account_member(p_account_id, 'admin') THEN p.email
      ELSE NULL
    END,
    p.avatar_url,
    am.role,
    am.created_at
  FROM public.account_memberships am
  JOIN public.profiles p ON p.user_id = am.user_id
  WHERE am.account_id = p_account_id
  ORDER BY am.created_at, am.user_id;
END;
$$;

ALTER FUNCTION public.list_account_members(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_account_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_account_members(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role public.account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account UUID := private.requested_account_id();
  v_target_role public.account_role_enum;
BEGIN
  IF auth.uid() IS NULL OR v_account IS NULL
     OR NOT public.is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'This action requires branch admin access'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM public.account_memberships
  WHERE account_id = v_account AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this branch'
      USING ERRCODE = '42501';
  END IF;
  IF v_target_role = 'owner' OR p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership for owner changes'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_memberships
  SET role = p_new_role
  WHERE account_id = v_account AND user_id = p_user_id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  SELECT a.organization_id, a.id, auth.uid(), 'branch.member_role_changed',
         jsonb_build_object('user_id', p_user_id, 'from', v_target_role, 'to', p_new_role)
  FROM public.accounts a WHERE a.id = v_account;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, public.account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, public.account_role_enum)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, public.account_role_enum)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account UUID := private.requested_account_id();
  v_target_role public.account_role_enum;
  v_fallback RECORD;
BEGIN
  IF auth.uid() IS NULL OR v_account IS NULL
     OR NOT public.is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'This action requires branch admin access'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM public.account_memberships
  WHERE account_id = v_account AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this branch'
      USING ERRCODE = '42501';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Transfer branch ownership before removal'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.account_memberships
  WHERE account_id = v_account AND user_id = p_user_id;

  -- Keep the legacy profile pointer valid without manufacturing or deleting
  -- memberships. Invitation redemption preserves the user's personal branch,
  -- so a fallback normally exists.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id AND account_id = v_account
  ) THEN
    SELECT am.account_id, am.role INTO v_fallback
    FROM public.account_memberships am
    WHERE am.user_id = p_user_id
    ORDER BY am.created_at, am.account_id
    LIMIT 1;
    IF v_fallback.account_id IS NULL THEN
      RAISE EXCEPTION 'Removal would leave the user without a branch'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles
    SET account_id = v_fallback.account_id,
        account_role = v_fallback.role
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  SELECT a.organization_id, a.id, auth.uid(), 'branch.member_removed',
         jsonb_build_object('user_id', p_user_id, 'role', v_target_role)
  FROM public.accounts a WHERE a.id = v_account;
  RETURN v_account;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account UUID := private.requested_account_id();
BEGIN
  IF auth.uid() IS NULL OR v_account IS NULL
     OR NOT public.is_account_member(v_account, 'owner') THEN
    RAISE EXCEPTION 'Only the selected branch owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;
  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_account_membership(v_account, 'viewer') OR NOT EXISTS (
    SELECT 1 FROM public.account_memberships
    WHERE account_id = v_account AND user_id = p_new_owner_user_id
  ) THEN
    RAISE EXCEPTION 'Target user is not a member of this branch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.account_memberships
  SET role = 'admin'
  WHERE account_id = v_account AND user_id = auth.uid();
  UPDATE public.account_memberships
  SET role = 'owner'
  WHERE account_id = v_account AND user_id = p_new_owner_user_id;
  UPDATE public.accounts
  SET owner_user_id = p_new_owner_user_id
  WHERE id = v_account;

  -- Compatibility metadata follows only when it points at this branch.
  UPDATE public.profiles p
  SET account_role = am.role
  FROM public.account_memberships am
  WHERE p.user_id = am.user_id
    AND p.account_id = v_account
    AND am.account_id = v_account
    AND am.user_id IN (auth.uid(), p_new_owner_user_id);

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  SELECT a.organization_id, a.id, auth.uid(), 'branch.ownership_transferred',
         jsonb_build_object('new_owner_user_id', p_new_owner_user_id)
  FROM public.accounts a WHERE a.id = v_account;
END;
$$;

ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;

-- Invitation redemption is additive: accepting a branch never removes an
-- existing membership or deletes the user's personal branch.
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inv public.account_invitations%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv
  FROM public.account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation is invalid, used, or expired'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_memberships
    WHERE account_id = v_inv.account_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You are already a member of this branch'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.account_memberships (
    account_id, user_id, role, created_by_user_id
  )
  VALUES (v_inv.account_id, v_caller, v_inv.role, v_inv.created_by_user_id);

  UPDATE public.account_invitations
  SET accepted_at = now(), accepted_by_user_id = v_caller
  WHERE id = v_inv.id;

  UPDATE public.contacts
  SET assigned_to = v_caller,
      pending_invitation_id = NULL,
      pending_assignee_name = NULL
  WHERE account_id = v_inv.account_id
    AND pending_invitation_id = v_inv.id;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  SELECT a.organization_id, a.id, v_caller, 'branch.invitation_redeemed',
         jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.role)
  FROM public.accounts a WHERE a.id = v_inv.account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_organization_branch(
  p_organization_id UUID,
  p_legal_entity_id UUID,
  p_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source public.accounts%ROWTYPE;
  v_new UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner can create a branch'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_name, ''))) = 0 OR length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Branch name must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.legal_entities
    WHERE id = p_legal_entity_id AND organization_id = p_organization_id
      AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Legal entity does not belong to the organization'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.* INTO v_source
  FROM public.accounts a
  JOIN public.account_memberships am ON am.account_id = a.id
  WHERE a.organization_id = p_organization_id
    AND am.user_id = auth.uid()
  ORDER BY a.created_at, a.id
  LIMIT 1;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'No source branch is available' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.accounts (
    name, owner_user_id, organization_id, legal_entity_id,
    branch_status, readiness_state,
    default_currency, country_code, locale, timezone, date_order,
    time_format, week_start, phone_country_code, measurement_system
  )
  VALUES (
    btrim(p_name), auth.uid(), p_organization_id, p_legal_entity_id,
    'active', 'setup',
    v_source.default_currency, v_source.country_code, v_source.locale,
    v_source.timezone, v_source.date_order, v_source.time_format,
    v_source.week_start, v_source.phone_country_code,
    v_source.measurement_system
  )
  RETURNING id INTO v_new;

  INSERT INTO public.account_memberships (account_id, user_id, role, created_by_user_id)
  VALUES (v_new, auth.uid(), 'owner', auth.uid());

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  VALUES (
    p_organization_id, v_new, auth.uid(), 'branch.created',
    jsonb_build_object(
      'legal_entity_id', p_legal_entity_id,
      'credentials_cloned', false
    )
  );
  RETURN v_new;
END;
$$;

ALTER FUNCTION public.create_organization_branch(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_organization_branch(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_branch(UUID, UUID, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_branch(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM public.accounts WHERE id = p_account_id;
  IF auth.uid() IS NULL OR v_org IS NULL
     OR NOT public.is_organization_owner(v_org)
     OR NOT public.has_account_membership(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Only an organization owner who owns the branch can archive it'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.accounts
  SET branch_status = 'archived',
      readiness_state = 'attention',
      archived_at = now()
  WHERE id = p_account_id;
  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation
  )
  VALUES (v_org, p_account_id, auth.uid(), 'branch.archived');
END;
$$;

ALTER FUNCTION public.archive_branch(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_branch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_branch(UUID) TO authenticated;

-- ============================================================
-- Compatibility rewrites for branch-sensitive legacy RPCs.
-- ============================================================

-- Presence is per user *and branch*. This avoids one tab's heartbeat silently
-- moving another tab's presence record to a different branch.
DO $$
DECLARE
  v_pk_name TEXT;
  v_pk_columns TEXT[];
BEGIN
  SELECT con.conname,
         array_agg(att.attname ORDER BY key_columns.ordinality)
  INTO v_pk_name, v_pk_columns
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = key_columns.attnum
  WHERE con.conrelid = 'public.member_presence'::regclass
    AND con.contype = 'p'
  GROUP BY con.conname;

  IF v_pk_columns = ARRAY['user_id']::TEXT[] THEN
    EXECUTE format(
      'ALTER TABLE public.member_presence DROP CONSTRAINT %I',
      v_pk_name
    );
    ALTER TABLE public.member_presence
      ADD PRIMARY KEY (user_id, account_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_account_id UUID := private.requested_account_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;
  IF v_account_id IS NULL
     OR NOT public.has_account_membership(v_account_id) THEN
    RAISE EXCEPTION 'No selected branch for caller' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.member_presence (
    user_id, account_id, status, last_seen_at
  )
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id, account_id) DO UPDATE
    SET status = excluded.status,
        last_seen_at = now();
END;
$$;

ALTER FUNCTION public.touch_presence(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_presence(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(TEXT) TO authenticated;

-- These functions were originally authored against the one-row-per-user
-- profile membership model. Patch only the exact legacy membership/account
-- lookup, and abort the migration if an upstream definition no longer
-- matches so the rollout fails closed instead of silently retaining it.
DO $$
DECLARE
  v_function REGPROCEDURE;
  v_definition TEXT;
  v_rewritten TEXT;
BEGIN
  v_function := 'public.record_expense(date,numeric,text,uuid,text,text,text,uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := regexp_replace(
    v_definition,
    $pattern$SELECT profile\.account_id, COALESCE\(account\.timezone, 'Asia/Kolkata'\)[[:space:]]+INTO v_account_id, v_timezone[[:space:]]+FROM public\.profiles AS profile[[:space:]]+JOIN public\.accounts AS account ON account\.id = profile\.account_id[[:space:]]+WHERE profile\.user_id = auth\.uid\(\);$pattern$,
    $replacement$v_account_id := private.requested_account_id();
  SELECT COALESCE(account.timezone, 'Asia/Kolkata')
  INTO v_timezone
  FROM public.accounts AS account
  WHERE account.id = v_account_id;$replacement$
  );
  IF v_rewritten = v_definition THEN
    RAISE EXCEPTION 'record_expense legacy account lookup did not match';
  END IF;
  v_rewritten := replace(
    v_rewritten,
    'SET search_path TO ''public'', ''pg_temp''',
    'SET search_path TO ''pg_catalog'', ''public'', ''private'', ''pg_temp'''
  );
  EXECUTE v_rewritten;

  v_function := 'public.request_lead_transfer(uuid,uuid,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := regexp_replace(
    v_definition,
    $pattern$SELECT 1 FROM profiles[[:space:]]+WHERE user_id = p_to_user AND account_id = v_account_id[[:space:]]+AND account_role <> 'viewer'$pattern$,
    $replacement$SELECT 1
    WHERE private.user_has_account_membership(
      v_account_id, p_to_user, 'agent'
    )$replacement$
  );
  IF v_rewritten = v_definition THEN
    RAISE EXCEPTION 'request_lead_transfer legacy membership lookup did not match';
  END IF;
  EXECUTE v_rewritten;

  v_function := 'public.request_lead_assignment(uuid,uuid,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := regexp_replace(
    v_definition,
    $pattern$SELECT 1 FROM profiles[[:space:]]+WHERE user_id = p_to_assignee AND account_id = v_account_id[[:space:]]+AND account_role <> 'viewer'$pattern$,
    $replacement$SELECT 1
    WHERE private.user_has_account_membership(
      v_account_id, p_to_assignee, 'agent'
    )$replacement$
  );
  IF v_rewritten = v_definition THEN
    RAISE EXCEPTION 'request_lead_assignment legacy membership lookup did not match';
  END IF;
  EXECUTE v_rewritten;
END $$;

-- ============================================================
-- Signup bootstrap: organization -> legal entity -> branch account.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name TEXT;
  v_org UUID;
  v_legal UUID;
  v_account UUID;
  v_currency TEXT;
BEGIN
  v_name := COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My gym');
  v_currency := CASE WHEN v_meta->>'default_currency' ~ '^[A-Z]{3}$'
                     THEN v_meta->>'default_currency' ELSE 'INR' END;
  INSERT INTO public.organizations (name) VALUES (v_name) RETURNING id INTO v_org;
  INSERT INTO public.legal_entities (
    organization_id, name, legal_name, default_currency
  ) VALUES (v_org, v_name, v_name, v_currency) RETURNING id INTO v_legal;
  INSERT INTO public.accounts (
    name, owner_user_id, organization_id, legal_entity_id,
    country_code, locale, default_currency, timezone,
    date_order, time_format, week_start,
    phone_country_code, measurement_system
  )
  VALUES (
    v_name, NEW.id, v_org, v_legal,
    CASE WHEN v_meta->>'country_code' ~ '^[A-Z]{2}$'
         THEN v_meta->>'country_code' ELSE 'IN' END,
    CASE WHEN v_meta->>'locale' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
         THEN v_meta->>'locale' ELSE 'en-IN' END,
    v_currency,
    CASE WHEN v_meta->>'timezone' ~ '^[A-Za-z0-9_+/-]{1,64}$'
         THEN v_meta->>'timezone' ELSE 'Asia/Kolkata' END,
    CASE WHEN v_meta->>'date_order' IN ('DMY', 'MDY', 'YMD')
         THEN v_meta->>'date_order' ELSE 'DMY' END,
    CASE WHEN v_meta->>'time_format' IN ('12h', '24h')
         THEN v_meta->>'time_format' ELSE '12h' END,
    CASE WHEN v_meta->>'week_start' IN ('0', '1', '6')
         THEN (v_meta->>'week_start')::smallint ELSE 1 END,
    CASE WHEN v_meta->>'phone_country_code' = ''
           OR v_meta->>'phone_country_code' ~ '^\+[0-9]{1,4}$'
         THEN v_meta->>'phone_country_code' ELSE '+91' END,
    CASE WHEN v_meta->>'measurement_system' IN ('metric', 'imperial')
         THEN v_meta->>'measurement_system' ELSE 'metric' END
  )
  RETURNING id INTO v_account;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''), v_account, 'owner');
  INSERT INTO public.account_memberships (account_id, user_id, role, created_by_user_id)
  VALUES (v_account, NEW.id, 'owner', NEW.id);
  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, created_by_user_id
  ) VALUES (v_org, NEW.id, 'owner', NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap organization/account/profile for user %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Duplicate discovery and consent/suppression enforcement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_organization_contact_index()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT organization_id INTO v_org
  FROM public.accounts
  WHERE id = NEW.account_id;
  IF NEW.phone_normalized <> '' THEN
    INSERT INTO public.organization_contact_index (
      organization_id, account_id, contact_id, phone_normalized,
      display_name, updated_at
    )
    VALUES (
      v_org, NEW.account_id, NEW.id, NEW.phone_normalized,
      NEW.name, now()
    )
    ON CONFLICT (account_id, contact_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          phone_normalized = EXCLUDED.phone_normalized,
          display_name = EXCLUDED.display_name,
          updated_at = now();
  ELSE
    DELETE FROM public.organization_contact_index
    WHERE account_id = NEW.account_id AND contact_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_organization_contact_index() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_organization_contact_index()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_organization_contact_index ON public.contacts;
CREATE TRIGGER sync_organization_contact_index
  AFTER INSERT OR UPDATE OF account_id, phone, name ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.sync_organization_contact_index();

INSERT INTO public.organization_contact_index (
  organization_id, account_id, contact_id, phone_normalized, display_name
)
SELECT a.organization_id, c.account_id, c.id, c.phone_normalized, c.name
FROM public.contacts c
JOIN public.accounts a ON a.id = c.account_id
WHERE c.phone_normalized <> ''
ON CONFLICT (account_id, contact_id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      phone_normalized = EXCLUDED.phone_normalized,
      display_name = EXCLUDED.display_name,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.organization_duplicate_contacts(
  p_phone_normalized TEXT
) RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  contact_id UUID,
  display_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.account_id, a.name, i.contact_id, i.display_name
  FROM public.organization_contact_index i
  JOIN public.accounts a ON a.id = i.account_id
  WHERE i.phone_normalized = regexp_replace(p_phone_normalized, '\D', '', 'g')
    AND public.is_organization_owner(i.organization_id)
    AND public.has_account_membership(i.account_id)
  ORDER BY a.name, i.contact_id;
$$;

ALTER FUNCTION public.organization_duplicate_contacts(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.organization_duplicate_contacts(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_duplicate_contacts(TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.business_message_allowed(
  p_account_id UUID,
  p_phone TEXT,
  p_purpose TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH target AS (
    SELECT a.organization_id,
           regexp_replace(p_phone, '\D', '', 'g') AS phone_normalized
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND (
        current_user = 'service_role'
        OR public.has_account_membership(a.id, 'agent')
      )
  ),
  suppression AS (
    SELECT s.suppressed_at
    FROM public.organization_message_suppressions s
    JOIN target t
      ON t.organization_id = s.organization_id
     AND t.phone_normalized = s.phone_normalized
    WHERE s.lifted_at IS NULL
    ORDER BY s.suppressed_at DESC
    LIMIT 1
  )
  SELECT EXISTS (SELECT 1 FROM target)
    AND (
      NOT EXISTS (SELECT 1 FROM suppression)
      OR EXISTS (
        SELECT 1
        FROM public.contact_consent_events ce
        JOIN target t
          ON t.organization_id = ce.organization_id
         AND t.phone_normalized = ce.phone_normalized
        CROSS JOIN suppression s
        WHERE ce.account_id = p_account_id
          AND ce.purpose = p_purpose
          AND ce.action = 'opt_in'
          AND ce.created_at > s.suppressed_at
      )
    );
$$;

ALTER FUNCTION public.business_message_allowed(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.business_message_allowed(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_message_allowed(UUID, TEXT, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_contact_consent(
  p_account_id UUID,
  p_contact_id UUID,
  p_purpose TEXT,
  p_action public.consent_action_enum,
  p_source TEXT,
  p_evidence JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org UUID;
  v_phone TEXT;
  v_event UUID;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Operational branch access is required'
      USING ERRCODE = '42501';
  END IF;
  SELECT a.organization_id, c.phone_normalized
  INTO v_org, v_phone
  FROM public.contacts c
  JOIN public.accounts a ON a.id = c.account_id
  WHERE c.id = p_contact_id AND c.account_id = p_account_id;
  IF v_phone IS NULL OR v_phone = '' THEN
    RAISE EXCEPTION 'Contact does not belong to this branch'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.contact_consent_events (
    organization_id, account_id, contact_id, phone_normalized,
    purpose, action, source, evidence, actor_user_id
  )
  VALUES (
    v_org, p_account_id, p_contact_id, v_phone,
    btrim(p_purpose), p_action, btrim(p_source),
    COALESCE(p_evidence, '{}'::jsonb), auth.uid()
  )
  RETURNING id INTO v_event;

  IF p_action = 'opt_out' THEN
    INSERT INTO public.organization_message_suppressions (
      organization_id, phone_normalized, source_account_id, reason,
      suppressed_by_user_id
    )
    VALUES (
      v_org, v_phone, p_account_id,
      COALESCE(NULLIF(p_evidence->>'reason', ''), p_purpose),
      auth.uid()
    )
    ON CONFLICT (organization_id, phone_normalized)
      WHERE lifted_at IS NULL
    DO UPDATE SET
      source_account_id = EXCLUDED.source_account_id,
      reason = EXCLUDED.reason,
      suppressed_at = now(),
      suppressed_by_user_id = EXCLUDED.suppressed_by_user_id;
  END IF;

  INSERT INTO public.organization_audit_log (
    organization_id, account_id, actor_user_id, operation, details
  )
  VALUES (
    v_org, p_account_id, auth.uid(),
    CASE WHEN p_action = 'opt_out'
      THEN 'consent.organization_suppressed'
      ELSE 'consent.scope_opted_in'
    END,
    jsonb_build_object(
      'contact_id', p_contact_id,
      'purpose', p_purpose,
      'source', p_source,
      'event_id', v_event
    )
  );
  RETURN v_event;
END;
$$;

ALTER FUNCTION public.record_contact_consent(
  UUID, UUID, TEXT, public.consent_action_enum, TEXT, JSONB
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_contact_consent(
  UUID, UUID, TEXT, public.consent_action_enum, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_contact_consent(
  UUID, UUID, TEXT, public.consent_action_enum, TEXT, JSONB
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capture_submission_consent_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.consent AND NEW.contact_id IS NOT NULL THEN
    PERFORM public.record_contact_consent(
      NEW.account_id,
      NEW.contact_id,
      'lead_follow_up',
      'opt_in',
      'lead_capture_form',
      jsonb_build_object(
        'submission_id', NEW.id,
        'consent_text', NEW.consent_text
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.capture_submission_consent_event() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_submission_consent_event()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_submission_consent_event
  ON public.lead_capture_submissions;
CREATE TRIGGER capture_submission_consent_event
  AFTER INSERT ON public.lead_capture_submissions
  FOR EACH ROW EXECUTE FUNCTION public.capture_submission_consent_event();

-- ============================================================
-- Explicit selected-branch and consolidated owner reporting.
-- ============================================================

CREATE OR REPLACE FUNCTION public.selected_branch_owner_report(
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Selected branch owner access is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.owner_report(
    p_start_date, p_end_date, p_time_zone, p_staff_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.selected_branch_owner_report(
  UUID, DATE, DATE, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.selected_branch_owner_report(
  UUID, DATE, DATE, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.selected_branch_owner_report_source_revenue(
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
) RETURNS TABLE (source TEXT, revenue NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Selected branch owner access is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.owner_report_source_revenue(
    p_start_date, p_end_date, p_time_zone, p_staff_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.selected_branch_owner_report_source_revenue(
  UUID, DATE, DATE, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.selected_branch_owner_report_source_revenue(
  UUID, DATE, DATE, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.selected_branch_owner_report_plan_options(
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Selected branch owner access is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.owner_report_plan_options(
    p_start_date, p_end_date, p_time_zone, p_staff_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.selected_branch_owner_report_plan_options(
  UUID, DATE, DATE, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.selected_branch_owner_report_plan_options(
  UUID, DATE, DATE, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.selected_branch_owner_report_average_sale_price(
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Selected branch owner access is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.owner_report_average_sale_price(
    p_start_date, p_end_date, p_time_zone, p_staff_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.selected_branch_owner_report_average_sale_price(
  UUID, DATE, DATE, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.selected_branch_owner_report_average_sale_price(
  UUID, DATE, DATE, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.organization_report_summary(
  p_organization_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH allowed AS (
    SELECT public.is_organization_owner(p_organization_id) AS ok
  ),
  bounds AS (
    SELECT LEAST(p_start_date, p_end_date) AS start_date,
           GREATEST(p_start_date, p_end_date) AS end_date
  ),
  branch_values AS (
    SELECT
      a.id AS account_id,
      a.name AS branch_name,
      a.legal_entity_id,
      le.name AS legal_entity_name,
      a.default_currency,
      a.branch_status,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p, bounds b
        WHERE p.account_id = a.id
          AND p.status = 'paid'
          AND p.paid_at >= b.start_date::timestamp AT TIME ZONE a.timezone
          AND p.paid_at < (b.end_date + 1)::timestamp AT TIME ZONE a.timezone
      ), 0) AS revenue,
      (
        SELECT COUNT(*)
        FROM public.memberships m, bounds b
        WHERE m.account_id = a.id
          AND m.is_trial = false
          AND COALESCE(m.converted_at, m.created_at)
            >= b.start_date::timestamp AT TIME ZONE a.timezone
          AND COALESCE(m.converted_at, m.created_at)
            < (b.end_date + 1)::timestamp AT TIME ZONE a.timezone
      ) AS new_members,
      (
        SELECT COUNT(*)
        FROM public.attendance atn, bounds b
        WHERE atn.account_id = a.id
          AND atn.checked_in_at
            >= b.start_date::timestamp AT TIME ZONE a.timezone
          AND atn.checked_in_at
            < (b.end_date + 1)::timestamp AT TIME ZONE a.timezone
      ) AS visits
    FROM public.accounts a
    JOIN public.legal_entities le ON le.id = a.legal_entity_id
    CROSS JOIN allowed
    WHERE allowed.ok
      AND a.organization_id = p_organization_id
  )
  SELECT CASE
    WHEN NOT (SELECT ok FROM allowed) THEN
      jsonb_build_object('ok', false, 'reason', 'forbidden')
    ELSE jsonb_build_object(
      'ok', true,
      'organizationId', p_organization_id,
      'currencyPolicy', 'separate_totals',
      'branches', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'accountId', account_id,
          'branchName', branch_name,
          'legalEntityId', legal_entity_id,
          'legalEntityName', legal_entity_name,
          'currency', default_currency,
          'status', branch_status,
          'revenue', revenue,
          'newMembers', new_members,
          'visits', visits
        ) ORDER BY branch_name, account_id)
        FROM branch_values
      ), '[]'::jsonb),
      'currencyTotals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'currency', default_currency,
          'revenue', revenue
        ) ORDER BY default_currency)
        FROM (
          SELECT default_currency, SUM(revenue) AS revenue
          FROM branch_values
          GROUP BY default_currency
        ) totals
      ), '[]'::jsonb)
    )
  END;
$$;

ALTER FUNCTION public.organization_report_summary(UUID, DATE, DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.organization_report_summary(UUID, DATE, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_report_summary(UUID, DATE, DATE)
  TO authenticated;
