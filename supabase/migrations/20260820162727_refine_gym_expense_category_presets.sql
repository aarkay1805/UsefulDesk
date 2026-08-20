-- Refine the gym-first expense catalogue without reviving categories that an
-- account has already renamed or archived.

CREATE OR REPLACE FUNCTION public.seed_default_expense_categories(
  p_account_id UUID
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.expense_categories(account_id, name, sort_order)
  SELECT p_account_id, category.name, category.ordinality::INTEGER
  FROM UNNEST(ARRAY[
    'Rent',
    'Staff salaries & trainer payouts',
    'Utilities',
    'Equipment & maintenance',
    'Marketing',
    'Cleaning & supplies',
    'Software & subscriptions',
    'Bank & gateway charges',
    'Taxes & licences',
    'Other'
  ]::TEXT[]) WITH ORDINALITY AS category(name, ordinality)
  WHERE EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.expense_categories AS existing
    WHERE existing.account_id = p_account_id
      AND LOWER(BTRIM(existing.name)) = LOWER(BTRIM(category.name))
  )
  ON CONFLICT DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.seed_default_expense_categories(UUID)
  FROM PUBLIC, anon, authenticated;

-- An active row with the exact old preset name is the only safe signal that
-- the seeded category is untouched. Renamed and archived rows remain as-is.
UPDATE public.expense_categories AS category
SET name = 'Staff salaries & trainer payouts'
WHERE category.is_active
  AND LOWER(BTRIM(category.name)) = 'salaries'
  AND NOT EXISTS (
    SELECT 1
    FROM public.expense_categories AS existing
    WHERE existing.account_id = category.account_id
      AND existing.id <> category.id
      AND LOWER(BTRIM(existing.name)) = 'staff salaries & trainer payouts'
  );

-- Add the new preset once to existing accounts, including accounts whose
-- other defaults have since been customized. An archived matching row wins.
INSERT INTO public.expense_categories(account_id, name, sort_order)
SELECT
  account.id,
  'Software & subscriptions',
  COALESCE(MAX(category.sort_order), 0) + 1
FROM public.accounts AS account
LEFT JOIN public.expense_categories AS category
  ON category.account_id = account.id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.expense_categories AS existing
  WHERE existing.account_id = account.id
    AND LOWER(BTRIM(existing.name)) = 'software & subscriptions'
)
GROUP BY account.id
ON CONFLICT DO NOTHING;
