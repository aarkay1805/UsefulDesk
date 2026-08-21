-- Preserve Meta-owned parameter and component state so recognized template
-- sends can fail closed when the provider payload differs from UsefulDesk's
-- operational contract.

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS parameter_format TEXT,
  ADD COLUMN IF NOT EXISTS provider_components_sync_required_at TIMESTAMPTZ;

-- Existing locally-authored numeric-placeholder templates use positional
-- parameters. Do not guess a format for templates without placeholders or
-- templates containing named placeholders; the next full Meta sync owns them.
UPDATE public.message_templates
SET parameter_format = 'POSITIONAL'
WHERE parameter_format IS NULL
  AND body_text ~ '\{\{[0-9]+\}\}'
  AND body_text !~ '\{\{[A-Za-z_][A-Za-z0-9_]*\}\}';

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_parameter_format_check;

ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_parameter_format_check
  CHECK (
    parameter_format IS NULL
    OR parameter_format IN ('POSITIONAL', 'NAMED')
  );

COMMENT ON COLUMN public.message_templates.parameter_format IS
  'Meta template parameter format. NULL means a full provider sync is required before an exact feature contract can be ready.';

COMMENT ON COLUMN public.message_templates.provider_components_sync_required_at IS
  'Set by Meta component-update webhooks and cleared only after a successful full provider sync.';
