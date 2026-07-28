-- Keep organization/branch authorization and audit joins index-backed.
-- Partial indexes avoid storing entries for optional attribution columns.

CREATE INDEX IF NOT EXISTS idx_accounts_owner_user_id
  ON public.accounts (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_account_memberships_created_by_user_id
  ON public.account_memberships (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organization_memberships_created_by_user_id
  ON public.organization_memberships (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organization_audit_log_account_id
  ON public.organization_audit_log (account_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organization_audit_log_actor_user_id
  ON public.organization_audit_log (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organization_contact_index_contact_id
  ON public.organization_contact_index (contact_id);

CREATE INDEX IF NOT EXISTS idx_organization_message_suppressions_source_account_id
  ON public.organization_message_suppressions (source_account_id)
  WHERE source_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organization_message_suppressions_suppressed_by_user_id
  ON public.organization_message_suppressions (suppressed_by_user_id)
  WHERE suppressed_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organization_message_suppressions_lifted_by_user_id
  ON public.organization_message_suppressions (lifted_by_user_id)
  WHERE lifted_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_consent_events_account_id
  ON public.contact_consent_events (account_id);

CREATE INDEX IF NOT EXISTS idx_contact_consent_events_contact_id
  ON public.contact_consent_events (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_consent_events_actor_user_id
  ON public.contact_consent_events (actor_user_id)
  WHERE actor_user_id IS NOT NULL;
