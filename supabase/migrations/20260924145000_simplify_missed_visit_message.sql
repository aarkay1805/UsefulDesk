-- Keep the activation guard aligned with the shorter missed-visit template.
CREATE OR REPLACE FUNCTION public.enforce_attendance_absence_readiness()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.attendance_absence_enabled
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.attendance_absence_enabled, FALSE))
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_config config
       JOIN public.message_templates template ON template.account_id = config.account_id
       WHERE config.account_id = NEW.account_id AND config.status = 'connected'
         AND template.name = 'gym_missed_visit'
         AND COALESCE(template.language, 'en_US') = 'en_US'
         AND template.status = 'APPROVED'
         AND template.category = 'Marketing'
         AND template.parameter_format = 'POSITIONAL'
         AND template.provider_components_sync_required_at IS NULL
         AND template.header_type IS NULL AND template.header_content IS NULL
         AND template.body_text = 'Hi {{1}}, we missed you at {{2}} today. Hope all is well!'
         AND template.footer_text IS NULL
         AND public.reminder_template_buttons_match(template.buttons, '[]'::jsonb)
     ) THEN
    RAISE EXCEPTION 'Missed visit reminder needs its exact approved WhatsApp template' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_attendance_absence_readiness() FROM PUBLIC, anon, authenticated;
