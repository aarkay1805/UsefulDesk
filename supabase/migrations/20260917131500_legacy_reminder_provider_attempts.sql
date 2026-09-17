-- Legacy membership, service, and joining-installment reminders used to erase
-- or reopen every sender error.  Once a request crosses the Meta boundary that
-- is unsafe: a lost response or a local message-row failure may follow a real
-- provider acceptance.  Persist that boundary and expose it in Activity.

ALTER TABLE public.renewal_reminders_sent
  ADD COLUMN IF NOT EXISTS delivery_state TEXT NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS provider_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.renewal_reminders_sent
  DROP CONSTRAINT IF EXISTS renewal_reminders_sent_delivery_state_check;
ALTER TABLE public.renewal_reminders_sent
  ADD CONSTRAINT renewal_reminders_sent_delivery_state_check
  CHECK (delivery_state IN ('unconfirmed', 'claimed', 'attempting', 'accepted', 'ambiguous'));

UPDATE public.renewal_reminders_sent
SET delivery_state = CASE
  WHEN wa_message_id IS NOT NULL THEN 'accepted'
  ELSE 'unconfirmed'
END
WHERE delivery_state = 'unconfirmed';

ALTER TABLE public.installment_reminders_sent
  ADD COLUMN IF NOT EXISTS delivery_state TEXT NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS provider_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.installment_reminders_sent
  DROP CONSTRAINT IF EXISTS installment_reminders_sent_delivery_state_check;
ALTER TABLE public.installment_reminders_sent
  ADD CONSTRAINT installment_reminders_sent_delivery_state_check
  CHECK (delivery_state IN ('unconfirmed', 'claimed', 'attempting', 'accepted', 'ambiguous'));

UPDATE public.installment_reminders_sent
SET delivery_state = CASE
  WHEN wa_message_id IS NOT NULL THEN 'accepted'
  ELSE 'unconfirmed'
END
WHERE delivery_state = 'unconfirmed';

ALTER TABLE public.service_renewal_reminders_sent
  ADD COLUMN IF NOT EXISTS provider_attempted_at TIMESTAMPTZ;

ALTER TABLE public.service_renewal_reminders_sent
  DROP CONSTRAINT IF EXISTS service_renewal_reminders_sent_status_check;
ALTER TABLE public.service_renewal_reminders_sent
  ADD CONSTRAINT service_renewal_reminders_sent_status_check
  CHECK (status IN ('claimed', 'attempting', 'sent', 'failed', 'ambiguous'));

-- Old failed/claimed rows predate durable provider-attempt evidence, so their
-- safety is unknowable.  Keep them non-retryable instead of risking a duplicate.
UPDATE public.service_renewal_reminders_sent
SET status = 'ambiguous',
    last_error = COALESCE(last_error, 'legacy provider outcome unknown'),
    updated_at = NOW()
WHERE status IN ('claimed', 'failed');

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
      status, claimed_at, provider_attempted_at, sent_at, attempts
    ) VALUES (
      v_candidate.account_id, v_candidate.id, v_candidate.end_date,
      v_candidate.days_until_expiry, 'claimed', NOW(), NULL, NULL, 1
    )
    ON CONFLICT (member_service_id, end_date, days_before) DO UPDATE SET
      status = 'claimed', claimed_at = NOW(), provider_attempted_at = NULL,
      sent_at = NULL,
      attempts = public.service_renewal_reminders_sent.attempts + 1,
      last_error = NULL, updated_at = NOW()
    WHERE public.service_renewal_reminders_sent.status = 'failed'
      AND public.service_renewal_reminders_sent.provider_attempted_at IS NULL;
    IF FOUND THEN RETURN NEXT v_candidate; END IF;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_service_renewal_reminders(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_service_renewal_reminders(INTEGER)
  TO service_role;

-- Keep the old completion RPC conservative during a rolling deployment.  The
-- new worker writes the explicit states directly, but an old worker reporting
-- failure cannot prove that Meta did not accept the request.
CREATE OR REPLACE FUNCTION public.finish_service_renewal_reminder(
  p_member_service_id UUID,
  p_end_date DATE,
  p_days_before INTEGER,
  p_succeeded BOOLEAN,
  p_wa_message_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.service_renewal_reminders_sent SET
    status = CASE WHEN p_succeeded THEN 'sent' ELSE 'ambiguous' END,
    sent_at = CASE WHEN p_succeeded THEN NOW() ELSE NULL END,
    wa_message_id = CASE WHEN p_succeeded THEN p_wa_message_id ELSE wa_message_id END,
    provider_attempted_at = COALESCE(provider_attempted_at, NOW()),
    last_error = CASE WHEN p_succeeded THEN NULL ELSE LEFT(COALESCE(p_error, 'Unknown provider outcome'), 1000) END,
    updated_at = NOW()
  WHERE member_service_id = p_member_service_id
    AND end_date = p_end_date AND days_before = p_days_before
    AND status IN ('claimed', 'attempting');
END;
$$;

REVOKE ALL ON FUNCTION public.finish_service_renewal_reminder(
  UUID, DATE, INTEGER, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_service_renewal_reminder(
  UUID, DATE, INTEGER, BOOLEAN, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE VIEW public.automated_message_activity
WITH (security_invoker = true)
AS
WITH lifecycle AS (
  SELECT
    'lifecycle:' || job.id::text AS activity_id,
    job.account_id,
    CASE job.kind
      WHEN 'invoice_due' THEN 'invoice_collection'
      WHEN 'invoice_overdue' THEN 'invoice_collection'
      WHEN 'installment_overdue' THEN 'invoice_collection'
      WHEN 'session_pack_low' THEN 'session_pack'
      WHEN 'session_pack_exhausted' THEN 'session_pack'
      ELSE job.kind
    END AS rule_id,
    job.kind AS source_kind,
    job.contact_id,
    contact.name AS contact_name,
    contact.avatar_url AS contact_avatar_url,
    job.membership_id,
    job.member_service_id,
    job.invoice_id,
    conversation.id AS conversation_id,
    follow_up.id AS follow_up_id,
    COALESCE(message.created_at, job.delivered_at, job.accepted_at, job.updated_at, job.created_at) AS occurred_at,
    job.effective_due_on AS scheduled_for,
    CASE
      WHEN message.status = 'read' THEN 'read'
      WHEN message.status = 'delivered' THEN 'delivered'
      WHEN message.status = 'failed' THEN 'failed'
      WHEN job.state = 'failed' OR job.reason ->> 'code' = 'provider_request_failed' THEN 'failed'
      WHEN job.state = 'accepted' OR job.provider_message_id IS NOT NULL THEN 'accepted'
      WHEN job.state = 'attempting' THEN 'attempting'
      WHEN job.state = 'leased' OR job.state = 'queued' THEN 'waiting'
      WHEN job.state = 'deferred' AND job.reason ->> 'code' IN ('invoice_hold_open', 'invoice_commitment_or_hold_open') THEN 'paused'
      WHEN job.state = 'deferred' THEN 'waiting'
      WHEN job.state = 'blocked' THEN 'blocked'
      WHEN job.state = 'skipped' THEN 'stopped'
      WHEN job.state = 'ambiguous' THEN 'ambiguous'
      ELSE job.state
    END AS outcome,
    job.state AS job_state,
    job.escalation_state,
    job.next_attempt_at,
    job.reason ->> 'code' AS reason_code,
    job.provider_message_id,
    message.status AS message_status,
    message.provider_error_title,
    message.provider_error_detail
  FROM public.lifecycle_reminder_jobs AS job
  JOIN public.contacts AS contact ON contact.id = job.contact_id AND contact.account_id = job.account_id
  LEFT JOIN LATERAL (
    SELECT conversation.id FROM public.conversations AS conversation
    WHERE conversation.account_id = job.account_id AND conversation.contact_id = job.contact_id
    LIMIT 1
  ) AS conversation ON true
  LEFT JOIN LATERAL (
    SELECT message.created_at, message.status, message.provider_error_title, message.provider_error_detail
    FROM public.messages AS message
    JOIN public.conversations AS message_conversation ON message_conversation.id = message.conversation_id
    WHERE message.message_id = job.provider_message_id
      AND message_conversation.account_id = job.account_id
      AND message_conversation.contact_id = job.contact_id
    ORDER BY message.created_at DESC LIMIT 1
  ) AS message ON true
  LEFT JOIN LATERAL (
    SELECT follow_up.id FROM public.follow_ups AS follow_up
    WHERE follow_up.account_id = job.account_id AND follow_up.contact_id = job.contact_id
      AND follow_up.status = 'open'
    ORDER BY follow_up.created_at DESC LIMIT 1
  ) AS follow_up ON true
  WHERE public.is_account_member(job.account_id, 'admin')
), legacy_membership AS (
  SELECT
    'membership-renewal:' || ledger.id::text AS activity_id,
    ledger.account_id,
    'membership_renewal'::text AS rule_id,
    'membership_renewal'::text AS source_kind,
    ledger.contact_id,
    contact.name AS contact_name,
    contact.avatar_url AS contact_avatar_url,
    ledger.membership_id,
    NULL::uuid AS member_service_id,
    NULL::uuid AS invoice_id,
    conversation.id AS conversation_id,
    NULL::uuid AS follow_up_id,
    COALESCE(message.created_at, ledger.provider_attempted_at, ledger.sent_at) AS occurred_at,
    ledger.end_date AS scheduled_for,
    CASE
      WHEN message.status = 'read' THEN 'read'
      WHEN message.status = 'delivered' THEN 'delivered'
      WHEN message.status = 'failed' THEN 'failed'
      WHEN ledger.wa_message_id IS NOT NULL THEN 'accepted'
      WHEN ledger.delivery_state IN ('attempting', 'ambiguous') THEN 'ambiguous'
      WHEN ledger.delivery_state = 'claimed' THEN 'waiting'
      ELSE 'unconfirmed'
    END AS outcome,
    ledger.delivery_state AS job_state,
    NULL::text AS escalation_state,
    NULL::timestamptz AS next_attempt_at,
    CASE
      WHEN ledger.wa_message_id IS NOT NULL AND ledger.last_error IS NOT NULL THEN 'local_message_persistence_failed'
      WHEN ledger.delivery_state IN ('attempting', 'ambiguous') THEN 'provider_outcome_unknown'
      WHEN ledger.delivery_state IN ('claimed', 'unconfirmed') THEN 'legacy_claim_unconfirmed'
    END AS reason_code,
    ledger.wa_message_id AS provider_message_id,
    message.status AS message_status,
    message.provider_error_title,
    message.provider_error_detail
  FROM public.renewal_reminders_sent AS ledger
  JOIN public.contacts AS contact ON contact.id = ledger.contact_id AND contact.account_id = ledger.account_id
  LEFT JOIN LATERAL (SELECT id FROM public.conversations WHERE account_id = ledger.account_id AND contact_id = ledger.contact_id LIMIT 1) AS conversation ON true
  LEFT JOIN LATERAL (
    SELECT message.created_at, message.status, message.provider_error_title, message.provider_error_detail
    FROM public.messages AS message JOIN public.conversations AS message_conversation ON message_conversation.id = message.conversation_id
    WHERE message.message_id = ledger.wa_message_id AND message_conversation.account_id = ledger.account_id AND message_conversation.contact_id = ledger.contact_id
    ORDER BY message.created_at DESC LIMIT 1
  ) AS message ON true
  WHERE public.is_account_member(ledger.account_id, 'admin')
), legacy_service AS (
  SELECT
    'service-renewal:' || ledger.id::text, ledger.account_id, 'service_renewal'::text, 'service_renewal'::text,
    service.contact_id, contact.name, contact.avatar_url, NULL::uuid, ledger.member_service_id, NULL::uuid, conversation.id, NULL::uuid,
    COALESCE(message.created_at, ledger.sent_at, ledger.provider_attempted_at, ledger.claimed_at, ledger.updated_at), ledger.end_date,
    CASE
      WHEN message.status = 'read' THEN 'read'
      WHEN message.status = 'delivered' THEN 'delivered'
      WHEN message.status = 'failed' THEN 'failed'
      WHEN ledger.wa_message_id IS NOT NULL THEN 'accepted'
      WHEN ledger.status IN ('attempting', 'ambiguous') THEN 'ambiguous'
      WHEN ledger.status = 'claimed' THEN 'waiting'
      ELSE 'unconfirmed'
    END,
    ledger.status, NULL::text, NULL::timestamptz,
    CASE
      WHEN ledger.wa_message_id IS NOT NULL AND ledger.last_error IS NOT NULL THEN 'local_message_persistence_failed'
      WHEN ledger.status IN ('attempting', 'ambiguous') THEN 'provider_outcome_unknown'
      WHEN ledger.status = 'claimed' THEN 'legacy_claim_unconfirmed'
      WHEN ledger.status = 'failed' THEN 'provider_request_failed'
    END,
    ledger.wa_message_id, message.status, message.provider_error_title, message.provider_error_detail
  FROM public.service_renewal_reminders_sent AS ledger
  JOIN public.member_services AS service ON service.id = ledger.member_service_id AND service.account_id = ledger.account_id
  JOIN public.contacts AS contact ON contact.id = service.contact_id AND contact.account_id = ledger.account_id
  LEFT JOIN LATERAL (SELECT id FROM public.conversations WHERE account_id = ledger.account_id AND contact_id = service.contact_id LIMIT 1) AS conversation ON true
  LEFT JOIN LATERAL (
    SELECT message.created_at, message.status, message.provider_error_title, message.provider_error_detail
    FROM public.messages AS message JOIN public.conversations AS message_conversation ON message_conversation.id = message.conversation_id
    WHERE message.message_id = ledger.wa_message_id AND message_conversation.account_id = ledger.account_id AND message_conversation.contact_id = service.contact_id
    ORDER BY message.created_at DESC LIMIT 1
  ) AS message ON true
  WHERE public.is_account_member(ledger.account_id, 'admin')
), legacy_installment AS (
  SELECT
    'installment:' || ledger.id::text, ledger.account_id, 'joining_installments'::text, 'joining_installments'::text,
    ledger.contact_id, contact.name, contact.avatar_url, ledger.membership_id, NULL::uuid, plan.invoice_id, conversation.id, NULL::uuid,
    COALESCE(message.created_at, ledger.provider_attempted_at, ledger.sent_at), ledger.due_on,
    CASE
      WHEN message.status = 'read' THEN 'read'
      WHEN message.status = 'delivered' THEN 'delivered'
      WHEN message.status = 'failed' THEN 'failed'
      WHEN ledger.wa_message_id IS NOT NULL THEN 'accepted'
      WHEN ledger.delivery_state IN ('attempting', 'ambiguous') THEN 'ambiguous'
      WHEN ledger.delivery_state = 'claimed' THEN 'waiting'
      ELSE 'unconfirmed'
    END,
    ledger.delivery_state, NULL::text, NULL::timestamptz,
    CASE
      WHEN ledger.wa_message_id IS NOT NULL AND ledger.last_error IS NOT NULL THEN 'local_message_persistence_failed'
      WHEN ledger.delivery_state IN ('attempting', 'ambiguous') THEN 'provider_outcome_unknown'
      WHEN ledger.delivery_state IN ('claimed', 'unconfirmed') THEN 'legacy_claim_unconfirmed'
    END,
    ledger.wa_message_id, message.status, message.provider_error_title, message.provider_error_detail
  FROM public.installment_reminders_sent AS ledger
  JOIN public.contacts AS contact ON contact.id = ledger.contact_id AND contact.account_id = ledger.account_id
  LEFT JOIN public.membership_installment_plans AS plan ON plan.id = ledger.installment_plan_id AND plan.account_id = ledger.account_id
  LEFT JOIN LATERAL (SELECT id FROM public.conversations WHERE account_id = ledger.account_id AND contact_id = ledger.contact_id LIMIT 1) AS conversation ON true
  LEFT JOIN LATERAL (
    SELECT message.created_at, message.status, message.provider_error_title, message.provider_error_detail
    FROM public.messages AS message JOIN public.conversations AS message_conversation ON message_conversation.id = message.conversation_id
    WHERE message.message_id = ledger.wa_message_id AND message_conversation.account_id = ledger.account_id AND message_conversation.contact_id = ledger.contact_id
    ORDER BY message.created_at DESC LIMIT 1
  ) AS message ON true
  WHERE public.is_account_member(ledger.account_id, 'admin')
)
SELECT * FROM lifecycle
UNION ALL SELECT * FROM legacy_membership
UNION ALL SELECT * FROM legacy_service
UNION ALL SELECT * FROM legacy_installment;

REVOKE ALL ON public.automated_message_activity FROM PUBLIC, anon;
GRANT SELECT ON public.automated_message_activity TO authenticated;
