-- Data API grants are explicit in addition to RLS: authors use the table
-- through authenticated policies, while anon has no table privilege at all.
REVOKE ALL ON public.member_import_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_import_drafts
  TO authenticated, service_role;

REVOKE ALL ON public.member_import_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.member_import_runs TO service_role;

DROP POLICY IF EXISTS "No direct member import run access"
  ON public.member_import_runs;
CREATE POLICY "No direct member import run access"
  ON public.member_import_runs FOR ALL TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);
