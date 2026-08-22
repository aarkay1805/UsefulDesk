-- Preserve provider-backed template rows that disappear from a complete Meta
-- snapshot without allowing their last cached status to remain sendable.

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS provider_missing_since TIMESTAMPTZ;

COMMENT ON COLUMN public.message_templates.provider_missing_since IS
  'First complete Meta sync that did not return this provider-backed template. NULL means the template was present at the last authoritative sync or has never been reconciled.';
