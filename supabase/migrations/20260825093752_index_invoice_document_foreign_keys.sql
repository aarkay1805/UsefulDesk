-- Cover foreign-key delete/update checks surfaced by the connected Supabase
-- performance advisor after the invoice-document migrations were applied.

CREATE INDEX IF NOT EXISTS invoice_profile_save_guards_account_idx
  ON private.invoice_profile_save_guards(account_id);

CREATE INDEX IF NOT EXISTS invoice_profiles_updated_by_idx
  ON public.invoice_profiles(updated_by);

CREATE INDEX IF NOT EXISTS invoice_documents_account_invoice_idx
  ON public.invoice_documents(account_id, invoice_id);

CREATE INDEX IF NOT EXISTS invoice_documents_generated_by_idx
  ON public.invoice_documents(generated_by);
