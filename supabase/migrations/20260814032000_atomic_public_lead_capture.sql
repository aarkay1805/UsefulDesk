-- A public form submission used to commit the contact, note, and consent
-- proof through separate Data API requests. A later write failure could leave
-- the contact behind, return success without consent evidence, and make the
-- retry look deduped so new-contact automation never fired. Keep the complete
-- database capture boundary in one transaction.

CREATE OR REPLACE FUNCTION public.capture_public_lead_form_submission(
  p_account_id UUID,
  p_form_id UUID,
  p_audit_user_id UUID,
  p_phone TEXT,
  p_name TEXT,
  p_email TEXT,
  p_goal TEXT,
  p_goal_label TEXT,
  p_source TEXT,
  p_consent_text TEXT,
  p_ip TEXT,
  p_user_agent TEXT
)
RETURNS TABLE(contact_id UUID, created_contact BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_contact_id UUID;
  v_created BOOLEAN := FALSE;
  v_note TEXT;
BEGIN
  IF v_phone = ''
     OR p_name IS NULL
     OR btrim(p_name) = ''
     OR NOT EXISTS (
       SELECT 1
       FROM public.lead_capture_forms AS form
       WHERE form.id = p_form_id
         AND form.account_id = p_account_id
         AND form.is_active
     )
     OR NOT private.user_has_account_membership(
       p_account_id,
       p_audit_user_id,
       'viewer'::public.account_role_enum
     ) THEN
    RAISE EXCEPTION 'Invalid public lead capture context'
      USING ERRCODE = '22023';
  END IF;

  SELECT contact.id
  INTO v_contact_id
  FROM public.contacts AS contact
  WHERE contact.account_id = p_account_id
    AND (
      contact.phone_normalized = v_phone
      OR (
        length(contact.phone_normalized) >= 8
        AND length(v_phone) >= 8
        AND right(contact.phone_normalized, 8) = right(v_phone, 8)
      )
    )
  ORDER BY
    (contact.phone_normalized = v_phone) DESC,
    contact.created_at,
    contact.id
  LIMIT 1
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    BEGIN
      INSERT INTO public.contacts (
        account_id,
        user_id,
        phone,
        name,
        email,
        source,
        received_via
      )
      VALUES (
        p_account_id,
        p_audit_user_id,
        v_phone,
        btrim(p_name),
        NULLIF(btrim(COALESCE(p_email, '')), ''),
        NULLIF(btrim(COALESCE(p_source, '')), ''),
        'form'
      )
      RETURNING id INTO v_contact_id;
      v_created := TRUE;
    EXCEPTION WHEN unique_violation THEN
      SELECT contact.id
      INTO v_contact_id
      FROM public.contacts AS contact
      WHERE contact.account_id = p_account_id
        AND contact.phone_normalized = v_phone
      ORDER BY contact.created_at, contact.id
      LIMIT 1
      FOR UPDATE;

      IF v_contact_id IS NULL THEN
        RAISE;
      END IF;
    END;
  END IF;

  v_note := CASE
    WHEN v_created THEN 'New enquiry via the capture form.'
    ELSE 'Existing lead enquired again via the capture form.'
  END;
  IF p_goal_label IS NOT NULL AND btrim(p_goal_label) <> '' THEN
    v_note := v_note || ' Goal: ' || btrim(p_goal_label);
  END IF;
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    v_note := v_note || ' Email: ' || btrim(p_email);
  END IF;

  INSERT INTO public.contact_notes (
    account_id,
    contact_id,
    user_id,
    note_text
  )
  VALUES (
    p_account_id,
    v_contact_id,
    p_audit_user_id,
    v_note
  );

  INSERT INTO public.lead_capture_submissions (
    account_id,
    form_id,
    contact_id,
    created_contact,
    payload,
    consent,
    consent_text,
    ip,
    user_agent
  )
  VALUES (
    p_account_id,
    p_form_id,
    v_contact_id,
    v_created,
    jsonb_build_object(
      'name', btrim(p_name),
      'phone', v_phone,
      'email', NULLIF(btrim(COALESCE(p_email, '')), ''),
      'goal', COALESCE(p_goal, ''),
      'source', COALESCE(p_source, '')
    ),
    TRUE,
    p_consent_text,
    p_ip,
    p_user_agent
  );

  RETURN QUERY SELECT v_contact_id, v_created;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_public_lead_form_submission(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_public_lead_form_submission(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.capture_public_lead_form_submission(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Service-only atomic contact, enquiry note, submission audit, and consent capture for public lead forms.';
