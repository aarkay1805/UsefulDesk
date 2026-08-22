-- A locally missing provider row must never satisfy the Approved-only send
-- selectors. A full Meta sync clears provider_missing_since in the same update
-- that restores the provider status, so legitimate reappearance remains valid.

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_missing_status_check;

ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_missing_status_check
  CHECK (provider_missing_since IS NULL OR status <> 'APPROVED');
