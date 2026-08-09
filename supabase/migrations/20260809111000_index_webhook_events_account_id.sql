-- Preserve foreign-key lookup coverage after the Razorpay recovery index was
-- reshaped around provider mode and retry eligibility.
CREATE INDEX IF NOT EXISTS webhook_events_account_id_idx
  ON public.webhook_events (account_id);
