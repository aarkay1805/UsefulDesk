-- A visit stays open until front-desk staff checks the member out.
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendance_checkout_after_checkin'
      AND conrelid = 'public.attendance'::regclass
  ) THEN
    ALTER TABLE public.attendance
      ADD CONSTRAINT attendance_checkout_after_checkin
      CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at);
  END IF;
END $$;

COMMENT ON COLUMN public.attendance.checked_out_at IS
  'When the member left; NULL means the visit is still open.';
