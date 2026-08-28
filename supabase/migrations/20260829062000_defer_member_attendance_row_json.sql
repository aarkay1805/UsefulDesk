-- Keep the roster materialization relational. The original snapshot built a
-- rich JSON object for every eligible member before filtering/pagination;
-- construct that explicit action contract only for the bounded result page.

DO $migration$
DECLARE
  v_function REGPROCEDURE :=
    'public.member_attendance_page(timestamp with time zone,timestamp with time zone,date,text,integer,boolean,text,text,uuid[],text,text,integer,integer)'::REGPROCEDURE;
  v_definition TEXT;
  v_start INTEGER;
  v_finish INTEGER;
  v_base_start TEXT := $start$      SELECT
        membership.id AS membership_id,$start$;
  v_base_finish TEXT := $finish$      FROM public.memberships AS membership$finish$;
  v_base_select TEXT := $replacement$      SELECT
        membership AS membership_record,
        contact AS contact_record,
        plan AS plan_record,
        membership.id AS membership_id,
        membership.plan_id,
        membership.start_date,
        contact.name AS contact_name,
        contact.phone AS contact_phone,
        plan.plan_type,
        plan.attendance_limit_count,
        plan.attendance_limit_interval,
        plan.sessions_count,
        visit.id AS attendance_id,
        visit.account_id AS attendance_account_id,
        visit.contact_id AS attendance_contact_id,
        visit.membership_id AS attendance_membership_id,
        visit.user_id AS attendance_user_id,
        visit.checked_in_at,
        visit.checked_out_at,
        visit.method AS attendance_method,
        visit.note AS attendance_note,
        visit.created_at AS attendance_created_at
$replacement$;
  v_result_start TEXT := $start$      SELECT
        row.membership_json,$start$;
  v_result_finish TEXT := $finish$      FROM page_with_windows AS row$finish$;
  v_result_select TEXT := $replacement$      SELECT
        jsonb_build_object(
          'id', (row.membership_record).id,
          'account_id', (row.membership_record).account_id,
          'contact_id', (row.membership_record).contact_id,
          'user_id', (row.membership_record).user_id,
          'plan_id', (row.membership_record).plan_id,
          'pricing_option_id', (row.membership_record).pricing_option_id,
          'member_number', (row.membership_record).member_number,
          'start_date', (row.membership_record).start_date,
          'end_date', (row.membership_record).end_date,
          'status', (row.membership_record).status,
          'fee_amount', (row.membership_record).fee_amount,
          'fee_status', (row.membership_record).fee_status,
          'frozen_at', (row.membership_record).frozen_at,
          'notes', (row.membership_record).notes,
          'is_trial', (row.membership_record).is_trial,
          'converted_at', (row.membership_record).converted_at,
          'collection_mode', (row.membership_record).collection_mode,
          'conversion_list_price', (row.membership_record).conversion_list_price,
          'conversion_discount_type', (row.membership_record).conversion_discount_type,
          'conversion_discount_value', (row.membership_record).conversion_discount_value,
          'conversion_discount_amount', (row.membership_record).conversion_discount_amount,
          'conversion_standard_end_date', (row.membership_record).conversion_standard_end_date,
          'conversion_bonus_months', (row.membership_record).conversion_bonus_months,
          'created_at', (row.membership_record).created_at,
          'updated_at', (row.membership_record).updated_at,
          'contact', jsonb_build_object(
            'id', (row.contact_record).id,
            'user_id', (row.contact_record).user_id,
            'account_id', (row.contact_record).account_id,
            'phone', (row.contact_record).phone,
            'name', (row.contact_record).name,
            'email', (row.contact_record).email,
            'company', (row.contact_record).company,
            'avatar_url', (row.contact_record).avatar_url,
            'created_at', (row.contact_record).created_at,
            'updated_at', (row.contact_record).updated_at
          ),
          'plan', CASE WHEN (row.plan_record).id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', (row.plan_record).id,
            'account_id', (row.plan_record).account_id,
            'name', (row.plan_record).name,
            'price', (row.plan_record).price,
            'duration_days', (row.plan_record).duration_days,
            'description', (row.plan_record).description,
            'plan_type', (row.plan_record).plan_type,
            'attendance_limit_count', (row.plan_record).attendance_limit_count,
            'attendance_limit_interval', (row.plan_record).attendance_limit_interval,
            'sessions_count', (row.plan_record).sessions_count,
            'is_active', (row.plan_record).is_active,
            'created_at', (row.plan_record).created_at,
            'updated_at', (row.plan_record).updated_at
          ) END
        ) AS membership_json,
        CASE WHEN row.attendance_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', row.attendance_id,
          'account_id', row.attendance_account_id,
          'contact_id', row.attendance_contact_id,
          'membership_id', row.attendance_membership_id,
          'user_id', row.attendance_user_id,
          'checked_in_at', row.checked_in_at,
          'checked_out_at', row.checked_out_at,
          'method', row.attendance_method,
          'note', row.attendance_note,
          'created_at', row.attendance_created_at
        ) END AS attendance_json,
        row.row_order,
        COALESCE(usage.used, 0)::BIGINT AS used
$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_function)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'membership AS membership_record') = 0 THEN
    v_start := pg_catalog.strpos(v_definition, v_base_start);
    v_finish := pg_catalog.strpos(v_definition, v_base_finish);
    IF v_start = 0 OR v_finish <= v_start THEN
      RAISE EXCEPTION 'member_attendance_page base scope shape changed';
    END IF;
    v_definition :=
      pg_catalog.substr(v_definition, 1, v_start - 1)
      || v_base_select
      || pg_catalog.substr(v_definition, v_finish);

    v_definition := pg_catalog.replace(
      v_definition,
      $old$scope.membership_json->>'member_number'$old$,
      $new$(scope.membership_record).member_number::TEXT$new$
    );
    v_definition := pg_catalog.replace(
      v_definition,
      $old$scope.membership_json->'plan'->>'name' AS plan_name$old$,
      $new$(scope.plan_record).name AS plan_name$new$
    );
    v_definition := pg_catalog.replace(
      v_definition,
      $old$scope.membership_json->'plan' <> 'null'::JSONB$old$,
      $new$(scope.plan_record).id IS NOT NULL$new$
    );

    v_start := pg_catalog.strpos(v_definition, v_result_start);
    v_finish := pg_catalog.strpos(v_definition, v_result_finish);
    IF v_start = 0 OR v_finish <= v_start THEN
      RAISE EXCEPTION 'member_attendance_page result scope shape changed';
    END IF;
    v_definition :=
      pg_catalog.substr(v_definition, 1, v_start - 1)
      || v_result_select
      || pg_catalog.substr(v_definition, v_finish);

    EXECUTE v_definition;
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
