-- One bounded Members -> Payments snapshot.
--
-- The legacy tab loaded every non-cancelled membership with full contact and
-- plan records, loaded positive membership_dues twice, and loaded every paid
-- payment in the current summary window. The browser then joined, filtered,
-- sorted, counted, aggregated, and paginated those datasets. Keep the exact
-- operational and money semantics while crossing the Data API once and
-- returning only the selected dues page plus its summaries.

CREATE OR REPLACE FUNCTION public.member_payment_dues_page(
  p_today DATE,
  p_search TEXT,
  p_plan_ids UUID[],
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
  v_plan_ids UUID[] := COALESCE(p_plan_ids, ARRAY[]::UUID[]);
  v_buckets TEXT[] := COALESCE(p_buckets, ARRAY[]::TEXT[]);
  v_sort_key TEXT := COALESCE(p_sort_key, 'due_date');
  v_sort_direction TEXT := COALESCE(p_sort_direction, 'asc');
  v_week_start DATE;
  v_month_start DATE;
  v_from_date DATE;
  v_result JSONB;
BEGIN
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Member payment date is required'
      USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(v_search) > 200 THEN
    RAISE EXCEPTION 'Member payment search must be 200 characters or fewer'
      USING ERRCODE = '22023';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'Member payment page must be zero or greater'
      USING ERRCODE = '22023';
  END IF;
  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Member payment page size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(v_plan_ids) > 100 THEN
    RAISE EXCEPTION 'Member payment plan filter is too large'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_buckets <@ ARRAY['due_today', 'overdue']::TEXT[]
     OR pg_catalog.cardinality(v_buckets) > 1 THEN
    RAISE EXCEPTION 'Member payment due-status filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_key NOT IN ('name', 'plan', 'due_date', 'status', 'balance') THEN
    RAISE EXCEPTION 'Member payment sort is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Member payment sort direction is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_week_start := p_today - 6;
  v_month_start := pg_catalog.date_trunc('month', p_today)::DATE;
  v_from_date := pg_catalog.least(v_week_start, v_month_start);

  WITH account_context AS MATERIALIZED (
    SELECT account.id, account.timezone
    FROM public.accounts AS account
    ORDER BY account.id
    LIMIT 1
  ),
  due_scope AS MATERIALIZED (
    SELECT
      membership.id,
      membership.start_date,
      membership.plan_id,
      contact.name AS contact_name,
      contact.phone AS contact_phone,
      plan.name AS plan_name,
      due.balance,
      CASE
        WHEN membership.start_date = p_today THEN 'due_today'
        WHEN membership.start_date < p_today THEN 'overdue'
        ELSE NULL
      END AS due_bucket,
      CASE
        WHEN membership.start_date = p_today THEN 0
        WHEN membership.start_date < p_today THEN 1
        ELSE 2
      END AS due_bucket_order,
      pg_catalog.to_jsonb(membership)
        || pg_catalog.jsonb_build_object(
          'balance', due.balance,
          'contact', pg_catalog.to_jsonb(contact),
          'plan', pg_catalog.to_jsonb(plan)
        ) AS row_json
    FROM account_context AS account
    JOIN public.membership_dues AS due
      ON due.account_id = account.id
     AND due.balance > 0
    JOIN public.memberships AS membership
      ON membership.id = due.membership_id
    JOIN public.contacts AS contact
      ON contact.id = membership.contact_id
    LEFT JOIN public.membership_plans AS plan
      ON plan.id = membership.plan_id
  ),
  filtered AS MATERIALIZED (
    SELECT due.*
    FROM due_scope AS due
    WHERE (
        v_search = ''
        OR pg_catalog.strpos(
          pg_catalog.lower(COALESCE(due.contact_name, '')),
          pg_catalog.lower(v_search)
        ) > 0
        OR pg_catalog.strpos(
          pg_catalog.lower(COALESCE(due.contact_phone, '')),
          pg_catalog.lower(v_search)
        ) > 0
        OR pg_catalog.strpos(due.row_json->>'member_number', v_search) > 0
      )
      AND (
        pg_catalog.cardinality(v_plan_ids) = 0
        OR due.plan_id = ANY(v_plan_ids)
      )
      AND (
        pg_catalog.cardinality(v_buckets) = 0
        OR due.due_bucket = ANY(v_buckets)
      )
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
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'asc'
            THEN pg_catalog.lower(COALESCE(filtered.contact_name, '')) END ASC,
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'desc'
            THEN pg_catalog.lower(COALESCE(filtered.contact_name, '')) END DESC,
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'asc'
            THEN COALESCE(filtered.contact_name, '') END ASC,
          CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'desc'
            THEN COALESCE(filtered.contact_name, '') END DESC,
          CASE WHEN v_sort_key = 'plan' AND v_sort_direction = 'asc'
            THEN pg_catalog.lower(COALESCE(filtered.plan_name, '')) END ASC,
          CASE WHEN v_sort_key = 'plan' AND v_sort_direction = 'desc'
            THEN pg_catalog.lower(COALESCE(filtered.plan_name, '')) END DESC,
          CASE WHEN v_sort_key = 'plan' AND v_sort_direction = 'asc'
            THEN COALESCE(filtered.plan_name, '') END ASC,
          CASE WHEN v_sort_key = 'plan' AND v_sort_direction = 'desc'
            THEN COALESCE(filtered.plan_name, '') END DESC,
          CASE WHEN v_sort_key = 'status' AND v_sort_direction = 'asc'
            THEN filtered.due_bucket_order END ASC,
          CASE WHEN v_sort_key = 'status' AND v_sort_direction = 'desc'
            THEN filtered.due_bucket_order END DESC,
          CASE WHEN v_sort_key = 'balance' AND v_sort_direction = 'asc'
            THEN filtered.balance END ASC,
          CASE WHEN v_sort_key = 'balance' AND v_sort_direction = 'desc'
            THEN filtered.balance END DESC,
          CASE WHEN v_sort_key = 'due_date' AND v_sort_direction = 'asc'
            THEN filtered.start_date END ASC,
          CASE WHEN v_sort_key = 'due_date' AND v_sort_direction = 'desc'
            THEN filtered.start_date END DESC,
          filtered.start_date ASC,
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
  ),
  payment_totals AS (
    SELECT
      COALESCE(pg_catalog.sum(payment.amount) FILTER (
        WHERE (payment.paid_at AT TIME ZONE account.timezone)::DATE = p_today
      ), 0)::NUMERIC(14, 2) AS today,
      COALESCE(pg_catalog.sum(payment.amount) FILTER (
        WHERE (payment.paid_at AT TIME ZONE account.timezone)::DATE
          >= v_week_start
      ), 0)::NUMERIC(14, 2) AS week,
      COALESCE(pg_catalog.sum(payment.amount) FILTER (
        WHERE (payment.paid_at AT TIME ZONE account.timezone)::DATE
          >= v_month_start
      ), 0)::NUMERIC(14, 2) AS month
    FROM account_context AS account
    LEFT JOIN public.payments AS payment
      ON payment.account_id = account.id
     AND payment.status = 'paid'
     AND payment.paid_at >= (
       v_from_date::TIMESTAMP AT TIME ZONE account.timezone
     )
    GROUP BY account.id
  )
  SELECT pg_catalog.jsonb_build_object(
    'rows', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(page_rows.row_json ORDER BY page_rows.row_order)
        FROM page_rows
      ),
      '[]'::JSONB
    ),
    'page', (SELECT page FROM pagination),
    'totalCount', (SELECT COUNT(*) FROM filtered),
    'outstandingCount', (SELECT COUNT(*) FROM due_scope),
    'bucketCounts', pg_catalog.jsonb_build_object(
      'due_today', (
        SELECT COUNT(*)
        FROM due_scope
        WHERE due_scope.due_bucket = 'due_today'
          AND (
            pg_catalog.cardinality(v_plan_ids) = 0
            OR due_scope.plan_id = ANY(v_plan_ids)
          )
      ),
      'overdue', (
        SELECT COUNT(*)
        FROM due_scope
        WHERE due_scope.due_bucket = 'overdue'
          AND (
            pg_catalog.cardinality(v_plan_ids) = 0
            OR due_scope.plan_id = ANY(v_plan_ids)
          )
      )
    ),
    'planOptions', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('id', plans.plan_id, 'name', plans.plan_name)
          ORDER BY pg_catalog.lower(plans.plan_name), plans.plan_name, plans.plan_id
        )
        FROM (
          SELECT DISTINCT due_scope.plan_id, due_scope.plan_name
          FROM due_scope
          WHERE due_scope.plan_id IS NOT NULL
            AND due_scope.plan_name IS NOT NULL
        ) AS plans
      ),
      '[]'::JSONB
    ),
    'summary', pg_catalog.jsonb_build_object(
      'today', COALESCE((SELECT payment_totals.today FROM payment_totals), 0),
      'week', COALESCE((SELECT payment_totals.week FROM payment_totals), 0),
      'month', COALESCE((SELECT payment_totals.month FROM payment_totals), 0),
      'outstanding', COALESCE((SELECT pg_catalog.sum(due_scope.balance) FROM due_scope), 0)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.member_payment_dues_page(
  DATE, TEXT, UUID[], TEXT[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_payment_dues_page(
  DATE, TEXT, UUID[], TEXT[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

COMMENT ON FUNCTION public.member_payment_dues_page(
  DATE, TEXT, UUID[], TEXT[], TEXT, TEXT, INTEGER, INTEGER
) IS 'One RLS-invoker Members Payments page, exact filtered total/facets, plan options, and account-local collection/outstanding summary.';
