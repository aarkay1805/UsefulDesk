-- ============================================================
-- 038_account_upi.sql — Account UPI collection details (Phase 2)
--
-- "Collect on UPI" half of the renewal wedge, v1: the gym's UPI ID
-- (VPA) + payee display name stored on the account, so the app can
-- mint `upi://pay?...` deep links for exact due amounts — no payment
-- gateway, no mandate plumbing. Links are copied/shared into WhatsApp
-- chats; the money still lands directly in the owner's UPI account
-- and staff record it manually (payments ledger, 031).
--
-- Same single-column-on-accounts approach as default_currency (021).
-- RLS: accounts_update (017) already limits writes to admins+; every
-- member may read their account row, which is fine — staff need the
-- VPA to build links.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; constraint dropped/re-added.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS upi_vpa TEXT;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS upi_payee_name TEXT;

-- NPCI VPA shape: handle@psp (letters/digits/dot/hyphen/underscore,
-- then @, then a letter-only PSP suffix). NULL = UPI not configured.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_upi_vpa_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_upi_vpa_format
  CHECK (upi_vpa IS NULL OR upi_vpa ~ '^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$');
