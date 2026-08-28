-- One bounded Members -> Follow-ups page.
--
-- The legacy listing crossed PostgREST five times for every interaction: one
-- paged row/exact-total request plus four exact head counts for the rendered
-- due-date chips. Numeric search first downloaded every membership as a sixth
-- request. Materialize the caller's RLS-visible member-task scope once, then
-- derive the bounded page, exact filtered total, and contextual chip counts.

CREATE OR REPLACE FUNCTION public.member_follow_ups_page(
  p_today DATE,
  p_search TEXT,
  p_scope TEXT,
  p_reasons TEXT[],
  p_assignee_ids UUID[],
  p_include_unassigned BOOLEAN,
  p_buckets TEXT[],
  p_sort_key TEXT,
  p_sort_direction TEXT,
  p_page INTEGER,
  p_page_size INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_search TEXT := pg_catalog.btrim(COALESCE(p_search, ''));
  v_scope TEXT := COALESCE(p_scope, 'mine');
  v_reasons TEXT[] := COALESCE(p_reasons, ARRAY[]::TEXT[]);
  v_assignee_ids UUID[] := COALESCE(p_assignee_ids, ARRAY[]::UUID[]);
  v_include_unassigned BOOLEAN := COALESCE(p_include_unassigned, FALSE);
  v_buckets TEXT[] := COALESCE(p_buckets, ARRAY[]::TEXT[]);
  v_sort_key TEXT := COALESCE(p_sort_key, 'due_date');
  v_sort_direction TEXT := COALESCE(p_sort_direction, 'asc');
  v_result JSONB;
BEGIN
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Member follow-up date is required'
      USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(v_search) > 200 THEN
    RAISE EXCEPTION 'Member follow-up search must be 200 characters or fewer'
      USING ERRCODE = '22023';
  END IF;
  IF v_scope NOT IN ('mine', 'team') THEN
    RAISE EXCEPTION 'Member follow-up scope is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_reasons <@ ARRAY[
      'renewal', 'payment', 'trial', 'inactive', 'other'
    ]::TEXT[]
     OR pg_catalog.cardinality(v_reasons) > 5 THEN
    RAISE EXCEPTION 'Member follow-up reason filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(v_assignee_ids) > 100 THEN
    RAISE EXCEPTION 'Member follow-up assignee filter is too large'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_buckets <@ ARRAY['overdue', 'today', 'upcoming']::TEXT[]
     OR pg_catalog.cardinality(v_buckets) > 1 THEN
    RAISE EXCEPTION 'Member follow-up due-date filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_key NOT IN ('customer', 'due_date', 'reason', 'created_at') THEN
    RAISE EXCEPTION 'Member follow-up sort is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Member follow-up sort direction is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'Member follow-up page must be zero or greater'
      USING ERRCODE = '22023';
  END IF;
  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Member follow-up page size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  WITH base_scope AS MATERIALIZED (
    SELECT
      follow_up.id,
      follow_up.due_date,
      follow_up.reason,
      follow_up.created_at,
      contact.name AS contact_name,
      pg_catalog.jsonb_build_object(
        'id', follow_up.id,
        'account_id', follow_up.account_id,
        'contact_id', follow_up.contact_id,
        'membership_id', follow_up.membership_id,
        'assigned_to', follow_up.assigned_to,
        'created_by', follow_up.created_by,
        'reason', follow_up.reason,
        'task_type', follow_up.task_type,
        'due_date', follow_up.due_date,
        'status', follow_up.status,
        'note', follow_up.note,
        'created_at', follow_up.created_at,
        'contact', pg_catalog.jsonb_build_object(
          'id', contact.id,
          'account_id', contact.account_id,
          'user_id', contact.user_id,
          'name', contact.name,
          'phone', contact.phone,
          'email', contact.email,
          'avatar_url', contact.avatar_url,
          'created_at', contact.created_at,
          'updated_at', contact.updated_at
        ),
        'membership', pg_catalog.jsonb_build_object(
          'id', membership.id,
          'account_id', membership.account_id,
          'contact_id', membership.contact_id,
          'member_number', membership.member_number,
          'user_id', membership.user_id,
          'plan_id', membership.plan_id,
          'pricing_option_id', membership.pricing_option_id,
          'start_date', membership.start_date,
          'end_date', membership.end_date,
          'status', membership.status,
          'fee_amount', membership.fee_amount,
          'fee_status', membership.fee_status,
          'is_trial', membership.is_trial,
          'collection_mode', membership.collection_mode,
          'created_at', membership.created_at,
          'updated_at', membership.updated_at,
          'contact', pg_catalog.jsonb_build_object(
            'id', contact.id,
            'account_id', contact.account_id,
            'user_id', contact.user_id,
            'name', contact.name,
            'phone', contact.phone,
            'email', contact.email,
            'avatar_url', contact.avatar_url,
            'created_at', contact.created_at,
            'updated_at', contact.updated_at
          ),
          'plan', CASE
            WHEN plan.id IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object(
              'id', plan.id,
              'account_id', plan.account_id,
              'name', plan.name,
              'price', plan.price,
              'duration_days', plan.duration_days,
              'plan_type', plan.plan_type,
              'is_active', plan.is_active,
              'created_at', plan.created_at,
              'updated_at', plan.updated_at
            )
          END
        )
      ) AS row_json
    FROM public.follow_ups AS follow_up
    JOIN public.contacts AS contact
      ON contact.id = follow_up.contact_id
    JOIN public.memberships AS membership
      ON membership.id = follow_up.membership_id
    LEFT JOIN public.membership_plans AS plan
      ON plan.id = membership.plan_id
    WHERE follow_up.status = 'open'
      AND follow_up.membership_id IS NOT NULL
      AND (
        v_scope = 'team'
        OR follow_up.assigned_to = (SELECT auth.uid())
      )
      AND (
        pg_catalog.cardinality(v_reasons) = 0
        OR follow_up.reason = ANY(v_reasons)
      )
      AND (
        (pg_catalog.cardinality(v_assignee_ids) = 0 AND NOT v_include_unassigned)
        OR follow_up.assigned_to = ANY(v_assignee_ids)
        OR (v_include_unassigned AND follow_up.assigned_to IS NULL)
      )
      AND (
        v_search = ''
        OR (
          v_search ~ '^[0-9]+$'
          AND (
            pg_catalog.strpos(
              pg_catalog.lower(COALESCE(contact.name, '')),
              pg_catalog.lower(v_search)
            ) > 0
            OR pg_catalog.strpos(
              pg_catalog.lower(COALESCE(contact.phone, '')),
              pg_catalog.lower(v_search)
            ) > 0
            OR pg_catalog.strpos(
              COALESCE(membership.member_number::TEXT, ''),
              v_search
            ) > 0
          )
        )
        OR (
          v_search !~ '^[0-9]+$'
          AND (
            contact.name ILIKE '%' || v_search || '%'
            OR contact.phone ILIKE '%' || v_search || '%'
          )
        )
      )
  ),
  filtered AS MATERIALIZED (
    SELECT base.*
    FROM base_scope AS base
    WHERE pg_catalog.cardinality(v_buckets) = 0
      OR CASE v_buckets[1]
           WHEN 'overdue' THEN base.due_date < p_today
           WHEN 'today' THEN base.due_date = p_today
           WHEN 'upcoming' THEN base.due_date > p_today
         END
  ),
  pagination AS MATERIALIZED (
    SELECT pg_catalog.least(
      p_page,
      pg_catalog.greatest(
        pg_catalog.ceil(COUNT(*)::NUMERIC / p_page_size)::INTEGER - 1,
        0
      )
    ) AS page
    FROM filtered
  ),
  ordered AS (
    SELECT
      filtered.*,
      pg_catalog.row_number() OVER (
        ORDER BY
          CASE WHEN v_sort_key = 'customer' AND v_sort_direction = 'asc'
            THEN filtered.contact_name END ASC,
          CASE WHEN v_sort_key = 'customer' AND v_sort_direction = 'desc'
            THEN filtered.contact_name END DESC,
          CASE WHEN v_sort_key = 'reason' AND v_sort_direction = 'asc'
            THEN filtered.reason END ASC,
          CASE WHEN v_sort_key = 'reason' AND v_sort_direction = 'desc'
            THEN filtered.reason END DESC,
          CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'asc'
            THEN filtered.created_at END ASC,
          CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'desc'
            THEN filtered.created_at END DESC,
          CASE WHEN v_sort_key = 'due_date' AND v_sort_direction = 'asc'
            THEN filtered.due_date END ASC,
          CASE WHEN v_sort_key = 'due_date' AND v_sort_direction = 'desc'
            THEN filtered.due_date END DESC,
          filtered.id
      ) AS row_order
    FROM filtered
  ),
  page_rows AS MATERIALIZED (
    SELECT ordered.*
    FROM ordered
    CROSS JOIN pagination
    ORDER BY ordered.row_order
    LIMIT p_page_size
    OFFSET (SELECT page * p_page_size FROM pagination)
  )
  SELECT pg_catalog.jsonb_build_object(
    'rows', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          page_rows.row_json ORDER BY page_rows.row_order
        )
        FROM page_rows
      ),
      '[]'::JSONB
    ),
    'page', (SELECT page FROM pagination),
    'totalCount', (SELECT COUNT(*) FROM filtered),
    'bucketCounts', pg_catalog.jsonb_build_object(
      'all', (SELECT COUNT(*) FROM base_scope),
      'overdue', (
        SELECT COUNT(*) FROM base_scope WHERE due_date < p_today
      ),
      'today', (
        SELECT COUNT(*) FROM base_scope WHERE due_date = p_today
      ),
      'upcoming', (
        SELECT COUNT(*) FROM base_scope WHERE due_date > p_today
      )
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.member_follow_ups_page(
  DATE, TEXT, TEXT, TEXT[], UUID[], BOOLEAN, TEXT[], TEXT, TEXT, INTEGER, INTEGER
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.member_follow_ups_page(
  DATE, TEXT, TEXT, TEXT[], UUID[], BOOLEAN, TEXT[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_follow_ups_page(
  DATE, TEXT, TEXT, TEXT[], UUID[], BOOLEAN, TEXT[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

COMMENT ON FUNCTION public.member_follow_ups_page(
  DATE, TEXT, TEXT, TEXT[], UUID[], BOOLEAN, TEXT[], TEXT, TEXT, INTEGER, INTEGER
) IS 'One RLS-invoker Members Follow-ups page with exact filtered total and contextual due-date facets.';

-- The Members page already coalesces Realtime bursts; publish the table that
-- actually owns follow-up create/reassign/complete changes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'follow_ups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;
  END IF;
END $$;
