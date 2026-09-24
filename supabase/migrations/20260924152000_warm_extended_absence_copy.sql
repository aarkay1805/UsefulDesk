-- Keep activation tied to the warmer six-day absence message.
CREATE OR REPLACE FUNCTION public.enforce_attendance_streak_readiness()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.attendance_streak_enabled
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.attendance_streak_enabled, FALSE))
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_config config
       JOIN public.message_templates template ON template.account_id = config.account_id
       WHERE config.account_id = NEW.account_id AND config.status = 'connected'
         AND template.name = 'gym_extended_absence'
         AND COALESCE(template.language, 'en_US') = 'en_US'
         AND template.status = 'APPROVED'
         AND template.category = 'Marketing'
         AND template.parameter_format = 'POSITIONAL'
         AND template.provider_components_sync_required_at IS NULL
         AND template.header_type IS NULL AND template.header_content IS NULL
         AND template.body_text = 'Hi {{1}}, it''s been a little while since we''ve seen you at {{2}}, so we wanted to check in. Hope you''re doing okay. We''d love to see you again whenever you''re ready.'
         AND template.footer_text IS NULL
         AND public.reminder_template_buttons_match(template.buttons, '[]'::jsonb)
     ) THEN
    RAISE EXCEPTION 'Extended absence reminder needs its exact approved WhatsApp template' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_attendance_streak_readiness() FROM PUBLIC, anon, authenticated;
