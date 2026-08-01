-- Unused catalogue items may be permanently deleted, but issued invoices and
-- member-service history must retain their live catalogue references. Deleting
-- an unused item cascades only through its unused options and trainer rates.
ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_catalog_item_id_fkey;
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_catalog_item_id_fkey
  FOREIGN KEY (catalog_item_id) REFERENCES public.catalog_items(id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_catalog_option_id_fkey;
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_catalog_option_id_fkey
  FOREIGN KEY (catalog_option_id) REFERENCES public.catalog_options(id) ON DELETE RESTRICT;

ALTER TABLE public.member_services
  DROP CONSTRAINT IF EXISTS member_services_catalog_item_id_fkey;
ALTER TABLE public.member_services
  ADD CONSTRAINT member_services_catalog_item_id_fkey
  FOREIGN KEY (catalog_item_id) REFERENCES public.catalog_items(id) ON DELETE RESTRICT;

ALTER TABLE public.member_services
  DROP CONSTRAINT IF EXISTS member_services_catalog_option_id_fkey;
ALTER TABLE public.member_services
  ADD CONSTRAINT member_services_catalog_option_id_fkey
  FOREIGN KEY (catalog_option_id) REFERENCES public.catalog_options(id) ON DELETE RESTRICT;

DROP POLICY IF EXISTS catalog_items_delete ON public.catalog_items;
CREATE POLICY catalog_items_delete ON public.catalog_items
  FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

GRANT DELETE ON public.catalog_items TO authenticated;
REVOKE DELETE ON public.catalog_items FROM anon;
