-- Align reminder-rule readiness with the researched customer-copy rewrite.
-- Apply with the matching application release after the audited template cutover
-- and variable-boundary migrations. Existing bodies require Meta review and sync.
-- Preserve activation, tenant, provider-status, and exact-component guards.

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
      ('membership_renewal', 'gym_membership_renewal', 'Marketing', 'Hi {{1}}, your {{2}} membership ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('service_renewal', 'gym_service_renewal', 'Marketing', 'Hi {{1}}, your {{2}} service ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('membership_post_expiry', 'gym_membership_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} membership ended on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('service_post_expiry', 'gym_service_post_expiry', 'Marketing', 'Hi {{1}}, your {{2}} service ended on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('invoice_due', 'gym_invoice_due', 'Utility', 'Hi {{1}}, invoice {{2}} has {{3}} left to pay, due on {{4}}. Reply to {{5}} for payment help.', NULL, '[]'::jsonb),
      ('invoice_overdue', 'gym_invoice_overdue', 'Utility', 'Hi {{1}}, invoice {{2}} has {{3}} left to pay, which was due on {{4}}. Reply to {{5}} if you have paid or need help.', NULL, '[]'::jsonb),
      ('payment_promise_upcoming', 'gym_payment_promise_upcoming', 'Utility', 'Hi {{1}}, your planned payment for invoice {{2}} has {{3}} left to pay on {{4}}. Reply to {{5}} if your plans have changed.', NULL, '[]'::jsonb),
      ('payment_promise_missed', 'gym_payment_promise_missed', 'Utility', 'Hi {{1}}, invoice {{2}} still has {{3}} unpaid from your planned payment on {{4}}. Reply to {{5}} if you have paid or need more time.', NULL, '[]'::jsonb),
      ('payment_link', 'gym_payment_link', 'Utility', 'Hi {{1}}, {{2}} is due for invoice {{3}}. This payment link expires on {{4}}. Pay {{5}} using the button below.', NULL, '[{"type":"URL","text":"Pay invoice","url":"https://rzp.io/{{1}}","example":"i/abc123"}]'::jsonb),
      ('autopay_recovery_pending', 'gym_autopay_retry_update', 'Utility', 'Hi {{1}}, AutoPay will retry the payment for {{2}}. Please wait before paying another way. Reply to {{3}} if you need help.', NULL, '[]'::jsonb),
      ('autopay_recovery_terminal', 'gym_autopay_payment_help', 'Utility', 'Hi {{1}}, the AutoPay payment for invoice {{2}} was unsuccessful. There is {{3}} left to pay. Reply to {{4}} for payment help.', NULL, '[]'::jsonb),
      ('session_pack_low', 'gym_session_pack_low', 'Marketing', 'Hi {{1}}, your {{2}} has {{3}} sessions left. Reply to {{4}} to ask about your next pack.', NULL, '[{"type":"QUICK_REPLY","text":"Ask about packs"}]'::jsonb),
      ('session_pack_exhausted', 'gym_session_pack_used', 'Marketing', 'Hi {{1}}, you have used all sessions in your {{2}}. Reply to {{3}} to ask about your next pack.', NULL, '[{"type":"QUICK_REPLY","text":"Ask about packs"}]'::jsonb),
      ('freeze_return', 'gym_membership_return_reminder', 'Utility', 'Hi {{1}}, your planned return date is {{2}}. Reply to {{3}} if your plans have changed.', NULL, '[]'::jsonb),
      ('membership_win_back', 'gym_membership_win_back', 'Marketing', 'Hi {{1}}, thinking of restarting your {{2}} membership? Reply to {{3}} for help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('service_win_back', 'gym_service_win_back', 'Marketing', 'Hi {{1}}, thinking of returning to your {{2}} service? Current renewal price: {{3}}. Reply to {{4}} for help renewing.', NULL, '[{"type":"QUICK_REPLY","text":"Help me renew"}]'::jsonb),
      ('payment_confirmation', 'gym_payment_confirmation', 'Utility', 'Hi {{1}}, we received {{2}} for invoice {{3}}. Reply to {{4}} if anything looks incorrect. Thank you.', NULL, '[]'::jsonb),
      ('payment_membership_renewal_confirmation', 'gym_payment_membership_renewal_confirmation', 'Utility', 'Hi {{1}}, we received {{2}} for invoice {{3}} and renewed your membership until {{4}}. Reply to {{5}} if anything looks incorrect. Thank you.', NULL, '[]'::jsonb)
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
