-- record_contact_consent is SECURITY DEFINER, so current_user is its owner
-- (`postgres`) while it runs. The previous service-role exception therefore
-- never matched and the submission trigger rejected every public-form write.
-- Read the request JWT role instead; authenticated users still need agent
-- membership, while service-role callers retain the existing trusted path.

CREATE OR REPLACE FUNCTION public.record_contact_consent(
  p_account_id UUID,
  p_contact_id UUID,
  p_purpose TEXT,
  p_action public.consent_action_enum,
  p_source TEXT,
  p_evidence JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_org UUID;
  v_phone TEXT;
  v_event UUID;
  v_request_role TEXT := COALESCE(
    auth.jwt()->>'role',
    current_setting('request.jwt.claim.role', TRUE),
    ''
  );
BEGIN
  IF v_request_role <> 'service_role'
     AND NOT public.is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Operational branch access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.organization_id, contact.phone_normalized
  INTO v_org, v_phone
  FROM public.contacts AS contact
  JOIN public.accounts AS account ON account.id = contact.account_id
  WHERE contact.id = p_contact_id
    AND contact.account_id = p_account_id;

  IF v_phone IS NULL OR v_phone = '' THEN
    RAISE EXCEPTION 'Contact does not belong to this branch'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.contact_consent_events (
    organization_id,
    account_id,
    contact_id,
    phone_normalized,
    purpose,
    action,
    source,
    evidence,
    actor_user_id,
    created_at
  )
  VALUES (
    v_org,
    p_account_id,
    p_contact_id,
    v_phone,
    btrim(p_purpose),
    p_action,
    btrim(p_source),
    COALESCE(p_evidence, '{}'::jsonb),
    auth.uid(),
    clock_timestamp()
  )
  RETURNING id INTO v_event;

  IF p_action = 'opt_out' THEN
    INSERT INTO public.organization_message_suppressions (
      organization_id,
      phone_normalized,
      source_account_id,
      reason,
      suppressed_by_user_id,
      suppressed_at
    )
    VALUES (
      v_org,
      v_phone,
      p_account_id,
      COALESCE(NULLIF(p_evidence->>'reason', ''), p_purpose),
      auth.uid(),
      clock_timestamp()
    )
    ON CONFLICT (organization_id, phone_normalized)
      WHERE lifted_at IS NULL
    DO UPDATE SET
      source_account_id = EXCLUDED.source_account_id,
      reason = EXCLUDED.reason,
      suppressed_at = clock_timestamp(),
      suppressed_by_user_id = EXCLUDED.suppressed_by_user_id;
  END IF;

  INSERT INTO public.organization_audit_log (
    organization_id,
    account_id,
    actor_user_id,
    operation,
    details
  )
  VALUES (
    v_org,
    p_account_id,
    auth.uid(),
    CASE
      WHEN p_action = 'opt_out' THEN 'consent.organization_suppressed'
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
$function$;

ALTER FUNCTION public.record_contact_consent(
  UUID, UUID, TEXT, public.consent_action_enum, TEXT, JSONB
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_contact_consent(
  UUID, UUID, TEXT, public.consent_action_enum, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_contact_consent(
  UUID, UUID, TEXT, public.consent_action_enum, TEXT, JSONB
) TO authenticated, service_role;
