-- Covers the composite FK that guarantees a branch's legal entity belongs
-- to the same organization.
CREATE INDEX IF NOT EXISTS idx_accounts_organization_legal_entity
  ON public.accounts (organization_id, legal_entity_id);
