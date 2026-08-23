-- Some Pages do not expose Meta's optional has_lead_access diagnostic even
-- though their leadgen webhook subscription is usable. Preserve the last
-- verified timestamp unless the current health check actually verified it.

CREATE OR REPLACE FUNCTION public.complete_meta_page_health_check(
  p_config_id UUID,
  p_account_id UUID,
  p_health_owner UUID,
  p_credential_generation INTEGER,
  p_repaired BOOLEAN DEFAULT FALSE,
  p_lead_access_verified BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_changed UUID;
BEGIN
  UPDATE public.meta_page_config
  SET status = 'connected',
      health_checked_at = v_now,
      last_healthy_at = v_now,
      lead_access_verified_at = CASE
        WHEN p_lead_access_verified THEN v_now
        ELSE lead_access_verified_at
      END,
      subscription_verified_at = v_now,
      last_repair_at = CASE WHEN p_repaired THEN v_now ELSE last_repair_at END,
      subscribed_at = COALESCE(subscribed_at, v_now),
      next_health_check_at = v_now + INTERVAL '6 hours',
      consecutive_health_failures = 0,
      last_error = NULL,
      health_error_code = NULL,
      health_error_resolution = NULL,
      health_lease_owner = NULL,
      health_lease_until = NULL,
      attention_started_at = NULL,
      attention_notified_at = NULL
  WHERE id = p_config_id
    AND account_id = p_account_id
    AND health_lease_owner = p_health_owner
    AND health_lease_until >= v_now
    AND credential_generation = p_credential_generation
  RETURNING id INTO v_changed;

  RETURN v_changed IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_meta_page_health_check(
  UUID, UUID, UUID, INTEGER, BOOLEAN, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_meta_page_health_check(
  UUID, UUID, UUID, INTEGER, BOOLEAN, BOOLEAN
) TO service_role;
