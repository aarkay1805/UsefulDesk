-- Data API grants are explicit in addition to RLS: authors use the table
-- through authenticated policies, while anon has no table privilege at all.
REVOKE ALL ON public.member_import_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_import_drafts
  TO authenticated, service_role;

REVOKE ALL ON public.member_import_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.member_import_runs TO service_role;

-- FK-leading indexes keep cleanup/audit joins predictable. The account-first
-- lookup index in the feature migration serves tenant history, not FK checks.
CREATE INDEX IF NOT EXISTS idx_member_import_runs_contact_fk
  ON public.member_import_runs(contact_id);
CREATE INDEX IF NOT EXISTS idx_member_import_runs_membership_fk
  ON public.member_import_runs(membership_id);
CREATE INDEX IF NOT EXISTS idx_member_import_runs_created_by_fk
  ON public.member_import_runs(created_by);

DROP POLICY IF EXISTS "No direct member import run access"
  ON public.member_import_runs;
CREATE POLICY "No direct member import run access"
  ON public.member_import_runs FOR ALL TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);
