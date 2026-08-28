-- Dashboard insight aggregates
--
-- Moves only the two unbounded raw-history reads used by the dashboard
-- insights snapshot into Postgres. Both functions are SECURITY INVOKER: the
-- authenticated caller's existing table RLS remains the tenant boundary, and
-- private.requested_account_id() (through is_account_member) keeps reads on
-- the branch selected by the request header. Keeping two functions preserves
-- the dashboard's section-local error behavior.

-- The conversation chart filters by time before following the conversation
-- RLS join. The idempotent index follows the repository's normal migration
-- convention and remains useful if either function is replaced later.
CREATE INDEX IF NOT EXISTS idx_messages_created_at_conversation
  ON public.messages(created_at, conversation_id);

CREATE OR REPLACE FUNCTION public.dashboard_conversation_series(
  p_range_days INTEGER,
  p_time_zone TEXT,
  p_today DATE
)
RETURNS TABLE (
  day DATE,
  incoming BIGINT,
  outgoing BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_range_days IS NULL OR p_range_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'Dashboard insight range must be 7, 30, or 90'
      USING ERRCODE = '22023';
  END IF;
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Dashboard insight end date is required'
      USING ERRCODE = '22004';
  END IF;
  IF p_time_zone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS zone
    WHERE zone.name = p_time_zone
  ) THEN
    RAISE EXCEPTION 'Unknown dashboard insight time zone'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT
      p_today - (p_range_days - 1) + offset_value AS local_day
    FROM pg_catalog.generate_series(0, p_range_days - 1) AS offsets(offset_value)
  ),
  counts AS (
    SELECT
      (message.created_at AT TIME ZONE p_time_zone)::DATE AS local_day,
      count(*) FILTER (WHERE message.sender_type = 'customer') AS incoming,
      count(*) FILTER (WHERE message.sender_type <> 'customer') AS outgoing
    FROM public.messages AS message
    WHERE message.created_at >= (
      (p_today - (p_range_days - 1))::TIMESTAMP AT TIME ZONE p_time_zone
    )
      AND message.created_at < (
        (p_today + 1)::TIMESTAMP AT TIME ZONE p_time_zone
      )
    GROUP BY 1
  )
  SELECT
    days.local_day,
    COALESCE(counts.incoming, 0)::BIGINT,
    COALESCE(counts.outgoing, 0)::BIGINT
  FROM days
  LEFT JOIN counts USING (local_day)
  ORDER BY days.local_day;
END;
$$;

ALTER FUNCTION public.dashboard_conversation_series(INTEGER, TEXT, DATE)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_conversation_series(INTEGER, TEXT, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_conversation_series(INTEGER, TEXT, DATE)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_lead_rating_inputs(
  p_range_days INTEGER,
  p_time_zone TEXT,
  p_today DATE
)
RETURNS TABLE (
  source TEXT,
  cohort_size BIGINT,
  member_conversion_successes BIGINT,
  trial_booking_successes BIGINT,
  human_response_successes BIGINT,
  human_response_sample BIGINT,
  follow_up_successes BIGINT,
  follow_up_sample BIGINT,
  positive_outcome_successes BIGINT,
  positive_outcome_sample BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_range_days IS NULL OR p_range_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'Dashboard insight range must be 7, 30, or 90'
      USING ERRCODE = '22023';
  END IF;
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Dashboard insight end date is required'
      USING ERRCODE = '22004';
  END IF;
  IF p_time_zone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS zone
    WHERE zone.name = p_time_zone
  ) THEN
    RAISE EXCEPTION 'Unknown dashboard insight time zone'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH bounds AS (
    SELECT
      (p_today - (p_range_days - 1))::TIMESTAMP
        AT TIME ZONE p_time_zone AS start_at,
      (p_today + 1)::TIMESTAMP
        AT TIME ZONE p_time_zone AS end_at
  ),
  cohort AS (
    SELECT
      contact.id,
      COALESCE(NULLIF(TRIM(contact.source), ''), 'unknown') AS source,
      contact.lead_status,
      contact.created_at
    FROM public.contacts AS contact
    CROSS JOIN bounds
    WHERE contact.created_at >= bounds.start_at
      AND contact.created_at < bounds.end_at
  ),
  cohort_memberships AS (
    SELECT
      membership.contact_id,
      membership.is_trial,
      membership.converted_at,
      membership.created_at
    FROM public.memberships AS membership
    JOIN cohort ON cohort.id = membership.contact_id
    CROSS JOIN bounds
    WHERE membership.created_at >= bounds.start_at
  ),
  cohort_follow_ups AS (
    SELECT
      follow_up.contact_id,
      bool_or(
        follow_up.status = 'done'
        AND follow_up.outcome = 'trial_booked'
      ) AS has_trial_outcome,
      count(*) FILTER (
        WHERE follow_up.status <> 'cancelled'
          AND follow_up.due_date <= p_today
      ) AS follow_up_sample,
      count(*) FILTER (
        WHERE follow_up.status = 'done'
          AND follow_up.due_date <= p_today
          AND follow_up.completed_at < (
            (follow_up.due_date + 1)::TIMESTAMP AT TIME ZONE p_time_zone
          )
      ) AS follow_up_successes,
      count(*) FILTER (
        WHERE follow_up.status = 'done'
          AND follow_up.outcome IS NOT NULL
      ) AS positive_outcome_sample,
      count(*) FILTER (
        WHERE follow_up.status = 'done'
          AND follow_up.outcome IN (
            'renewed', 'paid', 'promised', 'contacted', 'trial_booked'
          )
      ) AS positive_outcome_successes
    FROM public.follow_ups AS follow_up
    JOIN cohort ON cohort.id = follow_up.contact_id
    CROSS JOIN bounds
    WHERE follow_up.created_at >= bounds.start_at
    GROUP BY follow_up.contact_id
  ),
  eligible_messages AS (
    SELECT
      cohort.id AS contact_id,
      message.id,
      message.sender_type,
      message.created_at
    FROM cohort
    JOIN public.conversations AS conversation
      ON conversation.contact_id = cohort.id
    JOIN public.messages AS message
      ON message.conversation_id = conversation.id
    CROSS JOIN bounds
    WHERE conversation.created_at >= bounds.start_at
      AND message.created_at >= bounds.start_at
      AND message.created_at >= cohort.created_at
  ),
  first_inbound AS (
    SELECT DISTINCT ON (message.contact_id)
      message.contact_id,
      message.id,
      message.created_at
    FROM eligible_messages AS message
    WHERE message.sender_type = 'customer'
    ORDER BY message.contact_id, message.created_at, message.id
  ),
  first_human_response AS (
    SELECT
      inbound.contact_id,
      response.created_at
    FROM first_inbound AS inbound
    LEFT JOIN LATERAL (
      SELECT message.created_at
      FROM eligible_messages AS message
      WHERE message.contact_id = inbound.contact_id
        AND message.sender_type = 'agent'
        AND (
          message.created_at > inbound.created_at
          OR (
            message.created_at = inbound.created_at
            AND message.id > inbound.id
          )
        )
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS response ON TRUE
  ),
  contact_facts AS (
    SELECT
      cohort.id,
      cohort.source,
      (
        membership.contact_id IS NOT NULL
        AND NOT membership.is_trial
        AND COALESCE(membership.converted_at, membership.created_at)
          >= cohort.created_at
        AND COALESCE(membership.converted_at, membership.created_at)
          <= statement_timestamp()
      ) AS converted,
      (
        cohort.lead_status = 'trial_booked'
        OR COALESCE(follow_up.has_trial_outcome, FALSE)
        OR COALESCE(membership.is_trial, FALSE)
        OR membership.converted_at IS NOT NULL
      ) AS trial_booked,
      inbound.contact_id IS NOT NULL AS has_inbound,
      (
        response.created_at IS NOT NULL
        AND response.created_at - inbound.created_at <= INTERVAL '24 hours'
      ) AS responded_in_24h,
      COALESCE(follow_up.follow_up_successes, 0)::BIGINT
        AS follow_up_successes,
      COALESCE(follow_up.follow_up_sample, 0)::BIGINT AS follow_up_sample,
      COALESCE(follow_up.positive_outcome_successes, 0)::BIGINT
        AS positive_outcome_successes,
      COALESCE(follow_up.positive_outcome_sample, 0)::BIGINT
        AS positive_outcome_sample
    FROM cohort
    LEFT JOIN cohort_memberships AS membership
      ON membership.contact_id = cohort.id
    LEFT JOIN cohort_follow_ups AS follow_up
      ON follow_up.contact_id = cohort.id
    LEFT JOIN first_inbound AS inbound
      ON inbound.contact_id = cohort.id
    LEFT JOIN first_human_response AS response
      ON response.contact_id = cohort.id
  )
  SELECT
    contact.source,
    count(*) AS cohort_size,
    count(*) FILTER (WHERE contact.converted) AS member_conversion_successes,
    count(*) FILTER (WHERE contact.trial_booked) AS trial_booking_successes,
    count(*) FILTER (WHERE contact.responded_in_24h)
      AS human_response_successes,
    count(*) FILTER (WHERE contact.has_inbound) AS human_response_sample,
    sum(contact.follow_up_successes)::BIGINT AS follow_up_successes,
    sum(contact.follow_up_sample)::BIGINT AS follow_up_sample,
    sum(contact.positive_outcome_successes)::BIGINT
      AS positive_outcome_successes,
    sum(contact.positive_outcome_sample)::BIGINT AS positive_outcome_sample
  FROM contact_facts AS contact
  GROUP BY contact.source;
END;
$$;

ALTER FUNCTION public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)
  TO authenticated;
