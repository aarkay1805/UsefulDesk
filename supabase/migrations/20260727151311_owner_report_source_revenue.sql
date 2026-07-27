-- Paid revenue attributed to the acquisition source of contacts created in
-- the selected report period. SECURITY INVOKER keeps the existing account RLS
-- on contacts, memberships, and payments as the tenant boundary.

CREATE OR REPLACE FUNCTION public.owner_report_source_revenue(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (source TEXT, revenue NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH raw_params AS (
    SELECT
      LEAST(
        COALESCE(p_start_date, CURRENT_DATE - 29),
        COALESCE(p_end_date, CURRENT_DATE)
      ) AS report_start,
      GREATEST(
        COALESCE(p_start_date, CURRENT_DATE - 29),
        COALESCE(p_end_date, CURRENT_DATE)
      ) AS report_end,
      COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC') AS tz
  ),
  ranges AS (
    SELECT
      report_start::TIMESTAMP AT TIME ZONE tz AS current_start_at,
      (report_end + 1)::TIMESTAMP AT TIME ZONE tz AS current_end_at
    FROM raw_params
  ),
  cohort AS (
    SELECT
      c.id,
      COALESCE(NULLIF(BTRIM(c.source), ''), 'unknown') AS source
    FROM public.contacts AS c
    CROSS JOIN ranges AS r
    WHERE c.created_at >= r.current_start_at
      AND c.created_at < r.current_end_at
  )
  SELECT
    cohort.source,
    COALESCE(SUM(p.amount), 0)::NUMERIC AS revenue
  FROM cohort
  CROSS JOIN ranges AS r
  LEFT JOIN public.memberships AS m
    ON m.contact_id = cohort.id
    AND m.is_trial = FALSE
  LEFT JOIN public.payments AS p
    ON p.membership_id = m.id
    AND p.status = 'paid'
    AND p.paid_at >= r.current_start_at
    AND p.paid_at < r.current_end_at
  GROUP BY cohort.source
  ORDER BY revenue DESC, cohort.source;
$$;

ALTER FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT)
  TO authenticated;
