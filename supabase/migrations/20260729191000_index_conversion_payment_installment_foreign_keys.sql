-- Cover the non-leading foreign-key columns introduced by the installment
-- tables. The account, membership, first-payment, and installment-plan keys
-- are already covered by composite or unique indexes in the parent migration.

CREATE INDEX IF NOT EXISTS idx_membership_installments_contact
  ON public.membership_installment_plans(contact_id);

CREATE INDEX IF NOT EXISTS idx_membership_installments_created_by
  ON public.membership_installment_plans(created_by);

CREATE INDEX IF NOT EXISTS idx_installment_reminders_membership
  ON public.installment_reminders_sent(membership_id);

CREATE INDEX IF NOT EXISTS idx_installment_reminders_contact
  ON public.installment_reminders_sent(contact_id);
