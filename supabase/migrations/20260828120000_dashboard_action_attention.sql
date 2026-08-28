-- Narrow dashboard action attention aggregate.
--
-- Needs attention renders only three current-state counts. Calling the full
-- 30-day owner report for them also calculated revenue, trend, source, plan,
-- visit, and collection breakdowns that the action card discarded. This
-- SECURITY INVOKER function keeps the caller's existing selected-branch RLS
-- as the tenant boundary and remains readable by every authenticated branch
-- member, including viewers.

CREATE OR REPLACE FUNCTION public.dashboard_action_attention(p_today DATE)
RETURNS TABLE (
  churn_risk BIGINT,
  trial_followups BIGINT,
  failed_mandates BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Dashboard action date is required'
      USING ERRCODE = '22004';
  END IF;

  RETURN QUERY
  SELECT
    (
      SELECT COUNT(*)::BIGINT
      FROM public.memberships AS membership
      JOIN public.contacts AS contact
        ON contact.id = membership.contact_id
      WHERE membership.status = 'active'
        AND membership.is_trial = FALSE
        AND membership.end_date >= p_today
        AND contact.churn_risk = TRUE
    ) AS churn_risk,
    (
      SELECT COUNT(*)::BIGINT
      FROM public.memberships AS membership
      WHERE membership.is_trial = TRUE
        AND membership.status <> 'cancelled'
        AND membership.converted_at IS NULL
        AND membership.end_date <= p_today + 3
    ) AS trial_followups,
    (
      SELECT COUNT(DISTINCT failed.membership_id)::BIGINT
      FROM public.payment_mandates AS failed
      WHERE failed.status = 'failed'
        AND NOT EXISTS (
          SELECT 1
          FROM public.payment_mandates AS active
          WHERE active.membership_id = failed.membership_id
            AND active.status = 'active'
        )
    ) AS failed_mandates;
END;
$$;

ALTER FUNCTION public.dashboard_action_attention(DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_action_attention(DATE)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_action_attention(DATE)
  TO authenticated;
