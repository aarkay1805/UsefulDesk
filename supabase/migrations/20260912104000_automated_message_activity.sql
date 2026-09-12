-- A read-only, settings-scoped activity feed.  The union belongs in SQL so
-- filters run before the keyset page is selected; clients never have to merge
-- partially paged ledgers.  SECURITY INVOKER keeps the underlying RLS checks
-- in force and the explicit admin predicate matches settings access.

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
    SELECT conversation.id
    FROM public.conversations AS conversation
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
    ORDER BY message.created_at DESC
    LIMIT 1
  ) AS message ON true
  LEFT JOIN LATERAL (
    SELECT follow_up.id
    FROM public.follow_ups AS follow_up
    WHERE follow_up.account_id = job.account_id AND follow_up.contact_id = job.contact_id
      AND follow_up.status = 'open'
    ORDER BY follow_up.created_at DESC
    LIMIT 1
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
    COALESCE(message.created_at, ledger.sent_at) AS occurred_at,
    ledger.end_date AS scheduled_for,
    CASE
      WHEN message.status = 'read' THEN 'read'
      WHEN message.status = 'delivered' THEN 'delivered'
      WHEN message.status = 'failed' THEN 'failed'
      WHEN ledger.wa_message_id IS NOT NULL THEN 'accepted'
      ELSE 'unconfirmed'
    END AS outcome,
    NULL::text AS job_state, NULL::text AS escalation_state, NULL::timestamptz AS next_attempt_at,
    CASE WHEN ledger.wa_message_id IS NULL THEN 'legacy_claim_unconfirmed' END AS reason_code,
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
    COALESCE(message.created_at, ledger.sent_at, ledger.claimed_at, ledger.updated_at), ledger.end_date,
    CASE WHEN message.status = 'read' THEN 'read' WHEN message.status = 'delivered' THEN 'delivered' WHEN message.status = 'failed' THEN 'failed' WHEN ledger.wa_message_id IS NOT NULL THEN 'accepted' ELSE 'unconfirmed' END,
    NULL::text, NULL::text, NULL::timestamptz, CASE WHEN ledger.wa_message_id IS NULL THEN 'legacy_claim_unconfirmed' END, ledger.wa_message_id, message.status, message.provider_error_title, message.provider_error_detail
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
    COALESCE(message.created_at, ledger.sent_at), ledger.due_on,
    CASE WHEN message.status = 'read' THEN 'read' WHEN message.status = 'delivered' THEN 'delivered' WHEN message.status = 'failed' THEN 'failed' WHEN ledger.wa_message_id IS NOT NULL THEN 'accepted' ELSE 'unconfirmed' END,
    NULL::text, NULL::text, NULL::timestamptz, CASE WHEN ledger.wa_message_id IS NULL THEN 'legacy_claim_unconfirmed' END, ledger.wa_message_id, message.status, message.provider_error_title, message.provider_error_detail
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
