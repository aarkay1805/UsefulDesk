-- Optional recurring gym-local arrival time. Actual check-in and check-out
-- remain independent attendance timestamps.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS assigned_arrival_time TIME WITHOUT TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.contacts'::regclass
      AND conname = 'contacts_assigned_arrival_half_hour'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_assigned_arrival_half_hour CHECK (
        assigned_arrival_time IS NULL OR (
          EXTRACT(MINUTE FROM assigned_arrival_time) IN (0, 30)
          AND EXTRACT(SECOND FROM assigned_arrival_time) = 0
        )
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.contacts.assigned_arrival_time IS
  'Optional assigned gym-local arrival time in 30-minute steps; actual attendance is separate.';

-- The All members directory uses to_jsonb(contact), so it already includes
-- this column. Attendance explicitly constructs its contact JSON. Patch the
-- latest optimized function body rather than restoring its older definition.
DO $migration$
DECLARE
  v_function REGPROCEDURE :=
    'public.member_attendance_page(timestamp with time zone,timestamp with time zone,date,text,integer,boolean,text,text,uuid[],text,text,integer,integer)'::REGPROCEDURE;
  v_definition TEXT;
  v_old TEXT := $old$'avatar_url', (row.contact_record).avatar_url,$old$;
  v_new TEXT := $new$'avatar_url', (row.contact_record).avatar_url,
            'assigned_arrival_time', (row.contact_record).assigned_arrival_time,$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_function) INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'member_attendance_page contact shape changed';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

-- The import writer is protected by a separate guard function. Keep that
-- guard intact and set the optional time only after the guarded writer has
-- resolved the contact. Existing contacts are updated only when the reviewer
-- chose the CSV profile, matching every other imported profile field.
DO $migration$
DECLARE
  v_function REGPROCEDURE := 'public.perform_member_import_group(jsonb)'::REGPROCEDURE;
  v_definition TEXT;
  v_old TEXT := $old$  v_result := public.perform_member_import_group_unchecked(v_inner_payload);$old$;
  v_new TEXT := $new$  v_result := public.perform_member_import_group_unchecked(v_inner_payload);
  IF v_contact ? 'assigned_arrival_time'
     AND (v_contact_id IS NULL
       OR COALESCE((v_contact->>'use_csv')::BOOLEAN, FALSE)) THEN
    UPDATE public.contacts AS contact
    SET assigned_arrival_time = NULLIF(v_contact->>'assigned_arrival_time', '')::TIME
    WHERE contact.id = NULLIF(v_result->>'contact_id', '')::UUID
      AND contact.account_id = v_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Imported customer contact not found';
    END IF;
  END IF;$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_function) INTO v_definition;
  IF pg_catalog.strpos(v_definition, $patched$v_contact ? 'assigned_arrival_time'$patched$) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'perform_member_import_group guard shape changed';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.perform_member_import_group(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_member_import_group(JSONB)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
