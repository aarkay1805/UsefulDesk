-- Keep selected-month acquisition cohorts and their to-date joining revenue
-- efficient as a branch's contact and payment ledgers grow.

CREATE INDEX IF NOT EXISTS idx_contacts_account_created_at
  ON public.contacts(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_account_contact_joining
  ON public.payments(account_id, contact_id)
  INCLUDE (amount)
  WHERE status = 'paid' AND payment_purpose = 'joining';
