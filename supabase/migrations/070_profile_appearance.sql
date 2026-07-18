-- ============================================================
-- 070_profile_appearance.sql
--
-- Persists each user's appearance preferences on their profile so
-- the same accent and mode follow them across browsers and devices.
--
-- The columns intentionally start nullable. Existing installations
-- previously kept these values only in localStorage, so the database
-- cannot know an existing user's choice during migration. NULL lets
-- the client retain that browser's cached choice until the user next
-- changes it; every subsequent change is written to the profile.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS appearance_theme TEXT,
  ADD COLUMN IF NOT EXISTS appearance_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_appearance_theme_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_appearance_theme_check
      CHECK (
        appearance_theme IS NULL
        OR appearance_theme IN ('violet', 'emerald', 'cobalt', 'amber', 'rose')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_appearance_mode_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_appearance_mode_check
      CHECK (appearance_mode IS NULL OR appearance_mode IN ('light', 'dark'));
  END IF;
END $$;

-- Migration 017 already limits profile UPDATEs to the row's own user,
-- which is exactly the permission model these personal settings need.
