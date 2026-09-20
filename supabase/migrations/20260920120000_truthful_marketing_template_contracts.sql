-- Keep direct reminder-rule activation aligned with the canonical Marketing
-- contracts. Opt-out commands remain audit history and do not suppress sends,
-- so the exact customer messages retain only their affirmative reply action.

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
      ('membership_renewal', 'gym_membership_renewal', 'Marketing', 'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the button below to respond.', NULL, '[{"type":"QUICK_REPLY","text":"Renew membership"}]'::jsonb),
      ('service_renewal', 'gym_service_renewal', 'Marketing', 'Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of {{4}} will continue this service. Use the button below to respond.', NULL, '[{"type":"QUICK_REPLY","text":"Renew service"}]'::jsonb),
      ('membership_post_expiry', 'gym_membership_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} membership ended on {{3}}. You can renew at the current price of {{4}}. Use the button below and our team will help.', NULL, '[{"type":"QUICK_REPLY","text":"Renew membership"}]'::jsonb),
      ('service_post_expiry', 'gym_service_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} service ended on {{3}}. You can renew at the current price of {{4}}. Use the button below and our team will help.', NULL, '[{"type":"QUICK_REPLY","text":"Renew service"}]'::jsonb),
      ('invoice_due', 'gym_invoice_due', 'Utility', 'Hi {{1}}, invoice {{2}} has a remaining balance of {{3}} due on {{4}}. Reply here if you need help with this payment.', NULL, '[]'::jsonb),
      ('invoice_overdue', 'gym_invoice_overdue', 'Utility', 'Hi {{1}}, invoice {{2}} still has a remaining balance of {{3}} from {{4}}. Reply here if you need help with this payment.', NULL, '[]'::jsonb),
      ('payment_promise_reminder', 'gym_payment_promise_reminder', 'Utility', 'Hi {{1}}, this is a reminder of your payment commitment of {{3}} for invoice {{2}} on {{4}}. Reply here if you need help.', NULL, '[]'::jsonb),
      ('payment_link', 'gym_payment_link', 'Utility', 'Hi {{1}}, your payment of {{2}} for invoice {{3}} is due. Pay securely using this link: {{4}}. Please contact us if you need help.', NULL, '[]'::jsonb),
      ('autopay_recovery_pending', 'gym_autopay_retry_update', 'Utility', 'Hi {{1}}, your AutoPay payment for {{2}} is still being processed. No payment is needed from you right now; we will update you if anything changes.', NULL, '[]'::jsonb),
      ('autopay_recovery_terminal', 'gym_autopay_payment_help', 'Utility', 'Hi {{1}}, AutoPay could not complete invoice {{2}}, which has {{3}} remaining. Reply here and our team will help with the next payment step.', NULL, '[]'::jsonb),
      ('session_pack_low', 'gym_session_pack_low', 'Marketing', 'Hi {{1}}, your {{2}} has {{3}} sessions remaining. Reply here if you would like help choosing your next pack.', NULL, '[{"type":"QUICK_REPLY","text":"Ask about packs"}]'::jsonb),
      ('session_pack_exhausted', 'gym_session_pack_used', 'Marketing', 'Hi {{1}}, all sessions in your {{2}} have been used. Reply here if you would like help with your next pack.', NULL, '[{"type":"QUICK_REPLY","text":"Ask about packs"}]'::jsonb),
      ('freeze_return', 'gym_membership_return_reminder', 'Utility', 'Hi {{1}}, your planned return date is {{2}}. Reply here if you would like to discuss your next step with the gym.', NULL, '[]'::jsonb),
      ('membership_win_back', 'gym_membership_win_back', 'Marketing', 'Hi {{1}}, you can restart your {{2}} membership. Reply here if you would like help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Renew membership"}]'::jsonb),
      ('service_win_back', 'gym_service_win_back', 'Marketing', 'Hi {{1}}, you can renew your {{2}} service at the current price of {{3}}. Reply here if you would like help.', NULL, '[{"type":"QUICK_REPLY","text":"Renew service"}]'::jsonb),
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

REVOKE ALL ON FUNCTION public.reminder_rule_templates_ready(UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;
