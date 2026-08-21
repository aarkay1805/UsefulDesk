-- Meta requires positive opt-in for proactive WhatsApp templates. Preserve the
-- existing suppression-first behavior for legacy operational purposes, while
-- making the two canonical template scopes positive and fail-closed.

CREATE OR REPLACE FUNCTION public.business_message_allowed(
  p_account_id UUID,
  p_phone TEXT,
  p_purpose TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH target AS (
    SELECT a.organization_id,
           regexp_replace(p_phone, '\D', '', 'g') AS phone_normalized
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND a.branch_status = 'active'
      AND (
        COALESCE(
          auth.jwt()->>'role',
          current_setting('request.jwt.claim.role', TRUE),
          ''
        ) = 'service_role'
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
  ),
  latest_scope_event AS (
    SELECT ce.action, ce.created_at
    FROM public.contact_consent_events ce
    JOIN target t
      ON t.organization_id = ce.organization_id
     AND t.phone_normalized = ce.phone_normalized
    WHERE ce.account_id = p_account_id
      AND ce.purpose = p_purpose
    ORDER BY ce.created_at DESC, ce.id DESC
    LIMIT 1
  )
  SELECT EXISTS (SELECT 1 FROM target)
    AND CASE
      WHEN p_purpose IN (
        'whatsapp_account_updates',
        'whatsapp_marketing'
      ) THEN
        EXISTS (
          SELECT 1
          FROM latest_scope_event latest
          WHERE latest.action = 'opt_in'
            AND (
              NOT EXISTS (SELECT 1 FROM suppression)
              OR latest.created_at > (
                SELECT suppressed_at FROM suppression LIMIT 1
              )
            )
        )
      ELSE
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
    END;
$function$;

ALTER FUNCTION public.business_message_allowed(UUID, TEXT, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.business_message_allowed(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_message_allowed(UUID, TEXT, TEXT)
  TO authenticated, service_role;
