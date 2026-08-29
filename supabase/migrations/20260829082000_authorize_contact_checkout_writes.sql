-- Product/service checkout writes immutable financial rows through one
-- database-authoritative transaction. The RPC already validates the selected
-- account, requires agent access through auth.uid(), reloads every catalogue
-- price, and uses a fixed search_path. It must therefore run with its owner\'s
-- table privileges; authenticated roles intentionally retain SELECT-only
-- access to invoices, lines, member services, credits, and allocations.

ALTER FUNCTION public.perform_contact_checkout(JSONB) OWNER TO postgres;
ALTER FUNCTION public.perform_contact_checkout(JSONB) SECURITY DEFINER;
ALTER FUNCTION public.perform_contact_checkout(JSONB) SET search_path = '';

REVOKE ALL ON FUNCTION public.perform_contact_checkout(JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_contact_checkout(JSONB)
  TO authenticated;

COMMENT ON FUNCTION public.perform_contact_checkout(JSONB) IS
  'Agent-authorized, account-scoped product/service checkout transaction; runs as definer because financial base tables remain browser read-only.';
