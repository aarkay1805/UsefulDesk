-- Postgres does not create indexes for referencing foreign keys. Cover every
-- new FK that is not already the leading key of an existing index so joins,
-- archive checks, and referential actions stay bounded as sales history grows.

CREATE INDEX IF NOT EXISTS idx_catalog_items_created_by
  ON public.catalog_items(created_by);
CREATE INDEX IF NOT EXISTS idx_catalog_options_account_item
  ON public.catalog_options(account_id, item_id);

CREATE INDEX IF NOT EXISTS idx_invoice_credit_allocations_account
  ON public.invoice_credit_allocations(account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_account_invoice
  ON public.invoice_lines(account_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_catalog_option
  ON public.invoice_lines(catalog_option_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_overridden_by
  ON public.invoice_lines(overridden_by);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_trainer
  ON public.invoice_lines(trainer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_voided_by
  ON public.invoice_lines(voided_by);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by
  ON public.invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_voided_by
  ON public.invoices(voided_by);

CREATE INDEX IF NOT EXISTS idx_member_credit_entries_contact
  ON public.member_credit_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_member_credit_entries_created_by
  ON public.member_credit_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_member_credit_entries_membership_fk
  ON public.member_credit_entries(membership_id);
CREATE INDEX IF NOT EXISTS idx_member_credit_entries_source_service
  ON public.member_credit_entries(source_service_id);

CREATE INDEX IF NOT EXISTS idx_member_services_cancelled_by
  ON public.member_services(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_member_services_catalog_item
  ON public.member_services(catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_member_services_catalog_option
  ON public.member_services(catalog_option_id);
CREATE INDEX IF NOT EXISTS idx_member_services_contact
  ON public.member_services(contact_id);
CREATE INDEX IF NOT EXISTS idx_member_services_created_by
  ON public.member_services(created_by);
CREATE INDEX IF NOT EXISTS idx_member_services_renewed_from
  ON public.member_services(renewed_from_service_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_account
  ON public.payment_allocations(account_id);
CREATE INDEX IF NOT EXISTS idx_service_reminders_account
  ON public.service_renewal_reminders_sent(account_id);
CREATE INDEX IF NOT EXISTS idx_service_assignments_account
  ON public.service_trainer_assignments(account_id);
CREATE INDEX IF NOT EXISTS idx_service_assignments_assigned_by
  ON public.service_trainer_assignments(assigned_by);

CREATE INDEX IF NOT EXISTS idx_trainer_rates_account
  ON public.trainer_rates(account_id);
CREATE INDEX IF NOT EXISTS idx_trainer_rates_account_option
  ON public.trainer_rates(account_id, option_id);
CREATE INDEX IF NOT EXISTS idx_trainer_rates_account_trainer
  ON public.trainer_rates(account_id, trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainers_created_by
  ON public.trainers(created_by);
CREATE INDEX IF NOT EXISTS idx_trainers_linked_user
  ON public.trainers(linked_user_id);
