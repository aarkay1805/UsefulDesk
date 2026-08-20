-- The preceding backfill can reveal an older account that never received the
-- original catalogue: it will contain only the newly added Software category.
-- Complete only that exact state so accounts with real category history are
-- never reseeded after customization or archival.

SELECT public.seed_default_expense_categories(account.id)
FROM public.accounts AS account
WHERE (
  SELECT COUNT(*)
  FROM public.expense_categories AS category
  WHERE category.account_id = account.id
) = 1
AND EXISTS (
  SELECT 1
  FROM public.expense_categories AS category
  WHERE category.account_id = account.id
    AND LOWER(BTRIM(category.name)) = 'software & subscriptions'
);
