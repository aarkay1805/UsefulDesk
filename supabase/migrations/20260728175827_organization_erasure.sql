-- ============================================================
-- Permanent organization erasure.
--
-- Storage objects are purged through the Storage API before this RPC runs;
-- deleting storage.objects rows in SQL would orphan the underlying files.
-- The RPC owns the transactional relational cleanup and re-checks the caller
-- as an organization owner at the database boundary.
-- ============================================================

ALTER TABLE public.data_deletion_requests
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.data_deletion_requests
  DROP CONSTRAINT IF EXISTS data_deletion_requests_source_check,
  ADD CONSTRAINT data_deletion_requests_source_check
    CHECK (source IN (
      'meta_callback',
      'account_erasure',
      'organization_erasure'
    )),
  DROP CONSTRAINT IF EXISTS data_deletion_requests_status_check,
  ADD CONSTRAINT data_deletion_requests_status_check
    CHECK (status IN ('received', 'processing', 'completed', 'failed'));

CREATE OR REPLACE FUNCTION public.delete_organization(
  p_organization_id UUID
) RETURNS TABLE (deleted_account_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account_count INTEGER;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_organization_owner(p_organization_id) THEN
    RAISE EXCEPTION 'Only an organization owner can delete the organization'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize lifecycle changes for this organization. A concurrent branch
  -- create/archive cannot race the account snapshot below.
  PERFORM 1
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_account_count
  FROM public.accounts
  WHERE organization_id = p_organization_id;

  -- profiles.account_id/account_role are compatibility metadata. If a user
  -- also belongs to another organization, point that metadata at a surviving
  -- branch before the doomed account cascade runs.
  WITH replacements AS (
    SELECT DISTINCT ON (p.user_id)
      p.id AS profile_id,
      am.account_id,
      am.role
    FROM public.profiles p
    JOIN public.accounts doomed
      ON doomed.id = p.account_id
     AND doomed.organization_id = p_organization_id
    JOIN public.account_memberships am
      ON am.user_id = p.user_id
    JOIN public.accounts survivor
      ON survivor.id = am.account_id
     AND survivor.organization_id <> p_organization_id
    ORDER BY
      p.user_id,
      CASE survivor.branch_status
        WHEN 'active' THEN 0
        WHEN 'read_only' THEN 1
        ELSE 2
      END,
      am.created_at,
      am.account_id
  )
  UPDATE public.profiles p
  SET account_id = replacements.account_id,
      account_role = replacements.role,
      updated_at = now()
  FROM replacements
  WHERE p.id = replacements.profile_id;

  -- These rows intentionally use RESTRICT or organization-level foreign keys,
  -- so remove them explicitly before the account and organization parents.
  DELETE FROM public.contact_consent_events
  WHERE organization_id = p_organization_id;

  DELETE FROM public.organization_contact_index
  WHERE organization_id = p_organization_id;

  DELETE FROM public.organization_message_suppressions
  WHERE organization_id = p_organization_id;

  DELETE FROM public.organization_audit_log
  WHERE organization_id = p_organization_id;

  DELETE FROM public.account_memberships am
  USING public.accounts a
  WHERE am.account_id = a.id
    AND a.organization_id = p_organization_id;

  -- Every operational account_id foreign key is CASCADE (apart from the two
  -- explicit RESTRICT tables handled above), so this removes all branch data.
  DELETE FROM public.accounts
  WHERE organization_id = p_organization_id;

  DELETE FROM public.organization_memberships
  WHERE organization_id = p_organization_id;

  DELETE FROM public.legal_entities
  WHERE organization_id = p_organization_id;

  DELETE FROM public.organizations
  WHERE id = p_organization_id;

  RETURN QUERY SELECT v_account_count;
END;
$$;

ALTER FUNCTION public.delete_organization(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_organization(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_organization(UUID)
  TO authenticated;
