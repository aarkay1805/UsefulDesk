-- Read-only Starter standard-reminder preflight. No claims or provider sends.
-- Run through the approved connector against the intended project.
-- Aggregate history is not action-time send authority or delivery acceptance.
SELECT
  now() AS observed_at,
  a.id AS account_id,
  a.name AS branch,
  a.timezone,
  extract(hour FROM now() AT TIME ZONE a.timezone) >= 9 AS local_send_window_open,
  private.subscription_capability_allowed(a.id, 'standard_renewal_reminders') AS standard_capability,
  coalesce(w.status = 'connected', false) AS whatsapp_connected,
  nullif(trim(l.legal_name), '') IS NOT NULL AS legal_business_name_present,
  s.enabled AS membership_enabled,
  s.days_before AS membership_days_before,
  s.service_enabled,
  s.service_days_before,
  public.reminder_rule_templates_ready(a.id, ARRAY['membership_renewal']) AS exact_membership_template_ready,
  public.reminder_rule_templates_ready(a.id, ARRAY['service_renewal']) AS exact_service_template_ready
FROM public.accounts a
LEFT JOIN public.whatsapp_config w ON w.account_id = a.id
LEFT JOIN public.renewal_reminder_settings s ON s.account_id = a.id
LEFT JOIN public.legal_entities l ON l.id = a.legal_entity_id AND l.organization_id = a.organization_id
WHERE a.branch_status = 'active'
ORDER BY a.name, a.id;

-- Match the membership worker's non-trial recurring/manual cohort, including
-- its legacy NULL-plan behavior. A bound option never falls back to old fees.
WITH candidates AS (
  SELECT a.id AS account_id, a.name AS branch, m.id AS membership_id,
    m.end_date, m.end_date - (now() AT TIME ZONE a.timezone)::date AS days_before,
    nullif(trim(c.phone), '') IS NOT NULL AS has_phone,
    CASE WHEN m.pricing_option_id IS NULL THEN m.fee_amount >= 0
      ELSE o.id IS NOT NULL AND o.is_active AND o.price >= 0 END
      AND coalesce(p.is_active, true) AS has_price
  FROM public.memberships m
  JOIN public.accounts a ON a.id = m.account_id
  JOIN public.renewal_reminder_settings s ON s.account_id = a.id AND s.enabled
  LEFT JOIN public.contacts c ON c.id = m.contact_id AND c.account_id = a.id
  LEFT JOIN public.membership_plans p ON p.id = m.plan_id AND p.account_id = a.id
  LEFT JOIN public.plan_pricing_options o ON o.id = m.pricing_option_id
    AND o.account_id = a.id AND o.plan_id = m.plan_id
  WHERE m.status = 'active' AND NOT m.is_trial AND m.collection_mode = 'manual'
    AND (m.plan_id IS NULL OR p.plan_type = 'recurring')
    AND m.end_date - (now() AT TIME ZONE a.timezone)::date = ANY(s.days_before)
)
SELECT c.account_id, c.branch, count(*) AS date_matched,
  count(*) FILTER (WHERE r.id IS NULL AND c.has_phone AND c.has_price) AS unclaimed_with_prerequisites,
  count(*) FILTER (WHERE r.id IS NULL AND NOT (c.has_phone AND c.has_price)) AS missing_phone_or_price,
  count(r.id) AS retained_claims
FROM candidates c
LEFT JOIN public.renewal_reminders_sent r ON r.membership_id = c.membership_id
  AND r.account_id = c.account_id AND r.end_date = c.end_date AND r.days_before = c.days_before
GROUP BY c.account_id, c.branch;

SELECT q.account_id, a.name AS branch, count(*) AS date_matched,
  count(*) FILTER (WHERE (r.id IS NULL OR (r.status = 'failed' AND r.provider_attempted_at IS NULL))
    AND nullif(trim(q.phone), '') IS NOT NULL) AS retryable_with_phone,
  count(*) FILTER (WHERE r.id IS NOT NULL AND NOT (r.status = 'failed' AND r.provider_attempted_at IS NULL)) AS retained_claims
FROM public.service_renewal_queue q
JOIN public.accounts a ON a.id = q.account_id
LEFT JOIN public.service_renewal_reminders_sent r ON r.account_id = q.account_id
  AND r.member_service_id = q.id AND r.end_date = q.end_date AND r.days_before = q.days_until_expiry
WHERE q.service_enabled AND q.days_until_expiry = ANY(q.service_days_before)
  AND q.current_renewal_price IS NOT NULL AND q.item_is_active AND q.option_is_active
GROUP BY q.account_id, a.name;

-- Only genuine stored message statuses are returned. A provider id or
-- status='sent' proves acceptance, not delivered/read. Historical statuses
-- also do not prove that today's exact copy was used for a new acceptance.
SELECT c.account_id, a.name AS branch, m.template_name, m.status,
  count(*) AS messages, max(m.created_at) AS last_message_at
FROM public.messages m
JOIN public.conversations c ON c.id = m.conversation_id
JOIN public.accounts a ON a.id = c.account_id
WHERE m.template_name IN ('gym_membership_renewal', 'gym_service_renewal')
GROUP BY c.account_id, a.name, m.template_name, m.status
ORDER BY a.name, m.template_name, m.status;
