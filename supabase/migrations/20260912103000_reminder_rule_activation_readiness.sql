-- Guard direct dashboard writes to reminder switches. The route repeats this
-- check for a useful recovery message, but browser RLS writes must not be able
-- to activate a lifecycle when the provider setup is incomplete.
--
-- This intentionally only rejects false -> true transitions. A configured
-- rule remains enabled if WhatsApp disconnects or Meta later changes a
-- template, so workers can report it as blocked and operators can still edit
-- non-activation configuration. Existing lifecycle activation triggers retain
-- ownership of timestamps and generations.

CREATE OR REPLACE FUNCTION public.reminder_template_buttons_match(
  p_actual JSONB,
  p_expected JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_array_length(COALESCE(p_actual, '[]'::jsonb)) = jsonb_array_length(p_expected)
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_actual, '[]'::jsonb)) WITH ORDINALITY actual(button, position)
      JOIN jsonb_array_elements(p_expected) WITH ORDINALITY expected(button, position) USING (position)
      WHERE actual.button->>'type' IS DISTINCT FROM expected.button->>'type'
        OR actual.button->>'text' IS DISTINCT FROM expected.button->>'text'
        OR (
          expected.button->>'type' = 'URL'
          AND (
            actual.button->>'url' IS DISTINCT FROM expected.button->>'url'
            OR actual.button->'example' IS DISTINCT FROM expected.button->'example'
          )
        )
        OR (
          expected.button->>'type' = 'PHONE_NUMBER'
          AND actual.button->>'phone_number' IS DISTINCT FROM expected.button->>'phone_number'
        )
        OR (
          expected.button->>'type' = 'COPY_CODE'
          AND actual.button->'example' IS DISTINCT FROM expected.button->'example'
        )
    );
$$;

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
      ('membership_renewal', 'gym_membership_renewal', 'Marketing', 'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Renew membership"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('service_renewal', 'gym_service_renewal', 'Marketing', 'Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of {{4}} will continue this service. Use the buttons below to respond.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Renew service"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('membership_post_expiry', 'gym_membership_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} membership ended on {{3}}. You can renew at the current price of {{4}}. Use the buttons below and our team will help.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Renew membership"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('service_post_expiry', 'gym_service_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} service ended on {{3}}. You can renew at the current price of {{4}}. Use the buttons below and our team will help.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Renew service"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('invoice_due', 'gym_invoice_due', 'Utility', 'Hi {{1}}, invoice {{2}} has a remaining balance of {{3}} due on {{4}}. Reply here if you need help with this payment.', NULL, '[]'::jsonb),
      ('invoice_overdue', 'gym_invoice_overdue', 'Utility', 'Hi {{1}}, invoice {{2}} still has a remaining balance of {{3}} from {{4}}. Reply here if you need help with this payment.', NULL, '[]'::jsonb),
      ('payment_promise_reminder', 'gym_payment_promise_reminder', 'Utility', 'Hi {{1}}, this is a reminder of your payment commitment of {{3}} for invoice {{2}} on {{4}}. Reply here if you need help.', NULL, '[]'::jsonb),
      ('payment_link', 'gym_payment_link', 'Utility', 'Hi {{1}}, your payment of {{2}} for invoice {{3}} is due. Pay securely using this link: {{4}}. Please contact us if you need help.', NULL, '[]'::jsonb),
      ('autopay_recovery_pending', 'gym_autopay_retry_update', 'Utility', 'Hi {{1}}, your AutoPay payment for {{2}} is still being processed. No payment is needed from you right now; we will update you if anything changes.', NULL, '[]'::jsonb),
      ('autopay_recovery_terminal', 'gym_autopay_payment_help', 'Utility', 'Hi {{1}}, AutoPay could not complete invoice {{2}}, which has {{3}} remaining. Reply here and our team will help with the next payment step.', NULL, '[]'::jsonb),
      ('session_pack_low', 'gym_session_pack_low', 'Marketing', 'Hi {{1}}, your {{2}} has {{3}} sessions remaining. Reply here if you would like help choosing your next pack.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Ask about packs"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('session_pack_exhausted', 'gym_session_pack_used', 'Marketing', 'Hi {{1}}, all sessions in your {{2}} have been used. Reply here if you would like help with your next pack.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Ask about packs"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('freeze_return', 'gym_membership_return_reminder', 'Utility', 'Hi {{1}}, your planned return date is {{2}}. Reply here if you would like to discuss your next step with the gym.', NULL, '[]'::jsonb),
      ('membership_win_back', 'gym_membership_win_back', 'Marketing', 'Hi {{1}}, you can restart your {{2}} membership. Reply here if you would like help renewing.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Renew membership"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('service_win_back', 'gym_service_win_back', 'Marketing', 'Hi {{1}}, you can renew your {{2}} service at the current price of {{3}}. Reply here if you would like help.', 'Tap Unsubscribe to stop promotional messages.', '[{"type":"QUICK_REPLY","text":"Renew service"},{"type":"QUICK_REPLY","text":"Unsubscribe"}]'::jsonb),
      ('payment_confirmation', 'gym_payment_confirmation', 'Utility', 'Hi {{1}}, we received your payment of {{2}} for invoice {{3}}. {{4}} Reply if any payment detail looks incorrect.', NULL, '[]'::jsonb)
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
  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Reminder settings cannot be moved between accounts' USING ERRCODE = '23514';
  END IF;
  IF NEW.enabled AND NOT COALESCE(OLD.enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['membership_renewal']) THEN RAISE EXCEPTION 'Reminder rule membership_renewal cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.service_enabled AND NOT COALESCE(OLD.service_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['service_renewal']) THEN RAISE EXCEPTION 'Reminder rule service_renewal cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.membership_post_expiry_enabled AND NOT COALESCE(OLD.membership_post_expiry_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['membership_post_expiry']) THEN RAISE EXCEPTION 'Reminder rule membership_post_expiry cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.service_post_expiry_enabled AND NOT COALESCE(OLD.service_post_expiry_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['service_post_expiry']) THEN RAISE EXCEPTION 'Reminder rule service_post_expiry cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.invoice_collection_enabled AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['invoice_due', 'invoice_overdue']) THEN RAISE EXCEPTION 'Reminder rule invoice_collection cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.promise_to_pay_reminders_enabled AND NOT COALESCE(OLD.promise_to_pay_reminders_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['payment_promise_reminder']) THEN RAISE EXCEPTION 'Reminder rule promise_to_pay cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.payment_link_follow_up_enabled AND NOT COALESCE(OLD.payment_link_follow_up_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['payment_link']) THEN RAISE EXCEPTION 'Reminder rule payment_link_follow_up cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.autopay_recovery_enabled AND NOT COALESCE(OLD.autopay_recovery_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['autopay_recovery_pending', 'autopay_recovery_terminal']) THEN RAISE EXCEPTION 'Reminder rule autopay_recovery cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.session_pack_reminders_enabled AND NOT COALESCE(OLD.session_pack_reminders_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['session_pack_low', 'session_pack_exhausted']) THEN RAISE EXCEPTION 'Reminder rule session_pack cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.freeze_return_reminders_enabled AND NOT COALESCE(OLD.freeze_return_reminders_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['freeze_return']) THEN RAISE EXCEPTION 'Reminder rule freeze_return cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.membership_win_back_enabled AND NOT COALESCE(OLD.membership_win_back_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['membership_win_back']) THEN RAISE EXCEPTION 'Reminder rule membership_win_back cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.service_win_back_enabled AND NOT COALESCE(OLD.service_win_back_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['service_win_back']) THEN RAISE EXCEPTION 'Reminder rule service_win_back cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  IF NEW.payment_confirmations_enabled AND NOT COALESCE(OLD.payment_confirmations_enabled, FALSE) AND NOT public.reminder_rule_templates_ready(NEW.account_id, ARRAY['payment_confirmation']) THEN RAISE EXCEPTION 'Reminder rule payment_confirmation cannot be enabled until WhatsApp is connected and its exact approved template contracts are synced' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reminder_rule_activation_readiness ON public.renewal_reminder_settings;
CREATE TRIGGER trg_reminder_rule_activation_readiness
  BEFORE INSERT OR UPDATE
  ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reminder_rule_activation_readiness();

REVOKE ALL ON FUNCTION public.reminder_rule_templates_ready(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_reminder_rule_activation_readiness() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reminder_template_buttons_match(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
