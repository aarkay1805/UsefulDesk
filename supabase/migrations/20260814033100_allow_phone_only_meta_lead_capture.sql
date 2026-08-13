-- Meta forms can identify a phone number by value shape while leaving the
-- person's custom-name answer unmapped in note details. Preserve the previous
-- findOrCreateContact behavior by falling back to the normalized phone for the
-- contact name instead of rejecting an otherwise reachable lead.

CREATE OR REPLACE FUNCTION public.capture_meta_lead_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_audit_user_id UUID,
  p_phone TEXT,
  p_name TEXT,
  p_email TEXT,
  p_source TEXT,
  p_note_details TEXT
)
RETURNS TABLE(
  contact_id UUID,
  created_contact BOOLEAN,
  automation_dispatched BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_contact_id UUID;
  v_created BOOLEAN := FALSE;
  v_note_id UUID;
  v_note TEXT;
  v_context JSONB;
  v_automation_dispatched BOOLEAN := FALSE;
BEGIN
  IF v_phone = ''
     OR NOT private.user_has_account_membership(
       p_account_id,
       p_audit_user_id,
       'viewer'::public.account_role_enum
     ) THEN
    RAISE EXCEPTION 'Invalid Meta lead capture context'
      USING ERRCODE = '22023';
  END IF;

  SELECT event.processing_context
  INTO v_context
  FROM public.webhook_events AS event
  WHERE event.id = p_event_id
    AND event.account_id = p_account_id
    AND event.gateway = 'meta'
    AND event.type = 'leadgen'
    AND event.processing_status = 'processing'
    AND event.processed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta lead event is not claimed'
      USING ERRCODE = '55000';
  END IF;

  IF v_context #>> '{meta_lead,contact_id}' IS NOT NULL THEN
    v_contact_id := (v_context #>> '{meta_lead,contact_id}')::UUID;
    v_created := COALESCE(
      (v_context #>> '{meta_lead,created_contact}')::BOOLEAN,
      FALSE
    );
    v_automation_dispatched := COALESCE(
      (v_context #>> '{meta_lead,automation_dispatched}')::BOOLEAN,
      FALSE
    );
    RETURN QUERY
      SELECT v_contact_id, v_created, v_automation_dispatched;
    RETURN;
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
        COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_phone),
        NULLIF(btrim(COALESCE(p_email, '')), ''),
        NULLIF(btrim(COALESCE(p_source, '')), ''),
        'meta'
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
    WHEN v_created THEN 'New lead from a Meta lead ad.'
    ELSE 'Existing lead enquired again via a Meta lead ad.'
  END;
  IF p_note_details IS NOT NULL AND btrim(p_note_details) <> '' THEN
    v_note := v_note || E'\n' || btrim(p_note_details);
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
  )
  RETURNING id INTO v_note_id;

  UPDATE public.webhook_events AS event
  SET processing_context = jsonb_set(
        event.processing_context,
        '{meta_lead}',
        jsonb_build_object(
          'contact_id', v_contact_id,
          'created_contact', v_created,
          'note_id', v_note_id,
          'automation_dispatched', FALSE,
          'captured_at', clock_timestamp()
        ),
        TRUE
      )
  WHERE event.id = p_event_id
    AND event.account_id = p_account_id
    AND event.gateway = 'meta'
    AND event.processing_status = 'processing'
    AND event.processed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meta lead capture state was not retained'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT v_contact_id, v_created, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_meta_lead_webhook_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_meta_lead_webhook_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
