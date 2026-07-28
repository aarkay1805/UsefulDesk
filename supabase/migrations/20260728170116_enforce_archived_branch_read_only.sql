-- Archived branches retain history for owner reporting but are removed from
-- every operational RLS surface. Organization/reporting SECURITY DEFINER
-- boundaries remain the only read path; no write can accidentally reopen a
-- closed branch.

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
    AND public.has_account_membership(target_account_id, min_role)
    AND EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = target_account_id
        AND a.branch_status <> 'archived'
    );
$$;

ALTER FUNCTION public.is_account_member(
  UUID, public.account_role_enum
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_member(
  UUID, public.account_role_enum
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(
  UUID, public.account_role_enum
) TO authenticated, service_role;

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
      AND a.branch_status = 'active'
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
