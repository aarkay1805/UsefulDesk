-- Keep the account-seeding trigger helper internal and add covering indexes
-- for expense foreign keys used by category/staff lifecycle checks.

REVOKE ALL ON FUNCTION public.seed_expense_categories_for_new_account()
  FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS expenses_category_idx
  ON public.expenses(category_id);
CREATE INDEX IF NOT EXISTS expenses_recorded_by_idx
  ON public.expenses(recorded_by);
CREATE INDEX IF NOT EXISTS expenses_voided_by_idx
  ON public.expenses(voided_by)
  WHERE voided_by IS NOT NULL;
