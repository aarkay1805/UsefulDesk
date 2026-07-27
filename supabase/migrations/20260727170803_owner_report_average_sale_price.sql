-- Average initial invoice value for non-trial members who joined in the
-- selected report period, with the immediately preceding period as baseline.
-- SECURITY INVOKER keeps memberships and membership_periods RLS as the tenant
-- boundary.

CREATE OR REPLACE FUNCTION public.owner_report_average_sale_price(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
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
      (report_end + 1)::TIMESTAMP AT TIME ZONE tz AS current_end_at,
      (
        report_start - (report_end - report_start + 1)::INTEGER
      )::TIMESTAMP AT TIME ZONE tz AS previous_start_at
    FROM raw_params
  ),
  first_invoices AS (
    SELECT DISTINCT ON (mp.membership_id)
      mp.membership_id,
      mp.fee_amount
    FROM public.membership_periods AS mp
    ORDER BY
      mp.membership_id,
      mp.period_start,
      mp.created_at,
      mp.id
  ),
  joined_members AS (
    SELECT
      m.id,
      COALESCE(m.converted_at, m.created_at) AS joined_at,
      COALESCE(fi.fee_amount, 0) AS sale_value
    FROM public.memberships AS m
    LEFT JOIN first_invoices AS fi ON fi.membership_id = m.id
    WHERE m.is_trial = FALSE
  ),
  values_by_period AS (
    SELECT
      COUNT(jm.id) FILTER (
        WHERE jm.joined_at >= r.current_start_at
          AND jm.joined_at < r.current_end_at
      ) AS current_count,
      COALESCE(SUM(jm.sale_value) FILTER (
        WHERE jm.joined_at >= r.current_start_at
          AND jm.joined_at < r.current_end_at
      ), 0) AS current_total,
      COUNT(jm.id) FILTER (
        WHERE jm.joined_at >= r.previous_start_at
          AND jm.joined_at < r.current_start_at
      ) AS previous_count,
      COALESCE(SUM(jm.sale_value) FILTER (
        WHERE jm.joined_at >= r.previous_start_at
          AND jm.joined_at < r.current_start_at
      ), 0) AS previous_total
    FROM ranges AS r
    LEFT JOIN joined_members AS jm
      ON jm.joined_at >= r.previous_start_at
      AND jm.joined_at < r.current_end_at
  )
  SELECT jsonb_build_object(
    'current',
    CASE
      WHEN current_count = 0 THEN 0
      ELSE ROUND(current_total / current_count, 2)
    END,
    'previous',
    CASE
      WHEN previous_count = 0 THEN 0
      ELSE ROUND(previous_total / previous_count, 2)
    END
  )
  FROM values_by_period;
$$;

ALTER FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT)
  TO authenticated;
