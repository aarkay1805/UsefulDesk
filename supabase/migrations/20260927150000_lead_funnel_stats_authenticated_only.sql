-- Enquiries by stage: make public.lead_funnel_stats() authenticated-only, like
-- public.lead_listing_snapshot and the other selected-branch reads.
--
-- 047_lead_ownership_ops.sql revoked EXECUTE from PUBLIC and granted it to
-- authenticated, but left the anon and service_role EXECUTE that Supabase's
-- default privileges then gave every new public function. CREATE OR REPLACE
-- keeps a function's grants, so
-- 20260927130000_enquiry_reads_exclude_service_customers.sql kept them too.
-- The function is SECURITY INVOKER, so anon got no data: its call fails
-- because anon cannot read member_services. service_role bypasses RLS and
-- would count every branch's enquiries together.
--
-- Its only caller is Business → Performance, Enquiries by stage
-- (src/lib/reports/enquiry-stages.ts), through the signed-in browser client.
-- No server code, database function, view, or cron job calls it. Grants only;
-- the body stays as 20260927130000 defined it.
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.lead_funnel_stats()
-- TO anon, service_role;

REVOKE ALL ON FUNCTION public.lead_funnel_stats() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.lead_funnel_stats() TO authenticated;
