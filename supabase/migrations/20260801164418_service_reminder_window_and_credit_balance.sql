-- Prevent service automation from sending before the account-local reminder
-- window. The claim remains retryable and deduplicated by service/end/offset.

CREATE OR REPLACE FUNCTION public.claim_service_renewal_reminders(p_limit INTEGER DEFAULT 100)
RETURNS SETOF public.service_renewal_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_candidate public.service_renewal_queue%ROWTYPE;
BEGIN
  FOR v_candidate IN
    SELECT queue.*
    FROM public.service_renewal_queue queue
    WHERE queue.service_enabled
      AND queue.days_until_expiry = ANY(queue.service_days_before)
      AND queue.current_renewal_price IS NOT NULL
      AND queue.item_is_active AND queue.option_is_active
      AND EXTRACT(HOUR FROM NOW() AT TIME ZONE queue.timezone) >= 9
    ORDER BY queue.end_date, queue.id
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  LOOP
    INSERT INTO public.service_renewal_reminders_sent (
      account_id, member_service_id, end_date, days_before,
      status, claimed_at, sent_at, attempts
    ) VALUES (
      v_candidate.account_id, v_candidate.id, v_candidate.end_date,
      v_candidate.days_until_expiry, 'claimed', NOW(), NULL, 1
    )
    ON CONFLICT (member_service_id, end_date, days_before) DO UPDATE SET
      status = 'claimed', claimed_at = NOW(), sent_at = NULL,
      attempts = public.service_renewal_reminders_sent.attempts + 1,
      last_error = NULL, updated_at = NOW()
    WHERE public.service_renewal_reminders_sent.status = 'failed'
       OR (
         public.service_renewal_reminders_sent.status = 'claimed'
         AND public.service_renewal_reminders_sent.claimed_at < NOW() - INTERVAL '15 minutes'
       );
    IF FOUND THEN RETURN NEXT v_candidate; END IF;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_service_renewal_reminders(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_service_renewal_reminders(INTEGER)
  TO service_role;
