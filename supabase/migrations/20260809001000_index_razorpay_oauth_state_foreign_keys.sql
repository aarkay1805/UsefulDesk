-- Cover the two service-only OAuth-state foreign keys so account/user cleanup
-- does not require a full table scan while expiring connection attempts exist.

CREATE INDEX IF NOT EXISTS razorpay_oauth_states_account_id_idx
  ON public.razorpay_oauth_states (account_id);

CREATE INDEX IF NOT EXISTS razorpay_oauth_states_initiated_by_idx
  ON public.razorpay_oauth_states (initiated_by);
