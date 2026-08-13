-- Cover the branch-setup review/request foreign keys reported by the
-- Supabase performance advisor after Test rollout. Composite request indexes
-- follow the same organization-scoped identities as the foreign keys.

CREATE INDEX IF NOT EXISTS idx_accounts_setup_reviewed_by
  ON public.accounts (setup_reviewed_by)
  WHERE setup_reviewed_by IS NOT NULL;

DROP INDEX IF EXISTS private.idx_branch_creation_requests_created_account;

CREATE INDEX IF NOT EXISTS idx_branch_creation_requests_created_scope
  ON private.branch_creation_requests (organization_id, created_account_id)
  WHERE created_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branch_creation_requests_source_scope
  ON private.branch_creation_requests (organization_id, source_account_id)
  WHERE source_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branch_creation_requests_legal_entity_scope
  ON private.branch_creation_requests (organization_id, legal_entity_id);
