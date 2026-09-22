-- Direct cutover to the audited WhatsApp template library. Reminder-rule
-- activation requires the exact approved body, category, language, positional
-- format, and buttons that the application sends.

CREATE OR REPLACE FUNCTION public.reminder_rule_templates_ready(
  p_account_id UUID,
  p_contract_ids TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH expected(contract_id, name, category, body_text, footer_text, buttons) AS (
    VALUES
      ('membership_renewal', 'gym_membership_renewal', 'Marketing', 'Hi {{1}}, your {{2}} membership ends on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}}.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('service_renewal', 'gym_service_renewal', 'Marketing', 'Hi {{1}}, your {{2}} service ends on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}}.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('membership_post_expiry', 'gym_membership_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} membership ended on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}}.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('service_post_expiry', 'gym_service_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} service ended on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}}.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('invoice_due', 'gym_invoice_due', 'Utility', 'Hi {{1}}, invoice {{2}} has a remaining balance of {{3}} due on {{4}}. Reply if you need help with this payment. This message is from {{5}}.', NULL, '[]'::jsonb),
      ('invoice_overdue', 'gym_invoice_overdue', 'Utility', 'Hi {{1}}, invoice {{2}} still has a remaining balance of {{3}} that was due on {{4}}. Reply if you need help with this payment. This message is from {{5}}.', NULL, '[]'::jsonb),
      ('payment_promise_upcoming', 'gym_payment_promise_upcoming', 'Utility', 'Hi {{1}}, this is a reminder that you planned to pay {{3}} for invoice {{2}} on {{4}}. Reply if you need help. This message is from {{5}}.', NULL, '[]'::jsonb),
      ('payment_promise_missed', 'gym_payment_promise_missed', 'Utility', 'Hi {{1}}, the planned payment date of {{4}} for {{3}} on invoice {{2}} has passed, and the balance remains unpaid. Reply if you need help. This message is from {{5}}.', NULL, '[]'::jsonb),
      ('payment_link', 'gym_payment_link', 'Utility', 'Hi {{1}}, {{2}} is due for invoice {{3}}. The payment link expires on {{4}}. Use the button below to pay. This message is from {{5}}.', NULL, '[{"type":"URL","text":"Pay invoice","url":"https://rzp.io/{{1}}","example":"i/abc123"}]'::jsonb),
      ('autopay_recovery_pending', 'gym_autopay_retry_update', 'Utility', 'Hi {{1}}, your AutoPay payment for {{2}} is still being processed. No payment is needed from you now. This message is from {{3}}.', NULL, '[]'::jsonb),
      ('autopay_recovery_terminal', 'gym_autopay_payment_help', 'Utility', 'Hi {{1}}, AutoPay could not complete invoice {{2}}, which has {{3}} remaining. Reply for help with the next payment step. This message is from {{4}}.', NULL, '[]'::jsonb),
      ('session_pack_low', 'gym_session_pack_low', 'Marketing', 'Hi {{1}}, your {{2}} has {{3}} sessions remaining. Reply using the button if you would like help with your next pack. This message is from {{4}}.', NULL, '[{"type":"QUICK_REPLY","text":"Ask about packs"}]'::jsonb),
      ('session_pack_exhausted', 'gym_session_pack_used', 'Marketing', 'Hi {{1}}, all sessions in your {{2}} have been used. Reply using the button if you would like help with your next pack. This message is from {{3}}.', NULL, '[{"type":"QUICK_REPLY","text":"Ask about packs"}]'::jsonb),
      ('freeze_return', 'gym_membership_return_reminder', 'Utility', 'Hi {{1}}, your planned return date is {{2}}. Reply here if you need to update it. This message is from {{3}}.', NULL, '[]'::jsonb),
      ('membership_win_back', 'gym_membership_win_back', 'Marketing', 'Hi {{1}}, you can restart your {{2}} membership. Reply using the button if you would like help renewing. This message is from {{3}}.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('service_win_back', 'gym_service_win_back', 'Marketing', 'Hi {{1}}, you can renew your {{2}} service at the current price of {{3}}. Reply using the button if you would like help renewing. This message is from {{4}}.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('payment_confirmation', 'gym_payment_confirmation', 'Utility', 'Hi {{1}}, we received {{2}} for invoice {{3}}. Reply if any payment detail looks incorrect. This message is from {{4}}.', NULL, '[]'::jsonb),
      ('payment_membership_renewal_confirmation', 'gym_payment_membership_renewal_confirmation', 'Utility', 'Hi {{1}}, we received {{2}} for invoice {{3}} and renewed your membership until {{4}}. Reply if any payment detail looks incorrect. This message is from {{5}}.', NULL, '[]'::jsonb)
  )
  SELECT cardinality(p_contract_ids) > 0
  AND NOT EXISTS (
    SELECT 1 FROM unnest(p_contract_ids) requested(contract_id)
    WHERE NOT EXISTS (SELECT 1 FROM expected WHERE expected.contract_id = requested.contract_id)
  )
  AND EXISTS (
    SELECT 1 FROM public.whatsapp_config config
    WHERE config.account_id = p_account_id AND config.status = 'connected'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM expected e
    WHERE e.contract_id = ANY(p_contract_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.message_templates template
        WHERE template.account_id = p_account_id
          AND template.name = e.name
          AND COALESCE(template.language, 'en_US') = 'en_US'
          AND template.status = 'APPROVED'
          AND template.category = e.category
          AND template.parameter_format = 'POSITIONAL'
          AND template.provider_components_sync_required_at IS NULL
          AND template.header_type IS NULL
          AND template.header_content IS NULL
          AND template.body_text = e.body_text
          AND COALESCE(template.footer_text, NULL) IS NOT DISTINCT FROM e.footer_text
          AND public.reminder_template_buttons_match(template.buttons, e.buttons)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_reminder_rule_activation_readiness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN RAISE EXCEPTION 'Reminder settings cannot be moved between accounts' USING ERRCODE = '23514'; END IF;
  IF NEW.enabled AND NOT COALESCE(OLD.enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['membership_renewal']) THEN RAISE EXCEPTION 'Reminder rule membership_renewal cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.service_enabled AND NOT COALESCE(OLD.service_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['service_renewal']) THEN RAISE EXCEPTION 'Reminder rule service_renewal cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.membership_post_expiry_enabled AND NOT COALESCE(OLD.membership_post_expiry_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['membership_post_expiry']) THEN RAISE EXCEPTION 'Reminder rule membership_post_expiry cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.service_post_expiry_enabled AND NOT COALESCE(OLD.service_post_expiry_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['service_post_expiry']) THEN RAISE EXCEPTION 'Reminder rule service_post_expiry cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.invoice_collection_enabled AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['invoice_due', 'invoice_overdue']) THEN RAISE EXCEPTION 'Reminder rule invoice_collection cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.promise_to_pay_reminders_enabled AND NOT COALESCE(OLD.promise_to_pay_reminders_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['payment_promise_upcoming', 'payment_promise_missed']) THEN RAISE EXCEPTION 'Reminder rule promise_to_pay cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.payment_link_follow_up_enabled AND NOT COALESCE(OLD.payment_link_follow_up_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['payment_link']) THEN RAISE EXCEPTION 'Reminder rule payment_link_follow_up cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.autopay_recovery_enabled AND NOT COALESCE(OLD.autopay_recovery_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['autopay_recovery_pending', 'autopay_recovery_terminal']) THEN RAISE EXCEPTION 'Reminder rule autopay_recovery cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.session_pack_reminders_enabled AND NOT COALESCE(OLD.session_pack_reminders_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['session_pack_low', 'session_pack_exhausted']) THEN RAISE EXCEPTION 'Reminder rule session_pack cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.freeze_return_reminders_enabled AND NOT COALESCE(OLD.freeze_return_reminders_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['freeze_return']) THEN RAISE EXCEPTION 'Reminder rule freeze_return cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.membership_win_back_enabled AND NOT COALESCE(OLD.membership_win_back_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['membership_win_back']) THEN RAISE EXCEPTION 'Reminder rule membership_win_back cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.service_win_back_enabled AND NOT COALESCE(OLD.service_win_back_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['service_win_back']) THEN RAISE EXCEPTION 'Reminder rule service_win_back cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.payment_confirmations_enabled AND NOT COALESCE(OLD.payment_confirmations_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['payment_confirmation', 'payment_membership_renewal_confirmation']) THEN RAISE EXCEPTION 'Reminder rule payment_confirmation cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reminder_rule_templates_ready(UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_reminder_rule_activation_readiness()
  FROM PUBLIC, anon, authenticated;
