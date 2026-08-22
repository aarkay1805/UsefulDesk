CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_name_language_key
  ON public.message_templates (user_id, name, language);

COMMENT ON INDEX public.message_templates_user_name_language_key IS
  'Temporary mixed-version upsert arbiter; remove only after the account-scoped submit route is deployed.';
