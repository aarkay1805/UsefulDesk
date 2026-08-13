-- Meta lead delivery previously used a disposable webhook_events row while
-- contact creation, the enquiry note, and automation dispatch happened in
-- separate requests. If anything failed after the contact insert, deleting
-- the event claim made the retry dedupe to that contact and forget that this
-- delivery had originally created it. Persist the capture result on the
-- durable event and keep contact + note creation in one transaction.

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS processing_context JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_processing_context_object_check;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_processing_context_object_check
  CHECK (jsonb_typeof(processing_context) = 'object');

CREATE OR REPLACE FUNCTION public.claim_meta_lead_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_payload JSONB,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_claimed_id TEXT;
  v_existing public.webhook_events%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_event_id NOT LIKE 'meta:leadgen:%'
     OR p_account_id IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid Meta lead event identity'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.webhook_events (
    id,
    account_id,
    gateway,
    type,
    payload,
    processing_status,
    attempt_count,
    last_attempt_at,
    processing_started_at,
    next_attempt_at,
    last_error
  )
  VALUES (
    p_event_id,
    p_account_id,
    'meta',
    'leadgen',
    p_payload,
    'processing',
    1,
    v_now,
    v_now,
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET processing_status = 'processing',
      attempt_count = public.webhook_events.attempt_count + 1,
      last_attempt_at = v_now,
      processing_started_at = v_now,
      next_attempt_at = NULL,
      last_error = NULL
  WHERE public.webhook_events.account_id = p_account_id
    AND public.webhook_events.gateway = 'meta'
    AND public.webhook_events.type = 'leadgen'
    AND public.webhook_events.payload IS NOT DISTINCT FROM p_payload
    AND public.webhook_events.processed_at IS NULL
    AND (
      public.webhook_events.processing_status IN ('pending', 'failed')
      OR public.webhook_events.processing_started_at IS NULL
      OR public.webhook_events.processing_started_at
        < v_now
          - make_interval(
              secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
            )
    )
  RETURNING id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.webhook_events
  WHERE id = p_event_id;

  IF v_existing.id IS NULL
     OR v_existing.account_id IS DISTINCT FROM p_account_id
     OR v_existing.gateway IS DISTINCT FROM 'meta'
     OR v_existing.type IS DISTINCT FROM 'leadgen'
     OR v_existing.payload IS DISTINCT FROM p_payload THEN
    RETURN 'conflict';
  END IF;
  IF v_existing.processed_at IS NOT NULL
     OR v_existing.processing_status = 'processed' THEN
    RETURN 'processed';
  END IF;
  RETURN 'busy';
END;
$function$;

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
     OR p_name IS NULL
     OR btrim(p_name) = ''
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
        btrim(p_name),
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

CREATE OR REPLACE FUNCTION public.mark_meta_lead_automation_dispatched(
  p_event_id TEXT,
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH changed AS (
    UPDATE public.webhook_events AS event
    SET processing_context = jsonb_set(
          jsonb_set(
            event.processing_context,
            '{meta_lead,automation_dispatched}',
            'true'::jsonb,
            FALSE
          ),
          '{meta_lead,automation_dispatched_at}',
          to_jsonb(clock_timestamp()),
          TRUE
        )
    WHERE event.id = p_event_id
      AND event.account_id = p_account_id
      AND event.gateway = 'meta'
      AND event.processing_status = 'processing'
      AND event.processed_at IS NULL
      AND event.processing_context #>> '{meta_lead,contact_id}' IS NOT NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$function$;

CREATE OR REPLACE FUNCTION public.complete_meta_lead_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_processing_context JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH changed AS (
    UPDATE public.webhook_events
    SET processing_status = 'processed',
        processing_context = processing_context || COALESCE(
          p_processing_context,
          '{}'::jsonb
        ),
        processed_at = clock_timestamp(),
        processing_started_at = NULL,
        next_attempt_at = NULL,
        last_error = NULL
    WHERE id = p_event_id
      AND account_id = p_account_id
      AND gateway = 'meta'
      AND processing_status = 'processing'
      AND processed_at IS NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$function$;

CREATE OR REPLACE FUNCTION public.fail_meta_lead_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH changed AS (
    UPDATE public.webhook_events
    SET processing_status = 'failed',
        processing_started_at = NULL,
        next_attempt_at = NULL,
        last_error = LEFT(
          COALESCE(p_error, 'Meta lead processing failed'),
          4000
        )
    WHERE id = p_event_id
      AND account_id = p_account_id
      AND gateway = 'meta'
      AND processing_status = 'processing'
      AND processed_at IS NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$function$;

REVOKE ALL ON FUNCTION public.claim_meta_lead_webhook_event(
  TEXT, UUID, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_meta_lead_webhook_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_meta_lead_automation_dispatched(
  TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_meta_lead_webhook_event(
  TEXT, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_meta_lead_webhook_event(
  TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_meta_lead_webhook_event(
  TEXT, UUID, JSONB, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_meta_lead_webhook_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_meta_lead_automation_dispatched(
  TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_meta_lead_webhook_event(
  TEXT, UUID, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_meta_lead_webhook_event(
  TEXT, UUID, TEXT
) TO service_role;

COMMENT ON COLUMN public.webhook_events.processing_context IS
  'Service-only retry state derived while processing a stable provider payload.';
COMMENT ON FUNCTION public.capture_meta_lead_webhook_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Atomically retains a Meta lead contact, one enquiry note, and the original creation result for retry-safe automation dispatch.';
