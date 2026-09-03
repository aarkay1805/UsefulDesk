-- Repair ambiguity between the register function's installation_id output
-- parameter and the push_installations.installation_id table column.

CREATE OR REPLACE FUNCTION public.register_push_installation(
  p_user_id UUID,
  p_installation_id UUID,
  p_platform TEXT,
  p_environment TEXT,
  p_expo_push_token TEXT,
  p_app_version TEXT DEFAULT NULL,
  p_device_model TEXT DEFAULT NULL,
  p_os_version TEXT DEFAULT NULL
)
RETURNS TABLE(installation_id UUID, registration_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_installation_id IS NULL THEN
    RAISE EXCEPTION 'Push installation identity is required';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Invalid push platform';
  END IF;
  IF p_environment NOT IN ('development', 'preview', 'production') THEN
    RAISE EXCEPTION 'Invalid push environment';
  END IF;
  IF p_expo_push_token IS NULL
    OR length(p_expo_push_token) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_environment || ':' || p_expo_push_token, 0)
  );

  UPDATE public.push_installations AS installation
  SET revoked_at = COALESCE(revoked_at, clock_timestamp())
  WHERE installation.environment = p_environment
    AND installation.expo_push_token = p_expo_push_token
    AND installation.installation_id <> p_installation_id
    AND installation.revoked_at IS NULL;

  INSERT INTO public.push_installations (
    installation_id,
    user_id,
    platform,
    environment,
    expo_push_token,
    app_version,
    device_model,
    os_version,
    last_seen_at,
    revoked_at
  ) VALUES (
    p_installation_id,
    p_user_id,
    p_platform,
    p_environment,
    p_expo_push_token,
    NULLIF(left(btrim(p_app_version), 64), ''),
    NULLIF(left(btrim(p_device_model), 120), ''),
    NULLIF(left(btrim(p_os_version), 64), ''),
    clock_timestamp(),
    NULL
  )
  ON CONFLICT ON CONSTRAINT push_installations_pkey DO UPDATE
  SET user_id = EXCLUDED.user_id,
      platform = EXCLUDED.platform,
      environment = EXCLUDED.environment,
      expo_push_token = EXCLUDED.expo_push_token,
      app_version = EXCLUDED.app_version,
      device_model = EXCLUDED.device_model,
      os_version = EXCLUDED.os_version,
      last_seen_at = clock_timestamp(),
      revoked_at = NULL;

  RETURN QUERY SELECT p_installation_id, 'registered'::TEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_push_installation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_installation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
